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

let engagementChart = null;
let engagementRateChart = null;
let accountComparisonChart = null;

async function loadAnalytics() {
  const view = $('#view-analytics');
  view.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const [series, overview, performance, topPosts] = await Promise.all([
      api('/api/stats/engagement-series?days=30'),
      api('/api/stats/overview'),
      api('/api/stats/account-performance?days=30'),
      api('/api/stats/top-posts?days=30&limit=10')
    ]);
    
    state.series = series.series;
    state.performance = performance.accounts;

    // Destroy existing charts
    if (engagementChart) engagementChart.destroy();
    if (engagementRateChart) engagementRateChart.destroy();
    if (accountComparisonChart) accountComparisonChart.destroy();

    const labels = series.series.map(s => s.day.slice(5));
    const viewsData = series.series.map(s => s.views);
    const reactionsData = series.series.map(s => s.reactions);
    const postsData = series.series.map(s => s.posts);
    const engagementRateData = series.series.map(s => s.views > 0 ? Number(((s.reactions / s.views) * 100).toFixed(2)) : 0);

    // Build HTML with canvas elements for charts
    view.innerHTML = `
      <div class="analytics-controls">
        <label>Period:</label>
        <select id="analytics-period" onchange="changeAnalyticsPeriod(this.value)">
          <option value="7">7 days</option>
          <option value="14" selected>14 days</option>
          <option value="30" selected>30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>
        <label>Account:</label>
        <select id="analytics-account" onchange="changeAnalyticsAccount(this.value)">
          <option value="">All accounts</option>
          ${overview.accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
        </select>
      </div>

      <div class="chart-grid">
        <div class="chart-box">
          <h3>Views & Reactions Over Time</h3>
          <div class="chart-legend">
            <span class="legend-item"><span class="legend-color" style="background:#f0b90b"></span>Views</span>
            <span class="legend-item"><span class="legend-color" style="background:#2ea44f"></span>Reactions</span>
            <span class="legend-item"><span class="legend-color" style="background:#58a6ff"></span>Posts</span>
          </div>
          <canvas id="engagement-chart" height="200"></canvas>
        </div>

        <div class="chart-box">
          <h3>Engagement Rate (Reactions / Views %)</h3>
          <canvas id="engagement-rate-chart" height="200"></canvas>
        </div>
      </div>

      <div class="chart-grid">
        <div class="chart-box">
          <h3>Per-Account Performance (Last 30 Days)</h3>
          <canvas id="account-comparison-chart" height="200"></canvas>
        </div>

        <div class="chart-box">
          <h3>Top Posts by Engagement</h3>
          <table class="table">
            <thead><tr><th>Coin</th><th>Account</th><th>Views</th><th>Reactions</th><th>Engagement %</th><th>Time</th></tr></thead>
            <tbody>
              ${topPosts.posts.length === 0 ? '<tr><td colspan="6" class="empty">No engagement data yet.</td></tr>' : topPosts.posts.map(p => `
                <tr>
                  <td class="mono">${esc(p.coin || '—')}</td>
                  <td>${esc(p.account_name)}</td>
                  <td class="mono">${p.views || 0}</td>
                  <td class="mono">${p.reactions || 0}</td>
                  <td class="mono ${p.engagementRate > 5 ? 'green' : ''}">${p.engagementRate}%</td>
                  <td class="mono">${fmtDate(p.posted_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="chart-box">
        <h3>Account Summary Table</h3>
        <table class="table">
          <thead><tr><th>Account</th><th>Mode</th><th>Posts</th><th>Views</th><th>Reactions</th><th>Avg Views</th><th>Avg Reactions</th><th>Engagement %</th></tr></thead>
          <tbody>
            ${performance.accounts.length === 0 ? '<tr><td colspan="8" class="empty">No accounts.</td></tr>' : performance.accounts.map(a => `
              <tr>
                <td>${esc(a.name)}</td>
                <td><span class="pill">${esc(a.mode)}</span></td>
                <td class="mono">${a.totalPosts}</td>
                <td class="mono">${a.totalViews}</td>
                <td class="mono">${a.totalReactions}</td>
                <td class="mono">${a.avgViews}</td>
                <td class="mono">${a.avgReactions}</td>
                <td class="mono ${a.engagementRate > 5 ? 'green' : ''}">${a.engagementRate}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Initialize charts after DOM is ready
    setTimeout(() => {
      initEngagementChart(labels, viewsData, reactionsData, postsData);
      initEngagementRateChart(labels, engagementRateData);
      initAccountComparisonChart(performance.accounts);
    }, 0);

  } catch (err) {
    view.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}</div>`;
  }
}

function initEngagementChart(labels, views, reactions, posts) {
  const ctx = document.getElementById('engagement-chart');
  if (!ctx) return;
  
  engagementChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Views',
          data: views,
          borderColor: '#f0b90b',
          backgroundColor: 'rgba(240,185,11,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
          yAxisID: 'y'
        },
        {
          label: 'Reactions',
          data: reactions,
          borderColor: '#2ea44f',
          backgroundColor: 'rgba(46,164,79,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
          yAxisID: 'y'
        },
        {
          label: 'Posts',
          data: posts,
          borderColor: '#58a6ff',
          backgroundColor: 'rgba(88,166,255,0.1)',
          fill: false,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderDash: [5, 5],
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#2d333b',
          borderWidth: 1,
          padding: 12,
          displayColors: true
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(45,51,59,0.3)' },
          ticks: { color: '#8b949e', font: { size: 11 } }
        },
        y: {
          type: 'linear',
          position: 'left',
          grid: { color: 'rgba(45,51,59,0.3)' },
          ticks: { color: '#8b949e', font: { size: 11 } },
          beginAtZero: true
        },
        y1: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#8b949e', font: { size: 11 } },
          beginAtZero: true
        }
      }
    }
  });
}

