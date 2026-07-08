/**
 * /api/booklist
 *   回傳原網站首頁 TabbedPanels3 目前「有書」的所有分類與書單：
 *   { categories: [ { name, books:[{title, marcid, cover, type}] } ] }
 *
 * 分類名稱與內容都是即時從原網站解析，原網站改跑馬燈分類（例如換學年度、
 * 新增類別）時，本站首頁會自動跟著更新，不需手動改程式。
 */
const cheerio = require('cheerio');

const BASE_URL = 'https://collections.dyhu.edu.tw';
const TIMEOUT_MS = 9000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
};

// 簡單 in-process cache (30 分鐘)
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;

async function fetchCategories() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const resp = await fetch(`${BASE_URL}/webpacIndex.jsp`, { headers: HEADERS, signal: controller.signal })
    .finally(() => clearTimeout(timer));
  const html = await resp.text();
  const $ = cheerio.load(html);

  // 分類頁籤名稱（順序對應內容面板）
  const tabs = $('#TabbedPanels3 .TabbedPanelsTabGroup .TabbedPanelsTab')
    .map((i, el) => $(el).text().replace(/\s+/g, ' ').trim().replace(/[.．…]+$/, '').trim())
    .get();

  const categories = [];
  $('#TabbedPanels3 .TabbedPanelsContentGroup .TabbedPanelsContent').each((panelIdx, panelEl) => {
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

      if (title && marcid) books.push({ title, marcid, cover, type: 'book' });
    });

    // 只保留真的有書的分類（例如「所有主題」只是連結，會被跳過）
    if (books.length) {
      categories.push({ name: tabs[panelIdx] || `分類${panelIdx + 1}`, books: books.slice(0, 20) });
    }
  });

  _cache = categories;
  _cacheTime = now;
  return categories;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const categories = await fetchCategories();
    res.json({ categories });
  } catch (err) {
    console.error('Booklist error:', err);
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? '載入逾時，請稍後再試' : '載入失敗',
      detail: err.message,
    });
  }
};
