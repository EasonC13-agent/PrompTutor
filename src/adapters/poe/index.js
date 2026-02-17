// Poe-specific adapter

console.log('[Chat Collector] Poe adapter loaded');

const SELECTORS = {
  messageContainer: '[class*="Message_row"], [class*="message-row"], [class*="ChatMessage"], [data-message-id]',
  userMessage: '[class*="Message_humanMessage"], [class*="human-message"], [data-role="user"]',
  assistantMessage: '[class*="Message_botMessage"], [class*="bot-message"], [data-role="assistant"]',
  messageContent: '.markdown, .prose, [class*="Message_markdown"], [class*="message-content"]',
  conversationTitle: 'title'
};

window.PoeAdapter = {
  SELECTORS,

  parseFromDOM() {
    const messages = [];
    document.querySelectorAll(SELECTORS.messageContainer).forEach(el => {
      const role = el.getAttribute('data-role') ||
                   (el.matches('[class*="Message_humanMessage"], [class*="human-message"]') ? 'user' : 'assistant');
      const content = el.querySelector(SELECTORS.messageContent)?.textContent || '';
      if (content) {
        messages.push({ role, content });
      }
    });
    return messages;
  }
};
