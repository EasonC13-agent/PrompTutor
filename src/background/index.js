// Background service worker
// Handles data collection and sync to backend

const API_ENDPOINT = 'http://localhost:3000/api/chats'; // TODO: configure

let isEnabled = false;
let pendingData = [];

// Load state on startup
chrome.storage.local.get(['enabled', 'pendingData'], (result) => {
  isEnabled = result.enabled ?? false;
  pendingData = result.pendingData ?? [];
  console.log('[Chat Collector] Background loaded, enabled:', isEnabled);
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHAT_DATA') {
    handleChatData(message.payload);
  } else if (message.type === 'TOGGLE_ENABLED') {
    isEnabled = message.enabled;
    chrome.storage.local.set({ enabled: isEnabled });
    sendResponse({ enabled: isEnabled });
  } else if (message.type === 'GET_STATUS') {
    sendResponse({ 
      enabled: isEnabled, 
      pendingCount: pendingData.length 
    });
  } else if (message.type === 'SYNC_NOW') {
    syncPendingData().then(result => sendResponse(result));
    return true; // Keep channel open for async response
  }
});

async function handleChatData(payload) {
  if (!isEnabled) {
    console.log('[Chat Collector] Ignored (disabled):', payload.url);
    return;
  }
  
  console.log('[Chat Collector] Captured:', payload.platform, payload.url);
  
  // Add to pending queue
  pendingData.push({
    id: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    ...payload
  });
  
  // Persist to storage
  await chrome.storage.local.set({ pendingData });
  
  // Try to sync immediately
  await syncPendingData();
}

async function syncPendingData() {
  if (pendingData.length === 0) {
    return { success: true, synced: 0 };
  }
  
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: pendingData })
    });
    
    if (response.ok) {
      const synced = pendingData.length;
      pendingData = [];
      await chrome.storage.local.set({ pendingData });
      console.log('[Chat Collector] Synced', synced, 'items');
      return { success: true, synced };
    } else {
      console.error('[Chat Collector] Sync failed:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (e) {
    console.error('[Chat Collector] Sync error:', e);
    return { success: false, error: e.message };
  }
}

// Periodic sync attempt
chrome.alarms.create('sync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') {
    syncPendingData();
  }
});
