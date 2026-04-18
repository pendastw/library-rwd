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

function statusClass(s) {
  if (!s) return '';
  if (/請至|確認/.test(s)) return '';
  return /借|出|不|預|到期/.test(s) ? 'status-borrowed' : 'status-available';
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

  // 館藏：統一用連結到原系統
  const detailUrl = `https://collections.dyhu.edu.tw/bookDetail.do?id=${encodeURIComponent(marcid)}`;
  const holdingsHtml = `
    <div class="holding-row" style="flex-direction:column;gap:0.75rem;align-items:flex-start">
      ${detail.holdings && detail.holdings.length > 0
        ? detail.holdings.map(h => `
            <div style="width:100%">
              <div style="font-weight:600">${escHtml(h.location || '—')}</div>
              <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.15rem">
                ${h.callNo  ? `索書號：${escHtml(h.callNo)}` : ''}
                ${h.type    ? `　類型：${escHtml(h.type)}` : ''}
                ${h.barcode ? `　條碼：${escHtml(h.barcode)}` : ''}
                ${h.attach  ? `　附件：${escHtml(h.attach)}` : ''}
              </div>
            </div>`).join('<hr style="border:none;border-top:1px solid var(--border);margin:0.25rem 0">')
        : `<span style="color:var(--text-muted);font-size:0.9rem">館藏資訊請至原系統確認</span>`
      }
      <a href="${escHtml(detailUrl)}" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.45rem 1rem;background:var(--primary);color:#fff;border-radius:var(--radius);font-size:0.85rem;text-decoration:none;margin-top:0.25rem">
        查詢即時館藏狀態 ↗
      </a>
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
}

loadDetail();
