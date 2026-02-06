// ChatGPT-specific adapter
// Handles platform-specific parsing and normalization

// ChatGPT API response structure (for reference):
// POST /backend-api/conversation
// Response: SSE stream with data chunks
// Final message contains full conversation

// TODO: Add DOM fallback parser for when API interception fails

console.log('[Chat Collector] ChatGPT adapter loaded');

// DOM selectors (for fallback mode)
const SELECTORS = {
  messageContainer: '[data-message-author-role]',
  userMessage: '[data-message-author-role="user"]',
  assistantMessage: '[data-message-author-role="assistant"]',
  messageContent: '.markdown',
  conversationTitle: 'nav a.hover\\:bg-token-sidebar-surface-secondary'
};

// Export for potential use by content script
window.ChatGPTAdapter = {
  SELECTORS,
  
  // Parse conversation from DOM (fallback)
  parseFromDOM() {
    const messages = [];
    document.querySelectorAll(SELECTORS.messageContainer).forEach(el => {
      const role = el.getAttribute('data-message-author-role');
      const content = el.querySelector(SELECTORS.messageContent)?.textContent || '';
      if (content) {
        messages.push({ role, content });
      }
    });
    return messages;
  }
};
