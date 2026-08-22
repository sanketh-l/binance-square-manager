const $ = (sel) => document.querySelector(sel);

let API_URL = localStorage.getItem('bm_api') || '';
let TOKEN = localStorage.getItem('bm_token') || '';

const state = {
  accounts: [],
  page: 1,
  total: 0,
  tlAccount: '',
  tlStatus: '',
  tlQuery: '',
  periodDays: 30,
  anAccount: '',
  topSort: 'views',
  topPosts: [],
  charts: {},
  currentTab: 'overview'
};

const ACCENT = '#f0b90b';
const GREEN = '#2ebd85';
const RED = '#f6465d';
const BLUE = '#7aa2f7';
const GRID = 'rgba(255,255,255,0.06)';
const TICK = '#63636e';
const MONO = '"IBM Plex Mono", monospace';

const ICONS = {
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

function fmtDate(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d)) return '\u2014';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtRel(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '\u2014';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d + 'd ago';
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
  if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
  return json;
}

/* ---------- toast & modal ---------- */

function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function closeModal() { document.querySelector('.modal-back')?.remove(); }

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------- skeletons & empties ---------- */

function skeletonMetrics() {
  return '<div class="metric-row">' + Array(5).fill('<div class="metric"><div class="sk-line" style="width:60%"></div><div class="sk-line" style="width:40%;height:22px"></div></div>').join('') + '</div>';
}

function skeletonPanel(h) {
  return '<div class="panel panel-pad">' + Array(Math.max(3, h)).fill('<div class="sk-line"></div>').join('') + '</div>';
}

function emptyBox(title, hint) {
  return '<div class="empty">' + ICONS.inbox + '<div class="e-title">' + esc(title) + '</div><div class="e-hint">' + esc(hint) + '</div></div>';
}

/* ---------- countdown & auto-refresh ---------- */

function tickCountdown() {
  const el = $('#next-run-txt');
  if (!el) return;
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  el.textContent = 'run in ' + mm + ':' + ss;
}
setInterval(tickCountdown, 1000);

function applyAutoUI() {
  const btn = $('#auto-btn');
  if (!btn) return;
  btn.classList.toggle('on', state.auto === true);
}

async function autoTick() {
  if (!state.auto) return;
  try { await loadCurrent(true); } catch {}
}

function toggleAuto() {
  state.auto = !(state.auto === true);
  localStorage.setItem('bm_auto', state.auto ? '1' : '');
  applyAutoUI();
  toast(state.auto ? 'Auto-refresh on (30s)' : 'Auto-refresh off');
}
setInterval(autoTick, 30000);

/* ---------- navigation ---------- */

const PAGES = {
  overview: { t: 'Overview', sub: 'System health at a glance' },
  accounts: { t: 'Accounts', sub: 'Poster identities and limits' },
  timeline: { t: 'Timeline', sub: 'Every post, every result' },
  analytics: { t: 'Analytics', sub: 'Reach and engagement' }
};

function setPage(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
  const p = PAGES[tab];
  $('#page-title').textContent = p.t;
  $('#page-sub').textContent = p.sub;
  renderCtxAction(tab);
  loadCurrent();
}

function renderCtxAction(tab) {
  const slot = $('#ctx-slot');
  slot.innerHTML = '';
  if (tab === 'accounts') {
    slot.innerHTML = '<button class="btn primary sm" onclick="openAddAccount()">+ Add account</button>';
  } else if (tab === 'timeline') {
    slot.innerHTML = '<button class="btn ghost sm" onclick="exportCSV()" title="Download CSV">' + ICONS.download + ' Export</button>';
  }
}

async function loadCurrent(silent) {
  const tab = state.currentTab;
  if (!silent) {
    if (tab === 'overview') $('#view-overview').innerHTML = skeletonMetrics() + skeletonPanel(4);
    if (tab === 'accounts') $('#view-accounts').innerHTML = skeletonPanel(6);
    if (tab === 'timeline') $('#view-timeline').innerHTML = skeletonPanel(8);
    if (tab === 'analytics') $('#view-analytics').innerHTML = skeletonMetrics() + skeletonPanel(5);
  }
  try {
    if (tab === 'overview') await loadOverview();
    else if (tab === 'accounts') await loadAccounts();
    else if (tab === 'timeline') await loadTimeline();
    else if (tab === 'analytics') await loadAnalytics();
  } catch (err) {
    if (!silent) $('#' + 'view-' + tab).innerHTML = emptyBox('Failed to load', err.message);
  }
}

