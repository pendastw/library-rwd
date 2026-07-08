const cheerio = require('cheerio');
const { getSession, destroySession, clearSessionCookie } = require('./_session');
const { HEADERS, BASE_URL, fetchWithTimeout, isBouncedToHome } = require('./auth');

// 個人書房列操作：取消預約 / 續借（皆 POST 到 personalization/myListAct.do）
//   取消預約：action=ReserveCancer、勾選框 name=id  → 帶 id=<預約紀錄id>
//   續借    ：action=lendContinue、勾選框 name=extendId → 帶 extendId=<借閱id>
const ACTIONS = {
  cancel: { action: 'ReserveCancer', field: 'id',       label: '取消預約' },
  renew:  { action: 'lendContinue',  field: 'extendId', label: '續借' },
};

function resultMessage(html, label) {
  const alertMatch = html.match(/alert\(\s*["']([^"']+)["']\s*\)/);
  if (alertMatch) return alertMatch[1].trim();
  const $ = cheerio.load(html);
  $('script, style').remove();
  const text = $.text().replace(/\s+/g, ' ').trim();
  const m = text.match(new RegExp(`[^。!！]{0,20}(?:${label}|預約|續借|借閱)[^。!！]{0,20}(?:成功|完成|失敗|無法|不可|已達|上限)[^。!！]{0,15}`));
  if (m) return m[0].trim();
  return text.length <= 120 ? text : '';
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: '尚未登入' });

  const { type } = req.body || {};
  let ids = (req.body && req.body.ids) || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map(String).filter(v => /^\d+$/.test(v));

  const conf = ACTIONS[type];
  if (!conf) return res.status(400).json({ error: '未知的操作' });
  if (ids.length === 0) return res.status(400).json({ error: '缺少項目編號' });

  const cookie = `JSESSIONID=${sess.jsessionid}`;
  try {
    const body = new URLSearchParams();
    body.set('action', conf.action);
    for (const id of ids) body.append(conf.field, id);

    const resp = await fetchWithTimeout(`${BASE_URL}/personalization/myListAct.do`, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        ...HEADERS,
        'Cookie': cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/personalization/personal.jsp`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    });
    const html = await resp.text();

    if (isBouncedToHome(html)) {
      destroySession(req);
      clearSessionCookie(res);
      return res.status(401).json({ error: '連線已過期，請重新登入' });
    }

    if (String((req.body || {}).debug) === '1') {
      return res.json({ debug: true, sent: { action: conf.action, [conf.field]: ids }, len: html.length, html });
    }

    const msg = resultMessage(html, conf.label);
    // myListAct.do 成功時通常直接回到清單頁（無錯誤 alert）；有「失敗/無法/不可/上限」才算失敗
    const failed = /失敗|無法|不可|已達|上限|錯誤/.test(msg);
    if (failed) return res.status(422).json({ error: msg || `${conf.label}失敗` });
    return res.json({ ok: true, message: msg || `${conf.label}成功` });
  } catch (err) {
    console.error('MyAction proxy error:', err);
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? '連線逾時，原系統回應太慢，請稍後再試' : `${conf.label}失敗，請稍後再試`,
    });
  }
};
