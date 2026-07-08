// ── 個人書房：登入 + 個人資料呈現 ──────────────────────────

const loadingView  = document.getElementById('loadingView');
const loginView    = document.getElementById('loginView');
const personalView = document.getElementById('personalView');

let sectionsData = [];   // 各區塊目前頁的資料
let activeSection = '';  // 目前顯示的區塊 key

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function show(view) {
  [loadingView, loginView, personalView].forEach(v => v.style.display = 'none');
  view.style.display = 'block';
}

// ── 登入 ──────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errBox = document.getElementById('loginError');
  errBox.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '登入中…';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: document.getElementById('account').value.trim(),
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登入失敗');

    // 從其他頁（如書目預約）導來登入的，登入後跳回原頁
    const ret = new URLSearchParams(location.search).get('return');
    if (ret && /^[\w-]+\.html(\?[\w\-=&%.]*)?$/.test(ret)) {
      window.location.href = ret;
      return;
    }
    loadPersonal();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '登 入';
  }
});

// ── 登出 ──────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
  document.getElementById('password').value = '';
  const btn = document.getElementById('loginBtn');
  btn.disabled = false;
  btn.textContent = '登 入';
  show(loginView);
});

// ── 讀取並渲染個人資料 ────────────────────────────────
async function loadPersonal() {
  show(loadingView);
  try {
    const res = await fetch('/api/personal');
    if (res.status === 401) { show(loginView); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '查詢失敗');
    renderPersonal(data);
    show(personalView);
  } catch (err) {
    document.getElementById('personalContent').innerHTML =
      `<div class="error-box">${esc(err.message)}<br>
       <button class="btn-back" style="margin:0.75rem 0 0" onclick="loadPersonal()">重試</button></div>`;
    show(personalView);
  }
}

