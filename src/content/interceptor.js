// Runs in MAIN world to intercept fetch
// This bypasses CSP by being loaded as a content script with world: "MAIN"

(function() {
  'use strict';
  
  // Only capture actual conversation messages, not system requests
  const CHATGPT_INCLUDE = [
    '/backend-api/conversation/'  // Conversation messages (includes conversation ID)
  ];
  
  const CHATGPT_EXCLUDE = [
    '/sentinel/',         // System security checks
    '/conversations',     // Conversation list
    '/init',              // Init requests
    '/stream_status',     // Status checks
    '/textdocs',          // Text documents
    '/gen_title',         // Title generation
    '/tags',              // Tags
    '/share'              // Share links
  ];
  
  const CLAUDE_INCLUDE = [
    '/api/chat_conversations/'  // Claude conversations
  ];
  
  const CLAUDE_EXCLUDE = [
    '/organizations/',    // Org info
    '/settings'           // Settings
  ];
  
  // Store original fetch BEFORE anything else runs
  const originalFetch = window.fetch;
  
  // Intercept fetch
  window.fetch = async function(...args) {
    const [resource, config] = args;
    const url = typeof resource === 'string' ? resource : resource.url;
    
    const response = await originalFetch.apply(this, args);
    
    // Check if this is a chat API call we care about
    const isChatGPT = CHATGPT_INCLUDE.some(p => url.includes(p)) && !CHATGPT_EXCLUDE.some(p => url.includes(p));
    const isClaude = CLAUDE_INCLUDE.some(p => url.includes(p)) && !CLAUDE_EXCLUDE.some(p => url.includes(p));
    const isRelevant = isChatGPT || isClaude;
    
    if (isRelevant) {
      console.log('[Chat Collector] Intercepted:', url);
      try {
        const clone = response.clone();
        const contentType = clone.headers.get('content-type') || '';
        
        if (contentType.includes('text/event-stream')) {
          handleStreamingResponse(clone, url, config);
        } else if (contentType.includes('application/json')) {
          clone.json().then(data => {
            sendToExtension({
              url,
              method: config?.method || 'GET',
              timestamp: Date.now(),
              data,
              platform: detectPlatform(url)
            });
          }).catch(e => console.debug('[Chat Collector] JSON parse error:', e));
        }
      } catch (e) {
        console.debug('[Chat Collector] Intercept error:', e);
      }
    }
    
    return response;
  };
  
  async function handleStreamingResponse(response, url, config) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const chunks = [];
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              chunks.push(JSON.parse(data));
            } catch (e) {}
          }
        }
      }
      
      if (chunks.length > 0) {
        sendToExtension({
          url,
          method: config?.method || 'POST',
          timestamp: Date.now(),
          data: { streaming: true, chunks },
          platform: detectPlatform(url)
        });
      }
    } catch (e) {
      console.debug('[Chat Collector] Stream read error:', e);
    }
  }
  
  function detectPlatform(url) {
    if (url.includes('openai.com') || url.includes('chatgpt.com')) return 'chatgpt';
    if (url.includes('claude.ai')) return 'claude';
    return 'unknown';
  }
  
  function sendToExtension(payload) {
    console.log('[Chat Collector] Sending to extension:', payload.url);
    window.postMessage({ type: 'CHAT_COLLECTOR_DATA', payload }, '*');
  }
  
  console.log('[Chat Collector] API interceptor active (MAIN world)');
})();
