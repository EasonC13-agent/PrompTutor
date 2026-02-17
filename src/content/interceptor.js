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
  
  const GROK_INCLUDE = [
    '/api/rpc',           // Grok RPC endpoints
    '/api/2/grok/'        // Grok conversation API
  ];
  
  const GROK_EXCLUDE = [
    '/api/2/grok/threads', // Thread list
    '/settings'
  ];
  
  const COPILOT_INCLUDE = [
    '/turing/conversation/',  // Copilot conversation
    '/sydney/',               // Sydney backend
    '/c/api/conversations'    // Copilot conversations API
  ];
  
  const COPILOT_EXCLUDE = [
    '/turing/conversation/create', // Create new conversation
    '/settings'
  ];
  
  const DEEPSEEK_INCLUDE = [
    '/api/v0/chat/',          // DeepSeek chat API
    '/api/v0/chat/completion' // Chat completion
  ];
  
  const DEEPSEEK_EXCLUDE = [
    '/api/v0/chat/list',      // Chat list
    '/settings'
  ];
  
  const DOUBAO_INCLUDE = [
    '/api/chat/',             // Doubao chat API
    '/samantha/chat/'         // Doubao Samantha backend
  ];
  
  const DOUBAO_EXCLUDE = [
    '/api/chat/list',
    '/settings'
  ];
  
  const GEMINI_INCLUDE = [
    '/_/BardChatUi/',         // Gemini/Bard RPC
    '/api/generate',          // Generate API
    '/conversation/'          // Conversation endpoint
  ];
  
  const GEMINI_EXCLUDE = [
    '/settings',
    '/share'
  ];
  
  const PERPLEXITY_INCLUDE = [
    '/api/query',             // Perplexity query API
    '/api/ask',               // Ask endpoint
    '/socket.io/'             // WebSocket transport
  ];
  
  const PERPLEXITY_EXCLUDE = [
    '/api/auth/',
    '/settings'
  ];
  
  const POE_INCLUDE = [
    '/api/gql_POST',          // Poe GraphQL
    '/api/receive_POST'       // Poe message receive
  ];
  
  const POE_EXCLUDE = [
    '/api/settings',
    '/settings'
  ];
  
  const HUGGINGCHAT_INCLUDE = [
    '/chat/conversation/',    // HuggingChat conversation
    '/api/conversation/'      // HuggingChat API
  ];
  
  const HUGGINGCHAT_EXCLUDE = [
    '/api/conversations',     // Conversation list
    '/settings'
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
    const isGrok = GROK_INCLUDE.some(p => url.includes(p)) && !GROK_EXCLUDE.some(p => url.includes(p));
    const isCopilot = COPILOT_INCLUDE.some(p => url.includes(p)) && !COPILOT_EXCLUDE.some(p => url.includes(p));
    const isDeepSeek = DEEPSEEK_INCLUDE.some(p => url.includes(p)) && !DEEPSEEK_EXCLUDE.some(p => url.includes(p));
    const isDoubao = DOUBAO_INCLUDE.some(p => url.includes(p)) && !DOUBAO_EXCLUDE.some(p => url.includes(p));
    const isGemini = GEMINI_INCLUDE.some(p => url.includes(p)) && !GEMINI_EXCLUDE.some(p => url.includes(p));
    const isPerplexity = PERPLEXITY_INCLUDE.some(p => url.includes(p)) && !PERPLEXITY_EXCLUDE.some(p => url.includes(p));
    const isPoe = POE_INCLUDE.some(p => url.includes(p)) && !POE_EXCLUDE.some(p => url.includes(p));
    const isHuggingChat = HUGGINGCHAT_INCLUDE.some(p => url.includes(p)) && !HUGGINGCHAT_EXCLUDE.some(p => url.includes(p));
    const isRelevant = isChatGPT || isClaude || isGrok || isCopilot || isDeepSeek || isDoubao || isGemini || isPerplexity || isPoe || isHuggingChat;
    
    if (isRelevant) {
      console.log('[PrompTutor] Intercepted:', url);
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
          }).catch(e => console.debug('[PrompTutor] JSON parse error:', e));
        }
      } catch (e) {
        console.debug('[PrompTutor] Intercept error:', e);
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
      console.debug('[PrompTutor] Stream read error:', e);
    }
  }
  
  function detectPlatform(url) {
    if (url.includes('openai.com') || url.includes('chatgpt.com')) return 'chatgpt';
    if (url.includes('claude.ai')) return 'claude';
    if (url.includes('grok.com') || url.includes('x.com/i/grok')) return 'grok';
    if (url.includes('copilot.microsoft.com') || url.includes('bing.com/chat') || url.includes('bing.com/turing')) return 'copilot';
    if (url.includes('chat.deepseek.com')) return 'deepseek';
    if (url.includes('doubao.com')) return 'doubao';
    if (url.includes('gemini.google.com')) return 'gemini';
    if (url.includes('perplexity.ai')) return 'perplexity';
    if (url.includes('poe.com')) return 'poe';
    if (url.includes('huggingface.co/chat')) return 'huggingchat';
    return 'unknown';
  }
  
  function sendToExtension(payload) {
    console.log('[PrompTutor] Sending to extension:', payload.url);
    window.postMessage({ type: 'PROMPTUTOR_DATA', payload }, '*');
  }
  
  console.log('[PrompTutor] API interceptor active (MAIN world)');
})();
