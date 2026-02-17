// DOM-based chat parser
// More reliable than API interception - parses what users actually see

(function() {
  'use strict';
  
  // Selectors with fallbacks (try in order)
  const SELECTORS = {
    chatgpt: {
      // Message containers
      messageContainer: [
        '[data-message-author-role]',
        '[data-testid^="conversation-turn"]',
        '.group\\/conversation-turn'
      ],
      // User messages
      userMessage: [
        '[data-message-author-role="user"]',
        '[data-testid="conversation-turn-user"]'
      ],
      // Assistant messages  
      assistantMessage: [
        '[data-message-author-role="assistant"]',
        '[data-testid="conversation-turn-assistant"]'
      ],
      // Message content
      messageContent: [
        '.markdown',
        '.prose',
        '[data-message-content]'
      ],
      // Chat container (for MutationObserver)
      chatContainer: [
        'main',
        '[role="main"]',
        '.flex-1.overflow-hidden'
      ]
    },
    claude: {
      messageContainer: [
        '[data-test-render-count]',
        '[data-testid="user-message"]',
        '[data-testid="assistant-message"]',
        '.font-claude-response'
      ],
      userMessage: [
        '[data-testid="user-message"]',
        '.font-user-message'
      ],
      assistantMessage: [
        '[data-testid="assistant-message"]', 
        '.font-claude-response'
      ],
      messageContent: [
        '.font-claude-response-body',
        '.font-user-message',
        '.prose',
        '.markdown',
        'p'
      ],
      chatContainer: [
        'main',
        '[role="main"]'
      ]
    },
    grok: {
      // Grok uses .message-bubble for messages
      // User vs assistant distinguished by parent: items-end (user) vs items-start (assistant)
      messageContainer: [
        '.message-bubble',
        '[class*="message-row"]',
        '[class*="MessageRow"]'
      ],
      userMessage: [
        '[class*="items-end"] .message-bubble',
        '[class*="items-end"] > .message-bubble',
        '[class*="user-message"]'
      ],
      assistantMessage: [
        '[class*="items-start"] .message-bubble',
        '[class*="items-start"] > .message-bubble',
        '[class*="assistant-message"]'
      ],
      messageContent: [
        '.response-content-markdown',
        '.markdown',
        '.prose',
        '[class*="message-content"]',
        'p'
      ],
      chatContainer: [
        'main',
        '[role="main"]',
        '[class*="conversation"]',
        '[class*="chat-container"]'
      ]
    },
    copilot: {
      // Copilot new UI uses data-testid based components, no more cib-* shadow DOM
      messageContainer: [
        '[data-testid="message"]',
        '[class*="ChatMessage"]',
        '[class*="turn"]',
        '[class*="message-group"]'
      ],
      userMessage: [
        '[data-testid="user-message"]',
        '[class*="user-message"]',
        '[class*="UserMessage"]',
        '[data-author="user"]'
      ],
      assistantMessage: [
        '[data-testid="assistant-message"]',
        '[class*="bot-message"]',
        '[class*="AssistantMessage"]',
        '[data-author="bot"]'
      ],
      messageContent: [
        '.markdown',
        '.prose',
        '[class*="message-content"]',
        '[class*="ac-textBlock"]',
        'p'
      ],
      chatContainer: [
        'main',
        '[role="main"]',
        '[class*="chat-container"]',
        '[class*="conversation-container"]'
      ]
    },
    deepseek: {
      // Real DOM: .ds-message for all messages
      // Assistant messages have .ds-markdown child, user messages do NOT
      // Role differentiation done in parseMessages() by checking for .ds-markdown child
      messageContainer: [
        '.ds-message',
        '[data-role]',
        '[class*="message-item"]'
      ],
      userMessage: [
        '.ds-message:not(:has(.ds-markdown))',  // :has() may not work in all browsers
        '[data-role="user"]'
      ],
      assistantMessage: [
        '.ds-message:has(.ds-markdown)',  // :has() may not work in all browsers
        '[data-role="assistant"]'
      ],
      messageContent: [
        '.ds-markdown',
        '.markdown',
        '[class*="message-content"]',
        'p'
      ],
      chatContainer: [
        'main',
        '[role="main"]'
      ]
    },
    doubao: {
      messageContainer: [
        '[class*="message-item"]',
        '[class*="chat-message"]',
        '[class*="MessageItem"]',
        '[data-role]'
      ],
      userMessage: [
        '[data-role="user"]',
        '[class*="user-message"]',
        '[class*="UserMessage"]'
      ],
      assistantMessage: [
        '[data-role="assistant"]',
        '[class*="bot-message"]',
        '[class*="AssistantMessage"]'
      ],
      messageContent: [
        '.markdown',
        '[class*="message-content"]',
        '[class*="MessageContent"]',
        '.prose',
        'p'
      ],
      chatContainer: [
        'main',
        '[role="main"]',
        '[class*="chat-container"]',
        '[class*="conversation"]'
      ]
    },
    gemini: {
      // Gemini uses .message-container, user-query-container, model-response-text
      messageContainer: [
        '.message-container',
        '.conversation-container',
        '[data-message-id]',
        '[class*="message-row"]'
      ],
      userMessage: [
        '.user-query-container',
        '.user-query',
        '.query-content',
        '[data-role="user"]'
      ],
      assistantMessage: [
        '.response-container',
        '.model-response-text',
        '[class*="model-response"]',
        '[data-role="model"]'
      ],
      messageContent: [
        '.query-text',
        '.model-response-text',
        '.response-content',
        '.markdown',
        '.prose',
        'p'
      ],
      chatContainer: [
        'main',
        '.conversation-container',
        '[class*="chat-container"]',
        '[class*="conversation"]'
      ]
    },
    perplexity: {
      // Real DOM: user queries are h1 elements with Tailwind class containing "group/query"
      // Assistant answers are .prose elements
      // Container elements have class containing "threadContentWidth"
      messageContainer: [
        '[class*="threadContentWidth"]',
        '[class*="ConversationMessage"]',
        '[data-testid="message"]'
      ],
      userMessage: [
        'h1[class*="query"]',
        '[class*="user-message"]',
        '[data-role="user"]'
      ],
      assistantMessage: [
        '.prose',
        '[class*="assistant-message"]',
        '[data-role="assistant"]'
      ],
      messageContent: [
        '.prose',
        'p'
      ],
      chatContainer: [
        'main',
        '[role="main"]'
      ]
    },
    poe: {
      // Real DOM: CSS Modules with hash suffixes
      // Messages: [class*="ChatMessage_chatMessage"]
      // User messages have [class*="rightSide"] descendant
      // Content in [class*="messageTextContainer"]
      // data-complete="true" when done streaming
      messageContainer: [
        '[class*="ChatMessage_chatMessage"]',
        '[class*="Message_row"]',
        '[data-message-id]'
      ],
      userMessage: [
        '[class*="rightSideMessageBubble"]',
        '[class*="Message_humanMessage"]',
        '[data-role="user"]'
      ],
      assistantMessage: [
        '[class*="Message_botMessage"]',
        '[data-role="assistant"]'
      ],
      messageContent: [
        '[class*="messageTextContainer"]',
        '[class*="Message_row"]',
        '.markdown',
        '.prose',
        'p'
      ],
      chatContainer: [
        '[class*="ChatMessagesView"]',
        '[class*="ChatMessages"]',
        'main'
      ]
    },
    huggingchat: {
      messageContainer: [
        '.message',
        '[class*="message"]',
        '[data-testid="message"]',
        '.group'
      ],
      userMessage: [
        '.message.user',
        '[data-role="user"]',
        '[class*="user-message"]'
      ],
      assistantMessage: [
        '.message.assistant',
        '[data-role="assistant"]',
        '[class*="assistant-message"]'
      ],
      messageContent: [
        '.prose',
        '.markdown',
        '[class*="message-content"]',
        'p'
      ],
      chatContainer: [
        'main',
        '[class*="chat-container"]',
        '[class*="conversation"]',
        '.flex-col'
      ]
    }
  };
  
  // State
  let platform = detectPlatform();
  let lastSnapshot = null;
  let lastSnapshotHash = null;
  let observer = null;
  let scanInterval = null;
  let debounceTimer = null;
  let lastContentLength = 0; // Track content length to detect streaming
  const seenMessages = new Set(); // Track seen message hashes
  const DEBOUNCE_MS = 2000; // Wait 2 seconds after last change (for streaming)
  
  // Detect platform
  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com') || host.includes('openai.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('grok.com') || (host.includes('x.com') && window.location.pathname.startsWith('/i/grok'))) return 'grok';
    if (host.includes('copilot.microsoft.com') || (host.includes('bing.com') && window.location.pathname.startsWith('/chat'))) return 'copilot';
    if (host.includes('chat.deepseek.com')) return 'deepseek';
    if (host.includes('doubao.com')) return 'doubao';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('perplexity.ai')) return 'perplexity';
    if (host.includes('poe.com')) return 'poe';
    if (host.includes('huggingface.co') && window.location.pathname.startsWith('/chat')) return 'huggingchat';
    return 'unknown';
  }
  
  // Find element using fallback selectors
  function $(selectors, parent = document) {
    if (typeof selectors === 'string') selectors = [selectors];
    for (const sel of selectors) {
      try {
        const el = parent.querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }
  
  function $$(selectors, parent = document) {
    if (typeof selectors === 'string') selectors = [selectors];
    for (const sel of selectors) {
      try {
        const els = parent.querySelectorAll(sel);
        if (els.length > 0) return Array.from(els);
      } catch (e) {}
    }
    return [];
  }
  
  // Hash string for deduplication
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
  
  // Extract text content from element
  function extractText(el) {
    if (!el) return '';
    // Clone to avoid modifying original
    const clone = el.cloneNode(true);
    // Remove code block copy buttons, etc
    clone.querySelectorAll('button, [aria-hidden="true"]').forEach(e => e.remove());
    return clone.textContent?.trim() || '';
  }
  
  // Parse all messages from DOM
  function parseMessages() {
    const sel = SELECTORS[platform];
    if (!sel) return [];
    
    const messages = [];
    
    // Get all message containers
    const containers = $$(sel.messageContainer);
    
    for (const container of containers) {
      let role;
      let contentEl;
      
      // Platform-specific role detection
      if (platform === 'deepseek') {
        // DeepSeek: assistant messages have .ds-markdown child, user messages don't
        const hasMarkdown = container.querySelector('.ds-markdown');
        role = hasMarkdown ? 'assistant' : 'user';
        contentEl = hasMarkdown || container;
      } else if (platform === 'perplexity') {
        // Perplexity: user queries are h1 elements, assistant answers are .prose
        const isQuery = container.querySelector('h1[class*="query"]');
        const isProse = container.querySelector('.prose');
        if (isQuery) { role = 'user'; contentEl = isQuery; }
        else if (isProse) { role = 'assistant'; contentEl = isProse; }
        else continue;
      } else if (platform === 'poe') {
        // Poe: user messages have [class*="rightSide"] descendant
        const hasRightSide = container.querySelector('[class*="rightSide"]');
        role = hasRightSide ? 'user' : 'assistant';
        contentEl = container.querySelector('[class*="messageTextContainer"]') || container;
      } else {
        // Default role detection
        role = container.getAttribute('data-message-author-role') ||
               (container.matches(sel.userMessage?.join(',') || '') ? 'user' : 'assistant');
        contentEl = $(sel.messageContent, container);
      }
      
      const content = extractText(contentEl || container);
      
      if (content) {
        const hash = hashString(content);
        messages.push({
          role,
          content,
          hash,
          timestamp: Date.now()
        });
      }
    }
    
    return messages;
  }
  
  // Take snapshot of current conversation
  function takeSnapshot() {
    const messages = parseMessages();
    
    if (messages.length === 0) return null;
    
    // Create conversation snapshot
    const snapshot = {
      url: window.location.href,
      platform,
      timestamp: Date.now(),
      messages,
      title: document.title
    };
    
    // Hash for comparison
    const snapshotHash = hashString(JSON.stringify(messages.map(m => m.content)));
    
    return { snapshot, hash: snapshotHash };
  }
  
  // Check for changes and send to extension
  function checkForChanges() {
    const result = takeSnapshot();
    if (!result) return;
    
    const { snapshot, hash } = result;
    
    // Skip if no change
    if (hash === lastSnapshotHash) return;
    
    // Find new messages
    const newMessages = snapshot.messages.filter(m => !seenMessages.has(m.hash));
    
    if (newMessages.length === 0 && lastSnapshot) return;
    
    // Mark as seen
    newMessages.forEach(m => seenMessages.add(m.hash));
    
    console.log('[PrompTutor DOM] Detected', newMessages.length, 'new messages');
    
    // Send to extension
    sendToExtension({
      type: 'conversation_update',
      url: snapshot.url,
      platform: snapshot.platform,
      title: snapshot.title,
      messages: newMessages.length > 0 ? newMessages : snapshot.messages,
      fullConversation: snapshot.messages,
      isIncremental: lastSnapshot !== null && newMessages.length > 0
    });
    
    lastSnapshot = snapshot;
    lastSnapshotHash = hash;
  }
  
  // Send data to extension directly (we're in isolated world, can use chrome API)
  function sendToExtension(payload) {
    // Check if extension context is still valid
    if (!chrome?.runtime?.id) {
      console.log('[PrompTutor DOM] Extension context invalid, skipping send');
      return;
    }
    
    try {
      chrome.runtime.sendMessage({
        type: 'CHAT_DATA',
        payload: {
          ...payload,
          timestamp: Date.now(),
          platform: payload.platform,
          url: payload.url,
          data: payload
        }
      }, (response) => {
        // Check for error in callback
        if (chrome.runtime.lastError) {
          // Silently ignore - extension was reloaded
          return;
        }
      });
    } catch (e) {
      // Silently ignore extension context errors
      if (!e.message?.includes('Extension context invalidated')) {
        console.error('[PrompTutor DOM] Failed to send:', e);
      }
    }
  }
  
  // Set up MutationObserver
  function setupObserver() {
    const sel = SELECTORS[platform];
    if (!sel) return;
    
    const container = $(sel.chatContainer);
    if (!container) {
      console.log('[PrompTutor DOM] Chat container not found, retrying...');
      setTimeout(setupObserver, 1000);
      return;
    }
    
    // Disconnect existing observer
    if (observer) observer.disconnect();
    
    observer = new MutationObserver((mutations) => {
      // Debounce - wait for streaming to complete
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Check if content is still changing (streaming)
        const currentLength = document.body.innerText.length;
        if (currentLength !== lastContentLength) {
          lastContentLength = currentLength;
          // Content still changing, wait more
          debounceTimer = setTimeout(() => checkForChanges(), DEBOUNCE_MS);
        } else {
          // Content stable, process
          checkForChanges();
        }
      }, DEBOUNCE_MS);
    });
    
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
    
    console.log('[PrompTutor DOM] Observer attached to', container.tagName);
  }
  
  // Periodic scan as backup
  function startPeriodicScan() {
    if (scanInterval) clearInterval(scanInterval);
    
    scanInterval = setInterval(() => {
      checkForChanges();
    }, 10000); // Every 10 seconds (backup only)
  }
  
  // Initialize
  function init() {
    console.log('[PrompTutor DOM] Initializing for', platform);
    
    // Initial scan
    setTimeout(() => {
      checkForChanges();
      setupObserver();
      startPeriodicScan();
    }, 2000); // Wait for page to load
    
    // Re-init on navigation (SPA)
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        console.log('[PrompTutor DOM] URL changed, reinitializing');
        lastUrl = window.location.href;
        seenMessages.clear();
        lastSnapshot = null;
        lastSnapshotHash = null;
        setTimeout(() => {
          checkForChanges();
          setupObserver();
        }, 1000);
      }
    }, 1000);
  }
  
  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  console.log('[PrompTutor DOM] Parser loaded for', platform);
})();
