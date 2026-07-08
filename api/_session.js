const crypto = require('crypto');

// ── 伺服器端 session：自訂 token ←→ HyLib JSESSIONID 對應表 ──
// 帳密只在登入當下轉送給原系統，不落地保存；這裡只留原系統的 session cookie。
// 注意：存在記憶體中，重啟 server 後所有人需重新登入（單機部署夠用）。
const SESSION_TTL = 30 * 60 * 1000; // 30 分鐘（每次使用自動延長）
const COOKIE_NAME = 'lib_sess';
const sessions = new Map(); // token -> { jsessionid, name, expires }

function sweep() {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
}

function createSession(data) {
  sweep();
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { ...data, expires: Date.now() + SESSION_TTL });
  return token;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function getSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (sess.expires < Date.now()) { sessions.delete(token); return null; }
  sess.expires = Date.now() + SESSION_TTL; // 使用中自動延長
  return { token, ...sess };
}

function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) sessions.delete(token);
  return token;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

module.exports = { createSession, getSession, destroySession, setSessionCookie, clearSessionCookie };
