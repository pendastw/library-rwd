const cheerio = require('cheerio');
const { getSession, destroySession, clearSessionCookie } = require('./_session');
const { HEADERS, BASE_URL, fetchWithTimeout, isBouncedToHome } = require('./auth');

// HyLib 個人書房各功能頁（皆在 /personalization/ 下，資料表都是 table.tablesorter）
const SECTIONS = [
  { key: 'lend',           title: '借閱中圖書', path: '/personalization/MyLendList.do' },
  { key: 'reserve',        title: '預約中圖書', path: '/personalization/MyResource.do?t=list' },
  { key: 'lendHistory',    title: '借閱歷史',   path: '/personalization/MyLendHistory.do' },
  { key: 'reserveHistory', title: '預約歷史',   path: '/personalization/MyResource.do?t=history' },
  { key: 'penalty',        title: '違規紀錄',   path: '/personalization/MyPenalty.do?t=all' },
];

function sectionUrl(section, page) {
  const sep = section.path.includes('?') ? '&' : '?';
  return `${BASE_URL}${section.path}${page > 1 ? `${sep}nowPage=${page}` : ''}`;
}

// 解析清單頁：table.tablesorter + 「共 N 筆資料 / 共 N 頁」
function parseListing(html) {
  const $ = cheerio.load(html);
  $('script, style').remove();

  let headers = [];
  const rows = [];
  let $table = $('table.tablesorter').first();
  // 保險：若沒有 tablesorter，就找欄位最多的資料表
  if ($table.length === 0) {
    let best = 0;
    $('table').each((_, t) => {
      const n = $(t).find('th').length;
      if (n > best && $(t).find('table').length === 0) { best = n; $table = $(t); }
    });
  }

  const rowIds = [];   // 每列動作 id（預約列 name=id、借閱列 name=extendId 的勾選框值；不可操作時為空）
  const rowNotes = []; // 不可操作時的原因（如借閱列「無法續借」的說明），供前端顯示
  if ($table && $table.length) {
    $table.find('tr').first().find('th').each((_, th) =>
      headers.push($(th).text().replace(/\s+/g, ' ').trim()));
    $table.find('tr').each((_, tr) => {
      const $tds = $(tr).find('td');
      if ($tds.length === 0) return;
      const cells = [];
      $tds.each((_, td) => cells.push($(td).text().replace(/\s+/g, ' ').trim()));
      if (cells.some(c => c)) {
        rows.push(cells);
        const $chk = $(tr).find('input[type=checkbox][name=id], input[type=checkbox][name=extendId]').first();
        const id = $chk.length ? ($chk.attr('value') || '') : '';
        let note = '';
        if (!id) {
          // 可續借才有勾選框；不可續借時原系統改放「無法續借」連結，說明藏在 title
          const $no = $(tr).find('a').filter((_, a) =>
            /無法續借|不可續借|不可預約|已續借/.test($(a).text())).first();
          if ($no.length) note = ($no.attr('title') || $no.text() || '').replace(/\s+/g, ' ').trim();
        }
        rowIds.push(id);
        rowNotes.push(note);
      }
    });

    // 去掉勾選框那類「表頭空白」的欄位
    const dropIdx = headers.map((h, i) => (h === '' ? i : -1)).filter(i => i >= 0);
    if (dropIdx.length) {
      headers = headers.filter((_, i) => !dropIdx.includes(i));
      for (let r = 0; r < rows.length; r++) {
        if (rows[r].length > headers.length) {
          rows[r] = rows[r].filter((_, i) => !dropIdx.includes(i));
        }
      }
    }
  }

  const text = $.text();
  const totalMatch = text.match(/共\s*([\d,]+)\s*筆資料/);
  const pagesMatch = text.match(/共\s*(\d+)\s*頁/);
  return {
    headers,
    rows,
    rowIds,
    rowNotes,
    total: totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : rows.length,
    totalPages: pagesMatch ? parseInt(pagesMatch[1]) : 1,
  };
}

// 哪些區塊有列操作：預約中可取消、借閱中可續借
const SECTION_ACTION = { reserve: 'cancel', lend: 'renew' };

// 解析 personal.jsp 首頁摘要：姓名、借閱/預約/費用統計
function parseSummary(html) {
  const $ = cheerio.load(html);
  $('script, style').remove();
  const text = $.text().replace(/\s+/g, ' ');

  const nameMatch = text.match(/([^\s,，!！]{1,20})\s*[,，]?\s*您好/);
  const pick = (re) => { const m = text.match(re); return m ? parseInt(m[1].replace(/,/g, '')) : 0; };

  return {
    name: nameMatch ? nameMatch[1] : '',
    lendCount:    pick(/借閱\/續借\s*:\s*(\d+)/),
    overdueCount: pick(/\(\s*(\d+)\s*件?\s*逾期/),
    reserveCount: pick(/預約\s*:\s*(\d+)\s*件/),
    arrivedCount: pick(/\(\s*(\d+)\s*件?\s*已到館/),
    fee:          pick(/待繳費用\s*:\s*([\d,]+)\s*元/),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: '尚未登入' });

  const cookie = `JSESSIONID=${sess.jsessionid}`;
  const fetchPage = async (url) => {
    const resp = await fetchWithTimeout(url, {
      headers: { ...HEADERS, 'Cookie': cookie, 'Referer': `${BASE_URL}/personalization/personal.jsp` },
    });
    return resp.text();
  };

  try {
    // ── 單一區塊分頁查詢：/api/personal?section=lendHistory&page=3 ──
    const sectionKey = req.query.section;
    if (sectionKey) {
      const section = SECTIONS.find(s => s.key === sectionKey);
      if (!section) return res.status(400).json({ error: '未知的資料區塊' });
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const html = await fetchPage(sectionUrl(section, page));
      if (isBouncedToHome(html)) {
        destroySession(req);
        clearSessionCookie(res);
        return res.status(401).json({ error: '連線已過期，請重新登入' });
      }
      if (req.query.debug === '1') {
        return res.json({ debug: true, url: sectionUrl(section, page), html });
      }
      return res.json({ key: section.key, title: section.title, page, action: SECTION_ACTION[section.key] || null, ...parseListing(html) });
    }

    // ── 總覽：主頁摘要 + 各區塊第一頁 ──
    const mainHtml = await fetchPage(`${BASE_URL}/personalization/personal.jsp`);
    if (isBouncedToHome(mainHtml)) {
      destroySession(req);
      clearSessionCookie(res);
      return res.status(401).json({ error: '連線已過期，請重新登入' });
    }

    const summary = parseSummary(mainHtml);

    const results = await Promise.allSettled(
      SECTIONS.map(async (s) => ({ section: s, html: await fetchPage(sectionUrl(s, 1)) }))
    );

    if (req.query.debug === '1') {
      return res.json({
        debug: true,
        pages: [{ url: 'personal.jsp', html: mainHtml }]
          .concat(results.filter(r => r.status === 'fulfilled')
            .map(r => ({ url: r.value.section.path, html: r.value.html }))),
      });
    }

    const sections = [];
    for (const r of results) {
      if (r.status !== 'fulfilled' || isBouncedToHome(r.value.html)) continue;
      sections.push({
        key: r.value.section.key,
        title: r.value.section.title,
        page: 1,
        action: SECTION_ACTION[r.value.section.key] || null,
        ...parseListing(r.value.html),
      });
    }

    res.json({ name: summary.name || sess.name || '', summary, sections });
  } catch (err) {
    console.error('Personal proxy error:', err);
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? '查詢逾時，原系統回應太慢，請稍後再試' : '查詢失敗，請稍後再試',
    });
  }
};
