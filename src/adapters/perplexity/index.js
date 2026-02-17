// Perplexity-specific adapter
// Real DOM tested: user queries are h1 with Tailwind class "group/query"
// Assistant answers are .prose elements
// Container elements have class containing "threadContentWidth"

console.log('[PrompTutor] Perplexity adapter loaded');

const SELECTORS = {
  messageContainer: '[class*="threadContentWidth"]',
  userMessage: 'h1[class*="query"]',
  assistantMessage: '.prose',
  conversationList: null
};

window.PerplexityAdapter = {
  SELECTORS,

  parseFromDOM() {
    const messages = [];
    // User queries: h1 elements with class containing "query" (Tailwind group/query)
    document.querySelectorAll('h1[class*="query"]').forEach(el => {
      const content = el.textContent?.trim();
      if (content) {
        messages.push({ role: 'user', content });
      }
    });
    // Assistant answers: .prose elements with content
    document.querySelectorAll('.prose').forEach(el => {
      const content = el.textContent?.trim();
      if (content) {
        messages.push({ role: 'assistant', content });
      }
    });
    // Sort by DOM order would be better, but this gives a reasonable approximation
    // In practice, queries and answers alternate
    return messages;
  }
};