function initEngagementRateChart(labels, rates) {
  const ctx = document.getElementById('engagement-rate-chart');
  if (!ctx) return;

  engagementRateChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Engagement Rate %',
        data: rates,
        backgroundColor: rates.map(r => r > 5 ? 'rgba(46,164,79,0.6)' : 'rgba(240,185,11,0.6)'),
        borderColor: rates.map(r => r > 5 ? '#2ea44f' : '#f0b90b'),
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#2d333b',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (ctx) => `Engagement Rate: ${ctx.parsed.y}%`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(45,51,59,0.3)' }, ticks: { color: '#8b949e', font: { size: 11 } } },
        y: { 
          grid: { color: 'rgba(45,51,59,0.3)' }, 
          ticks: { color: '#8b949e', font: { size: 11 }, callback: (v) => v + '%' },
          beginAtZero: true,
          suggestedMax: Math.max(10, Math.max(...rates) * 1.2)
        }
      }
    }
  });
}

function initAccountComparisonChart(accounts) {
  const ctx = document.getElementById('account-comparison-chart');
  if (!ctx) return;

  const labels = accounts.map(a => a.name);
  const viewsData = accounts.map(a => a.totalViews);
  const reactionsData = accounts.map(a => a.totalReactions);
  const postsData = accounts.map(a => a.totalPosts);

  accountComparisonChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Views',
          data: viewsData,
          backgroundColor: 'rgba(240,185,11,0.6)',
          borderColor: '#f0b90b',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y'
        },
        {
          label: 'Total Reactions',
          data: reactionsData,
          backgroundColor: 'rgba(46,164,79,0.6)',
          borderColor: '#2ea44f',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y'
        },
        {
          label: 'Posts Count',
          data: postsData,
          backgroundColor: 'rgba(88,166,255,0.6)',
          borderColor: '#58a6ff',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          display: true,
          position: 'bottom',
          labels: { color: '#8b949e', font: { size: 11 }, usePointStyle: true }
        },
        tooltip: {
          backgroundColor: '#1c2128',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#2d333b',
          borderWidth: 1,
          padding: 12
        }
      },
      scales: {
        x: { grid: { color: 'rgba(45,51,59,0.3)' }, ticks: { color: '#8b949e', font: { size: 11 } } },
        y: { 
          type: 'linear',
          position: 'left',
          grid: { color: 'rgba(45,51,59,0.3)' },
          ticks: { color: '#8b949e', font: { size: 11 } },
          beginAtZero: true
        },
        y1: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#8b949e', font: { size: 11 } },
          beginAtZero: true
        }
      }
    }
  });
}

