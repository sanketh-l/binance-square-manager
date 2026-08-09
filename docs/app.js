const $ = (sel) => document.querySelector(sel);

let API_URL = localStorage.getItem('bm_api') || '';
let TOKEN = localStorage.getItem('bm_token') || '';
let state = { accounts: [], page: 1, total: 0, filterAccount: '', filterStatus: '', series: [] };

function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function api(path, options = {}) {
  const res = await fetch(API_URL + path, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': TOKEN,
      ...(options.headers || {})
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text }; }
  if (!res.ok) throw new Error(json.error || res.status);
  return json;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function nextCronTime() {
  // Cron: 0 * * * * (top of every hour)
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  if (next <= now) next.setHours(next.getHours() + 1);
  return next.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Login ---------------- */

function initLogin() {
  if (API_URL) $('#login-api').value = API_URL;
  $('#login-btn').addEventListener('click', async () => {
    API_URL = $('#login-api').value.trim().replace(/\/+$/, '');
    TOKEN = $('#login-token').value.trim();
    if (!API_URL || !TOKEN) { $('#login-error').textContent = 'Enter both API URL and token.'; return; }
    $('#login-btn').disabled = true;
    try {
      const env = await api('/api/health/env');
      if (!env.adminConfigured) throw new Error('ADMIN_TOKEN not configured on the Worker');
      localStorage.setItem('bm_api', API_URL);
      localStorage.setItem('bm_token', TOKEN);
      $('#login-error').textContent = '';
      showApp();
    } catch (err) {
      $('#login-error').textContent = 'Connection failed: ' + err.message;
    }
    $('#login-btn').disabled = false;
  });
}

function showApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  switchTab('overview');
  loadOverview();
}

/* ---------------- Tabs ---------------- */

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('#view-' + tab).classList.add('active');
}

function initTabs() {
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      const tab = t.dataset.tab;
      switchTab(tab);
      if (tab === 'overview') loadOverview();
      if (tab === 'accounts') loadAccounts();
      if (tab === 'timeline') loadTimeline();
      if (tab === 'analytics') loadAnalytics();
    })
  );
  $('#logout-btn').addEventListener('click', () => {
    localStorage.removeItem('bm_token');
    TOKEN = '';
    $('#app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
  });
}

/* ---------------- Overview ---------------- */

async function loadOverview() {
  const view = $('#view-overview');
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const data = await api('/api/stats/overview');
    state.accounts = data.accounts;
    const t = data.totals;
    const successRate = t.total > 0 ? Math.round((t.published / t.total) * 100) : 0;
    view.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Total posts</div><div class="value accent">${t.total}</div></div>
        <div class="stat-card"><div class="label">Today</div><div class="value">${t.today}</div></div>
        <div class="stat-card"><div class="label">Published</div><div class="value green">${t.published}</div></div>
        <div class="stat-card"><div class="label">Failed</div><div class="value red">${t.failed}</div></div>
        <div class="stat-card"><div class="label">Success rate</div><div class="value">${successRate}%</div></div>
        <div class="stat-card"><div class="label">Next auto-run</div><div class="value accent">${nextCronTime()}</div></div>
      </div>
      <h3 class="section-title">Accounts (${data.accounts.length})</h3>
      <div class="account-grid">
        ${data.accounts.length === 0 ? '<div class="empty">No accounts yet — add one in the Accounts tab.</div>' : data.accounts.map(accountCard).join('')}
      </div>
      ${data.lastPosts.length ? `
        <h3 class="section-title mt20">Latest posts</h3>
        ${postTable(data.lastPosts)}
      ` : ''}
    `;
  } catch (err) {
    view.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}</div>`;
  }
}

function accountCard(a) {
  const capped = a.dailyCap > 0 && a.postsToday >= a.dailyCap;
  return `
    <div class="account-card">
      <h3><span class="dot ${a.enabled ? 'on' : 'off'}"></span>${esc(a.name)} <span class="pill">${esc(a.mode)}</span> ${capped ? '<span class="pill capped">capped</span>' : ''}</h3>
      <div class="acc-meta">
        <span>${a.totalPosts} posts</span><span>${a.postsToday} today</span>
        <span>every ${a.intervalMin}m</span><span>cap ${a.dailyCap}/day</span>
        <span>last: ${fmtDate(a.lastPostAt)}</span>
      </div>
      <div class="acc-actions">
        <button class="ghost" onclick="openEditAccount(${a.id})">Edit</button>
        <button class="ghost" onclick="toggleAccount(${a.id})">${a.enabled ? 'Pause' : 'Resume'}</button>
        <button class="danger" onclick="deleteAccount(${a.id})">Delete</button>
      </div>
    </div>`;
}

