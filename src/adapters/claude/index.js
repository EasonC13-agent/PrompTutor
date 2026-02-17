// Claude-specific adapter
// Handles platform-specific parsing and normalization

// Claude API endpoints (for reference):
// GET /api/organizations/{org}/chat_conversations/{id}
// POST /api/organizations/{org}/chat_conversations/{id}/completion

console.log('[Chat Collector] Claude adapter loaded');

// DOM selectors (for fallback mode)
const SELECTORS = {
  messageContainer: '[data-test-render-count]',
  humanMessage: '.font-user-message',
  assistantMessage: '.font-claude-response',
  assistantContent: '.font-claude-response-body',
  conversationList: '[data-testid="conversation-list"]'
};

// Export for potential use by content script
window.ClaudeAdapter = {
  SELECTORS,
  
  // Parse conversation from DOM (fallback)
  parseFromDOM() {
    const messages = [];
    const containers = document.querySelectorAll(SELECTORS.messageContainer);
    
    containers.forEach(el => {
      const isHuman = el.querySelector(SELECTORS.humanMessage);
      const isAssistant = el.querySelector(SELECTORS.assistantMessage);
      
      if (isHuman) {
        messages.push({ 
          role: 'user', 
          content: isHuman.textContent || '' 
        });
      } else if (isAssistant) {
        const contentEl = el.querySelector(SELECTORS.assistantContent) || isAssistant;
        messages.push({ 
          role: 'assistant', 
          content: contentEl.textContent || '' 
        });
      }
    });
    
    return messages;
  }
};
