// Background service worker
// Handles data collection, caching, and sync to backend

importScripts('../privacy.js');

// ==================== CONFIG & STATE ====================

const CONFIG = {
  apiEndpoint: 'https://chat-collector.eason.phd'
};

let isEnabled = false;
let accessToken = null;
let conversationCache = {};
let user = null;
let conversationConsents = {};
let syncPromise = null;
let pendingDeletions = {};
let consentPromise = Promise.resolve();
function canCollect(url) {
  return !pendingDeletions[url] && PROMPTUTOR_PRIVACY.allowed({ enabled: isEnabled, accessToken, user, conversationConsents }, url);
}

let resolveReady;
const ready = new Promise(resolve => { resolveReady = resolve; });
chrome.storage.local.get(['enabled', 'accessToken', 'conversationCache', 'apiEndpoint', 'user', 'conversationConsents', 'pendingDeletions'], (result) => {
  pendingDeletions = result.pendingDeletions || {};
  user = result.user || null;
  conversationConsents = result.conversationConsents || {};
  isEnabled = result.enabled ?? false;
  accessToken = result.accessToken ?? null;
  conversationCache = result.conversationCache ?? {};
  if (result.apiEndpoint) CONFIG.apiEndpoint = result.apiEndpoint;
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  conversationCache = Object.fromEntries(Object.entries(conversationCache).filter(([url, cache]) =>
    canCollect(url) && cache.owner === account && Array.isArray(cache.messages)));
  chrome.storage.local.set({ conversationCache }).then(resolveReady);
});

// ==================== LISTENERS ====================

chrome.storage.onChanged.addListener((changes, area) => {
  if (area && area !== 'local') return;
  const previousAccount = PROMPTUTOR_PRIVACY.owner({ user });
  const wasEnabled = isEnabled;
  if (changes.user) user = changes.user.newValue || null;
  if (changes.enabled) isEnabled = changes.enabled.newValue === true;
  if (changes.accessToken) accessToken = changes.accessToken.newValue || null;
  if (changes.conversationConsents) conversationConsents = changes.conversationConsents.newValue || {};
  if (changes.pendingDeletions) pendingDeletions = changes.pendingDeletions.newValue || {};
  if (previousAccount !== PROMPTUTOR_PRIVACY.owner({ user })) {
    conversationCache = {};
    conversationConsents = {};
    chrome.storage.local.set({ conversationCache, conversationConsents });
    return;
  }
  if (wasEnabled && !isEnabled) deleteActiveConversations();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ready.then(() => routeMessage(message, sender, sendResponse)).catch(() => sendResponse({ success: false, error: 'Storage unavailable' }));
  return true;
});

function routeMessage(message, sender, sendResponse) {
  console.log('[PrompTutor BG] Received message:', message.type);

  switch (message.type) {
    case 'CHAT_DATA':
      handleChatData(message.payload, sender.tab?.url).then(accepted => sendResponse({ accepted })).catch(() => sendResponse({ accepted: false }));
      return true;

    case 'SET_CONVERSATION_CONSENT':
      consentPromise = consentPromise.then(() => setConversationConsent(message, sender));
      consentPromise.then(sendResponse).catch(() => sendResponse({ success: false }));
      return true;

    case 'TOGGLE_ENABLED':
      break;

    case 'GET_STATUS':
      sendResponse({
        enabled: isEnabled,
        pendingCount: Object.keys(conversationCache).reduce((sum, url) =>
          sum + (conversationCache[url]?.messages?.length || 0), 0)
      });
      break;

    case 'DELETE_ALL_DATA':
      deleteAllData().then(sendResponse).catch(() => sendResponse({ success: false, error: 'Deletion failed; retry required' }));
      return true;

    case 'SYNC_NOW':
      syncAllCachedData().then(result => sendResponse(result));
      return true;

    case 'GOOGLE_SIGN_IN':
      handleGoogleSignIn().then(result => sendResponse(result)).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'DETECT':
      if (!canCollect(message.url) || getConversationUrl(sender.tab?.url) !== getConversationUrl(message.url)) { sendResponse(null); return; }
      handleDetect(message).then(result => sendResponse(result)).catch(() => sendResponse(null));
      return true;

    case 'LOG_GUIDANCE':
      if (!canCollect(message.url) || getConversationUrl(sender.tab?.url) !== getConversationUrl(message.url)) return;
      handleLogGuidance(message);
      break;
  }
}

chrome.alarms.create('sync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync' && accessToken) {
    syncAllCachedData();
  }
});

// ==================== AUTH ====================

