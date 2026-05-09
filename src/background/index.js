// Background service worker
// Handles data collection, caching, and sync to backend

// ==================== CONFIG & STATE ====================

const CONFIG = {
  apiEndpoint: 'https://chat-collector.eason.phd'
};

let isEnabled = false;
let accessToken = null;
let conversationCache = {};

chrome.storage.local.get(['enabled', 'accessToken', 'conversationCache', 'apiEndpoint'], (result) => {
  isEnabled = result.enabled ?? false;
  accessToken = result.accessToken ?? null;
  conversationCache = result.conversationCache ?? {};
  if (result.apiEndpoint) CONFIG.apiEndpoint = result.apiEndpoint;
  console.log('[PrompTutor] Background loaded, enabled:', isEnabled, 'authenticated:', !!accessToken);
});

// ==================== LISTENERS ====================

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    const wasEnabled = isEnabled;
    isEnabled = changes.enabled.newValue;
    if (wasEnabled && !isEnabled) {
      deleteActiveConversations();
    } else if (!wasEnabled && isEnabled) {
      syncAllCachedData();
    }
  }
  if (changes.accessToken) {
    accessToken = changes.accessToken.newValue ?? null;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[PrompTutor BG] Received message:', message.type);

  switch (message.type) {
    case 'CHAT_DATA':
      handleChatData(message.payload, sender.tab?.url);
      break;

    case 'TOGGLE_ENABLED':
      break;

    case 'GET_STATUS':
      sendResponse({
        enabled: isEnabled,
        pendingCount: Object.keys(conversationCache).reduce((sum, url) =>
          sum + (conversationCache[url]?.messages?.length || 0), 0)
      });
      break;

    case 'SYNC_NOW':
      syncAllCachedData().then(result => sendResponse(result));
      return true;

    case 'GOOGLE_SIGN_IN':
      handleGoogleSignIn().then(result => sendResponse(result)).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'DETECT':
      handleDetect(message).then(result => sendResponse(result)).catch(() => sendResponse(null));
      return true;

    case 'LOG_GUIDANCE':
      handleLogGuidance(message);
      break;
  }
});

chrome.alarms.create('sync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync' && isEnabled && accessToken) {
    syncAllCachedData();
  }
});

// ==================== AUTH ====================

async function handleGoogleSignIn() {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2.client_id;
  const redirectUrl = chrome.identity.getRedirectURL();
  const scopes = ['openid', 'email', 'profile'].join(' ');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUrl)}&scope=${encodeURIComponent(scopes)}`;

  console.log('[PrompTutor BG] Starting launchWebAuthFlow, redirect:', redirectUrl);

  const responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });

  if (chrome.runtime.lastError || !responseUrl) {
    throw new Error(chrome.runtime.lastError?.message || 'Authentication failed');
  }

  const token = new URL(responseUrl.replace('#', '?')).searchParams.get('access_token');
  if (!token) throw new Error('No token received from Google');

  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!userInfoRes.ok) throw new Error('Failed to get user info');

  const userInfo = await userInfoRes.json();

  const user = { email: userInfo.email, name: userInfo.name, picture: userInfo.picture };

  await chrome.storage.local.set({ user, accessToken: token, hasConsented: true });
  accessToken = token;
  chrome.action.setBadgeText({ text: '' });

  console.log('[PrompTutor BG] Sign-in success:', user.email);
  return { user, accessToken: token };
}

async function trySilentRefresh() {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2.client_id;
  const redirectUrl = chrome.identity.getRedirectURL();
  const scopes = manifest.oauth2.scopes.join(' ');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUrl)}&scope=${encodeURIComponent(scopes)}`;

  try {
    const responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: false });
    const token = new URL(responseUrl.replace('#', '?')).searchParams.get('access_token');
    if (token) {
      accessToken = token;
      await chrome.storage.local.set({ accessToken: token });
      return true;
    }
  } catch {
    accessToken = null;
    await chrome.storage.local.remove(['accessToken', 'user']);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
  }
  return false;
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}

async function backendFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
  if (res.status === 401) {
    const refreshed = await trySilentRefresh();
    if (refreshed) {
      return fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
    }
  }
  return res;
}

