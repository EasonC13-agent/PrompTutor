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
        '[data-testid="user-message"]',
        '[data-testid="assistant-message"]',
        '.font-claude-message'
      ],
      userMessage: [
        '[data-testid="user-message"]',
        '.font-user-message'
      ],
      assistantMessage: [
        '[data-testid="assistant-message"]', 
        '.font-claude-message'
      ],
      messageContent: [
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
      messageContainer: [
        '[data-testid="message"]',
        '[class*="message-row"]',
        '[class*="MessageRow"]',
        '.message-bubble'
      ],
      userMessage: [
        '[data-testid="user-message"]',
        '[class*="user-message"]',
        '[class*="UserMessage"]'
      ],
      assistantMessage: [
        '[data-testid="assistant-message"]',
        '[class*="assistant-message"]',
        '[class*="AssistantMessage"]',
        '[class*="grok-message"]'
      ],
      messageContent: [
        '.markdown',
        '.prose',
        '[class*="message-content"]',
        '[class*="MessageContent"]',
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
      messageContainer: [
        '[data-testid="message"]',
        'cib-message-group',
        '[class*="message-group"]',
        '[class*="ChatMessage"]',
        '[class*="turn"]'
      ],
      userMessage: [
        '[data-testid="user-message"]',
        'cib-message-group[source="user"]',
        '[class*="user-message"]',
        '[class*="UserMessage"]',
        '[data-author="user"]'
      ],
      assistantMessage: [
        '[data-testid="assistant-message"]',
        'cib-message-group[source="bot"]',
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
        '#b_content',
        '[class*="chat-container"]',
        '[class*="conversation-container"]'
      ]
    },
    deepseek: {
      messageContainer: [
        '[class*="message-item"]',
        '[class*="chat-message"]',
        '[data-role]',
        '.ds-message'
      ],
      userMessage: [
        '[data-role="user"]',
        '[class*="user-message"]',
        '[class*="human-message"]'
      ],
      assistantMessage: [
        '[data-role="assistant"]',
        '[class*="assistant-message"]',
        '[class*="ai-message"]'
      ],
      messageContent: [
        '.markdown',
        '.ds-markdown',
        '[class*="message-content"]',
        '.prose',
        'p'
      ],
      chatContainer: [
        'main',
        '[class*="chat-container"]',
        '[class*="conversation"]',
        '#chat-container'
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
      messageContainer: [
        '.conversation-container',
        'message-content',
        '[class*="message-row"]',
        '[data-message-id]'
      ],
      userMessage: [
        '.user-query',
        '[class*="user-message"]',
        '[data-role="user"]',
        '.query-content'
      ],
      assistantMessage: [
        '.model-response-text',
        '.response-container',
        '[class*="model-response"]',
        '[data-role="model"]'
      ],
      messageContent: [
        '.markdown',
        '.model-response-text',
        '.message-content',
        '.prose',
        'p'
      ],
      chatContainer: [
        'main',
        '[class*="chat-container"]',
        '.conversation-container',
        '[class*="conversation"]'
      ]
    },
    perplexity: {
      messageContainer: [
        '[class*="message"]',
        '[class*="ConversationMessage"]',
        '[data-testid="message"]',
        '.pb-md'
      ],
      userMessage: [
        '[class*="user-message"]',
        '[class*="UserMessage"]',
        '[data-role="user"]'
      ],
      assistantMessage: [
        '[class*="assistant-message"]',
        '[class*="AssistantMessage"]',
        '[data-role="assistant"]'
      ],
      messageContent: [
        '.prose',
        '.markdown',
        '[class*="message-content"]',
        '[class*="answer-text"]',
        'p'
      ],
      chatContainer: [
        'main',
        '[role="main"]',
        '[class*="conversation"]',
        '[class*="chat-container"]'
      ]
    },
    poe: {
      messageContainer: [
        '[class*="Message_row"]',
        '[class*="message-row"]',
        '[class*="ChatMessage"]',
        '[data-message-id]'
      ],
      userMessage: [
        '[class*="Message_humanMessage"]',
        '[class*="human-message"]',
        '[data-role="user"]'
      ],
      assistantMessage: [
        '[class*="Message_botMessage"]',
        '[class*="bot-message"]',
        '[data-role="assistant"]'
      ],
      messageContent: [
        '.markdown',
        '.prose',
        '[class*="Message_markdown"]',
        '[class*="message-content"]',
        'p'
      ],
      chatContainer: [
        'main',
        '[class*="ChatMessages"]',
        '[class*="chat-container"]',
        '[class*="conversation"]'
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
      const role = container.getAttribute('data-message-author-role') ||
                   (container.matches(sel.userMessage?.join(',') || '') ? 'user' : 'assistant');
      
      // Find content element
      const contentEl = $(sel.messageContent, container);
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
    
    console.log('[Chat Collector DOM] Detected', newMessages.length, 'new messages');
    
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
      console.log('[Chat Collector DOM] Extension context invalid, skipping send');
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
        console.error('[Chat Collector DOM] Failed to send:', e);
      }
    }
  }
  
  // Set up MutationObserver
  function setupObserver() {
    const sel = SELECTORS[platform];
    if (!sel) return;
    
    const container = $(sel.chatContainer);
    if (!container) {
      console.log('[Chat Collector DOM] Chat container not found, retrying...');
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
    
    console.log('[Chat Collector DOM] Observer attached to', container.tagName);
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
    console.log('[Chat Collector DOM] Initializing for', platform);
    
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
        console.log('[Chat Collector DOM] URL changed, reinitializing');
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
  
  console.log('[Chat Collector DOM] Parser loaded for', platform);
})();
