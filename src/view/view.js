// Private extension page: credentials remain in extension storage, never in a URL.
const CONFIG = { apiEndpoint: 'https://chat-collector.eason.phd' };
const LIMIT = 20;
let visibleCount = LIMIT;
let loading = false;
let sessionKey = null;
const expanded = new Set();

async function init() {
  const stored = await chrome.storage.local.get(['accessToken', 'apiEndpoint']);
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
  document.getElementById('loadMoreBtn').disabled = true;
  document.getElementById('refreshStatus').textContent = 'Refreshing…';
  try {
    const stored = await chrome.storage.local.get(['accessToken', 'apiEndpoint']);
    const nextSession = `${stored.apiEndpoint || CONFIG.apiEndpoint}:${stored.accessToken || ''}`;
    if (sessionKey && sessionKey !== nextSession) clearPrivateData();
    sessionKey = nextSession;
    if (!stored.accessToken) { const error = new Error('Not signed in. Sign in again via the extension popup.'); error.status = 401; throw error; }
    const target = visibleCount + (more ? LIMIT : 0);
    const logs = [];
    let total = 0;
    // Re-read every visible page so new/deleted conversations do not duplicate stale pages.
    for (let offset = 0; offset < target; offset += LIMIT) {
      const res = await fetch(`${stored.apiEndpoint || CONFIG.apiEndpoint}/api/my-chats?limit=${LIMIT}&offset=${offset}&includeData=1`, {
        cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${stored.accessToken}` }
      });
      if (!res.ok) {
        const error = new Error(res.status === 401 ? 'Session expired. Sign in again via the extension popup.' : `HTTP ${res.status}`);
        error.status = res.status; throw error;
      }
      const data = await res.json();
      total = Number(data.total);
      logs.push(...data.logs);
      if (offset + data.logs.length >= total || data.logs.length < LIMIT) break;
    }
    const unique = new Map(logs.map(log => [chatKey(log), log]));
    renderChats([...unique.values()]);
    visibleCount = Math.max(LIMIT, unique.size);
    document.getElementById('total').textContent = total;
    document.getElementById('loadMore').style.display = unique.size < total ? 'block' : 'none';
    document.getElementById('error').style.display = 'none';
    document.getElementById('refreshStatus').textContent = `Updated ${new Date().toLocaleTimeString()} · auto-refresh 15s`;
  } catch (error) {
    if (error.status === 401 || error.status === 403) clearPrivateData();
    showError(error.message);
    document.getElementById('refreshStatus').textContent = 'Refresh failed; retrying every 15s. Displayed data may be stale.';
  } finally {
    loading = false;
    document.getElementById('loadMoreBtn').disabled = false;
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
  if (!log.chat_id) { el.textContent = 'Details for conversations without a chat ID require the updated backend.'; return; }
  if (el.dataset.loading === 'true') return;
  el.dataset.loading = 'true';
  el.textContent = 'Loading…';
  try {
    const stored = await chrome.storage.local.get(['accessToken', 'apiEndpoint']);
    const nextSession = `${stored.apiEndpoint || CONFIG.apiEndpoint}:${stored.accessToken || ''}`;
    if (sessionKey && sessionKey !== nextSession) clearPrivateData();
    sessionKey = nextSession;
    if (!stored.accessToken) { clearPrivateData(); showError('Not signed in.'); return; }
    const res = await fetch(`${stored.apiEndpoint || CONFIG.apiEndpoint}/api/chat/${encodeURIComponent(log.chat_id)}`, {
      cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${stored.accessToken}` }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) clearPrivateData();
      throw new Error(`HTTP ${res.status}`);
    }
    const rows = await res.json();
    el.innerHTML = rows.map(row => `<div class="message user"><div class="message-label">You</div>${escapeHtml(row.message_text || '')}</div>
      ${row.assistant_response ? `<div class="message assistant"><div class="message-label">Assistant</div>${escapeHtml(row.assistant_response)}</div>` : ''}`).join('');
  } catch (error) { el.textContent = `Failed to load messages: ${error.message}`; }
  finally { el.dataset.loading = 'false'; }
}
function showError(msg) { const el = document.getElementById('error'); el.textContent = msg; el.style.display = 'block'; }
function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}
function escapeHtml(value) { const d = document.createElement('div'); d.textContent = String(value ?? ''); return d.innerHTML; }
init().catch(error => showError(error.message));
