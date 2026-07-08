const params = new URLSearchParams(location.search);
const marcid = params.get('marcid') || '';
const backUrl = params.get('back') || 'results.html';

const contentEl = document.getElementById('detailContent');
const backBtn = document.getElementById('backBtn');
backBtn.href = backUrl;

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadDetail() {
  if (!marcid) {
    contentEl.innerHTML = `<div class="error-box"><p>缺少書籍 ID，請從搜尋結果頁進入。</p></div>`;
    return;
  }

  try {
    const res = await fetch(`/api/detail?marcid=${encodeURIComponent(marcid)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '載入失敗');
    render(data.detail);
  } catch (err) {
    contentEl.innerHTML = `<div class="error-box"><p>⚠️ ${escHtml(err.message)}</p></div>`;
  }
}

// Fields to exclude from the generic table (shown separately)
const EXCLUDED = new Set(['title', 'cover', 'holdings', 'holdingsUrl']);

// Display name mapping for common MARC-like labels
const LABEL_MAP = {
  '題名': '書名', '著者': '作者', '出版年': '出版年',
  '出版地': '出版地', '出版者': '出版社', 'ISBN': 'ISBN',
  '頁數': '頁數', '叢書名': '叢書', '附註': '附註',
  '主題': '主題', '分類號': '分類號', '索書號': '索書號',
};

// 依 HyLib 館藏狀態分類，回傳徽章 HTML 與到期日
// 規則：在館 → 綠色「在館」；已被外借 → 橘色「外借中，可預約」；其他(自動報銷等) → 灰色原文
function holdingBadge(h) {
  const raw = (h.status || '').trim();
  if (/書在館|在館/.test(raw)) {
    return { html: `<span class="holding-status status-available">在館</span>`, due: '' };
  }
  if (/外借|借出/.test(raw)) {
    const reservable = !/不可預約/.test(h.reserve || '');
    const due = (raw.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/) || [''])[0];
    return {
      html: `<span class="holding-status status-borrowed">外借中${reservable ? '，可預約' : ''}</span>`,
      due,
    };
  }
  // 自動報銷、整理中等 → 顯示原文，不提示預約
  return { html: `<span class="holding-status" style="background:#eee;color:#666">${escHtml(raw || '—')}</span>`, due: '' };
}

function render(detail) {
  document.title = `${detail.title || '書籍詳情'} — 圖書館館藏查詢`;

  const coverHtml = detail.cover
    ? `<div class="detail-cover"><img src="${escHtml(detail.cover)}" alt="封面" onerror="this.parentElement.outerHTML='<div class=\\'detail-cover-placeholder\\'>📚</div>'"></div>`
    : `<div class="detail-cover-placeholder">📚</div>`;

  // Generic MARC fields
  const fieldRows = Object.entries(detail)
    .filter(([k]) => !EXCLUDED.has(k) && k)
    .map(([k, v]) => {
      const label = LABEL_MAP[k] || k;
      return `<tr><th>${escHtml(label)}</th><td>${escHtml(v)}</td></tr>`;
    }).join('');

  // 可預約的冊 = 原系統館藏表格有帶預約參數的（外借中且開放預約）
  const anyReservable = (detail.holdings || []).some(h => h.reserveParams);

  // 有可預約的冊 → 每冊顯示站內「預約」按鈕；都不可 → 附原系統連結
  const detailUrl = `https://collections.dyhu.edu.tw/bookDetail.do?id=${encodeURIComponent(marcid)}`;
  const btnStyle = 'display:inline-flex;align-items:center;gap:0.4rem;padding:0.45rem 1rem;background:var(--primary);color:#fff;border:none;border-radius:var(--radius);font-size:0.85rem;text-decoration:none;margin-top:0.25rem;cursor:pointer';
  const holdingBtnHtml = anyReservable
    ? `<div id="reserveMsg" style="display:none;width:100%;font-size:0.85rem;padding:0.5rem 0.75rem;border-radius:var(--radius)"></div>`
    : `<a href="${escHtml(detailUrl)}" target="_blank" rel="noopener" style="${btnStyle}">前往原系統 ↗</a>`;
  const holdingsHtml = `
    <div class="holding-row" style="flex-direction:column;gap:0.75rem;align-items:flex-start">
      ${detail.holdings && detail.holdings.length > 0
        ? detail.holdings.map(h => {
            const b = holdingBadge(h);
            return `
            <div style="width:100%">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem">
                <span style="font-weight:600">館藏地：${escHtml(h.location || '—')}</span>
                <span style="display:inline-flex;align-items:center;gap:0.5rem">
                  ${b.html}
                  ${h.reserveParams ? `<button class="holding-reserve-btn" data-params="${escHtml(JSON.stringify(h.reserveParams))}"
                    style="padding:0.25rem 0.75rem;background:var(--primary);color:#fff;border:none;border-radius:20px;font-size:0.8rem;cursor:pointer">預約</button>` : ''}
                </span>
              </div>
              <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.15rem">
                ${h.callNo  ? `索書號：${escHtml(h.callNo)}` : ''}
                ${h.type    ? `　類型：${escHtml(h.type)}` : ''}
                ${b.due     ? `　應還：${escHtml(b.due)}` : ''}
              </div>
            </div>`;
          }).join('<hr style="border:none;border-top:1px solid var(--border);margin:0.25rem 0">')
        : `<span style="color:var(--text-muted);font-size:0.9rem">館藏資訊請至原系統確認</span>`
      }
      ${holdingBtnHtml}
    </div>`;

  contentEl.innerHTML = `
    <div class="detail-wrapper">
      <div class="detail-cover-wrap">
        ${coverHtml}
      </div>
      <div class="detail-main">
        <h1 class="detail-title">${escHtml(detail.title || '（無題名）')}</h1>

        ${fieldRows ? `
        <div class="detail-card" style="margin-bottom:1rem">
          <h2>書目資訊</h2>
          <table class="detail-table">${fieldRows}</table>
        </div>` : ''}

        <div class="detail-card">
          <h2>館藏狀態</h2>
          ${holdingsHtml}
        </div>
      </div>
    </div>`;

  document.querySelectorAll('.holding-reserve-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      let params = {};
      try { params = JSON.parse(btn.dataset.params || '{}'); } catch (_) {}
      doReserve(detail.title || '', params, btn);
    });
  });
}

