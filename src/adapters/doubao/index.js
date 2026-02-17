// Doubao (豆包)-specific adapter

console.log('[PrompTutor] Doubao adapter loaded');

const SELECTORS = {
  messageContainer: '[class*="message-item"], [class*="chat-message"], [class*="MessageItem"], [data-role]',
  userMessage: '[data-role="user"], [class*="user-message"], [class*="UserMessage"]',
  assistantMessage: '[data-role="assistant"], [class*="bot-message"], [class*="AssistantMessage"]',
  messageContent: '.markdown, [class*="message-content"], [class*="MessageContent"], .prose',
  conversationTitle: 'title'
};

window.DoubaoAdapter = {
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
