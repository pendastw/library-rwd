const cheerio = require('cheerio');

const BASE_URL = 'https://collections.dyhu.edu.tw';
const TIMEOUT_MS = 9000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
};

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── 簡易記憶體快取：同樣的查詢在 TTL 內直接回舊結果，避免短時間重複爬取被圖書館封鎖 IP ──
const SEARCH_CACHE_TTL = 15 * 60 * 1000; // 15 分鐘
const SEARCH_CACHE_MAX = 300;            // 最多保留筆數，避免記憶體無限成長
const _searchCache = new Map();          // key -> { time, data }

function cacheGet(key) {
  const hit = _searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > SEARCH_CACHE_TTL) { _searchCache.delete(key); return null; }
  return hit.data;
}
function cacheSet(key, data) {
  _searchCache.set(key, { time: Date.now(), data });
  if (_searchCache.size > SEARCH_CACHE_MAX) _searchCache.delete(_searchCache.keys().next().value);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const { q, field = 'FullText', page = 1, type = '' } = req.query;

  // 類型對應 execode
  const TYPE_EXECODE = {
    book:    'webpac.dataType.book',
    ebook:   'webpac.dataType.ebook',
    journal: 'webpac.dataType.journal',
    media:   'webpac.dataType.media',
  };

  if (!q || !q.trim()) {
    return res.status(400).json({ error: '請輸入搜尋關鍵字' });
  }

  const useCache = req.query.debug !== '1';
  const cacheKey = `s|${field}|${type}|${page}|${q.trim()}`;
  if (useCache) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }
  }

  try {
    const commonParams = {
      searchtype: 'simplesearch',
      execodeHidden: 'true',
      execode: TYPE_EXECODE[type] || '',
      authoriz: '1',
      search_field: field,
      search_input: q,
      searchsymbol: 'hyLibCore.webpac.search.common_symbol',
      nowpage: String(page),
    };

    // Step 1: 先呼叫 bookSearchList.do 取得 session cookie 和 resid
    const initResp = await fetchWithTimeout(
      `${BASE_URL}/bookSearchList.do?${new URLSearchParams(commonParams)}`,
      { headers: { ...HEADERS, 'Referer': `${BASE_URL}/webpacIndex.jsp` } }
    );

    const setCookie = initResp.headers.get('set-cookie') || '';
    const jsessionMatch = setCookie.match(/JSESSIONID=([^;,\s]+)/);
    const jsessionid = jsessionMatch ? jsessionMatch[1] : '';

    const initHtml = await initResp.text();
    const $init = cheerio.load(initHtml);

    // 從回傳的 HTML 中取出 resid（藏在 frame src 或連結中）
    let resid = '';
    $init('[src*="resid="], [href*="resid="]').each((_, el) => {
      const val = $init(el).attr('src') || $init(el).attr('href') || '';
      const m = val.match(/resid=(\d+)/);
      if (m) { resid = m[1]; return false; }
    });

    // Step 2: 呼叫 booksearch.do 取得真實書單
    const bookParams = new URLSearchParams({ ...commonParams });
    if (resid) bookParams.set('resid', resid);

    const cookieHeader = jsessionid ? `JSESSIONID=${jsessionid}` : '';
    const bookResp = await fetchWithTimeout(
      `${BASE_URL}/booksearch.do?${bookParams}`,
      { headers: { ...HEADERS, 'Referer': `${BASE_URL}/bookSearchList.do`, 'Cookie': cookieHeader } }
    );

    const html = await bookResp.text();

    if (req.query.debug === '1') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    const $ = cheerio.load(html);

    // 解析總筆數
    let total = 0;
    const totalMatch = $.text().match(/共查得\s*([\d,]+)\s*件/);
    if (totalMatch) total = parseInt(totalMatch[1].replace(/,/g, ''));

    // 解析資料類型篩選
    const dataTypes = [];
    $('.sift ul li').each((_, li) => {
      const $li = $(li);
      const titleAttr = $li.find('a[title]').attr('title') || '';
      const countText = $li.find('p').text().trim().replace(/[()（）]/g, '');
      const typeMatch = titleAttr.match(/^(.+?)\((\d+)\)$/);
      if (typeMatch) {
        const typeName = typeMatch[1];
        const count = parseInt(typeMatch[2]);
        const imgSrc = $li.find('img').attr('src') || '';
        const typeKey = imgSrc.includes('e-book') || imgSrc.includes('E-resource') ? 'ebook'
          : imgSrc.includes('journal') ? 'journal'
          : imgSrc.includes('digital') ? 'media'
          : 'book';
        dataTypes.push({ name: typeName, count, typeKey });
      }
    });

    // 解析書籍列表
    const books = [];
    $('a.bookname').each((_, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      if (!title) return;

      const href = $el.attr('href') || '';
      const idMatch = href.match(/[?&]id=(\d+)/);
      const marcid = idMatch ? idMatch[1] : '';

      const $td = $el.closest('td');

      // 判斷資料類型
      const $row = $el.closest('tr');
      const typeImg = $row.find('img[title]').first();
      const typeTitle = typeImg.attr('title') || '';
      const typeSrc = typeImg.attr('src') || '';
      const isEbook = /電子書|e-book|E-resource/i.test(typeTitle + typeSrc);
      const type = isEbook ? 'ebook' : 'book';

      // 電子書外部連結
      let ebookUrl = '';
      if (isEbook) {
        $td.find('a[href]').each((_, a) => {
          const aHref = $(a).attr('href') || '';
          if (aHref.startsWith('http') && !aHref.includes(BASE_URL)) {
            ebookUrl = aHref;
            return false;
          }
        });
        // 若無外部連結，連到原系統詳情頁
        if (!ebookUrl) ebookUrl = `${BASE_URL}/bookDetail.do?id=${marcid}`;
      }

      // 書目欄位
      const meta = {};
      $td.find('div.bookDetail ul li').each((_, li) => {
        const text = $(li).text().trim();
        const sep = text.indexOf('：');
        if (sep !== -1) meta[text.slice(0, sep).trim()] = text.slice(sep + 1).trim();
      });

      // 封面圖片
      let cover = $row.find('img[src1]').first().attr('src1') || '';
      if (cover && !cover.startsWith('http')) cover = `${BASE_URL}/${cover.replace(/^\//, '')}`;
      if (cover && cover.includes('defaultBook')) cover = '';

      books.push({
        title,
        author: meta['作者'] || '',
        publisher: meta['出版社'] || '',
        year: meta['出版年'] || '',
        cover,
        marcid,
        type,
        ebookUrl,
      });
    });

    const result = { books, total, dataTypes, page: parseInt(page), query: q, field };
    if (useCache) cacheSet(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Search proxy error:', err);
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? '查詢逾時，原系統回應太慢，請稍後再試' : '查詢失敗，請稍後再試',
      detail: err.message,
    });
  }
};