// ── 站內線上預約 ──────────────────────────────────────
function showReserveMsg(text, ok) {
  const box = document.getElementById('reserveMsg');
  if (!box) return;
  box.textContent = text;
  box.style.display = 'block';
  box.style.background = ok ? '#d5f5e3' : '#fdf2f8';
  box.style.color = ok ? '#1e8449' : '#922b21';
  box.style.border = ok ? '1px solid #82e0aa' : '1px solid #f1948a';
}

async function doReserve(title, params, btn) {
  // 未登入 → 先去登入，登入後自動跳回本頁
  let loggedIn = false;
  try {
    const st = await fetch('/api/auth-status').then(r => r.json());
    loggedIn = !!st.loggedIn;
  } catch (_) {}
  if (!loggedIn) {
    const back = `detail.html?marcid=${encodeURIComponent(marcid)}`;
    window.location.href = `account.html?return=${encodeURIComponent(back)}`;
    return;
  }

  if (!confirm(`確定要預約《${title}》嗎？\n到館後會依原系統規則通知取書。`)) return;

  btn.disabled = true;
  btn.textContent = '預約中…';
  try {
    const res = await fetch('/api/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marcid, ...params }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '預約失敗');
    showReserveMsg(data.message || '預約成功！可至個人書房查看預約狀態。', true);
    btn.textContent = '已預約';
  } catch (err) {
    showReserveMsg(err.message, false);
    btn.disabled = false;
    btn.textContent = '預約';
  }
}

loadDetail();
