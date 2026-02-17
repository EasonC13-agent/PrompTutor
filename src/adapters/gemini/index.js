// Google Gemini-specific adapter

console.log('[Chat Collector] Gemini adapter loaded');

const SELECTORS = {
  messageContainer: '.conversation-container, message-content, [class*="message-row"], [data-message-id]',
  userMessage: '.user-query, [class*="user-message"], [data-role="user"], .query-content',
  assistantMessage: '.model-response-text, .response-container, [class*="model-response"], [data-role="model"]',
  messageContent: '.markdown, .model-response-text, .message-content, .prose',
  conversationTitle: 'title'
};

window.GeminiAdapter = {
  SELECTORS,

  parseFromDOM() {
    const messages = [];
    document.querySelectorAll(SELECTORS.messageContainer).forEach(el => {
      const role = el.getAttribute('data-role') === 'model' ? 'assistant' :
                   el.getAttribute('data-role') === 'user' ? 'user' :
                   (el.matches('.user-query, .query-content') ? 'user' : 'assistant');
      const content = el.querySelector(SELECTORS.messageContent)?.textContent || '';
      if (content) {
        messages.push({ role, content });
      }
    });
    return messages;
  }
};
