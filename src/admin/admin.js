const CONFIG = { apiEndpoint: 'https://chat-collector.eason.phd' };
const LIMIT = 50;
let offset = 0;
let currentPlatform = '';
let expandedRows = new Set();
let refreshing = false;
let generation = 0;
let sessionKey = null;

// A generation fences responses even when credentials change A → B → A.
const SESSION_FIELDS = ['accessToken', 'apiEndpoint', 'user'];
const controllers = new Set();
function sessionIdentity(stored) {
  return JSON.stringify([stored.apiEndpoint || CONFIG.apiEndpoint, stored.accessToken || null, stored.user?.email || null]);
}
function invalidateSession() {
  ++generation;
  sessionKey = null;
  for (const controller of controllers) controller.abort();
  controllers.clear();
  clearPrivateData();
  document.getElementById('error').textContent = '';
  document.getElementById('refreshStatus').textContent = 'Session changed. Refresh to continue.';
  refreshing = false;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SESSION_FIELDS.some(key => Object.hasOwn(changes, key))) invalidateSession();
});
async function currentSession(run, stored) {
  const current = await chrome.storage.local.get(SESSION_FIELDS);
  if (run !== generation) return false;
  if (sessionIdentity(current) !== sessionIdentity(stored)) { invalidateSession(); return false; }
  return true;
}
async function privateRequest(url, stored) {
  const controller = new AbortController();
  controllers.add(controller);
  try {
    const res = await fetch(url, {
      cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      headers: { Authorization: `Bearer ${stored.accessToken}` }
    });
    if (!res.ok) {
      const error = new Error(res.status === 401 ? 'Session expired. Sign in again via the extension popup.' : res.status === 403 ? 'Admin access required.' : `HTTP ${res.status}`);
      error.status = res.status; throw error;
    }
    return await res.json();
  } finally { controllers.delete(controller); }
}

