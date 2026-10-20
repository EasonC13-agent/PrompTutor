// Private extension page: credentials remain in extension storage, never in a URL.
const CONFIG = { apiEndpoint: 'https://chat-collector.eason.phd' };
const LIMIT = 20;
let visibleCount = LIMIT;
let loading = false;
let sessionKey = null;
const expanded = new Set();
let generation = 0;

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
  loading = false;
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
  if (!stored.accessToken) { clearPrivateData(); showError('Not signed in. Please sign in via the PrompTutor extension popup.'); return; }
  document.getElementById('loadMoreBtn').addEventListener('click', () => refreshChats(true));
  document.getElementById('refreshBtn').addEventListener('click', () => refreshChats());
  await refreshChats();
  const timer = setInterval(() => refreshChats(), 15000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}

async function refreshChats(more = false) {
  if (loading) return;
  loading = true;
  const run = ++generation;
  document.getElementById('loadMoreBtn').disabled = true;
  document.getElementById('refreshStatus').textContent = 'Refreshing…';
  let stored;
  try {
    stored = await chrome.storage.local.get(SESSION_FIELDS);
    if (run !== generation) return;
    const nextSession = sessionIdentity(stored);
    if (sessionKey && sessionKey !== nextSession) clearPrivateData();
    sessionKey = nextSession;
    if (!stored.accessToken) { const error = new Error('Not signed in. Sign in again via the extension popup.'); error.status = 401; throw error; }
    const target = visibleCount + (more ? LIMIT : 0);
    const logs = [];
    let total = 0;
    // Re-read every visible page so new/deleted conversations do not duplicate stale pages.
    for (let offset = 0; offset < target; offset += LIMIT) {
      if (!await currentSession(run, stored) || run !== generation) return;
      const data = await privateRequest(`${stored.apiEndpoint || CONFIG.apiEndpoint}/api/my-chats?limit=${LIMIT}&offset=${offset}&includeData=1`, stored);
      total = Number(data.total);
      logs.push(...data.logs);
      if (offset + data.logs.length >= total || data.logs.length < LIMIT) break;
    }
    if (!await currentSession(run, stored) || run !== generation) return;
    const unique = new Map(logs.map(log => [chatKey(log), log]));
    renderChats([...unique.values()]);
    visibleCount = Math.max(LIMIT, unique.size);
    document.getElementById('total').textContent = total;
    document.getElementById('loadMore').style.display = unique.size < total ? 'block' : 'none';
    document.getElementById('error').style.display = 'none';
    document.getElementById('refreshStatus').textContent = `Updated ${new Date().toLocaleTimeString()} · auto-refresh 15s`;
  } catch (error) {
    if (!stored || !await currentSession(run, stored) || run !== generation) return;
    if (error.status === 401 || error.status === 403) clearPrivateData();
    showError(error.message);
    document.getElementById('refreshStatus').textContent = 'Refresh failed; retrying every 15s. Displayed data may be stale.';
  } finally {
    if (run === generation) {
      loading = false;
      document.getElementById('loadMoreBtn').disabled = false;
    }
  }
}
function chatKey(log) { return JSON.stringify([log.chat_id, log.url, log.platform]); }
function clearPrivateData() {
  document.getElementById('chatList').innerHTML = '';
  document.getElementById('total').textContent = '—';
  document.getElementById('loadMore').style.display = 'none';
  expanded.clear(); visibleCount = LIMIT;
}
function renderChats(logs) {
  const list = document.getElementById('chatList');
  list.innerHTML = '';
  if (!logs.length) { list.innerHTML = '<div class="empty">No data uploaded yet.</div>'; return; }
  const keys = new Set(logs.map(chatKey));
  for (const key of expanded) if (!keys.has(key)) expanded.delete(key);
  for (const log of logs) {
    const key = chatKey(log);
    const item = document.createElement('div');
    item.className = expanded.has(key) ? 'chat-item expanded' : 'chat-item';
    item.innerHTML = `<div class="chat-header"><span class="chat-chevron">▶</span>
      <span class="chat-platform">${escapeHtml(log.platform || 'unknown')}</span>
      <span class="chat-url">${escapeHtml(log.url || '')}</span>
      <span class="chat-meta">${Number(log.message_count)} msg · ${formatDate(log.last_message_at)}</span></div>
      <div class="chat-messages"></div>`;
    const messages = item.querySelector('.chat-messages');
    if (Array.isArray(log.messages)) {
      messages.innerHTML = log.messages.map(row => `<div class="message user"><div class="message-label">You</div>${escapeHtml(row.message_text || '')}</div>
        ${row.assistant_response ? `<div class="message assistant"><div class="message-label">Assistant</div>${escapeHtml(row.assistant_response)}</div>` : ''}`).join('');
    } else {
      messages.textContent = 'Expand to load messages.';
      if (expanded.has(key)) loadLegacyMessages(log, messages);
    }
    item.querySelector('.chat-header').addEventListener('click', () => {
      item.classList.toggle('expanded');
      if (item.classList.contains('expanded')) {
        expanded.add(key);
        if (!Array.isArray(log.messages)) loadLegacyMessages(log, messages);
      } else expanded.delete(key);
    });
    list.appendChild(item);
  }
}
// Compatibility with an existing server that does not yet embed conversation rows.
async function loadLegacyMessages(log, el) {
  if (el.dataset.loading === 'true') return;
  const run = generation;
  let stored;
  el.dataset.loading = 'true';
  try {
    stored = await chrome.storage.local.get(SESSION_FIELDS);
    if (!await currentSession(run, stored) || run !== generation || !el.isConnected) return;
    if (sessionIdentity(stored) !== sessionKey || !stored.accessToken) { invalidateSession(); return; }
    if (!log.chat_id) { el.textContent = 'Details for conversations without a chat ID require the updated backend.'; return; }
    el.textContent = 'Loading…';
    const rows = await privateRequest(`${stored.apiEndpoint || CONFIG.apiEndpoint}/api/chat/${encodeURIComponent(log.chat_id)}`, stored);
    if (!await currentSession(run, stored) || run !== generation || !el.isConnected) return;
    el.innerHTML = rows.map(row => `<div class="message user"><div class="message-label">You</div>${escapeHtml(row.message_text || '')}</div>
      ${row.assistant_response ? `<div class="message assistant"><div class="message-label">Assistant</div>${escapeHtml(row.assistant_response)}</div>` : ''}`).join('');
  } catch (error) {
    if (!stored || !await currentSession(run, stored) || run !== generation || !el.isConnected) return;
    if (error.status === 401 || error.status === 403) { invalidateSession(); return; }
    el.textContent = `Failed to load messages: ${error.message}`;
  } finally { el.dataset.loading = 'false'; }
}

function showError(msg) { const el = document.getElementById('error'); el.textContent = msg; el.style.display = 'block'; }
function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}
function escapeHtml(value) { const d = document.createElement('div'); d.textContent = String(value ?? ''); return d.innerHTML; }
init().catch(error => showError(error.message));