async function googleToken(interactive) {
  const manifest = chrome.runtime.getManifest();
  const redirectUrl = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID();
  const params = new URLSearchParams({ client_id: manifest.oauth2.client_id, response_type: 'token',
    redirect_uri: redirectUrl, scope: manifest.oauth2.scopes.join(' '), state });
  const responseUrl = await chrome.identity.launchWebAuthFlow({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, interactive });
  if (!responseUrl || chrome.runtime.lastError) throw new Error('Authentication failed');
  const response = new URL(responseUrl), expected = new URL(redirectUrl);
  const fragment = new URLSearchParams(response.hash.slice(1));
  if (response.origin !== expected.origin || response.pathname !== expected.pathname || fragment.get('state') !== state) throw new Error('Invalid OAuth callback state or redirect');
  const token = fragment.get('access_token');
  if (!token || fragment.get('error')) throw new Error('No token received from Google');
  return token;
}

async function handleGoogleSignIn() {
  const token = await googleToken(true);
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!userInfoRes.ok) throw new Error('Failed to get user info');

  const userInfo = await userInfoRes.json();

  const user = { email: userInfo.email, name: userInfo.name, picture: userInfo.picture };

  await chrome.storage.local.set({ user, accessToken: token, hasConsented: true });
  accessToken = token;
  chrome.action.setBadgeText({ text: '' });

  console.log('[PrompTutor BG] Sign-in completed');
  return { user, accessToken: token };
}

async function trySilentRefresh() {
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  try {
    const token = await googleToken(false);
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return false;
    const refreshed = await response.json();
    if (!account || refreshed.email?.toLowerCase().trim() !== account || PROMPTUTOR_PRIVACY.owner({ user }) !== account) return false;
    accessToken = token;
    await chrome.storage.local.set({ accessToken });
    return true;
  } catch { return false; }
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}

async function backendFetch(url, options = {}, guard = () => true) {
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  if (!guard()) throw new Error('Consent revoked');
  const res = await fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
  if (res.status === 401) {
    const refreshed = await trySilentRefresh();
    if (refreshed && guard() && PROMPTUTOR_PRIVACY.owner({ user }) === account) {
      return fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
    }
  }
  return res;
}

// ==================== CACHE ====================

async function handleChatData(payload, tabUrl) {
  const conversationUrl = getConversationUrl(payload?.url);
  if (!canCollect(conversationUrl) || !tabUrl || getConversationUrl(tabUrl) !== conversationUrl) return false;
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  const messages = payload.fullConversation || payload.messages || [];
  if (!Array.isArray(messages)) return false;
  const pairs = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'user' || typeof message.content !== 'string' || !message.content.trim()) continue;
    const replies = [];
    for (let j = i + 1; j < messages.length && messages[j].role !== 'user'; j++) {
      if (messages[j].role === 'assistant' && typeof messages[j].content === 'string' && messages[j].content.trim()) replies.push(messages[j].content);
    }
    if (!replies.length) continue; // A later full snapshot supplies the completed reply.
    const assistantResponse = replies.join('\n\n');
    const bytes = new TextEncoder().encode(JSON.stringify([account, conversationUrl, i, message.content, assistantResponse]));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const messageHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    pairs.push({ platform: new URL(conversationUrl).hostname === 'claude.ai' ? 'claude' : 'chatgpt',
      url: conversationUrl, chatId: getChatId(conversationUrl), messageText: message.content,
      assistantResponse, messageHash, capturedAt: new Date().toISOString() });
  }
  // Crypto yields: recheck consent and account before writing any content.
  if (!canCollect(conversationUrl) || PROMPTUTOR_PRIVACY.owner({ user }) !== account) return false;
  let cache = conversationCache[conversationUrl];
  if (!cache || cache.owner !== account) cache = conversationCache[conversationUrl] = { owner: account, messages: [], lastUpdate: null };
  const seen = new Set(cache.messages.map(message => message.messageHash));
  for (const pair of pairs) if (!seen.has(pair.messageHash)) { cache.messages.push(pair); seen.add(pair.messageHash); }
  cache.lastUpdate = Date.now();
  await chrome.storage.local.set({ conversationCache });
  return true;
}

function getConversationUrl(url) { return PROMPTUTOR_PRIVACY.conversationUrl(url); }

function getChatId(conversationUrl) {
  try {
    return getConversationUrl(conversationUrl)?.split('/').pop() || null;
  } catch {
    return null;
  }
}

// ==================== SYNC ====================