async function changeAnalyticsPeriod(days) {
  try {
    const [series, performance] = await Promise.all([
      api(`/api/stats/engagement-series?days=${days}`),
      api(`/api/stats/account-performance?days=${days}`)
    ]);
    
    if (engagementChart) {
      const labels = series.series.map(s => s.day.slice(5));
      engagementChart.data.labels = labels;
      engagementChart.data.datasets[0].data = series.series.map(s => s.views);
      engagementChart.data.datasets[1].data = series.series.map(s => s.reactions);
      engagementChart.data.datasets[2].data = series.series.map(s => s.posts);
      engagementChart.update();
    }

    if (engagementRateChart) {
      const labels = series.series.map(s => s.day.slice(5));
      const rates = series.series.map(s => s.views > 0 ? Number(((s.reactions / s.views) * 100).toFixed(2)) : 0);
      engagementRateChart.data.labels = labels;
      engagementRateChart.data.datasets[0].data = rates;
      engagementRateChart.data.datasets[0].backgroundColor = rates.map(r => r > 5 ? 'rgba(46,164,79,0.6)' : 'rgba(240,185,11,0.6)');
      engagementRateChart.data.datasets[0].borderColor = rates.map(r => r > 5 ? '#2ea44f' : '#f0b90b');
      engagementRateChart.update();
    }

    if (accountComparisonChart) {
      accountComparisonChart.data.labels = performance.accounts.map(a => a.name);
      accountComparisonChart.data.datasets[0].data = performance.accounts.map(a => a.totalViews);
      accountComparisonChart.data.datasets[1].data = performance.accounts.map(a => a.totalReactions);
      accountComparisonChart.data.datasets[2].data = performance.accounts.map(a => a.totalPosts);
      accountComparisonChart.update();
    }
  } catch (err) {
    toast(err.message, false);
  }
}

async function changeAnalyticsAccount(accountId) {
  try {
    const days = document.getElementById('analytics-period').value;
    const url = accountId 
      ? `/api/stats/engagement-series?days=${days}&accountId=${accountId}`
      : `/api/stats/engagement-series?days=${days}`;
    
    const series = await api(url);
    
    if (engagementChart) {
      const labels = series.series.map(s => s.day.slice(5));
      engagementChart.data.labels = labels;
      engagementChart.data.datasets[0].data = series.series.map(s => s.views);
      engagementChart.data.datasets[1].data = series.series.map(s => s.reactions);
      engagementChart.data.datasets[2].data = series.series.map(s => s.posts);
      engagementChart.update();
    }

    if (engagementRateChart) {
      const labels = series.series.map(s => s.day.slice(5));
      const rates = series.series.map(s => s.views > 0 ? Number(((s.reactions / s.views) * 100).toFixed(2)) : 0);
      engagementRateChart.data.labels = labels;
      engagementRateChart.data.datasets[0].data = rates;
      engagementRateChart.data.datasets[0].backgroundColor = rates.map(r => r > 5 ? 'rgba(46,164,79,0.6)' : 'rgba(240,185,11,0.6)');
      engagementRateChart.data.datasets[0].borderColor = rates.map(r => r > 5 ? '#2ea44f' : '#f0b90b');
      engagementRateChart.update();
    }
  } catch (err) {
    toast(err.message, false);
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
window.changeAnalyticsPeriod = changeAnalyticsPeriod;
window.changeAnalyticsAccount = changeAnalyticsAccount;

boot();