async function init() {
  const stored = await chrome.storage.local.get(SESSION_FIELDS);
  if (!stored.accessToken) { showError('Not signed in. Please sign in via the PrompTutor extension popup.'); return; }
  document.getElementById('applyFilter').addEventListener('click', () => {
    currentPlatform = document.getElementById('filterPlatform').value;
    offset = 0; expandedRows.clear(); refreshDashboard(true);
  });
  document.getElementById('prevBtn').addEventListener('click', () => {
    offset = Math.max(0, offset - LIMIT); expandedRows.clear(); refreshDashboard(true);
  });
  document.getElementById('nextBtn').addEventListener('click', () => {
    offset += LIMIT; expandedRows.clear(); refreshDashboard(true);
  });
  document.getElementById('refreshBtn').addEventListener('click', () => refreshDashboard(true));
  await refreshDashboard();
  const timer = setInterval(() => refreshDashboard(), 15000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}

async function request(route, stored) {
  return privateRequest(`${stored.apiEndpoint || CONFIG.apiEndpoint}${route}`, stored);
}

async function refreshDashboard(force = false) {
  if (refreshing && !force) return;
  refreshing = true;
  const run = ++generation;
  const pageOffset = offset, platform = currentPlatform;
  document.getElementById('refreshStatus').textContent = 'Refreshing…';
  let stored;
  try {
    stored = await chrome.storage.local.get(SESSION_FIELDS);
    if (run !== generation) return;
    const nextSession = sessionIdentity(stored);
    if (sessionKey && sessionKey !== nextSession) clearPrivateData();
    sessionKey = nextSession;
    if (!stored.accessToken) { const error = new Error('Not signed in. Sign in again via the extension popup.'); error.status = 401; throw error; }
    const params = new URLSearchParams({ limit: LIMIT, offset: pageOffset });
    if (platform) params.set('platform', platform);
    const [stats, data] = await Promise.all([
      request('/api/admin/stats', stored), request(`/api/admin/chats?${params}`, stored)
    ]);
    if (!await currentSession(run, stored) || run !== generation) return;
    if (pageOffset > 0 && pageOffset >= data.total) {
      offset = Math.max(0, Math.floor((data.total - 1) / LIMIT) * LIMIT);
      return await refreshDashboard(true);
    }
    renderStats(stats);
    renderLogs(data.logs);
    updatePagination(data.logs.length, data.total);
    document.getElementById('error').classList.add('hidden');
    document.getElementById('refreshStatus').textContent = `Updated ${new Date().toLocaleTimeString()} · auto-refresh 15s`;
  } catch (error) {
    if (!stored || !await currentSession(run, stored) || run !== generation) return;
    if (error.status === 401 || error.status === 403) clearPrivateData();
    showError(error.message);
    document.getElementById('refreshStatus').textContent = 'Refresh failed; retrying every 15s. Displayed data may be stale.';
  } finally {
    if (run === generation) refreshing = false;
  }
}

function clearPrivateData() {
  for (const id of ['logsBody', 'platformBody']) document.getElementById(id).innerHTML = '';
  for (const id of ['statTotal', 'statUsers', 'statLatest']) document.getElementById(id).textContent = '—';
  document.getElementById('pageInfo').textContent = '';
  document.getElementById('prevBtn').disabled = true;
  document.getElementById('nextBtn').disabled = true;
  expandedRows.clear();
}

function renderStats(data) {
  document.getElementById('statTotal').textContent = Number(data.totalLogs).toLocaleString();
  document.getElementById('statUsers').textContent = Number(data.totalUsers).toLocaleString();
  const latest = data.latestCapturedAt || data.byPlatform.map(p => p.last_capture).filter(Boolean).sort().at(-1);
  document.getElementById('statLatest').textContent = latest ? new Date(latest).toLocaleString() : 'No captures';
  document.getElementById('platformBody').innerHTML = data.byPlatform
    .sort((a, b) => Number(b.log_count) - Number(a.log_count))
    .map(p => `<tr><td><span class="platform-tag">${esc(p.platform)}</span></td><td>${Number(p.log_count).toLocaleString()}</td><td>${Number(p.user_count).toLocaleString()}</td><td>${formatDate(p.first_capture)}</td><td>${formatDate(p.last_capture)}</td></tr>`).join('') || '<tr><td colspan="5">No data</td></tr>';
}

function renderLogs(logs) {
  const tbody = document.getElementById('logsBody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#aaa;padding:16px">No logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  logs.forEach((log, i) => {
    const rowId = String(log.id);
    const tr = document.createElement('tr');
    tr.className = 'expandable';
    tr.dataset.id = rowId;
    tr.innerHTML = `
      <td><span class="user-id">${esc(log.user_id?.slice(0, 8))}…</span></td>
      <td><span class="platform-tag">${esc(log.platform || '?')}</span></td>
      <td><div class="msg-text">${esc(log.message_text || '')}</div></td>
      <td><div class="msg-response">${esc(log.assistant_response || '—')}</div></td>
      <td style="white-space:nowrap;color:#aaa">${formatDate(log.captured_at)}</td>
    `;

    const detailTr = document.createElement('tr');
    detailTr.className = expandedRows.has(rowId) ? 'detail-row' : 'detail-row hidden';
    detailTr.dataset.detail = rowId;
    detailTr.innerHTML = `
      <td colspan="5">
        <div class="detail-content">
          <div class="detail-user"><strong>User:</strong> ${esc(log.message_text || '')}</div>
          ${log.assistant_response ? `<div class="detail-assistant"><strong>Assistant:</strong> ${esc(log.assistant_response)}</div>` : ''}
          <div style="margin-top:8px;font-size:11px;color:#bbb">
            ${esc(log.url || '')} · ${esc(log.chat_id || '')}
          </div>
        </div>
      </td>
    `;

    tr.addEventListener('click', () => {
      if (expandedRows.has(rowId)) {
        expandedRows.delete(rowId);
        detailTr.classList.add('hidden');
      } else {
        expandedRows.add(rowId);
        detailTr.classList.remove('hidden');
      }
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  });
}

function updatePagination(count, total) {
  const start = offset + 1;
  const end = offset + count;
  document.getElementById('pageInfo').textContent = count > 0
    ? `Showing ${start}–${end} of ${total.toLocaleString()}`
    : 'No results';
  document.getElementById('prevBtn').disabled = offset === 0;
  document.getElementById('nextBtn').disabled = offset + count >= total;
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

init().catch(error => showError(error.message));
