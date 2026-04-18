const params = new URLSearchParams(location.search);
let currentQuery = params.get('q') || '';
let currentField = params.get('field') || 'FullText';
let currentPage = parseInt(params.get('page') || '1');
let currentType = params.get('type') || 'all'; // all | book | ebook | journal | media

const gridEl = document.getElementById('bookGrid');
const countEl = document.getElementById('resultsCount');
const paginationEl = document.getElementById('pagination');
const headerInput = document.getElementById('headerInput');
const headerField = document.getElementById('headerField');

// 類型標籤容器
const typeTabsEl = document.getElementById('typeTabs');

headerInput.value = currentQuery;
headerField.value = currentField;
headerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goSearch(); });

function goSearch() {
  const q = headerInput.value.trim();
  const field = headerField.value;
  if (!q) return;
  window.location.href = `results.html?q=${encodeURIComponent(q)}&field=${field}`;
}

async function loadResults(q, field, page) {
  gridEl.innerHTML = `<div class="loading"><div class="spinner"></div><p>正在查詢館藏資料…</p></div>`;
  countEl.textContent = '搜尋中…';
  paginationEl.innerHTML = '';

  try {
    const typeParam = currentType !== 'all' ? `&type=${currentType}` : '';
    const url = `/api/search?q=${encodeURIComponent(q)}&field=${field}&page=${page}${typeParam}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '查詢失敗');
    render(data);
  } catch (err) {
    gridEl.innerHTML = `<div class="error-box"><p>⚠️ ${err.message}</p></div>`;
    countEl.textContent = '查詢失敗';
  }
}

const TYPE_LABEL = { all: '全部', book: '圖書', ebook: '電子書', journal: '期刊', media: '視聽資料' };
const TYPE_ICON  = { all: '📚', book: '📖', ebook: '💻', journal: '📰', media: '🎬' };

// 從 sessionStorage 恢復類型統計
const cacheKey = `dtypes_${currentQuery}_${currentField}`;
let cachedDataTypes = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
let cachedTotalAll = parseInt(sessionStorage.getItem(cacheKey + '_total') || '0');

function render(data) {
  document.title = `「${currentQuery}」搜尋結果 — 圖書館館藏查詢`;

  const books = data.books || [];

  // 只有「全部」模式才更新類型統計快取
  if (currentType === 'all' && data.dataTypes && data.dataTypes.length > 0) {
    cachedDataTypes = data.dataTypes;
    cachedTotalAll = data.total;
    sessionStorage.setItem(cacheKey, JSON.stringify(data.dataTypes));
    sessionStorage.setItem(cacheKey + '_total', data.total);
  }

  // 渲染類型分頁標籤
  if (typeTabsEl && cachedDataTypes) {
    const tabs = [{ typeKey: 'all', name: '全部', count: cachedTotalAll }].concat(cachedDataTypes);
    typeTabsEl.innerHTML = tabs.map(t => {
      const key = t.typeKey || 'all';
      const isActive = currentType === key;
      return `<button class="type-tab${isActive ? ' active' : ''}" onclick="switchType('${key}')">
        ${TYPE_ICON[key] || '📄'} ${t.name} <span class="tab-count">${t.count}</span>
      </button>`;
    }).join('');
  }

  if (!books || books.length === 0) {
    countEl.textContent = `找不到符合「${currentQuery}」的${TYPE_LABEL[currentType] || ''}`;
    gridEl.innerHTML = `<div class="loading"><p>😔 查無結果，請嘗試其他關鍵字。</p></div>`;
    return;
  }

  const typeLabel = currentType !== 'all' ? `${TYPE_LABEL[currentType]} ` : '';
  countEl.textContent = `共找到 ${data.total.toLocaleString()} 筆${typeLabel ? `（${typeLabel}）` : ''}，第 ${currentPage} 頁`;

  renderPagination(data.total, currentPage);

  gridEl.innerHTML = books.map(book => {
    const isEbook = book.type === 'ebook';
    const href = isEbook
      ? escHtml(book.ebookUrl || `https://collections.dyhu.edu.tw/bookDetail.do?id=${book.marcid}`)
      : `detail.html?marcid=${encodeURIComponent(book.marcid)}&back=${encodeURIComponent(location.href)}`;
    const target = isEbook ? ' target="_blank" rel="noopener"' : '';

    return `<a class="book-card${isEbook ? ' ebook-card' : ''}" href="${href}"${target}>
      <div class="book-cover">
        ${book.cover
          ? `<img src="${escHtml(book.cover)}" alt="${escHtml(book.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'book-cover-placeholder\\'>${isEbook ? '💻' : '📚'}</div>'">`
          : `<div class="book-cover-placeholder">${isEbook ? '💻' : '📚'}</div>`}
      </div>
      <div class="book-info">
        ${isEbook ? '<span class="ebook-badge">電子書</span>' : ''}
        <div class="book-title">${escHtml(book.title)}</div>
        <div class="book-meta">
          ${book.author    ? `<span data-label="作者">${escHtml(book.author)}</span>` : ''}
          ${book.year      ? `<span data-label="出版年">${escHtml(book.year)}</span>` : ''}
          ${book.publisher ? `<span data-label="出版社">${escHtml(book.publisher)}</span>` : ''}
        </div>
        ${isEbook ? '<span class="ebook-link-hint">點擊直接閱讀 ↗</span>' : ''}
      </div>
    </a>`;
  }).join('');

}

function switchType(type) {
  currentType = type;
  const url = new URL(location.href);
  url.searchParams.set('type', type);
  url.searchParams.set('page', '1');
  window.location.href = url.toString();
}

const PER_PAGE = 10;

function renderPagination(total, page) {
  const totalPages = Math.ceil(total / PER_PAGE);
  if (totalPages <= 1) return;

  const makeBtn = (label, targetPage, disabled = false, active = false) => {
    const cls = ['btn-page', active ? 'active' : ''].filter(Boolean).join(' ');
    return disabled
      ? `<button class="${cls}" disabled>${label}</button>`
      : `<button class="${cls}" onclick="changePage(${targetPage})">${label}</button>`;
  };

  let html = makeBtn('‹ 上一頁', page - 1, page <= 1);
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p++) html += makeBtn(p, p, false, p === page);
  html += makeBtn('下一頁 ›', page + 1, page >= totalPages);
  paginationEl.innerHTML = html;
}

function changePage(page) {
  const url = new URL(location.href);
  url.searchParams.set('page', page);
  window.location.href = url.toString();
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

if (currentQuery) {
  loadResults(currentQuery, currentField, currentPage);
} else {
  countEl.textContent = '';
  gridEl.innerHTML = `<div class="loading"><p>請輸入搜尋關鍵字。</p></div>`;
}
