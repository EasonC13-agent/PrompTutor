// DOM-based chat parser
// More reliable than API interception - parses what users actually see

(function() {
  'use strict';
  
  // Selectors with fallbacks (try in order)
  const SELECTORS = {
    chatgpt: {
      messageContainer: [
        '[data-message-author-role]',
      ],
      userMessage: [
        '[data-message-author-role="user"]',
      ],
      assistantMessage: [
        '[data-message-author-role="assistant"]',
      ],
      messageContent: [
        '.markdown',                                      // assistant responses
        '[data-testid="collapsible-user-message-content"]', // user messages (collapsible)
        '[data-message-content]',
      ],
      chatContainer: [
        'main',
      ]
    },
    claude: {
      messageContainer: [
        '[data-test-render-count]',
      ],
      userMessage: [
        '[data-user-message-bubble="true"]',
      ],
      assistantMessage: [
        '[data-is-streaming]',
        '.font-claude-response'
      ],
      messageContent: [
        '[data-testid="user-message"]',
        '.font-claude-response',
        'p'
      ],
      chatContainer: [
        '[data-autoscroll-container="true"]',
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
  let lastContentLength = 0;
  let isEnabled = false;
  let privacyState = {};
  let activeConversation = PROMPTUTOR_PRIVACY.conversationUrl(location.href);
  let previousRoots = [];
  let staleRoots = [];
  function refreshRoute() {
    const current = PROMPTUTOR_PRIVACY.conversationUrl(location.href);
    if (current === activeConversation) return;
    activeConversation = current;
    staleRoots = previousRoots;
    previousRoots = [];
    lastSnapshot = null;
    lastSnapshotHash = null;
    stopCollecting();
    isEnabled = PROMPTUTOR_PRIVACY.allowed(privacyState, location.href);
    if (isEnabled) startCollecting();
  }
  const seenMessages = new Set();
  const DEBOUNCE_MS = 300;
  
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
    clone.querySelectorAll('button, [aria-hidden="true"], script, style, [contenteditable="true"]').forEach(e => e.remove());
    clone.querySelectorAll('p, pre, li, h1, h2, h3, blockquote, br').forEach(e => e.appendChild(document.createTextNode('\n')));
    return clone.textContent?.trim() || '';
  }
  
  // Parse all messages from DOM
  function parseMessages() {
    const sel = SELECTORS[platform];
    if (!sel) return [];
    
    if (platform === 'chatgpt' || platform === 'claude') {
      const userSelector = platform === 'chatgpt' ? '[data-message-author-role="user"]' : '[data-user-message-bubble="true"], [data-testid="user-message"], .font-user-message';
      const assistantSelector = platform === 'chatgpt' ? '[data-message-author-role="assistant"]' : '[data-testid="assistant-message"], .font-claude-response';
      const roots = `${userSelector}, ${assistantSelector}`;
      const scope = document.querySelector('main, [role="main"]');
      if (!scope) return [];
      // Anonymous ChatGPT uses labeled list turns, not data-message-author-role.
      // Only direct children of the observed Conversation list are turn roots;
      // role labels plus assistant DIL content avoid treating arbitrary li as replies.
      if (platform === 'chatgpt' && !scope.querySelector(roots)) {
        return Array.from(scope.querySelectorAll('ol[aria-label="Conversation"] > li'))
          .filter(el => !el.closest('[contenteditable="true"], [aria-hidden="true"]'))
          .map(el => {
            const text = extractText(el);
            let role, content;
            if (text.startsWith('You said:')) {
              role = 'user';
              content = text.slice('You said:'.length).trim();
            } else if (text.startsWith('ChatGPT said:')) {
              role = 'assistant';
              content = extractText(el.querySelector('section[aria-label="DIL content"]'));
            } else return null;
            return content ? { role, content, hash: hashString(`${role}:${content}`), timestamp: Date.now() } : null;
          }).filter(Boolean);
      }
      return Array.from(scope.querySelectorAll(roots))
        .filter(el => !el.parentElement.closest(roots) && !el.closest('[contenteditable="true"], [aria-hidden="true"]'))
        .map(el => {
          const role = el.matches(userSelector) ? 'user' : 'assistant';
          const body = platform === 'chatgpt'
            ? el.querySelector('[data-message-content], .whitespace-pre-wrap, .markdown, .prose')
            : el.querySelector('.font-claude-response-body');
          const content = extractText(body || el);
          return { role, content, hash: hashString(`${role}:${content}`), timestamp: Date.now() };
        }).filter(m => m.content);
    }
    const messages = [];
    
    // Get all message containers
    const containers = $$(sel.messageContainer);
    
    for (const container of containers) {
      let role;
      let contentEl;
      
      // Platform-specific role detection
      if (platform === 'claude') {
        const userBubble = container.querySelector('[data-user-message-bubble="true"]');
        const assistantDiv = container.querySelector('[data-is-streaming]') || container.querySelector('.font-claude-response');
        if (userBubble) {
          role = 'user';
          contentEl = userBubble.querySelector('[data-testid="user-message"]') || userBubble;
        } else if (assistantDiv) {
          role = 'assistant';
          contentEl = assistantDiv.classList.contains('font-claude-response') ? assistantDiv : assistantDiv.querySelector('.font-claude-response') || assistantDiv;
        } else {
          continue;
        }
      } else if (platform === 'deepseek') {
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
    const snapshotHash = JSON.stringify(messages.map(m => [m.role, m.content]));
    
    return { snapshot, hash: snapshotHash };
  }
  
  // Check for changes and send to extension
  function checkForChanges() {
    refreshRoute();
    if (staleRoots.some(node => node.isConnected)) return;
    if (!PROMPTUTOR_PRIVACY.allowed(privacyState, location.href) || isStreaming()) return;
    const result = takeSnapshot();
    if (!result) return;
    
    const { snapshot, hash } = result;
    previousRoots = Array.from(document.querySelectorAll('[data-message-author-role], ol[aria-label="Conversation"] > li, [data-user-message-bubble], [data-testid="user-message"], [data-testid="assistant-message"], .font-claude-response'));
    
    // Skip if no change
    if (hash === lastSnapshotHash) return;
    
    // Send to extension
    sendToExtension({
      type: 'conversation_update',
      url: snapshot.url,
      platform: snapshot.platform,
      title: snapshot.title,
      messages: snapshot.messages,
      fullConversation: snapshot.messages,
      isIncremental: false
    }, () => {
      if (PROMPTUTOR_PRIVACY.conversationUrl(location.href) !== PROMPTUTOR_PRIVACY.conversationUrl(snapshot.url) || !PROMPTUTOR_PRIVACY.allowed(privacyState, location.href)) return;
      lastSnapshot = snapshot;
      lastSnapshotHash = hash;
    });
  }
  
  // Send data to extension directly (we're in isolated world, can use chrome API)
  function sendToExtension(payload, onAccepted) {
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
        }
      }, (response) => {
        // Check for error in callback
        if (chrome.runtime.lastError || !response?.accepted) return;
        onAccepted();
      });
    } catch (e) {
      // Silently ignore extension context errors
      if (!e.message?.includes('Extension context invalidated')) {
        console.error('[PrompTutor DOM] Failed to send:', e);
      }
    }
  }
  
  // Check if AI is currently streaming a response
  function isStreaming() {
    if (platform === 'claude') return !!document.querySelector('[data-is-streaming="true"]');
    // ChatGPT: data-stream-active="" during stream, data-stream-active="null" when done
    if (platform === 'chatgpt') return !!document.querySelector('[data-stream-active]:not([data-stream-active="null"]):not([data-stream-active="false"]), button[data-testid="stop-button"]');
    // Fallback: detect via content length change
    const len = document.body.innerText.length;
    if (len !== lastContentLength) { lastContentLength = len; return true; }
    return false;
  }

  // Returns true if this mutation signals streaming just ended
  function isStreamDoneSignal(m) {
    if (platform === 'claude' && m.attributeName === 'data-is-streaming') {
      return m.target.getAttribute('data-is-streaming') === 'false';
    }
    if (platform === 'chatgpt' && m.attributeName === 'data-stream-active') {
      return m.target.getAttribute('data-stream-active') === 'null';
    }
    return false;
  }

  function scheduleCheck() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (isStreaming()) {
        debounceTimer = setTimeout(scheduleCheck, 500);
      } else {
        checkForChanges();
      }
    }, DEBOUNCE_MS);
  }

  // Set up MutationObserver
  function setupObserver(attempt = 0) {
    const sel = SELECTORS[platform];
    if (!sel) return;

    const container = $(sel.chatContainer);
    if (!container) {
      if (attempt < 10) setTimeout(() => setupObserver(attempt + 1), 1000);
      return;
    }

    if (observer) observer.disconnect();

    // No characterData — typing in input fires it constantly and we don't need it.
    // Streaming end is detected via attribute changes instead.
    const observerOptions = { childList: true, subtree: true };
    if (platform === 'claude') {
      observerOptions.attributes = true;
      observerOptions.attributeFilter = ['data-is-streaming'];
    } else if (platform === 'chatgpt') {
      observerOptions.attributes = true;
      observerOptions.attributeFilter = ['data-stream-active'];
    }

    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (isStreamDoneSignal(m)) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(checkForChanges, 100);
          return;
        }
      }
      // Skip if all mutations are from our own overlay UI (including its initial insertion)
      const overlay = document.getElementById('promptutor-overlay');
      const fromOverlay = overlay && mutations.every(m => {
        if (overlay.contains(m.target) || m.target === overlay) return true;
        const allAdded = Array.from(m.addedNodes).every(n => n === overlay || overlay.contains(n));
        const allRemoved = Array.from(m.removedNodes).every(n => n === overlay || overlay.contains(n));
        return (m.addedNodes.length || m.removedNodes.length) && allAdded && allRemoved;
      });
      if (fromOverlay) return;
      scheduleCheck();
    });

    observer.observe(container, observerOptions);
    console.log('[PrompTutor DOM] Observer attached to', container.tagName, `(attempt ${attempt})`);
  }
  
  // Periodic scan as backup
  function startPeriodicScan() {
    if (scanInterval) clearInterval(scanInterval);
    
    scanInterval = setInterval(() => {
      checkForChanges();
    }, 10000); // Every 10 seconds (backup only)
  }
  
  function startCollecting() {
    seenMessages.clear();
    lastSnapshot = null;
    lastSnapshotHash = null;
    checkForChanges();
    setupObserver();
    startPeriodicScan();
  }

  function stopCollecting() {
    if (observer) { observer.disconnect(); observer = null; }
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    clearTimeout(debounceTimer);
  }

  // Initialize
  function init() {
    console.log('[PrompTutor DOM] Initializing for', platform);

    chrome.storage.local.get(['enabled', 'accessToken', 'user', 'conversationConsents'], (stored) => {
      privacyState = stored;
      isEnabled = PROMPTUTOR_PRIVACY.allowed(privacyState, location.href);
      if (isEnabled) setTimeout(startCollecting, 500);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area && area !== 'local') return;
      for (const key of ['enabled', 'accessToken', 'user', 'conversationConsents']) {
        if (changes[key]) privacyState[key] = changes[key].newValue;
      }
      const wasEnabled = isEnabled;
      isEnabled = PROMPTUTOR_PRIVACY.allowed(privacyState, location.href);
      if (isEnabled && !wasEnabled) startCollecting();
      if (!isEnabled) stopCollecting();
    });

    // Poll as a fallback; Navigation API is not available in every browser.
    globalThis.navigation?.addEventListener('navigatesuccess', refreshRoute);
    setInterval(refreshRoute, 500);
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  console.log('[PrompTutor DOM] Parser loaded for', platform);
})();
