const cheerio = require('cheerio');

const BASE_URL = 'https://collections.dyhu.edu.tw';
const TIMEOUT_MS = 9000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
};

// 解析 MARC 欄位字串，例如 "|a書名|f作者" → { a: '書名', f: '作者' }
function parseMarcSubfields(str) {
  const result = {};
  const parts = str.split('|').filter(Boolean);
  for (const part of parts) {
    if (part.length >= 2) {
      result[part[0]] = part.slice(1).trim();
    }
  }
  return result;
}

// ── 簡易記憶體快取：書目/館藏資料幾乎不變，快取較久，避免重複爬取被圖書館封鎖 IP ──
const DETAIL_CACHE_TTL = 10 * 60 * 1000; // 10 分鐘（含即時館藏狀態，故不宜快取太久）
const DETAIL_CACHE_MAX = 500;
const _detailCache = new Map();              // key -> { time, data }

function cacheGet(key) {
  const hit = _detailCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > DETAIL_CACHE_TTL) { _detailCache.delete(key); return null; }
  return hit.data;
}
function cacheSet(key, data) {
  _detailCache.set(key, { time: Date.now(), data });
  if (_detailCache.size > DETAIL_CACHE_MAX) _detailCache.delete(_detailCache.keys().next().value);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const { marcid } = req.query;
  if (!marcid) return res.status(400).json({ error: '缺少書籍 ID' });

  const useCache = req.query.debug !== '1' && req.query.debughold !== '1';
  const cacheKey = `d|${marcid}`;
  if (useCache) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }
  }

  try {
    // 手動跟隨 redirect 並收集所有 cookie
    async function fetchWithCookies(url, options = {}) {
      let cookies = options.cookies || {};
      let currentUrl = url;

      for (let i = 0; i < 5; i++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        const resp = await fetch(currentUrl, {
          ...options,
          redirect: 'manual',
          signal: controller.signal,
          headers: { ...HEADERS, ...(options.headers || {}), 'Cookie': cookieStr },
        }).finally(() => clearTimeout(timer));

        // 收集所有 set-cookie
        const raw = resp.headers.get('set-cookie') || '';
        for (const match of raw.matchAll(/([^=,;\s]+)=([^;,\s]*)/g)) {
          if (!['path','domain','expires','max-age','samesite','httponly','secure'].includes(match[1].toLowerCase())) {
            cookies[match[1]] = match[2];
          }
        }

        if (resp.status >= 300 && resp.status < 400) {
          currentUrl = new URL(resp.headers.get('location'), BASE_URL).toString();
          continue;
        }
        return { resp, cookies };
      }
      throw new Error('Too many redirects');
    }

    // Step 1：訪問首頁取得初始 session
    const { cookies: c1 } = await fetchWithCookies(`${BASE_URL}/webpacIndex.jsp`);

    // Step 2：訪問書籍詳情頁（同一 session）
    const url = `${BASE_URL}/bookDetail.do?id=${encodeURIComponent(marcid)}`;
    const { resp: response, cookies: c2 } = await fetchWithCookies(url, {
      cookies: c1,
      headers: { 'Referer': `${BASE_URL}/webpacIndex.jsp` },
    });

    if (!response.ok) throw new Error(`原系統回應錯誤: ${response.status}`);
    const cookieHeader = Object.entries(c2).map(([k, v]) => `${k}=${v}`).join('; ');

    const html = await response.text();

    if (req.query.debug === '1') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    const $ = cheerio.load(html);
    const detail = {};

    // ── 書名 ──────────────────────────────────
    detail.title = $('td.mainconC h3').first().text().trim()
      || $('meta[name="Title"]').attr('content')
      || '';

    // ── 封面圖（博客來圖片）──────────────────
    const $coverImg = $('div.scrollableDiv img[src]').first();
    const coverSrc = $coverImg.attr('src') || '';
    detail.cover = coverSrc.startsWith('http') ? coverSrc : '';

    // ── 解析 MARC 原始欄位 ────────────────────
    const marc = {}; // { '200': '|a書名|f作者...', ... }
    $('div#detailViewMARC table tr').each((_, tr) => {
      const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
      if (cells.length >= 3 && /^\d{3}$/.test(cells[0])) {
        marc[cells[0]] = (marc[cells[0]] || '') + cells[2];
      }
    });

    // 200：書名 / 著者
    if (marc['200']) {
      const sf = parseMarcSubfields(marc['200']);
      if (!detail.title && sf.a) detail.title = sf.a;
      if (sf.f) detail['著者'] = sf.f;
      if (sf.g) detail['譯者'] = sf.g;
    }

    // 210：出版地 / 出版社 / 出版年
    if (marc['210']) {
      const sf = parseMarcSubfields(marc['210']);
      if (sf.a) detail['出版地'] = sf.a;
      if (sf.c) detail['出版社'] = sf.c;
      if (sf.d) detail['出版年'] = sf.d;
    }

    // 010：ISBN
    if (marc['010']) {
      const sf = parseMarcSubfields(marc['010']);
      if (sf.a) detail['ISBN'] = sf.a;
    }

    // 215：頁數
    if (marc['215']) {
      const sf = parseMarcSubfields(marc['215']);
      if (sf.a) detail['頁數'] = sf.a;
    }

    // 205：版次
    if (marc['205']) {
      const sf = parseMarcSubfields(marc['205']);
      if (sf.a) detail['版次'] = sf.a;
    }

    // 606：主題
    const subjects = [];
    $('div#detailViewMARC table tr').each((_, tr) => {
      const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
      if (cells[0] === '606') {
        const sf = parseMarcSubfields(cells[2] || '');
        if (sf.a) subjects.push(sf.a);
      }
    });
    if (subjects.length) detail['主題'] = subjects.join('；');

    // ── 館藏資訊：直接從 MARC 805 欄位解析 ────────
    // 805 欄位包含每冊的條碼、索書號、館藏類型等，不需要額外 API
    // 格式：|a序號|b館藏代碼|c條碼|d索書號主|e索書號副|t館藏類型|x附件
    const COLLECTION_MAP = {
      CB: '中文書櫃', EB: '英文書櫃', PB: '期刊室',
      VB: '視聽資料', RB: '參考書區', TB: '論文區',
    };
    const holdings = [];
    $('div#detailViewMARC table tr').each((_, tr) => {
      const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
      if (cells[0] !== '805') return;
      const sf = parseMarcSubfields(cells[2] || '');
      const colCode = sf.b || '';
      const location = COLLECTION_MAP[colCode] || colCode || '圖書館';
      const callNo = [sf.d, sf.e].filter(Boolean).join(' ');
      holdings.push({
        barcode:  sf.c || '',
        location,
        callNo,
        type:     sf.t || '一般圖書',
        attach:   sf.x || '',
        status:   '請至館內確認',
      });
    });
    detail.holdings = holdings;
    // 若無 805 欄位，提供原系統連結讓使用者自行查詢
    detail.holdingsUrl = holdings.length === 0
      ? `${BASE_URL}/bookDetail.do?id=${marcid}`
      : '';

    // ── 即時館藏狀態：呼叫 HoldListForBookDetailAjax.do 取得每冊「目前狀態」（書在館 / 借出+到期日）──
    // 回傳為 HTML 表格，欄位順序：序｜條碼｜館藏位置｜索書號｜資料類型｜目前狀態｜架號｜附件｜預約
    try {
      const holdController = new AbortController();
      const holdTimer = setTimeout(() => holdController.abort(), TIMEOUT_MS);
      const holdResp = await fetch(`${BASE_URL}/maintain/HoldListForBookDetailAjax.do`, {
        method: 'POST',
        signal: holdController.signal,
        headers: {
          ...HEADERS,
          'Cookie': cookieHeader,
          'Referer': `${BASE_URL}/bookDetail.do?id=${marcid}`,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `id=${encodeURIComponent(marcid)}`,
      }).finally(() => clearTimeout(holdTimer));

      const $h = cheerio.load(await holdResp.text());
      const liveHoldings = [];
      $h('table tr').each((_, tr) => {
        const tds = $h(tr).find('td');
        if (tds.length < 9) return;
        const cell = (i) => $h(tds[i]).text().replace(/\s+/g, ' ').trim();
        if (!/^\d+$/.test(cell(0))) return; // 跳過表頭列（第一欄非序號）

        // 預約欄的按鈕 onclick 帶著這一冊的預約參數（Login4Reserve.do?...&hold=冊號...），
        // 站內預約 API 需要原樣轉送這些參數
        let reserveParams = null;
        const onclick = $h(tds[8]).find('input[onclick], a[onclick]').attr('onclick') || '';
        const urlMatch = onclick.match(/Login4Reserve\.do\?([^'"]+)/);
        if (urlMatch) {
          reserveParams = {};
          for (const [k, v] of new URLSearchParams(urlMatch[1])) {
            if (['id', 'site', 'hold', 'keeproom', 'collectionDef', 'purpose'].includes(k)) reserveParams[k] = v;
          }
        }

        liveHoldings.push({
          barcode:  cell(1),
          location: cell(2),
          callNo:   cell(3),
          type:     cell(4),
          status:   cell(5), // 書在館 / 借出（可能含到期日）
          shelf:    cell(6),
          reserve:  cell(8),
          reserveParams,
        });
      });
      // 有即時資料就用它取代 MARC 805 版本（含真正的借閱狀態）
      if (liveHoldings.length) {
        detail.holdings = liveHoldings;
        detail.holdingsUrl = '';
      }
    } catch (e) {
      // 即時館藏抓取失敗就沿用上面的 MARC 805 版本（狀態顯示「請至館內確認」）
    }

    if (req.query.debughold === '1') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.json({ internalId, marc001: marc['001'], marcid, holdingsRaw: holdings });
    }

    const result = { detail, marcid };
    if (useCache) cacheSet(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Detail proxy error:', err);
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? '查詢逾時，原系統回應太慢，請稍後再試' : '取得書籍資料失敗',
      detail: err.message,
    });
  }
};
