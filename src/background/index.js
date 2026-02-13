// Background service worker
// Handles data collection, caching, and sync to backend

// Config
const CONFIG = {
  apiEndpoint: 'https://YOUR_SERVER_URL'
};

// State
let isEnabled = false;
let userAnonId = null; // Hashed email for anonymous identification
let conversationCache = {}; // { url: { data: [], lastUpdate: timestamp } }
let activeConversations = new Set(); // Currently open conversation URLs

// Load state on startup
chrome.storage.local.get(['enabled', 'user', 'conversationCache', 'apiEndpoint'], (result) => {
  isEnabled = result.enabled ?? false;
  userAnonId = result.user?.anonId ?? null;
  conversationCache = result.conversationCache ?? {};
  if (result.apiEndpoint) CONFIG.apiEndpoint = result.apiEndpoint;
  console.log('[Chat Collector] Background loaded, enabled:', isEnabled, 'anonId:', userAnonId?.slice(0,8));
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    const wasEnabled = isEnabled;
    isEnabled = changes.enabled.newValue;
    
    // If toggled OFF, delete data for all active conversations
    if (wasEnabled && !isEnabled) {
      deleteActiveConversations();
    }
    // If toggled ON, sync cached data for active conversations
    else if (!wasEnabled && isEnabled) {
      syncActiveConversations();
    }
  }
  if (changes.user) {
    userAnonId = changes.user.newValue?.anonId ?? null;
  }
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Chat Collector BG] Received message:', message.type);
  
  switch (message.type) {
    case 'CHAT_DATA':
      handleChatData(message.payload, sender.tab?.url);
      break;
      
    case 'CONVERSATION_OPENED':
      handleConversationOpened(message.url);
      break;
      
    case 'CONVERSATION_CLOSED':
      handleConversationClosed(message.url);
      break;
      
    case 'TOGGLE_ENABLED':
      // Handled by storage change listener
      break;
      
    case 'GET_STATUS':
      sendResponse({ 
        enabled: isEnabled, 
        pendingCount: Object.keys(conversationCache).reduce((sum, url) => 
          sum + (conversationCache[url]?.data?.length || 0), 0)
      });
      break;
      
    case 'SYNC_NOW':
      userAnonId = message.userAnonId || userAnonId;
      syncAllCachedData().then(result => sendResponse(result));
      return true; // Keep channel open for async response
  }
});

// Handle incoming chat data
function handleChatData(payload, tabUrl) {
  console.log('[Chat Collector BG] handleChatData called, isEnabled:', isEnabled, 'userAnonId:', userAnonId?.slice(0,8));
  
  const url = payload.url || tabUrl;
  if (!url) {
    console.log('[Chat Collector BG] No URL, skipping');
    return;
  }
  
  // Extract conversation base URL (e.g., https://chatgpt.com/c/abc123)
  const conversationUrl = getConversationUrl(url);
  
  console.log('[Chat Collector BG] Captured:', payload.platform, conversationUrl);
  
  // Cache the data
  if (!conversationCache[conversationUrl]) {
    conversationCache[conversationUrl] = { data: [], lastUpdate: null };
  }
  
  conversationCache[conversationUrl].data.push({
    id: self.crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    ...payload,
    url: conversationUrl
  });
  conversationCache[conversationUrl].lastUpdate = Date.now();
  
  // Persist cache
  chrome.storage.local.set({ conversationCache });
  
  // If enabled, sync immediately
  if (isEnabled && userAnonId) {
    syncConversation(conversationUrl);
  }
}

// Handle conversation opened
function handleConversationOpened(url) {
  const conversationUrl = getConversationUrl(url);
  activeConversations.add(conversationUrl);
  console.log('[Chat Collector] Conversation opened:', conversationUrl);
  
  // If enabled and we have cached data, sync it
  if (isEnabled && userAnonId && conversationCache[conversationUrl]?.data?.length > 0) {
    syncConversation(conversationUrl);
  }
}

