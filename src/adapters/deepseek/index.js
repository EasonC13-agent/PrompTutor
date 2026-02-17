// DeepSeek-specific adapter

console.log('[Chat Collector] DeepSeek adapter loaded');

const SELECTORS = {
  messageContainer: '[class*="message-item"], [class*="chat-message"], [data-role], .ds-message',
  userMessage: '[data-role="user"], [class*="user-message"]',
  assistantMessage: '[data-role="assistant"], [class*="assistant-message"]',
  messageContent: '.markdown, .ds-markdown, [class*="message-content"], .prose',
  conversationTitle: 'title'
};

window.DeepSeekAdapter = {
  SELECTORS,

  parseFromDOM() {
    const messages = [];
    document.querySelectorAll(SELECTORS.messageContainer).forEach(el => {
      const role = el.getAttribute('data-role') ||
                   (el.matches('[class*="user-message"]') ? 'user' : 'assistant');
      const content = el.querySelector(SELECTORS.messageContent)?.textContent || '';
      if (content) {
        messages.push({ role, content });
      }
    });
    return messages;
  }
};