/* ---------- login / boot ---------- */

function initLogin() {
  if (API_URL) $('#login-api').value = API_URL;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    API_URL = $('#login-api').value.trim().replace(/\/+$/, '');
    TOKEN = $('#login-token').value.trim();
    if (!API_URL || !TOKEN) { $('#login-error').textContent = 'Enter both API URL and admin token.'; return; }
    const btn = $('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting\u2026';
    try {
      await api('/api/health/env');
      localStorage.setItem('bm_api', API_URL);
      localStorage.setItem('bm_token', TOKEN);
      $('#login-error').textContent = '';
      showApp();
    } catch (err) {
      $('#login-error').textContent = 'Connection failed: ' + err.message;
    }
    btn.disabled = false;
    btn.textContent = 'Connect';
  });
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#conn-url').textContent = API_URL.replace(/^https?:\/\//, '');
  state.auto = localStorage.getItem('bm_auto') === '1';
  applyAutoUI();
  setPage('overview');
  tickCountdown();
}

function initShell() {
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.tab)));
  $('#refresh-btn').addEventListener('click', () => loadCurrent());
  $('#auto-btn').addEventListener('click', toggleAuto);
  $('#logout-btn').addEventListener('click', () => {
    localStorage.removeItem('bm_token');
    TOKEN = '';
    location.reload();
  });
}

async function boot() {
  initLogin();
  initShell();
  if (TOKEN && API_URL) {
    try {
      await api('/api/health/env');
      showApp();
      return;
    } catch {}
    localStorage.removeItem('bm_token');
    TOKEN = '';
  }
  $('#login').classList.remove('hidden');
}

/* ================= OVERVIEW ================= */

async function loadOverview() {
  const view = $('#view-overview');
  const data = await api('/api/stats/overview');
  state.accounts = data.accounts;
  const t = data.totals;
  const rate = t.total > 0 ? Math.round((t.published / t.total) * 100) : 0;

  const metric = (label, value, cls, foot) =>
    '<div class="metric"><div class="m-label">' + label + '</div><div class="m-value ' + (cls || '') + '">' + value + '</div>' + (foot ? '<div class="m-foot">' + foot + '</div>' : '') + '</div>';

  view.innerHTML =
    '<div class="metric-row">' +
    metric('Total posts', fmtNum(t.total), '', fmtNum(t.published) + ' published \u00b7 ' + fmtNum(t.failed) + ' failed') +
    metric('Today (UTC)', fmtNum(t.today), '', 'rolling midnight') +
    metric('Success rate', rate + '%', rate >= 90 ? 'green' : (rate >= 60 ? '' : 'red'), 'published / total') +
    metric('Accounts', data.accounts.length, '', data.accounts.filter((a) => a.enabled).length + ' enabled') +
    metric('Next auto-run', '<span id="ov-next">—</span>', 'gold', 'hourly at :00 UTC') +
    '</div>' +
    '<div class="section-head"><h2>Accounts</h2><span class="sh-side">' + data.accounts.length + ' configured</span></div>' +
    (data.accounts.length === 0
      ? '<div class="panel">' + emptyBox('No accounts yet', 'Open the Accounts page and connect your first Binance Square identity.') + '</div>'
      : '<div class="account-grid">' + data.accounts.map(accountCard).join('') + '</div>') +
    '<div class="section-head"><h2>Latest posts</h2><span class="sh-side">most recent 5</span></div>' +
    (data.lastPosts.length
      ? '<div class="panel table-wrap">' + postTable(data.lastPosts, true) + '</div>'
      : '<div class="panel">' + emptyBox('No posts yet', 'Once the hourly cron fires, results land here.') + '</div>');

  const ovNext = $('#ov-next');
  if (ovNext) {
    const upd = () => {
      const now = new Date();
      const next = new Date(now);
      next.setUTCMinutes(0, 0, 0);
      if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
      const m = Math.floor((next - now) / 60000);
      ovNext.textContent = m + ' min';
    };
    upd();
    setInterval(upd, 15000);
  }
}