/* ---------------- Accounts ---------------- */

let editingId = null;

async function loadAccounts() {
  const view = $('#view-accounts');
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const data = await api('/api/stats/overview');
    state.accounts = data.accounts;
    view.innerHTML = `
      <div class="mb16"><button onclick="openAddAccount()">+ Add account</button></div>
      <div class="account-grid">
        ${data.accounts.length === 0 ? '<div class="empty">No accounts yet.</div>' : data.accounts.map(accountCard).join('')}
      </div>
    `;
  } catch (err) {
    view.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}</div>`;
  }
}

function accountModalHtml(a = {}) {
  return `
    <div class="modal">
      <h2>${a.id ? 'Edit account' : 'Add account'}</h2>
      <label>Account name</label>
      <input id="f-name" value="${esc(a.name || '')}" placeholder="e.g. Main account, Backup">
      <label>Binance Square API key</label>
      <input id="f-key" value="" placeholder="${a.keyMask ? 'Leave blank to keep ' + esc(a.keyMask) : 'Paste your Square OpenAPI key'}" ${a.id ? 'type="password"' : ''}>
      <div class="row-2">
        <div>
          <label>Mode</label>
          <select id="f-mode">
            <option value="broadcast" ${a.mode === 'broadcast' ? 'selected' : ''}>Broadcast (share same post)</option>
            <option value="unique" ${a.mode === 'unique' ? 'selected' : ''}>Unique (own research)</option>
          </select>
        </div>
        <div>
          <label>Interval (minutes)</label>
          <input id="f-interval" type="number" min="1" value="${a.intervalMin || 60}">
        </div>
      </div>
      <div class="row-2">
        <div>
          <label>Daily cap</label>
          <input id="f-cap" type="number" min="1" value="${a.dailyCap || 50}">
        </div>
        <div>
          <label>Status</label>
          <select id="f-enabled">
            <option value="1" ${a.enabled === false ? '' : 'selected'}>Enabled</option>
            <option value="0" ${a.enabled === false ? 'selected' : ''}>Disabled</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button class="ghost" onclick="closeModal()">Cancel</button>
        <button id="f-save" onclick="saveAccount()">Save</button>
      </div>
    </div>`;
}

function openModal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = html;
  back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
}

function closeModal() { document.querySelector('.modal-back')?.remove(); }

function openAddAccount() { editingId = null; openModal(accountModalHtml()); }

function openEditAccount(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (a) { editingId = id; openModal(accountModalHtml(a)); }
}

async function saveAccount() {
  const body = {
    name: $('#f-name').value.trim(),
    mode: $('#f-mode').value,
    intervalMin: Number($('#f-interval').value) || 60,
    dailyCap: Number($('#f-cap').value) || 50,
    enabled: $('#f-enabled').value === '1'
  };
  const key = $('#f-key').value.trim();
  try {
    if (key) body.binanceKey = key;
    if (editingId) {
      await api('/api/accounts/' + editingId, { method: 'PATCH', body });
    } else {
      if (!key) throw new Error('API key required for new accounts');
      await api('/api/accounts', { method: 'POST', body });
    }
    closeModal();
    toast(editingId ? 'Account updated' : 'Account added');
    loadAccounts();
    loadOverview();
  } catch (err) {
    toast(err.message, false);
  }
}

async function toggleAccount(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  try {
    await api('/api/accounts/' + id, { method: 'PATCH', body: { enabled: !a.enabled } });
    toast(a.enabled ? 'Account paused' : 'Account resumed');
    loadAccounts(); loadOverview();
  } catch (err) { toast(err.message, false); }
}

async function deleteAccount(id) {
  if (!confirm('Delete this account and all its post history?')) return;
  try {
    await api('/api/accounts/' + id, { method: 'DELETE' });
    toast('Account deleted');
    loadAccounts(); loadOverview();
  } catch (err) { toast(err.message, false); }
}

/* ---------------- Timeline ---------------- */

function postTable(posts) {
  return `
    <table class="table">
      <thead><tr><th>Time</th><th>Account</th><th>Coin</th><th>Post</th><th>Image</th><th>Status</th><th>Link</th></tr></thead>
      <tbody>
        ${posts.map((p) => `
          <tr>
            <td class="mono">${fmtDate(p.posted_at)}</td>
            <td>${esc(p.account_name || '')}</td>
            <td class="mono">${esc(p.coin || '')}</td>
            <td class="post-text">${esc((p.text || '').substring(0, 160))}${(p.text || '').length > 160 ? '…' : ''}</td>
            <td>${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="">` : '—'}</td>
            <td><span class="status ${esc(p.status)}">${esc(p.status)}</span>${p.error ? `<div class="muted" style="font-size:11px">${esc(p.error)}</div>` : ''}</td>
            <td>${p.post_url && p.post_url !== 'N/A' ? `<a href="${esc(p.post_url)}" target="_blank" rel="noopener">view ↗</a>` : '—'}</td>
          </tr>
        `).join('') || '<tr><td colspan="7" class="empty">No posts found.</td></tr>'}
      </tbody>
    </table>`;
}

