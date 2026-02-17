// Grok-specific adapter
// Handles platform-specific parsing and normalization

// Grok API endpoints (for reference):
// POST /api/rpc - Grok RPC calls
// POST /api/2/grok/ - Grok conversation API

console.log('[Chat Collector] Grok adapter loaded');

// DOM selectors (for fallback mode)
const SELECTORS = {
  messageContainer: '[data-testid="message"], [class*="message-row"], [class*="MessageRow"]',
  userMessage: '[data-testid="user-message"], [class*="user-message"], [class*="UserMessage"]',
  assistantMessage: '[data-testid="assistant-message"], [class*="assistant-message"], [class*="grok-message"]',
  messageContent: '.markdown, .prose, [class*="message-content"], [class*="MessageContent"]'
};

// Export for potential use by content script
window.GrokAdapter = {
  SELECTORS,
  
  // Parse conversation from DOM (fallback)
  parseFromDOM() {
    const messages = [];
    const containers = document.querySelectorAll(SELECTORS.messageContainer);
    
    containers.forEach(el => {
      const isUser = el.matches(SELECTORS.userMessage) || el.querySelector(SELECTORS.userMessage);
      const content = (el.querySelector(SELECTORS.messageContent) || el).textContent || '';
      
      if (content.trim()) {
        messages.push({
          role: isUser ? 'user' : 'assistant',
          content: content.trim()
        });
      }
    });
    
    return messages;
  }
};