function accountCard(a) {
  const capped = a.dailyCap > 0 && a.postsToday >= a.dailyCap;
  const pct = a.dailyCap > 0 ? Math.min(100, Math.round((a.postsToday / a.dailyCap) * 100)) : 0;
  return (
    '<div class="account-card">' +
    '<div class="acc-top">' +
    '<div class="acc-name"><span class="dot ' + (a.enabled ? 'ok' : 'off') + '"></span><span class="nm">' + esc(a.name) + '</span></div>' +
    '<span class="pill ' + (capped ? 'red' : 'gold') + '">' + esc(capped ? 'capped' : a.mode) + '</span>' +
    '</div>' +
    '<div class="acc-stats">' +
    '<div class="acc-stat"><div class="k">Total</div><div class="v">' + fmtNum(a.totalPosts) + '</div></div>' +
    '<div class="acc-stat"><div class="k">Today</div><div class="v">' + a.postsToday + ' / ' + (a.dailyCap > 0 ? a.dailyCap : '\u221e') + '</div></div>' +
    '<div class="acc-stat"><div class="k">Interval</div><div class="v">' + a.intervalMin + ' min</div></div>' +
    '<div class="acc-stat"><div class="k">Last post</div><div class="v">' + esc(fmtRel(a.lastPostAt)) + '</div></div>' +
    '</div>' +
    '<div class="cap-bar"><i style="width:' + pct + '%"></i></div>' +
    '<div class="acc-actions" style="margin-top:14px">' +
    '<button class="btn ghost sm" onclick="openEditAccount(' + a.id + ')">' + ICONS.pencil + ' Edit</button>' +
    '<button class="btn ghost sm" onclick="toggleAccount(' + a.id + ')">' + ICONS.power + ' ' + (a.enabled ? 'Pause' : 'Resume') + '</button>' +
    '<button class="btn danger sm" onclick="deleteAccount(' + a.id + ')">' + ICONS.trash + '</button>' +
    '</div></div>');
}

/* ================= ACCOUNTS ================= */

let editingId = null;

async function loadAccounts() {
  const view = $('#view-accounts');
  const data = await api('/api/stats/overview');
  state.accounts = data.accounts;
  view.innerHTML =
    (data.accounts.length === 0
      ? '<div class="panel">' + emptyBox('No accounts connected', 'Add one below with its name and Binance Square OpenAPI key.') + '</div>'
      : '<div class="account-grid">' + data.accounts.map(accountCard).join('') + '</div>');
}

function accountModalHtml(a) {
  a = a || {};
  const keyField =
    '<div class="field"><label>Binance Square API key</label>' +
    '<input id="f-key" type="' + (a.id ? 'password' : 'text') + '" placeholder="' +
    (a.keyMask ? 'Leave blank to keep ' + esc(a.keyMask) : 'Paste your Square OpenAPI key') + '"></div>';
  return (
    '<input type="hidden" id="m-title" value="' + (a.id ? 'Edit account' : 'Add account') + '">' +
    '<div class="field"><label>Account name</label><input id="f-name" value="' + esc(a.name || '') + '" placeholder="Main, chota, backup\u2026"></div>' +
    keyField +
    '<div class="row-2">' +
    '<div class="field"><label>Mode</label><select id="f-mode">' +
    '<option value="broadcast"' + (a.mode === 'broadcast' ? ' selected' : '') + '>Broadcast</option>' +
    '<option value="unique"' + (a.mode !== 'unique' ? ' selected' : '') + '>Unique</option>' +
    '</select></div>' +
    '<div class="field"><label>Interval (min)</label><input id="f-interval" type="number" min="1" value="' + (a.intervalMin || 60) + '"></div>' +
    '</div>' +
    '<div class="row-2">' +
    '<div class="field"><label>Daily cap</label><input id="f-cap" type="number" min="1" value="' + (a.dailyCap || 50) + '"></div>' +
    '<div class="field"><label>Status</label><select id="f-enabled">' +
    '<option value="1"' + (a.enabled === false ? '' : ' selected') + '>Enabled</option>' +
    '<option value="0"' + (a.enabled === false ? ' selected' : '') + '>Disabled</option>' +
    '</select></div>' +
    '</div>' +
    '<div class="modal-actions"><button class="btn ghost" onclick="closeModal()">Cancel</button>' +
    '<button class="btn primary" onclick="saveAccount()">' + (a.id ? 'Save changes' : 'Create account') + '</button></div>');
}