async function loadTimeline() {
  const view = $('#view-timeline');
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const accounts = await api('/api/stats/overview');
    const opts = state.filterAccount ? '&accountId=' + state.filterAccount : '';
    const data = await api(`/api/posts?page=${state.page}&limit=20${opts}`);
    state.total = data.total;
    const sel = `
      <div class="filters">
        <select onchange="setFilterAccount(this.value)">
          <option value="">All accounts</option>
          ${accounts.accounts.map((a) => `<option value="${a.id}" ${state.filterAccount == a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
        <button class="ghost" onclick="reloadTimeline()">Refresh</button>
      </div>`;
    const totalPages = Math.max(1, Math.ceil(state.total / 20));
    view.innerHTML = sel + postTable(data.posts) + `
      <div class="pagination">
        <button class="ghost" ${state.page <= 1 ? 'disabled' : ''} onclick="gotoPage(${state.page - 1})">← Prev</button>
        <span class="info">Page ${state.page} of ${totalPages} · ${state.total} posts</span>
        <button class="ghost" ${state.page >= totalPages ? 'disabled' : ''} onclick="gotoPage(${state.page + 1})">Next →</button>
      </div>`;
  } catch (err) {
    view.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}</div>`;
  }
}

function setFilterAccount(id) { state.filterAccount = id; state.page = 1; reloadTimeline(); }
function gotoPage(p) { state.page = p; reloadTimeline(); }
function reloadTimeline() { loadTimeline(); }

/* ---------------- Analytics ---------------- */

async function loadAnalytics() {
  const view = $('#view-analytics');
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const [series, overview] = await Promise.all([
      api('/api/stats/series?days=14'),
      api('/api/stats/overview')
    ]);
    const max = Math.max(1, ...series.series.map((s) => s.total));
    const bars = series.series.map((s) => `
      <div class="bar-row">
        <div class="bar-label">${s.day.slice(5)}</div>
        <div class="bar-wrap"><div class="bar" style="width:${Math.round((s.total / max) * 100)}%"></div></div>
        <div class="bar-val">${s.total}</div>
      </div>`).join('');

    const accRows = overview.accounts.map((a) => {
      const rate = a.totalPosts > 0 ? Math.round((a.postsToday > 0 ? a.postsToday / a.totalPosts : 0) * 100) : 0;
      return `
        <tr>
          <td>${esc(a.name)}</td><td>${a.totalPosts}</td><td>${a.postsToday}</td>
          <td>${a.dailyCap > 0 ? Math.round((a.postsToday / a.dailyCap) * 100) + '% of cap' : '—'}</td>
        </tr>`;
    }).join('');

    view.innerHTML = `
      <div class="chart-box">
        <h3>Posts per day (last 14 days)</h3>
        ${bars}
      </div>
      <div class="chart-box">
        <h3>Per-account volume</h3>
        <table class="table">
          <thead><tr><th>Account</th><th>Total</th><th>Today</th><th>Cap usage</th></tr></thead>
          <tbody>${accRows || '<tr><td colspan="4" class="empty">No accounts.</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch (err) {
    view.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}</div>`;
  }
}

/* ---------------- Boot ---------------- */

async function boot() {
  initLogin();
  initTabs();
  if (TOKEN && API_URL) {
    try {
      await api('/api/health/env');
      showApp();
    } catch {
      localStorage.removeItem('bm_token');
    }
  } else {
    $('#login-screen').classList.remove('hidden');
  }
}

window.openAddAccount = openAddAccount;
window.openEditAccount = openEditAccount;
window.toggleAccount = toggleAccount;
window.deleteAccount = deleteAccount;
window.saveAccount = saveAccount;
window.closeModal = closeModal;
window.setFilterAccount = setFilterAccount;
window.gotoPage = gotoPage;
window.reloadTimeline = reloadTimeline;

boot();