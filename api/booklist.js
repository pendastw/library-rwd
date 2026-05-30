const fetch = require('node-fetch');
/**
 * /api/booklist?source=yueshu|ranking|movie|media2
 * 從原網站首頁 TabbedPanels3 解析四個跑馬燈分類（靜態 HTML 內嵌）
 *   panel 0 → 悅書訊
 *   panel 1 → 113學年度借閱排行
 *   panel 2 → 熱門電影
 *   panel 3 → 專業影片、其他
 */
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const BASE_URL = 'https://collections.dyhu.edu.tw';
const TIMEOUT_MS = 9000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
};

const SOURCE_PANEL = { yueshu: 0, ranking: 1, movie: 2, media2: 3 };

// 簡單 in-process cache (60分鐘)
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

async function fetchAllPanels() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const resp = await fetch(`${BASE_URL}/webpacIndex.jsp`, { headers: HEADERS, signal: controller.signal })
    .finally(() => clearTimeout(timer));
  const html = await resp.text();
  const $ = cheerio.load(html);

  const panels = [];
  $('#TabbedPanels3 .TabbedPanelsContent').each((panelIdx, panelEl) => {
    const books = [];
    const seen = new Set();

    $(panelEl).find('a[href*="bookDetail.do"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const idMatch = href.match(/[?&;]id=(\d+)/);
      if (!idMatch) return;
      const marcid = idMatch[1];
      if (seen.has(marcid)) return;
      seen.add(marcid);

      const title = $el.attr('title') || $el.text().trim() || '';

      // 封面：jscarousel-src 優先（延遲載入屬性），過濾預設圖
      const $img = $el.find('img[jscarousel-src]').first();
      let cover = $img.attr('jscarousel-src') || '';
      if (cover && cover.includes('defaultBook')) cover = '';
      if (cover && !cover.startsWith('http')) cover = `${BASE_URL}/${cover.replace(/^\//, '')}`;

      if (title && marcid) {
        books.push({ title, marcid, cover, type: 'book' });
      }
    });

    panels.push(books);
  });

  _cache = panels;
  _cacheTime = now;
  return panels;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const { source = 'yueshu' } = req.query;
  const panelIdx = SOURCE_PANEL[source];

  if (panelIdx === undefined) {
    return res.status(400).json({ error: '未知的 source 參數' });
  }

  try {
    const panels = await fetchAllPanels();
    const books = (panels[panelIdx] || []).slice(0, 20);
    res.json({ books, total: books.length });
  } catch (err) {
    console.error('Booklist error:', err);
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? '載入逾時，請稍後再試' : '載入失敗',
      detail: err.message,
    });
  }
};