function openAddAccount() {
  editingId = null;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = '<div class="modal"><div class="modal-head"><h2>Add account</h2>' +
    '<button class="modal-x" onclick="closeModal()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
    accountModalHtml(null) + '</div>';
  back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
}

function openEditAccount(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  editingId = id;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = '<div class="modal"><div class="modal-head"><h2>Edit account</h2>' +
    '<button class="modal-x" onclick="closeModal()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
    accountModalHtml(a) + '</div>';
  back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
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
    toast(editingId ? 'Account updated' : 'Account created');
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
    loadAccounts();
  } catch (err) { toast(err.message, false); }
}

async function deleteAccount(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!confirm('Delete "' + (a ? a.name : 'this account') + '" and all its post history?')) return;
  try {
    await api('/api/accounts/' + id, { method: 'DELETE' });
    toast('Account deleted');
    loadAccounts();
    loadOverview();
  } catch (err) { toast(err.message, false); }
}

/* ================= TIMELINE ================= */

function postCell(p) {
  const txt = (p.text || '').replace(/\s+/g, ' ').trim();
  const short = txt.length > 140 ? txt.slice(0, 140) + '\u2026' : txt;
  return '<td class="post-cell">' + esc(short) + '</td>';
}

function postTable(posts, compact) {
  return '<table class="tbl"><thead><tr>' +
    '<th>When</th>' + (compact ? '' : '<th>Account</th>') + '<th>Coin</th><th>Post</th><th>Img</th>' +
    (compact ? '' : '<th>Views</th><th>Rcts</th>') +
    '<th>Status</th><th>Link</th></tr></thead><tbody>' +
    (posts.map((p) =>
      '<tr>' +
      '<td class="mono" title="' + esc(fmtDate(p.posted_at)) + '" style="white-space:nowrap">' + esc(fmtRel(p.posted_at)) + '</td>' +
      (compact ? '' : '<td>' + esc(p.account_name || '') + '</td>') +
      '<td class="mono gold">$' + esc(p.coin || '\u2014') + '</td>' +
      postCell(p) +
      '<td>' + (p.image ? '<img class="thumb" loading="lazy" src="' + esc(p.image) + '" alt="">' : '<span class="muted">\u2014</span>') + '</td>' +
      (compact ? '' : '<td class="mono">' + (p.views != null ? fmtNum(p.views) : '\u2014') + '</td><td class="mono">' + (p.reactions != null ? fmtNum(p.reactions) : '\u2014') + '</td>') +
      '<td><span class="pill ' + (p.status === 'published' ? 'green' : 'red') + '">' + esc(p.status) + '</span>' +
      (p.error ? '<div class="mono muted" style="font-size:10.5px;margin-top:4px;max-width:180px">' + esc(String(p.error).slice(0, 80)) + '</div>' : '') + '</td>' +
      '<td>' + (p.post_url && p.post_url !== 'N/A'
        ? '<a href="' + esc(p.post_url) + '" target="_blank" rel="noopener" title="Open post">' + ICONS.external + '</a>'
        : '<span class="muted">\u2014</span>') + '</td>' +
      '</tr>').join('') ||
      '<tr><td colspan="9"><div class="empty">' + ICONS.inbox + '<div class="e-title">Nothing here</div><div class="e-hint">No posts match these filters.</div></div></td></tr>') +
    '</tbody></table>';
}

let searchTimer = null;

