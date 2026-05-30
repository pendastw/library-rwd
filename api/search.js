const fetch = require('node-fetch');
const cheerio = require('cheerio');

const BASE_URL = 'http://collections.dyhu.edu.tw';
const TIMEOUT_MS = 25000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const { q, field = 'FullText', page = 1, type = '' } = req.query;

  const TYPE_EXECODE = {
    book:    'webpac.dataType.book',
    ebook:   'webpac.dataType.ebook',
    journal: 'webpac.dataType.journal',
    media:   'webpac.dataType.media',
  };

  if (!q || !q.trim()) {
    return res.status(400).json({ error: '請輸入搜尋關鍵字' });
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

    // Step 1: 只取 session cookie，不下載 body
    const ctrl1 = new AbortController();
    const t1 = setTimeout(() => ctrl1.abort(), TIMEOUT_MS);
    const initResp = await fetch(
      `${BASE_URL}/bookSearchList.do?${new URLSearchParams(commonParams)}`,
      { headers: { ...HEADERS, 'Referer': `${BASE_URL}/webpacIndex.jsp` }, signal: ctrl1.signal }
    );
    clearTimeout(t1);

    const setCookie = initResp.headers.get('set-cookie') || '';
    const jsessionMatch = setCookie.match(/JSESSIONID=([^;,\s]+)/);
    const jsessionid = jsessionMatch ? jsessionMatch[1] : '';
    // 立刻取消 body 下載，我們只需要 cookie
    if (initResp.body) initResp.body.destroy ? initResp.body.destroy() : null;

    // Step 2: 用 session cookie 取得書單
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), TIMEOUT_MS);
    const bookResp = await fetch(
      `${BASE_URL}/booksearch.do?${new URLSearchParams(commonParams)}`,
      {
        headers: {
          ...HEADERS,
          'Referer': `${BASE_URL}/bookSearchList.do`,
          'Cookie': jsessionid ? `JSESSIONID=${jsessionid}` : '',
        },
        signal: ctrl2.signal,
      }
    );
    clearTimeout(t2);

    const html = await bookResp.text();

    if (req.query.debug === '1') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    const $ = cheerio.load(html);

    let total = 0;
    const totalMatch = $('body').text().match(/共查得\s*([\d,]+)\s*件/);
    if (totalMatch) total = parseInt(totalMatch[1].replace(/,/g, ''));

    const dataTypes = [];
    $('.sift ul li').each((_, li) => {
      const $li = $(li);
      const titleAttr = $li.find('a[title]').attr('title') || '';
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

    const books = [];
    $('a.bookname').each((_, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      if (!title) return;

      const href = $el.attr('href') || '';
      const idMatch = href.match(/[?&]id=(\d+)/);
      const marcid = idMatch ? idMatch[1] : '';

      const $td = $el.closest('td');
      const $row = $el.closest('tr');
      const typeImg = $row.find('img[title]').first();
      const typeTitle = typeImg.attr('title') || '';
      const typeSrc = typeImg.attr('src') || '';
      const isEbook = /電子書|e-book|E-resource/i.test(typeTitle + typeSrc);
      const bookType = isEbook ? 'ebook' : 'book';

      let ebookUrl = '';
      if (isEbook) {
        $td.find('a[href]').each((_, a) => {
          const aHref = $(a).attr('href') || '';
          if (aHref.startsWith('http') && !aHref.includes(BASE_URL)) {
            ebookUrl = aHref;
            return false;
          }
        });
        if (!ebookUrl) ebookUrl = `${BASE_URL}/bookDetail.do?id=${marcid}`;
      }

      const meta = {};
      $td.find('div.bookDetail ul li').each((_, li) => {
        const text = $(li).text().trim();
        const sep = text.indexOf('：');
        if (sep !== -1) meta[text.slice(0, sep).trim()] = text.slice(sep + 1).trim();
      });

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
        type: bookType,
        ebookUrl,
      });
    });

    res.json({ books, total, dataTypes, page: parseInt(page), query: q, field });
  } catch (err) {
    console.error('Search proxy error:', err);
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? '查詢逾時，原系統回應太慢，請稍後再試' : '查詢失敗，請稍後再試',
      detail: err.message,
    });
  }
};
