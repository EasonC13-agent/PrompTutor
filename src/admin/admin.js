const CONFIG = { apiEndpoint: 'https://chat-collector.eason.phd' };
const LIMIT = 50;

let accessToken = null;
let offset = 0;
let totalLogs = 0;
let currentPlatform = '';
let expandedRows = new Set();

async function init() {
  const stored = await chrome.storage.local.get(['accessToken', 'apiEndpoint']);
  if (stored.apiEndpoint) CONFIG.apiEndpoint = stored.apiEndpoint;

  if (!stored.accessToken) {
    showError('Not signed in. Please sign in via the PrompTutor extension popup.');
    return;
  }
  accessToken = stored.accessToken;

  document.getElementById('applyFilter').addEventListener('click', () => {
    currentPlatform = document.getElementById('filterPlatform').value;
    offset = 0;
    expandedRows.clear();
    loadLogs();
  });
  document.getElementById('prevBtn').addEventListener('click', () => {
    offset = Math.max(0, offset - LIMIT);
    expandedRows.clear();
    loadLogs();
  });
  document.getElementById('nextBtn').addEventListener('click', () => {
    offset += LIMIT;
    expandedRows.clear();
    loadLogs();
  });

  await Promise.all([loadStats(), loadLogs()]);
}

async function loadStats() {
  try {
    const res = await fetch(`${CONFIG.apiEndpoint}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.status === 403) { showError('Admin access required.'); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    document.getElementById('statTotal').textContent = data.totalLogs.toLocaleString();
    document.getElementById('statUsers').textContent = data.totalUsers.toLocaleString();

    document.getElementById('platformBody').innerHTML = data.byPlatform
      .sort((a, b) => Number(b.log_count) - Number(a.log_count))
      .map(p => `
        <tr>
          <td><span class="platform-tag">${esc(p.platform)}</span></td>
          <td>${Number(p.log_count).toLocaleString()}</td>
          <td>${Number(p.user_count).toLocaleString()}</td>
          <td>${formatDate(p.first_capture)}</td>
          <td>${formatDate(p.last_capture)}</td>
        </tr>
      `).join('') || '<tr><td colspan="5" style="color:#aaa;padding:16px">No data</td></tr>';
  } catch (e) {
    showError(e.message);
  }
}

async function loadLogs() {
  const params = new URLSearchParams({ limit: LIMIT, offset });
  if (currentPlatform) params.set('platform', currentPlatform);

  try {
    const res = await fetch(`${CONFIG.apiEndpoint}/api/admin/chats?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.status === 403) { showError('Admin access required.'); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    totalLogs = data.total;

    renderLogs(data.logs);
    updatePagination(data.logs.length, data.total);
  } catch (e) {
    showError(e.message);
  }
}

function renderLogs(logs) {
  const tbody = document.getElementById('logsBody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#aaa;padding:16px">No logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  logs.forEach((log, i) => {
    const rowId = `row-${offset + i}`;
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
    detailTr.className = 'detail-row hidden';
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

init();
