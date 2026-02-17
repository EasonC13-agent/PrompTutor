// DeepSeek-specific adapter
// Real DOM tested: .ds-message for all messages
// Assistant messages have .ds-markdown child, user messages do NOT

console.log('[PrompTutor] DeepSeek adapter loaded');

const SELECTORS = {
  messageContainer: '.ds-message',
  assistantMessage: '.ds-markdown',  // child of .ds-message for assistant
  conversationList: null
};

window.DeepSeekAdapter = {
  SELECTORS,

  parseFromDOM() {
    const messages = [];
    document.querySelectorAll('.ds-message').forEach(el => {
      const hasMarkdown = el.querySelector('.ds-markdown');
      const role = hasMarkdown ? 'assistant' : 'user';
      const content = hasMarkdown ? hasMarkdown.textContent : el.textContent;
      if (content?.trim()) {
        messages.push({ role, content: content.trim() });
      }
    });
    return messages;
  }
};
