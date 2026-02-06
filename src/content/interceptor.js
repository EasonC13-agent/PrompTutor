// Runs in page context to intercept fetch/XHR
// This script is injected by inject.js

const CHATGPT_PATTERNS = [
  '/backend-api/conversation',
  '/backend-api/sentinel/chat-requirements'
];

const CLAUDE_PATTERNS = [
  '/api/organizations/',
  '/api/chat_conversations/'
];

// Store original fetch
const originalFetch = window.fetch;

// Intercept fetch
window.fetch = async function(...args) {
  const [resource, config] = args;
  const url = typeof resource === 'string' ? resource : resource.url;
  
  const response = await originalFetch.apply(this, args);
  
  // Check if this is a chat API call we care about
  const isRelevant = [...CHATGPT_PATTERNS, ...CLAUDE_PATTERNS].some(p => url.includes(p));
  
  if (isRelevant) {
    try {
      // Clone response so we can read it without consuming
      const clone = response.clone();
      const contentType = clone.headers.get('content-type') || '';
      
      if (contentType.includes('text/event-stream')) {
        // Handle SSE streaming responses
        handleStreamingResponse(clone, url);
      } else if (contentType.includes('application/json')) {
        // Handle regular JSON responses
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

// Handle SSE streaming responses (used by ChatGPT)
async function handleStreamingResponse(response, url) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const chunks = [];
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            chunks.push(JSON.parse(data));
          } catch (e) {
            // Not valid JSON, skip
          }
        }
      }
    }
    
    // Send collected chunks
    if (chunks.length > 0) {
      sendToExtension({
        url,
        method: 'POST',
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
  window.postMessage({
    type: 'CHAT_COLLECTOR_DATA',
    payload
  }, '*');
}

console.log('[Chat Collector] API interceptor active');
