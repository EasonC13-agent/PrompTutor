// Bridge between MAIN world and extension
// Runs in isolated world, forwards messages to background

// Track current URL
let lastUrl = window.location.href;

// Notify background that conversation is opened
try {
  chrome.runtime.sendMessage({
    type: 'CONVERSATION_OPENED',
    url: lastUrl
  });
} catch (e) {}

// Listen for URL changes (SPA navigation)
const checkUrlChange = () => {
  if (window.location.href !== lastUrl) {
    const oldUrl = lastUrl;
    lastUrl = window.location.href;
    
    try {
      chrome.runtime.sendMessage({ type: 'CONVERSATION_CLOSED', url: oldUrl });
      chrome.runtime.sendMessage({ type: 'CONVERSATION_OPENED', url: lastUrl });
    } catch (e) {}
    
    console.log('[Chat Collector] URL changed:', oldUrl, '->', lastUrl);
  }
};

window.addEventListener('popstate', checkUrlChange);

const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function(...args) {
  originalPushState.apply(this, args);
  checkUrlChange();
};

history.replaceState = function(...args) {
  originalReplaceState.apply(this, args);
  checkUrlChange();
};

setInterval(checkUrlChange, 1000);

window.addEventListener('beforeunload', () => {
  try {
    chrome.runtime.sendMessage({ type: 'CONVERSATION_CLOSED', url: window.location.href });
  } catch (e) {}
});

// Listen for messages from MAIN world (interceptor)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'CHAT_COLLECTOR_DATA') {
    console.log('[Chat Collector] Forwarding to background:', event.data.payload.url);
    try {
      chrome.runtime.sendMessage({
        type: 'CHAT_DATA',
        payload: event.data.payload
      });
    } catch (e) {}
  }
});

console.log('[Chat Collector] Bridge loaded (isolated world)');
