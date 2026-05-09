// Extension view page — reads auth from storage directly

const CONFIG = { apiEndpoint: 'https://chat-collector.eason.phd' };

let accessToken = null;
let offset = 0;
const LIMIT = 20;

async function init() {
  const stored = await chrome.storage.local.get(['accessToken', 'apiEndpoint']);
  if (stored.apiEndpoint) CONFIG.apiEndpoint = stored.apiEndpoint;

  if (!stored.accessToken) {
    showError('Not signed in. Please sign in via the PrompTutor extension popup.');
    document.getElementById('chatList').innerHTML = '';
    return;
  }

  accessToken = stored.accessToken;
  await loadChats();

  document.getElementById('loadMoreBtn').addEventListener('click', loadChats);
}

async function loadChats() {
  try {
    const res = await fetch(`${CONFIG.apiEndpoint}/api/my-chats?limit=${LIMIT}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    document.getElementById('total').textContent = data.total;

    if (data.logs.length === 0 && offset === 0) {
      document.getElementById('chatList').innerHTML = '<div class="empty">No data uploaded yet.</div>';
      return;
    }

    if (offset === 0) document.getElementById('chatList').innerHTML = '';

    renderChats(data.logs);
    offset += data.logs.length;

    const loadMore = document.getElementById('loadMore');
    loadMore.style.display = offset < data.total ? 'block' : 'none';
  } catch (e) {
    showError(e.message);
  }
}

function renderChats(logs) {
  const list = document.getElementById('chatList');
  for (const log of logs) {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.innerHTML = `
      <div class="chat-header">
        <span class="chat-chevron">▶</span>
        <span class="chat-platform">${escapeHtml(log.platform || 'unknown')}</span>
        <span class="chat-url">${escapeHtml(log.url || '')}</span>
        <span class="chat-meta">${log.message_count} msg · ${formatDate(log.last_message_at)}</span>
      </div>
      <div class="chat-messages" data-chat-id="${escapeHtml(log.chat_id || '')}" data-loaded="false"></div>
    `;
    item.querySelector('.chat-header').addEventListener('click', () => toggleChat(item));
    list.appendChild(item);
  }
}

async function toggleChat(item) {
  item.classList.toggle('expanded');
  const messagesEl = item.querySelector('.chat-messages');
  if (item.classList.contains('expanded') && messagesEl.dataset.loaded === 'false') {
    messagesEl.innerHTML = '<div style="padding:8px;color:#aaa;font-size:13px">Loading…</div>';
    await loadMessages(messagesEl);
  }
}

async function loadMessages(el) {
  const chatId = el.dataset.chatId;
  if (!chatId) {
    el.innerHTML = '<div style="padding:8px;color:#aaa;font-size:13px">No chat ID</div>';
    return;
  }
  try {
    const res = await fetch(`${CONFIG.apiEndpoint}/api/chat/${encodeURIComponent(chatId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();

    el.innerHTML = rows.map(row => `
      <div class="message user">
        <div class="message-label">You</div>
        ${escapeHtml(row.message_text || '')}
      </div>
      ${row.assistant_response ? `
        <div class="message assistant">
          <div class="message-label">Assistant</div>
          ${escapeHtml(row.assistant_response)}
        </div>
      ` : ''}
    `).join('');

    el.dataset.loaded = 'true';
  } catch (e) {
    el.innerHTML = `<div style="padding:8px;color:#c62828;font-size:13px">Failed to load: ${escapeHtml(e.message)}</div>`;
  }
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = 'block';
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

init();