function renderPersonal(data) {
  document.getElementById('welcomeTitle').textContent =
    data.name ? `${data.name} 的個人書房` : '個人書房';

  sectionsData = data.sections || [];
  if (!activeSection || !sectionsData.some(s => s.key === activeSection)) {
    // 預設顯示第一個有資料的區塊，全空就顯示第一個
    const firstWithData = sectionsData.find(s => s.rows.length > 0);
    activeSection = (firstWithData || sectionsData[0] || {}).key || '';
  }

  const s = data.summary || {};
  const summaryHtml = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-num">${s.lendCount ?? 0}</div>
        <div class="summary-label">借閱中${s.overdueCount ? `<span class="summary-warn">（逾期 ${s.overdueCount}）</span>` : ''}</div>
      </div>
      <div class="summary-card">
        <div class="summary-num">${s.reserveCount ?? 0}</div>
        <div class="summary-label">預約中${s.arrivedCount ? `<span class="summary-ok">（已到館 ${s.arrivedCount}）</span>` : ''}</div>
      </div>
      <div class="summary-card">
        <div class="summary-num">${s.fee ?? 0} <small>元</small></div>
        <div class="summary-label">待繳費用</div>
      </div>
    </div>`;

  const tabsHtml = `
    <div class="type-tabs" id="sectionTabs">
      ${sectionsData.map(sec => `
        <button class="type-tab${sec.key === activeSection ? ' active' : ''}" data-key="${esc(sec.key)}">
          ${esc(sec.title)}${sec.total ? `<span class="tab-count">${sec.total}</span>` : ''}
        </button>`).join('')}
    </div>`;

  document.getElementById('personalContent').innerHTML =
    summaryHtml + tabsHtml + `<div id="sectionBody"></div>`;

  document.getElementById('sectionTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.type-tab');
    if (!btn) return;
    activeSection = btn.dataset.key;
    document.querySelectorAll('#sectionTabs .type-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.key === activeSection));
    renderSection();
  });

  renderSection();
}

function renderSection() {
  const sec = sectionsData.find(s => s.key === activeSection);
  const body = document.getElementById('sectionBody');
  if (!sec) { body.innerHTML = ''; return; }

  const headers = sec.headers || [];
  const rows = sec.rows || [];
  const rowIds = sec.rowIds || [];
  const rowNotes = sec.rowNotes || [];
  const action = sec.action; // 'cancel'（取消預約）| 'renew'（續借）| null
  const actionLabel = action === 'cancel' ? '取消' : action === 'renew' ? '續借' : '';

  const tableHtml = rows.length === 0
    ? '<p class="account-empty">目前沒有資料</p>'
    : `<div class="table-scroll">
        <table class="data-table">
          ${headers.length ? `<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}${action ? '<th>操作</th>' : ''}</tr></thead>` : ''}
          <tbody>
            ${rows.map((cells, ri) => {
              const id = rowIds[ri];
              const note = rowNotes[ri];
              let actCell = '';
              if (action) {
                if (id) {
                  actCell = `<td data-label="操作"><button class="row-action-btn" data-action="${esc(action)}" data-id="${esc(id)}">${actionLabel}</button></td>`;
                } else if (note) {
                  actCell = `<td data-label="操作"><span class="row-action-note" title="${esc(note)}">無法${actionLabel}</span></td>`;
                } else {
                  actCell = '<td data-label="操作">—</td>';
                }
              }
              return `<tr>${cells.map((c, i) =>
                `<td${headers[i] ? ` data-label="${esc(headers[i])}"` : ''}>${esc(c)}</td>`).join('')}${actCell}</tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

  const totalPages = sec.totalPages || 1;
  const pagerHtml = totalPages <= 1 ? '' : `
    <div class="pagination">
      <button class="btn-page" ${sec.page <= 1 ? 'disabled' : ''} onclick="loadSectionPage('${esc(sec.key)}', ${sec.page - 1})">‹ 上一頁</button>
      <span class="results-count">第 ${sec.page} / ${totalPages} 頁（共 ${sec.total} 筆）</span>
      <button class="btn-page" ${sec.page >= totalPages ? 'disabled' : ''} onclick="loadSectionPage('${esc(sec.key)}', ${sec.page + 1})">下一頁 ›</button>
    </div>`;

  body.innerHTML = `
    <div class="detail-card account-card">
      <h2>${esc(sec.title)}</h2>
      ${tableHtml}
    </div>
    ${pagerHtml}`;

  body.querySelectorAll('.row-action-btn').forEach(btn => {
    btn.addEventListener('click', () => doRowAction(btn));
  });
  // 「無法續借」點擊顯示原因（手機上沒有 title 提示）
  body.querySelectorAll('.row-action-note').forEach(el => {
    el.addEventListener('click', () => { const t = el.getAttribute('title'); if (t) alert(t); });
  });
}

// 取消預約 / 續借
async function doRowAction(btn) {
  const type = btn.dataset.action;
  const id = btn.dataset.id;
  const label = type === 'cancel' ? '取消這筆預約' : '續借這本書';
  if (!confirm(`確定要${label}嗎？`)) return;

  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '處理中…';
  try {
    const res = await fetch('/api/myaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ids: [id] }),
    });
    if (res.status === 401) { show(loginView); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '操作失敗');
    // 成功後重載當前區塊與摘要數字
    alert(data.message || (type === 'cancel' ? '已取消預約' : '續借成功'));
    await refreshSummary();
    loadSectionPage(activeSection, 1);
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// 重新抓摘要卡片數字（借閱中/預約中/待繳費用）
async function refreshSummary() {
  try {
    const res = await fetch('/api/personal');
    if (!res.ok) return;
    const data = await res.json();
    const s = data.summary || {};
    const setNum = (i, html) => {
      const el = document.querySelectorAll('.summary-card')[i];
      if (el) el.querySelector('.summary-num').innerHTML = html;
    };
    setNum(0, `${s.lendCount ?? 0}`);
    setNum(1, `${s.reserveCount ?? 0}`);
    setNum(2, `${s.fee ?? 0} <small>元</small>`);
    // 更新分頁籤上的筆數
    if (Array.isArray(data.sections)) {
      data.sections.forEach(ns => {
        const idx = sectionsData.findIndex(s => s.key === ns.key);
        if (idx >= 0) sectionsData[idx].total = ns.total;
        const tab = document.querySelector(`#sectionTabs .type-tab[data-key="${ns.key}"] .tab-count`);
        if (tab) tab.textContent = ns.total;
      });
    }
  } catch (_) {}
}

async function loadSectionPage(key, page) {
  const body = document.getElementById('sectionBody');
  body.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const res = await fetch(`/api/personal?section=${encodeURIComponent(key)}&page=${page}`);
    if (res.status === 401) { show(loginView); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '查詢失敗');
    const idx = sectionsData.findIndex(s => s.key === key);
    if (idx >= 0) sectionsData[idx] = { ...sectionsData[idx], ...data };
    renderSection();
  } catch (err) {
    body.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// 初始：檢查是否已登入
loadPersonal();