async function loadTimeline() {
  const view = $('#view-timeline');
  if (state.accounts.length === 0) {
    const ov = await api('/api/stats/overview');
    state.accounts = ov.accounts;
  }
  const params = new URLSearchParams({ page: state.page, limit: '20' });
  if (state.tlAccount) params.set('accountId', state.tlAccount);
  const data = await api('/api/posts?' + params.toString());
  let rows = data.posts;
  state.total = data.total;

  let filtered = rows;
  if (state.tlStatus) filtered = filtered.filter((p) => p.status === state.tlStatus);
  if (state.tlQuery) {
    const q = state.tlQuery.toLowerCase();
    filtered = filtered.filter((p) =>
      (p.text || '').toLowerCase().includes(q) ||
      (p.coin || '').toLowerCase().includes(q) ||
      (p.account_name || '').toLowerCase().includes(q));
  }

  const totalPages = Math.max(1, Math.ceil(state.total / 20));
  view.innerHTML =
    '<div class="controls">' +
    '<select onchange="setTlAccount(this.value)">' +
    '<option value="">All accounts</option>' +
    state.accounts.map((a) => '<option value="' + a.id + '"' + (String(state.tlAccount) === String(a.id) ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') +
    '</select>' +
    '<select onchange="setTlStatus(this.value)">' +
    '<option value="">Any status</option>' +
    '<option value="published"' + (state.tlStatus === 'published' ? ' selected' : '') + '>Published</option>' +
    '<option value="failed"' + (state.tlStatus === 'failed' ? ' selected' : '') + '>Failed</option>' +
    '</select>' +
    '<input type="search" placeholder="Search text, coin, account\u2026" value="' + esc(state.tlQuery) + '" oninput="tlSearch(this.value)">' +
    '</div>' +
    '<div class="panel table-wrap">' + (rows.length === 0
      ? emptyBox('No posts found', 'Published results appear here once the cron runs.')
      : postTable(filtered, false)) + '</div>' +
    '<div class="pagination">' +
    '<button class="btn ghost sm"' + (state.page <= 1 ? ' disabled' : '') + ' onclick="gotoPage(' + (state.page - 1) + ')">\u2190 Prev</button>' +
    '<span class="pg-info mono">page ' + state.page + ' / ' + totalPages + ' \u00b7 ' + fmtNum(state.total) + ' posts</span>' +
    '<button class="btn ghost sm"' + (state.page >= totalPages ? ' disabled' : '') + ' onclick="gotoPage(' + (state.page + 1) + ')">Next \u2192</button>' +
    '</div>';
}

function setTlAccount(v) { state.tlAccount = v; state.page = 1; loadTimeline().catch((e) => toast(e.message, false)); }
function setTlStatus(v) { state.tlStatus = v; loadTimeline().catch((e) => toast(e.message, false)); }
function gotoPage(p) { state.page = p; loadTimeline().catch((e) => toast(e.message, false)); }
function tlSearch(v) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.tlQuery = v.trim(); loadTimeline().catch(() => {}); }, 280);
}

async function exportCSV() {
  try {
    toast('Preparing CSV\u2026');
    const data = await api('/api/posts?page=1&limit=100' + (state.tlAccount ? '&accountId=' + state.tlAccount : ''));
    const rows = [['posted_at', 'account', 'coin', 'status', 'views', 'reactions', 'post_url']];
    for (const p of data.posts) {
      rows.push([p.posted_at || '', p.account_name || '', p.coin || '', p.status || '', p.views ?? '', p.reactions ?? '', p.post_url || '']);
    }
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'posts_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast(data.posts.length + ' rows exported');
  } catch (err) {
    toast(err.message, false);
  }
}

/* ================= ANALYTICS ================= */

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1d1d21',
        titleColor: '#f4f4f5',
        bodyColor: '#9d9da8',
        borderColor: 'rgba(255,255,255,0.12)',
        borderWidth: 1,
        padding: 11,
        titleFont: { family: MONO, size: 11 },
        bodyFont: { family: MONO, size: 11 },
        displayColors: true,
        boxPadding: 4
      }
    },
    scales: {
      x: { grid: { color: GRID }, ticks: { color: TICK, font: { family: MONO, size: 10 }, maxRotation: 0, autoSkip: true } },
      y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK, font: { family: MONO, size: 10 } } }
    }
  };
}

function killChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

function drawChart(key, canvasId, config, boxTitle) {
  killChart(key);
  const el = document.getElementById(canvasId);
  if (!el) return;
  if (typeof Chart === 'undefined') {
    const host = el.closest('.chart-box');
    if (host) host.innerHTML = '<h3>' + esc(boxTitle || 'Chart') + '</h3><div class="empty"><div class="e-title">Charts unavailable</div><div class="e-hint">Chart library failed to load — refresh the page.</div></div>';
    return;
  }
  try {
    state.charts[key] = new Chart(el.getContext('2d'), config);
  } catch (err) {
    console.error('chart error', key, err);
  }
}

async function loadAnalytics() {
  const view = $('#view-analytics');
  const [series, perf, tops] = await Promise.all([
    api('/api/stats/engagement-series?days=' + state.periodDays + (state.anAccount ? '&accountId=' + state.anAccount : '')),
    api('/api/stats/account-performance?days=' + state.periodDays),
    api('/api/stats/top-posts?days=' + state.periodDays + '&limit=10' + (state.anAccount ? '&accountId=' + state.anAccount : ''))
  ]);
  state.topPosts = tops.posts;

  const totals = series.series.reduce(
    (acc, s) => ({ v: acc.v + s.views, r: acc.r + s.reactions, p: acc.p + s.posts }),
    { v: 0, r: 0, p: 0 });
  const rate = totals.v > 0 ? ((totals.r / totals.v) * 100).toFixed(2) : '0.00';

  view.innerHTML =
    '<div class="controls" style="justify-content:space-between">' +
    '<div class="seg" role="group" aria-label="Period">' +
    [7, 14, 30, 60, 90].map((d) =>
      '<button class="' + (d === state.periodDays ? 'active' : '') + '" onclick="setPeriod(' + d + ')">' + d + 'd</button>').join('') +
    '</div>' +
    '<select onchange="setAnAccount(this.value)" style="background:var(--surface);border:1px solid var(--border-strong);color:var(--text);padding:8px 12px;border-radius:10px;font-size:13px">' +
    '<option value="">All accounts</option>' +
    perf.accounts.map((a) => '<option value="' + a.id + '"' + (String(state.anAccount) === String(a.id) ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') +
    '</select></div>' +

    '<div class="metric-row">' +
    '<div class="metric hero-metric"><div class="m-label">Total views</div><div class="m-value">' + fmtNum(totals.v) + '</div><div class="m-foot">' + state.periodDays + 'd window</div></div>' +
    '<div class="metric"><div class="m-label">Reactions</div><div class="m-value green">' + fmtNum(totals.r) + '</div><div class="m-foot">likes collected</div></div>' +
    '<div class="metric"><div class="m-label">Engagement</div><div class="m-value">' + rate + '%</div><div class="m-foot">reactions / views</div></div>' +
    '<div class="metric"><div class="m-label">Posts</div><div class="m-value">' + fmtNum(totals.p) + '</div><div class="m-foot">in window</div></div>' +
    '</div>' +

    '<div class="grid-2" style="margin-bottom:16px">' +
    '<div class="chart-box" style="grid-column:1/-1"><h3>Views &amp; reactions over time</h3>' +
    '<div class="c-sub">daily totals \u00b7 dashed line = post count</div>' +
    '<div class="legend-row">' +
    '<span class="lg-item"><span class="lg-swatch" style="background:' + ACCENT + '"></span>views</span>' +
    '<span class="lg-item"><span class="lg-swatch" style="background:' + GREEN + '"></span>reactions</span>' +
    '<span class="lg-item"><span class="lg-swatch" style="background:' + BLUE + '"></span>posts</span>' +
    '</div><div class="chart-canvas"><canvas id="ch-engagement"></canvas></div></div>' +

    '<div class="chart-box"><h3>Engagement rate</h3><div class="c-sub">% reactions per views, per day</div>' +
    '<div class="chart-canvas"><canvas id="ch-rate"></canvas></div></div>' +

    '<div class="chart-box"><h3>Per-account performance</h3><div class="c-sub">totals across ' + state.periodDays + ' days</div>' +
    '<div class="legend-row">' +
    '<span class="lg-item"><span class="lg-swatch" style="background:' + ACCENT + '"></span>views</span>' +
    '<span class="lg-item"><span class="lg-swatch" style="background:' + GREEN + '"></span>reactions</span>' +
    '<span class="lg-item"><span class="lg-swatch" style="background:' + BLUE + '"></span>posts</span>' +
    '</div><div class="chart-canvas"><canvas id="ch-accounts"></canvas></div></div>' +
    '</div>' +

    '<div class="section-head"><h2>Top posts</h2>' +
    '<select onchange="sortTop(this.value)" style="background:var(--surface);border:1px solid var(--border-strong);color:var(--text);padding:6px 10px;border-radius:8px;font-size:12px;font-family:var(--mono)">' +
    '<option value="views">by views</option><option value="reactions">by reactions</option><option value="rate">by rate</option>' +
    '</select></div>' +
    '<div class="panel table-wrap" id="top-posts-wrap">' + topPostsTable() + '</div>' +

    '<div class="section-head"><h2>Account summary</h2><span class="sh-side">' + state.periodDays + ' days</span></div>' +
    '<div class="panel table-wrap">' +
    '<table class="tbl"><thead><tr><th>Account</th><th>Posts</th><th>Views</th><th>Avg views</th><th>Reactions</th><th>Avg rct</th><th>Rate</th></tr></thead><tbody>' +
    (perf.accounts.map((a) =>
      '<tr><td>' + esc(a.name) + '</td>' +
      '<td class="mono">' + a.totalPosts + '</td>' +
      '<td class="mono">' + fmtNum(a.totalViews) + '</td>' +
      '<td class="mono muted">' + fmtNum(a.avgViews) + '</td>' +
      '<td class="mono">' + fmtNum(a.totalReactions) + '</td>' +
      '<td class="mono muted">' + fmtNum(a.avgReactions) + '</td>' +
      '<td class="mono ' + (a.engagementRate >= 5 ? 'green' : '') + '">' + a.engagementRate + '%</td></tr>').join('') ||
      '<tr><td colspan="7">' + emptyBox('No data', 'Scraped engagement will appear here after the daily scrape runs.') + '</td></tr>') +
    '</tbody></table></div>';

  const labels = series.series.map((s) => s.day.slice(5));

  killChart('engagement');
  killChart('rate');
  killChart('accounts');

  const engEl = $('#ch-engagement');
  if (engEl) {
    drawChart('engagement', 'ch-engagement', {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Views', data: series.series.map((s) => s.views), borderColor: ACCENT, backgroundColor: 'rgba(240,185,11,0.08)', fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: ACCENT, borderWidth: 2 },
          { label: 'Reactions', data: series.series.map((s) => s.reactions), borderColor: GREEN, backgroundColor: 'rgba(46,189,133,0.08)', fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: GREEN, borderWidth: 2 },
          { label: 'Posts', data: series.series.map((s) => s.posts), borderColor: BLUE, borderDash: [4, 4], tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 1.5, yAxisID: 'y1' }
        ]
      },
      options: Object.assign(chartDefaults(), {
        scales: Object.assign(chartDefaults().scales, {
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: TICK, font: { family: MONO, size: 10 }, precision: 0 } }
        })
      })
    }, 'Views & reactions over time');
  }

  const rateEl = $('#ch-rate');
  if (rateEl) {
    const rates = series.series.map((s) => s.views > 0 ? Number(((s.reactions / s.views) * 100).toFixed(2)) : 0);
    drawChart('rate', 'ch-rate', {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: rates,
          backgroundColor: rates.map((r) => r >= 5 ? 'rgba(46,189,133,0.55)' : 'rgba(240,185,11,0.55)'),
          hoverBackgroundColor: rates.map((r) => r >= 5 ? GREEN : ACCENT),
          borderRadius: 4, maxBarThickness: 22
        }]
      },
      options: Object.assign(chartDefaults(), {
        plugins: Object.assign(chartDefaults().plugins, {
          tooltip: Object.assign(chartDefaults().plugins.tooltip, {
            callbacks: { label: (ctx) => ctx.parsed.y + '%' }
          })
        }),
        scales: Object.assign(chartDefaults().scales, {
          y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK, font: { family: MONO, size: 10 }, callback: (v) => v + '%' }, suggestedMax: 10 }
        })
      })
    }, 'Engagement rate');
  }

  const accEl = $('#ch-accounts');
  if (accEl) {
    drawChart('accounts', 'ch-accounts', {
      type: 'bar',
      data: {
        labels: perf.accounts.map((a) => a.name),
        datasets: [
          { label: 'Views', data: perf.accounts.map((a) => a.totalViews), backgroundColor: 'rgba(240,185,11,0.55)', hoverBackgroundColor: ACCENT, borderRadius: 4, maxBarThickness: 26 },
          { label: 'Reactions', data: perf.accounts.map((a) => a.totalReactions), backgroundColor: 'rgba(46,189,133,0.55)', hoverBackgroundColor: GREEN, borderRadius: 4, maxBarThickness: 26 },
          { label: 'Posts', data: perf.accounts.map((a) => a.totalPosts), backgroundColor: 'rgba(122,162,247,0.5)', hoverBackgroundColor: BLUE, borderRadius: 4, maxBarThickness: 26 }
        ]
      },
      options: Object.assign(chartDefaults(), {
        plugins: Object.assign(chartDefaults().plugins, {
          legend: { display: false }
        })
      })
    }, 'Per-account performance');
  }
}

