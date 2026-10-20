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
let networkPromise = Promise.resolve();
function serializeNetwork(operation) {
  const next = networkPromise.then(operation);
  networkPromise = next.catch(() => {});
  return next;
}
let pendingDeletions = {};
let consentPromise = Promise.resolve();
let accountGeneration = 0;
let collectionGeneration = 0;
// Receipts contain only owner and canonical URL; never conversation content.
function deletionKey(url, account = PROMPTUTOR_PRIVACY.owner({ user })) {
  return JSON.stringify([account, getConversationUrl(url)]);
}
function migrateDeletionReceipts(receipts) {
  const migrated = {};
  for (const [key, owner] of Object.entries(receipts || {})) {
    if (typeof owner !== 'string' || !owner.trim()) continue;
    const account = owner.toLowerCase().trim();
    let url = getConversationUrl(key); // Legacy URL -> owner receipt.
    if (!url) {
      try {
        const pair = JSON.parse(key);
        if (Array.isArray(pair) && pair.length === 2 && pair[0] === account) url = getConversationUrl(pair[1]);
      } catch {}
    }
    if (url) migrated[deletionKey(url, account)] = account;
  }
  return migrated;
}
function ownDeletionUrls() {
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  return Object.entries(pendingDeletions).filter(([, owner]) => owner === account)
    .map(([key]) => JSON.parse(key)[1]);
}
function canCollect(url) {
  return !pendingDeletions[deletionKey(url)] && PROMPTUTOR_PRIVACY.allowed({ enabled: isEnabled, accessToken, user, conversationConsents }, url);
}

// Reserve at content admission, not when queued work eventually starts. Current
// consent alone cannot distinguish revoke/regrant or an account ABA transition.
function collectionGuard(url) {
  const collection = collectionGeneration;
  const auth = accountGeneration;
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  const admitted = canCollect(url);
  return () => admitted && collection === collectionGeneration && auth === accountGeneration &&
    account === PROMPTUTOR_PRIVACY.owner({ user }) && canCollect(url);
}

let resolveReady;
const ready = new Promise(resolve => { resolveReady = resolve; });
chrome.storage.local.get(['enabled', 'accessToken', 'conversationCache', 'apiEndpoint', 'user', 'conversationConsents', 'pendingDeletions'], (result) => {
  pendingDeletions = migrateDeletionReceipts(result.pendingDeletions);
  user = result.user || null;
  conversationConsents = result.conversationConsents || {};
  isEnabled = result.enabled ?? false;
  accessToken = result.accessToken ?? null;
  conversationCache = result.conversationCache ?? {};
  if (result.apiEndpoint) CONFIG.apiEndpoint = result.apiEndpoint;
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  conversationCache = Object.fromEntries(Object.entries(conversationCache).filter(([url, cache]) =>
    canCollect(url) && cache.owner === account && Array.isArray(cache.messages)));
  chrome.storage.local.set({ conversationCache, pendingDeletions }).then(resolveReady);
});

// ==================== LISTENERS ====================

