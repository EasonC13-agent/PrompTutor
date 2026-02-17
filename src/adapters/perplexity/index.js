// Perplexity-specific adapter

console.log('[Chat Collector] Perplexity adapter loaded');

const SELECTORS = {
  messageContainer: '[class*="message"], [class*="ConversationMessage"], [data-testid="message"], .pb-md',
  userMessage: '[class*="user-message"], [class*="UserMessage"], [data-role="user"]',
  assistantMessage: '[class*="assistant-message"], [class*="AssistantMessage"], [data-role="assistant"]',
  messageContent: '.prose, .markdown, [class*="message-content"], [class*="answer-text"]',
  conversationTitle: 'title'
};

window.PerplexityAdapter = {
  SELECTORS,

  parseFromDOM() {
    const messages = [];
    document.querySelectorAll(SELECTORS.messageContainer).forEach(el => {
      const role = el.getAttribute('data-role') ||
                   (el.matches('[class*="user-message"], [class*="UserMessage"]') ? 'user' : 'assistant');
      const content = el.querySelector(SELECTORS.messageContent)?.textContent || '';
      if (content) {
        messages.push({ role, content });
      }
    });
    return messages;
  }
};