function topPostsTable() {
  const list = [...state.topPosts].sort((a, b) => {
    if (state.topSort === 'reactions') return (b.reactions || 0) - (a.reactions || 0);
    if (state.topSort === 'rate') return (b.engagementRate || 0) - (a.engagementRate || 0);
    return (b.views || 0) - (a.views || 0);
  });
  if (list.length === 0) {
    return emptyBox('No engagement data yet', 'The daily scraper fills views and reactions automatically.');
  }
  return '<table class="tbl"><thead><tr><th>#</th><th>Coin</th><th>Account</th><th>Views</th><th>Reactions</th><th>Rate</th><th>Posted</th><th></th></tr></thead><tbody>' +
    list.map((p, i) =>
      '<tr><td class="mono muted">' + String(i + 1).padStart(2, '0') + '</td>' +
      '<td class="mono gold">$' + esc(p.coin || '\u2014') + '</td>' +
      '<td>' + esc(p.account_name || '') + '</td>' +
      '<td class="mono">' + fmtNum(p.views || 0) + '</td>' +
      '<td class="mono">' + fmtNum(p.reactions || 0) + '</td>' +
      '<td class="mono ' + ((p.engagementRate || 0) >= 5 ? 'green' : '') + '">' + (p.engagementRate || 0) + '%</td>' +
      '<td class="mono muted" style="white-space:nowrap">' + esc(fmtRel(p.posted_at)) + '</td>' +
      '<td>' + (p.post_url && p.post_url !== 'N/A' ? '<a href="' + esc(p.post_url) + '" target="_blank" rel="noopener">' + ICONS.external + '</a>' : '') + '</td></tr>').join('') +
    '</tbody></table>';
}

function setPeriod(d) { state.periodDays = d; loadAnalytics().catch((e) => toast(e.message, false)); }
function setAnAccount(v) { state.anAccount = v; loadAnalytics().catch((e) => toast(e.message, false)); }
function sortTop(v) {
  state.topSort = v;
  const wrap = $('#top-posts-wrap');
  if (wrap) wrap.innerHTML = topPostsTable();
}

/* ---------- global handlers ---------- */

window.openAddAccount = openAddAccount;
window.openEditAccount = openEditAccount;
window.saveAccount = saveAccount;
window.closeModal = closeModal;
window.toggleAccount = toggleAccount;
window.deleteAccount = deleteAccount;
window.setTlAccount = setTlAccount;
window.setTlStatus = setTlStatus;
window.gotoPage = gotoPage;
window.tlSearch = tlSearch;
window.exportCSV = exportCSV;
window.setPeriod = setPeriod;
window.setAnAccount = setAnAccount;
window.sortTop = sortTop;

boot();