// Handle conversation closed
async function handleConversationClosed(url) {
  const conversationUrl = getConversationUrl(url);
  activeConversations.delete(conversationUrl);
  console.log('[Chat Collector] Conversation closed:', conversationUrl);
  
  // If toggle is OFF, delete this conversation's data from server
  if (!isEnabled && userAnonId) {
    await deleteConversation(conversationUrl);
  }
}

// Delete data for all active conversations (when toggle turned OFF)
async function deleteActiveConversations() {
  console.log('[Chat Collector] Deleting active conversations data...');
  
  for (const url of activeConversations) {
    await deleteConversation(url);
  }
  
  // Also clear local cache for active conversations
  for (const url of activeConversations) {
    delete conversationCache[url];
  }
  chrome.storage.local.set({ conversationCache });
}

// Sync data for all active conversations (when toggle turned ON)
async function syncActiveConversations() {
  console.log('[Chat Collector] Syncing active conversations...');
  
  for (const url of activeConversations) {
    if (conversationCache[url]?.data?.length > 0) {
      await syncConversation(url);
    }
  }
}

// Sync a single conversation's data
async function syncConversation(conversationUrl) {
  const cache = conversationCache[conversationUrl];
  if (!cache?.data?.length || !userAnonId) return;
  
  try {
    const response = await fetch(`${CONFIG.apiEndpoint}/api/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userAnonId
      },
      body: JSON.stringify({ logs: cache.data })
    });
    
    if (response.ok) {
      console.log('[Chat Collector] Synced', cache.data.length, 'items for', conversationUrl);
      // Clear synced data
      conversationCache[conversationUrl].data = [];
      chrome.storage.local.set({ conversationCache });
      return { success: true, synced: cache.data.length };
    } else {
      console.error('[Chat Collector] Sync failed:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (e) {
    console.error('[Chat Collector] Sync error:', e);
    return { success: false, error: e.message };
  }
}

// Delete a conversation's data from server
async function deleteConversation(conversationUrl) {
  if (!userAnonId) return;
  
  try {
    const response = await fetch(`${CONFIG.apiEndpoint}/api/conversation`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userAnonId
      },
      body: JSON.stringify({ url: conversationUrl })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('[Chat Collector] Deleted', result.deleted, 'items for', conversationUrl);
    } else {
      console.error('[Chat Collector] Delete failed:', response.status);
    }
  } catch (e) {
    console.error('[Chat Collector] Delete error:', e);
  }
}

// Sync all cached data
async function syncAllCachedData() {
  const allData = [];
  
  for (const url in conversationCache) {
    if (conversationCache[url]?.data?.length > 0) {
      allData.push(...conversationCache[url].data);
    }
  }
  
  if (allData.length === 0) {
    return { success: true, synced: 0 };
  }
  
  try {
    const response = await fetch(`${CONFIG.apiEndpoint}/api/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userAnonId
      },
      body: JSON.stringify({ logs: allData })
    });
    
    if (response.ok) {
      // Clear all caches
      for (const url in conversationCache) {
        conversationCache[url].data = [];
      }
      chrome.storage.local.set({ conversationCache });
      console.log('[Chat Collector] Synced', allData.length, 'items');
      return { success: true, synced: allData.length };
    } else {
      console.error('[Chat Collector] Sync failed:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (e) {
    console.error('[Chat Collector] Sync error:', e);
    return { success: false, error: e.message };
  }
}

// Extract conversation URL from full URL
function getConversationUrl(url) {
  try {
    const parsed = new URL(url);
    // ChatGPT: /c/xxxxx or /g/xxxxx
    // Claude: /chat/xxxxx
    const match = parsed.pathname.match(/^\/(?:c|g|chat)\/[^\/]+/);
    if (match) {
      return `${parsed.origin}${match[0]}`;
    }
    // Return base URL if no conversation ID
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

// Periodic sync attempt - set up after a delay to ensure APIs are ready
setTimeout(() => {
  try {
    chrome.alarms.create('sync', { periodInMinutes: 5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'sync' && isEnabled && userAnonId) {
        syncAllCachedData();
      }
    });
    console.log('[Chat Collector] Alarms set up');
  } catch (e) {
    console.log('[Chat Collector] Alarms not available:', e.message);
  }
}, 100);
