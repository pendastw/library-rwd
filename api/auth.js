const { createSession, destroySession, getSession, setSessionCookie, clearSessionCookie } = require('./_session');

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

// 從回應收集所有 Set-Cookie 裡的 JSESSIONID
function extractJsessionid(resp) {
  const raw = typeof resp.headers.getSetCookie === 'function'
    ? resp.headers.getSetCookie().join(', ')
    : (resp.headers.get('set-cookie') || '');
  const m = raw.match(/JSESSIONID=([^;,\s]+)/);
  return m ? m[1] : '';
}

// 未登入時 HyLib 的個人頁會用 JS 導回首頁，以此判斷 session 是否有效
function isBouncedToHome(html) {
  return /location\.href\s*=\s*["']https?:\/\/collections\.dyhu\.edu\.tw\/?["']/.test(html);
}

async function fetchPersonalPage(jsessionid) {
  const resp = await fetchWithTimeout(`${BASE_URL}/personalization/personal.jsp`, {
    headers: { ...HEADERS, 'Cookie': `JSESSIONID=${jsessionid}`, 'Referer': `${BASE_URL}/login.jsp` },
  });
  return resp.text();
}

// 從個人頁嘗試抓出讀者姓名（抓不到就回空字串，前端會有預設稱呼）
function extractReaderName(html) {
  const patterns = [
    /([^\s,，!！<>]{1,20})\s*[,，]?\s*您好/,
    /親愛的\s*([^，,<\s]{1,20})/,
    /讀者[:：]\s*([^<，,\s]{1,20})/,
    /姓名[:：]\s*(?:<[^>]+>\s*)*([^<，,\s]{1,20})/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].trim();
  }
  return '';
}

async function login(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const { account, password } = req.body || {};
  if (!account || !password) {
    return res.status(400).json({ error: '請輸入證號與密碼' });
  }

  try {
    // Step 1: 取得原系統 session cookie 與 csrfToken
    const loginPageResp = await fetchWithTimeout(`${BASE_URL}/login.jsp`, { headers: HEADERS });
    let jsessionid = extractJsessionid(loginPageResp);
    const loginHtml = await loginPageResp.text();
    const csrfMatch = loginHtml.match(/name="csrfToken"[^>]*value="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';
    if (!jsessionid || !csrfToken) {
      return res.status(502).json({ error: '無法連線至圖書館系統，請稍後再試' });
    }

    // Step 2: 代送登入表單
    const body = new URLSearchParams({
      account2: account,
      passwd2: password,
      csrfToken,
      rdurl: '/personalization/personal.jsp',
    });
    const loginResp = await fetchWithTimeout(`${BASE_URL}/personalization/memberLoginAct.do`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `JSESSIONID=${jsessionid}`,
        'Referer': `${BASE_URL}/login.jsp`,
        'Origin': BASE_URL,
      },
      body: body.toString(),
    });

    // 登入成功後系統可能換發新的 JSESSIONID
    const newJsessionid = extractJsessionid(loginResp);
    if (newJsessionid) jsessionid = newJsessionid;

    // 登入失敗時通常會在回應中用 alert() 顯示原因
    let failMessage = '';
    if (loginResp.status !== 301 && loginResp.status !== 302) {
      const respHtml = await loginResp.text();
      const alertMatch = respHtml.match(/alert\(\s*["']([^"']+)["']\s*\)/);
      if (alertMatch) failMessage = alertMatch[1];
    }

    // Step 3: 用個人頁驗證是否真的登入成功
    const personalHtml = await fetchPersonalPage(jsessionid);
    if (isBouncedToHome(personalHtml)) {
      return res.status(401).json({
        error: failMessage || '登入失敗，請確認證號與密碼是否正確',
      });
    }

    const name = extractReaderName(personalHtml);
    const token = createSession({ jsessionid, name });
    setSessionCookie(res, token);
    res.json({ ok: true, name });
  } catch (err) {
    console.error('Login proxy error:', err);
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? '連線逾時，原系統回應太慢，請稍後再試' : '登入失敗，請稍後再試',
    });
  }
}

async function logout(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const sess = getSession(req);
  destroySession(req);
  clearSessionCookie(res);
  // 順手通知原系統登出（失敗也無妨，session 過期會自動失效）
  if (sess && sess.jsessionid) {
    try {
      await fetchWithTimeout(`${BASE_URL}/personalization/memberLogoutAct.do`, {
        headers: { ...HEADERS, 'Cookie': `JSESSIONID=${sess.jsessionid}` },
      });
    } catch (_) { /* ignore */ }
  }
  res.json({ ok: true });
}

async function status(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const sess = getSession(req);
  if (!sess) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, name: sess.name || '' });
}

module.exports = { login, logout, status, HEADERS, BASE_URL, fetchWithTimeout, isBouncedToHome };
