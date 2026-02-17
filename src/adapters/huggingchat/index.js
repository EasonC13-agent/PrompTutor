// HuggingChat-specific adapter

console.log('[Chat Collector] HuggingChat adapter loaded');

const SELECTORS = {
  messageContainer: '.message, [class*="message"], [data-testid="message"], .group',
  userMessage: '.message.user, [data-role="user"], [class*="user-message"]',
  assistantMessage: '.message.assistant, [data-role="assistant"], [class*="assistant-message"]',
  messageContent: '.prose, .markdown, [class*="message-content"]',
  conversationTitle: 'title'
};

window.HuggingChatAdapter = {
  SELECTORS,

  parseFromDOM() {
    const messages = [];
    document.querySelectorAll(SELECTORS.messageContainer).forEach(el => {
      const role = el.getAttribute('data-role') ||
                   (el.matches('.message.user, [class*="user-message"]') ? 'user' : 'assistant');
      const content = el.querySelector(SELECTORS.messageContent)?.textContent || '';
      if (content) {
        messages.push({ role, content });
      }
    });
    return messages;
  }
};
