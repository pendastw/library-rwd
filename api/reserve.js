const cheerio = require('cheerio');
const { getSession, destroySession, clearSessionCookie } = require('./_session');
const { HEADERS, BASE_URL, fetchWithTimeout, isBouncedToHome } = require('./auth');

// 站內預約（需已登入會員）：
// 登入狀態下，館藏 AJAX（HoldListForBookDetailAjax.do）的預約按鈕會指向
//   personalization/reserveAdd.do?id=&site=&hold=&readerType=&keeproom=&collectionDef=&purpose=
// 這個端點認會員 session、不需再輸密碼。流程：
//   1. 用會員 session 抓館藏 AJAX，取出指定冊號(hold)的 reserveAdd.do 網址（含 readerType）
//   2. 呼叫 reserveAdd.do 完成預約，解析回應訊息

function pageMessage(html) {
  const alertMatch = html.match(/alert\(\s*["']([^"']+)["']\s*\)/);
  if (alertMatch) return alertMatch[1].trim();
  const $ = cheerio.load(html);
  $('script, style').remove();
  const text = $.text().replace(/\s+/g, ' ').trim();
  const msgMatch = text.match(/([^。!！]{0,30}預約[^。!！]{0,30}(?:成功|完成|失敗|重複|上限|已滿|不可|無法)[^。!！]{0,20})/);
  if (msgMatch) return msgMatch[1].trim();
  return text.length <= 120 ? text : '';
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: '尚未登入' });

  const src = req.method === 'POST' ? (req.body || {}) : req.query;
  const marcid = String(src.marcid || src.id || '');
  if (!/^\d+$/.test(marcid)) return res.status(400).json({ error: '缺少書目編號' });
  const wantHold = String(src.hold || '');

  const cookie = `JSESSIONID=${sess.jsessionid}`;
  const commonHeaders = {
    ...HEADERS,
    'Cookie': cookie,
    'Referer': `${BASE_URL}/bookDetail.do?id=${marcid}`,
  };

  try {
    // Step 1: 用會員 session 抓館藏 AJAX，取得該冊的 reserveAdd.do 網址
    const holdResp = await fetchWithTimeout(`${BASE_URL}/maintain/HoldListForBookDetailAjax.do`, {
      method: 'POST',
      headers: { ...commonHeaders, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `id=${encodeURIComponent(marcid)}`,
    });
    const holdHtml = await holdResp.text();

    if (isBouncedToHome(holdHtml)) {
      destroySession(req);
      clearSessionCookie(res);
      return res.status(401).json({ error: '連線已過期，請重新登入' });
    }

    // 找出 reserveAdd.do 連結；有指定冊號就挑對應那冊，否則取第一個
    const matches = [...holdHtml.matchAll(/reserveAdd\.do\?([^'"&][^'"]*)/g)].map(m => m[1]);
    let chosen = null;
    for (const q of matches) {
      const p = new URLSearchParams(q.replace(/&amp;/g, '&'));
      if (!wantHold || p.get('hold') === wantHold) { chosen = p; break; }
    }
    if (!chosen && matches.length) chosen = new URLSearchParams(matches[0].replace(/&amp;/g, '&'));

    if (!chosen) {
      // 沒有預約按鈕 → 此書目前不可預約（可能已在架、或不開放）
      return res.status(422).json({ error: '此書目前不可預約（可能已在架或不開放預約）' });
    }

    // 只保留預約需要的參數（去掉 thickbox 的 height/width/TB_iframe 等）
    const reserveParams = new URLSearchParams();
    for (const k of ['id', 'site', 'hold', 'readerType', 'keeproom', 'collectionDef', 'purpose']) {
      const v = chosen.get(k);
      if (v !== null && v !== '') reserveParams.set(k, v);
    }

    const reserveUrl = `${BASE_URL}/personalization/reserveAdd.do?${reserveParams}`;

    // Step 2: 呼叫 reserveAdd.do
    const doResp = await fetchWithTimeout(reserveUrl, {
      headers: { ...commonHeaders, 'X-Requested-With': 'XMLHttpRequest' },
    });
    const doHtml = await doResp.text();

    // 除錯模式：回傳 reserveAdd.do 原始回應（送出前先檢查用）
    if (String(src.debug) === '1') {
      return res.json({ debug: true, reserveUrl, params: Object.fromEntries(reserveParams), html: doHtml });
    }

    // reserveAdd.do 可能直接完成預約並回訊息，或回一個需再送出的確認表單
    const $ = cheerio.load(doHtml);
    const $form = $('form').filter((_, f) => {
      const action = $(f).attr('action') || '';
      return /reserveAdd|Reserve|Hold/i.test(action) && $(f).find('input, select').length > 0;
    }).first();

    let resultHtml = doHtml;
    if (req.method === 'POST' && $form.length) {
      // 有確認表單 → 帶著欄位再 POST 一次
      const fields = {};
      $form.find('input').each((_, el) => {
        const name = $(el).attr('name');
        if (!name) return;
        const type = ($(el).attr('type') || 'text').toLowerCase();
        if (['submit', 'button', 'image', 'reset'].includes(type)) return;
        if ((type === 'radio' || type === 'checkbox') && $(el).attr('checked') === undefined) return;
        fields[name] = $(el).attr('value') || '';
      });
      $form.find('select').each((_, el) => {
        const name = $(el).attr('name');
        if (!name) return;
        const $sel = $(el).find('option[selected]').first();
        const $opt = $sel.length ? $sel : $(el).find('option').first();
        fields[name] = $opt.attr('value') !== undefined ? $opt.attr('value') : $opt.text().trim();
      });
      const submitUrl = new URL($form.attr('action'), `${BASE_URL}/personalization/`).href;
      const subResp = await fetchWithTimeout(submitUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { ...commonHeaders, 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': BASE_URL },
        body: new URLSearchParams(fields).toString(),
      });
      resultHtml = await subResp.text();
    }

    // GET（預覽）模式：只回報偵測到的表單資訊，不送出
    if (req.method !== 'POST') {
      return res.json({ ok: true, step: 'preview', reserveUrl, hasConfirmForm: $form.length > 0, message: pageMessage(doHtml) });
    }

    const msg = pageMessage(resultHtml);
    const success = /成功|完成|已預約/.test(msg) || /成功|完成/.test(pageMessage(doHtml));
    if (success) return res.json({ ok: true, message: msg || '預約成功' });
    return res.status(422).json({ error: msg || '預約結果不明，請至個人書房或原系統確認' });
  } catch (err) {
    console.error('Reserve proxy error:', err);
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? '連線逾時，原系統回應太慢，請稍後再試' : '預約失敗，請稍後再試',
    });
  }
};
