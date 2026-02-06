// Inject interceptor script into page context
// Content scripts run in isolated world, but we need access to page's fetch/XHR

const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content/interceptor.js');
script.type = 'module';
(document.head || document.documentElement).appendChild(script);

// Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'CHAT_COLLECTOR_DATA') {
    // Forward to background worker
    chrome.runtime.sendMessage({
      type: 'CHAT_DATA',
      payload: event.data.payload
    });
  }
});

console.log('[Chat Collector] Content script loaded');