chrome.storage.onChanged.addListener((changes, area) => {
  if (area && area !== 'local') return;
  const previousAccount = PROMPTUTOR_PRIVACY.owner({ user });
  const wasEnabled = isEnabled;
  if (changes.user || changes.enabled || changes.conversationConsents || changes.pendingDeletions) collectionGeneration++;
  if (changes.accessToken && (changes.accessToken.newValue || null) !== accessToken) {
    // A refresh publishes its token in memory before storage; external token
    // replacement/removal instead invalidates every outstanding auth attempt.
    accountGeneration++;
    collectionGeneration++;
  }
  if (changes.user) user = changes.user.newValue || null;
  if (changes.enabled) isEnabled = changes.enabled.newValue === true;
  if (changes.accessToken) accessToken = changes.accessToken.newValue || null;
  if (changes.conversationConsents) conversationConsents = changes.conversationConsents.newValue || {};
  if (changes.pendingDeletions) pendingDeletions = migrateDeletionReceipts(changes.pendingDeletions.newValue);
  if (previousAccount !== PROMPTUTOR_PRIVACY.owner({ user })) {
    accountGeneration++;
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
  const generation = accountGeneration;
  try {
    const token = await googleToken(false);
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return false;
    const refreshed = await response.json();
    if (!account || generation !== accountGeneration || refreshed.email?.toLowerCase().trim() !== account || PROMPTUTOR_PRIVACY.owner({ user }) !== account) return false;
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
  const generation = accountGeneration;
  if (!account || !accessToken || !guard()) throw new Error('Consent revoked');
  const res = await fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
  if (res.status === 401 && generation === accountGeneration && PROMPTUTOR_PRIVACY.owner({ user }) === account && guard()) {
    const refreshed = await trySilentRefresh();
    if (refreshed && generation === accountGeneration && guard() && PROMPTUTOR_PRIVACY.owner({ user }) === account) {
      return fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
    }
  }
  return res;
}

// ==================== CACHE ====================

async function handleChatData(payload, tabUrl) {
  const conversationUrl = getConversationUrl(payload?.url);
  const guard = collectionGuard(conversationUrl);
  if (!guard() || !tabUrl || getConversationUrl(tabUrl) !== conversationUrl) return false;
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
    if (!guard()) return false;
    const messageHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    pairs.push({ platform: PROMPTUTOR_PRIVACY.platform(conversationUrl),
      url: conversationUrl, chatId: getChatId(conversationUrl), messageText: message.content,
      assistantResponse, messageHash, capturedAt: new Date().toISOString() });
  }
  // Crypto yields: recheck consent and account before writing any content.
  if (!guard()) return false;
  let cache = conversationCache[conversationUrl];
  if (!cache || cache.owner !== account) cache = conversationCache[conversationUrl] = { owner: account, messages: [], lastUpdate: null };
  const seen = new Set(cache.messages.map(message => message.messageHash));
  for (const pair of pairs) if (!seen.has(pair.messageHash)) { cache.messages.push(pair); seen.add(pair.messageHash); }
  cache.lastUpdate = Date.now();
  await chrome.storage.local.set({ conversationCache });
  return guard();
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
  collectionGeneration++;
  for (const url of Object.keys(conversationConsents)) {
    if (conversationConsents[url] === account) pendingDeletions[deletionKey(url, account)] = account;
  }
  isEnabled = false;
  conversationConsents = {};
  conversationCache = {};
  await chrome.storage.local.set({ enabled: false, conversationConsents, conversationCache, pendingDeletions });
  return serializeNetwork(async () => {
    if (PROMPTUTOR_PRIVACY.owner({ user }) !== account) return { success: false, error: 'Account changed; retry deletion with the original account' };
    const response = await backendFetch(`${CONFIG.apiEndpoint}/api/my-chats`, {
      method: 'DELETE'
    }, () => PROMPTUTOR_PRIVACY.owner({ user }) === account);
    if (!response.ok) return { success: false, error: `Deletion failed: HTTP ${response.status}; retry required` };
    const result = await response.json();
    if (PROMPTUTOR_PRIVACY.owner({ user }) === account) {
      for (const url of Object.keys(pendingDeletions)) if (pendingDeletions[url] === account) delete pendingDeletions[url];
      await chrome.storage.local.set({ uploadedCount: 0, pendingDeletions });
    }
    return { success: true, deleted: result.deleted };
  });
}

async function setConversationConsent(message, sender) {
  const url = getConversationUrl(message.url);
  if (!url || url !== getConversationUrl(sender.tab?.url) || !user || !accessToken) return { success: false, error: 'Open a supported conversation and sign in first' };
  if (message.granted === true) {
    if (pendingDeletions[deletionKey(url)]) return { success: false, error: 'Deletion pending; retry after synchronization' };
    collectionGeneration++;
    conversationConsents[url] = PROMPTUTOR_PRIVACY.owner({ user });
    isEnabled = true;
    await chrome.storage.local.set({ enabled: true, conversationConsents });
    return { success: true };
  }
  const account = conversationConsents[url] || PROMPTUTOR_PRIVACY.owner({ user });
  collectionGeneration++;
  delete conversationConsents[url];
  delete conversationCache[url];
  pendingDeletions[deletionKey(url, account)] = account;
  await chrome.storage.local.set({ conversationCache, conversationConsents, pendingDeletions });
  // Queue behind all admitted uploads/deletions, not only the current upload.
  return serializeNetwork(() => deleteConversation(url, account));
}

async function deleteActiveConversations() {
  collectionGeneration++;
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  for (const url of Object.keys(conversationConsents)) {
    if (conversationConsents[url] === account) pendingDeletions[deletionKey(url, account)] = account;
  }
  conversationConsents = {};
  conversationCache = {};
  await chrome.storage.local.set({ conversationCache, conversationConsents, pendingDeletions });
  return serializeNetwork(async () => {
    if (PROMPTUTOR_PRIVACY.owner({ user }) !== account) return;
    for (const url of ownDeletionUrls()) await deleteConversation(url, account);
  });
}

async function deleteConversation(url, account = PROMPTUTOR_PRIVACY.owner({ user })) {
  if (PROMPTUTOR_PRIVACY.owner({ user }) !== account || !accessToken || pendingDeletions[deletionKey(url, account)] !== account) return { success: false, error: 'Deletion needs the original account' };
  try {
    const response = await backendFetch(`${CONFIG.apiEndpoint}/api/conversation`, {
      method: 'DELETE', body: JSON.stringify({ url })
    }, () => PROMPTUTOR_PRIVACY.owner({ user }) === account && pendingDeletions[deletionKey(url, account)] === account);
    if (!response.ok) return { success: false, error: `Deletion pending: HTTP ${response.status}` };
    if (PROMPTUTOR_PRIVACY.owner({ user }) === account) {
      delete pendingDeletions[deletionKey(url, account)];
      await chrome.storage.local.set({ pendingDeletions });
    }
    return { success: true };
  } catch { return { success: false, error: 'Deletion pending: network failure' }; }
}

async function syncAllCachedData() {
  await ready;
  if (syncPromise) return syncPromise;
  const generation = accountGeneration;
  syncPromise = serializeNetwork(async () => {
    if (generation !== accountGeneration) return { success: false, synced: 0, error: 'Account changed' };
    for (const url of ownDeletionUrls()) {
      const result = await deleteConversation(url);
      if (!result.success) return { ...result, synced: 0 };
    }
    return uploadCachedData();
  }).finally(() => { syncPromise = null; });
  return syncPromise;
}

async function uploadCachedData() {
  const generation = collectionGeneration;
  const account = PROMPTUTOR_PRIVACY.owner({ user });
  const batches = Object.entries(conversationCache).filter(([url, cache]) =>
    canCollect(url) && cache.owner === account && cache.messages?.length
  ).map(([url, cache]) => ({ url, cache, messages: cache.messages.slice() }));
  const messages = batches.flatMap(batch => batch.messages);
  if (!messages.length) return Promise.resolve({ success: true, synced: 0 });
  try {
    const response = await backendFetch(`${CONFIG.apiEndpoint}/api/message-logs/batch`, {
      method: 'POST', body: JSON.stringify({ messages })
    }, () => generation === collectionGeneration && PROMPTUTOR_PRIVACY.owner({ user }) === account && batches.every(batch =>
      canCollect(batch.url) && conversationCache[batch.url] === batch.cache));
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
  }
}

// ==================== GUIDANCE ====================

function handleDetect({ message, platform, url }) {
  const guard = collectionGuard(url);
  return serializeNetwork(async () => {
    try {
      const response = await backendFetch(`${CONFIG.apiEndpoint}/api/detect`, {
        method: 'POST',
        body: JSON.stringify({ message, platform, context: { url } }),
      }, guard);
      if (!response.ok || !guard()) return null;
      const result = await response.json();
      return guard() ? result : null;
    } catch (e) {
      console.error('[PrompTutor] Detect proxy error:', e);
      return null;
    }
  });
}

function handleLogGuidance(data) {
  const guard = collectionGuard(data.url);
  return serializeNetwork(async () => {
    try {
      const response = await backendFetch(`${CONFIG.apiEndpoint}/api/guidance-log`, {
        method: 'POST',
        body: JSON.stringify(data),
      }, guard);
      return guard() && response.ok;
    } catch (e) {
      console.error('[PrompTutor] Guidance log proxy error:', e);
    }
  });
}
