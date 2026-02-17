// Poe-specific adapter
// Real DOM tested: CSS Modules with hash suffixes
// Messages: [class*="ChatMessage_chatMessage"]
// User: has [class*="rightSide"] descendant
// Assistant: no rightSide descendant
// Content: [class*="messageTextContainer"]
// data-complete="true" when done streaming

console.log('[Chat Collector] Poe adapter loaded');

const SELECTORS = {
  messageContainer: '[class*="ChatMessage_chatMessage"]',
  userMessage: '[class*="rightSideMessageBubble"]',
  assistantMessage: null,  // determined by absence of rightSide
  messageContent: '[class*="messageTextContainer"]',
  conversationList: null
};

window.PoeAdapter = {
  SELECTORS,

  parseFromDOM() {
    const messages = [];
    document.querySelectorAll('[class*="ChatMessage_chatMessage"]').forEach(el => {
      const hasRightSide = el.querySelector('[class*="rightSide"]');
      const role = hasRightSide ? 'user' : 'assistant';
      const contentEl = el.querySelector('[class*="messageTextContainer"]');
      const content = (contentEl || el).textContent?.trim();
      if (content) {
        messages.push({
          role,
          content,
          complete: el.getAttribute('data-complete') === 'true'
        });
      }
    });
    return messages;
  }
};
