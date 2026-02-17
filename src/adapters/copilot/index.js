// Copilot-specific adapter
// Handles platform-specific parsing and normalization

// Copilot API endpoints (for reference):
// POST /turing/conversation/ - Copilot conversation messages
// POST /sydney/ - Sydney backend
// POST /c/api/conversations - Copilot conversations API

console.log('[Chat Collector] Copilot adapter loaded');

// DOM selectors (for fallback mode)
const SELECTORS = {
  messageContainer: '[data-testid="message"], cib-message-group, [class*="ChatMessage"], [class*="turn"]',
  userMessage: 'cib-message-group[source="user"], [class*="user-message"], [data-author="user"]',
  assistantMessage: 'cib-message-group[source="bot"], [class*="bot-message"], [data-author="bot"]',
  messageContent: '.markdown, .prose, [class*="message-content"], [class*="ac-textBlock"]'
};

// Export for potential use by content script
window.CopilotAdapter = {
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