// ==================== CACHE ====================

function handleChatData(payload, tabUrl) {
  const url = payload.url || tabUrl;
  if (!url) return;

  const conversationUrl = getConversationUrl(url);
  const chatId = getChatId(conversationUrl);

  console.log('[PrompTutor BG] Captured:', payload.platform, conversationUrl);

  if (!isEnabled || !accessToken) return;

  const messages = payload.messages || [];
  if (!conversationCache[conversationUrl]) {
    conversationCache[conversationUrl] = { messages: [], lastUpdate: null };
  }

  const seenHashes = new Set(conversationCache[conversationUrl].messages.map(m => m.messageHash).filter(Boolean));
  let added = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user' || !msg.content) continue;
    const next = messages[i + 1];
    const assistantResponse = next?.role === 'assistant' ? next.content : null;
    if (assistantResponse) i++;

    if (msg.hash && seenHashes.has(msg.hash)) continue;
    if (msg.hash) seenHashes.add(msg.hash);

    conversationCache[conversationUrl].messages.push({
      platform: payload.platform,
      url: conversationUrl,
      chatId,
      messageText: msg.content,
      assistantResponse,
      messageHash: msg.hash || null,
      capturedAt: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
    });
    added++;
  }

  if (added === 0) return;
  conversationCache[conversationUrl].lastUpdate = Date.now();

  chrome.storage.local.set({ conversationCache });
}

function getConversationUrl(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/(?:c|g|chat)\/[^\/]+/);
    if (match) return `${parsed.origin}${match[0]}`;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function getChatId(conversationUrl) {
  try {
    const match = new URL(conversationUrl).pathname.match(/^\/(?:c|g|chat)\/([^\/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ==================== SYNC ====================

async function deleteActiveConversations() {
  for (const url of Object.keys(conversationCache)) {
    await deleteConversation(url);
    delete conversationCache[url];
  }
  chrome.storage.local.set({ conversationCache });
}

async function deleteConversation(conversationUrl) {
  if (!accessToken) return;

  try {
    const response = await backendFetch(`${CONFIG.apiEndpoint}/api/conversation`, {
      method: 'DELETE',
      body: JSON.stringify({ url: conversationUrl })
    });
    if (response.ok) {
      const result = await response.json();
      console.log('[PrompTutor] Deleted', result.deleted, 'items for', conversationUrl);
    } else {
      console.error('[PrompTutor] Delete failed:', response.status);
    }
  } catch (e) {
    console.error('[PrompTutor] Delete error:', e);
  }
}

async function syncAllCachedData() {
  const allMessages = [];

  for (const url in conversationCache) {
    if (conversationCache[url]?.messages?.length > 0) {
      allMessages.push(...conversationCache[url].messages);
    }
  }

  if (allMessages.length === 0) return { success: true, synced: 0 };

  try {
    const response = await backendFetch(`${CONFIG.apiEndpoint}/api/message-logs/batch`, {
      method: 'POST',
      body: JSON.stringify({ messages: allMessages })
    });

    if (response.ok) {
      const data = await response.json();
      for (const url in conversationCache) {
        conversationCache[url].messages = [];
      }
      const storageUpdate = { conversationCache };
      if (data.total != null) storageUpdate.uploadedCount = data.total;
      chrome.storage.local.set(storageUpdate);
      console.log('[PrompTutor] Synced', allMessages.length, 'messages, total:', data.total);
      return { success: true, synced: allMessages.length, total: data.total };
    } else {
      console.error('[PrompTutor] Sync failed:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (e) {
    console.error('[PrompTutor] Sync error:', e);
    return { success: false, error: e.message };
  }
}

// ==================== GUIDANCE ====================

async function handleDetect({ message, platform, url }) {
  try {
    const response = await backendFetch(`${CONFIG.apiEndpoint}/api/detect`, {
      method: 'POST',
      body: JSON.stringify({ message, platform, context: { url } }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error('[PrompTutor] Detect proxy error:', e);
    return null;
  }
}

async function handleLogGuidance(data) {
  try {
    await backendFetch(`${CONFIG.apiEndpoint}/api/guidance-log`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error('[PrompTutor] Guidance log proxy error:', e);
  }
}