async function deleteAllData() {
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  const token = accessToken;
  if (!account || !token) return { success: false, error: 'Sign in first' };
  for (const url of Object.keys(conversationConsents)) {
    if (conversationConsents[url] === account) pendingDeletions[url] = account;
  }
  isEnabled = false;
  conversationConsents = {};
  conversationCache = {};
  await chrome.storage.local.set({ enabled: false, conversationConsents, conversationCache, pendingDeletions });
  await syncPromise;
  if (PROMPTUTOR_PRIVACY.owner({ user }) !== account) return { success: false, error: 'Account changed; retry deletion with the original account' };
  const response = await fetch(`${CONFIG.apiEndpoint}/api/my-chats`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return { success: false, error: `Deletion failed: HTTP ${response.status}; retry required` };
  const result = await response.json();
  if (PROMPTUTOR_PRIVACY.owner({ user }) === account) {
    for (const url of Object.keys(pendingDeletions)) if (pendingDeletions[url] === account) delete pendingDeletions[url];
    await chrome.storage.local.set({ uploadedCount: 0, pendingDeletions });
  }
  return { success: true, deleted: result.deleted };
}

async function setConversationConsent(message, sender) {
  const url = getConversationUrl(message.url);
  if (!url || url !== getConversationUrl(sender.tab?.url) || !user || !accessToken) return { success: false, error: 'Open a supported conversation and sign in first' };
  if (message.granted === true) {
    if (pendingDeletions[url]) return { success: false, error: 'Deletion pending; retry after synchronization' };
    conversationConsents[url] = PROMPTUTOR_PRIVACY.owner({ user });
    isEnabled = true;
    await chrome.storage.local.set({ enabled: true, conversationConsents });
    return { success: true };
  }
  const account = conversationConsents[url] || PROMPTUTOR_PRIVACY.owner({ user });
  delete conversationConsents[url];
  delete conversationCache[url];
  pendingDeletions[url] = account;
  await chrome.storage.local.set({ conversationCache, conversationConsents, pendingDeletions });
  await syncPromise; // Do not let a completed POST resurrect data after deletion.
  return deleteConversation(url);
}

async function deleteActiveConversations() {
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  for (const url of Object.keys(conversationConsents)) {
    if (conversationConsents[url] === account) pendingDeletions[url] = account;
  }
  conversationConsents = {};
  conversationCache = {};
  await chrome.storage.local.set({ conversationCache, conversationConsents, pendingDeletions });
  await syncPromise;
  for (const url of Object.keys(pendingDeletions)) await deleteConversation(url);
}

async function deleteConversation(url) {
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  if (!accessToken || pendingDeletions[url] !== account) return { success: false, error: 'Deletion needs the original account' };
  try {
    const response = await fetch(`${CONFIG.apiEndpoint}/api/conversation`, {
      method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ url })
    });
    if (!response.ok) return { success: false, error: `Deletion pending: HTTP ${response.status}` };
    if (PROMPTUTOR_PRIVACY.owner({ user }) === account) {
      delete pendingDeletions[url];
      await chrome.storage.local.set({ pendingDeletions });
    }
    return { success: true };
  } catch { return { success: false, error: 'Deletion pending: network failure' }; }
}

async function syncAllCachedData() {
  await ready;
  if (syncPromise) return syncPromise;
  for (const url of Object.keys(pendingDeletions)) {
    const result = await deleteConversation(url);
    if (!result.success) return { ...result, synced: 0 };
  }
  return uploadCachedData();
}

function uploadCachedData() {
  if (syncPromise) return syncPromise;
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  const token = accessToken;
  const batches = Object.entries(conversationCache).filter(([url, cache]) =>
    canCollect(url) && cache.owner === account && cache.messages?.length
  ).map(([url, cache]) => ({ url, cache, messages: cache.messages.slice() }));
  const messages = batches.flatMap(batch => batch.messages);
  if (!messages.length) return Promise.resolve({ success: true, synced: 0 });
  syncPromise = (async () => {
    try {
      const response = await fetch(`${CONFIG.apiEndpoint}/api/message-logs/batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages })
      });
      if (!response.ok) return { success: false, error: `HTTP ${response.status}`, synced: 0 };
      const data = await response.json();
      for (const batch of batches) {
        if (conversationCache[batch.url] !== batch.cache || PROMPTUTOR_PRIVACY.owner({ user }) !== account) continue;
        const sent = new Set(batch.messages);
        batch.cache.messages = batch.cache.messages.filter(message => !sent.has(message));
      }
      const update = { conversationCache };
      if (data.total != null && PROMPTUTOR_PRIVACY.owner({ user }) === account) update.uploadedCount = data.total;
      await chrome.storage.local.set(update);
      return { success: true, synced: messages.length, total: data.total };
    } catch (e) {
      return { success: false, error: e.message, synced: 0 };
    } finally { syncPromise = null; }
  })();
  return syncPromise;
}

// ==================== GUIDANCE ====================

async function handleDetect({ message, platform, url }) {
  try {
    const response = await backendFetch(`${CONFIG.apiEndpoint}/api/detect`, {
      method: 'POST',
      body: JSON.stringify({ message, platform, context: { url } }),
    }, () => canCollect(url));
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
    }, () => canCollect(data.url));
  } catch (e) {
    console.error('[PrompTutor] Guidance log proxy error:', e);
  }
}
