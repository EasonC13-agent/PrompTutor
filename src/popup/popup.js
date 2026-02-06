// Popup UI logic

const toggle = document.getElementById('enableToggle');
const status = document.getElementById('status');
const statusText = document.getElementById('statusText');
const pendingCount = document.getElementById('pendingCount');
const syncBtn = document.getElementById('syncBtn');

// Load current status
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (response) {
    updateUI(response.enabled, response.pendingCount);
  }
});

// Handle toggle
toggle.addEventListener('change', () => {
  chrome.runtime.sendMessage({ 
    type: 'TOGGLE_ENABLED', 
    enabled: toggle.checked 
  }, (response) => {
    if (response) {
      updateUI(response.enabled);
    }
  });
});

// Handle sync button
syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';
  
  chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, (response) => {
    if (response?.success) {
      syncBtn.textContent = `Synced ${response.synced} items!`;
      pendingCount.textContent = '0';
    } else {
      syncBtn.textContent = `Error: ${response?.error || 'Unknown'}`;
    }
    
    setTimeout(() => {
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync Now';
    }, 2000);
  });
});

function updateUI(enabled, pending = 0) {
  toggle.checked = enabled;
  status.className = `status ${enabled ? 'enabled' : 'disabled'}`;
  statusText.textContent = enabled ? 'Collecting data' : 'Disabled';
  pendingCount.textContent = pending;
}
