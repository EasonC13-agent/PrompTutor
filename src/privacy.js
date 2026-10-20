// Shared fail-closed policy. A global switch is not per-conversation consent.
(function(root) {
  'use strict';
  function conversationUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return null;
      let match;
      if (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com') {
        match = url.pathname.match(/^\/(?:c\/[^/]+|g\/[^/]+\/c\/[^/]+)\/?$/);
        if (!match && url.hostname === 'chatgpt.com') match = url.pathname.match(/^\/uc\/[^/]+\/?$/);
      } else if (url.hostname === 'claude.ai') {
        match = url.pathname.match(/^\/chat\/[^/]+\/?$/);
      } else if (url.hostname === 'gemini.google.com') {
        // Persisted chats only: hex chat id, optionally under a Gem. Excludes /app, /app/download, /share/*.
        match = url.pathname.match(/^\/(?:app|gem\/[A-Za-z0-9_-]+)\/[0-9a-f]{8,}\/?$/i);
      } else if (url.hostname === 'grok.com') {
        match = url.pathname.match(/^\/c\/[A-Za-z0-9-]+\/?$/);
      }
      return match ? `${url.origin}${match[0].replace(/\/$/, '')}` : null;
    } catch { return null; }
  }
  const PLATFORMS = { 'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt', 'claude.ai': 'claude', 'gemini.google.com': 'gemini', 'grok.com': 'grok' };
  function platform(value) {
    const canonical = conversationUrl(value);
    return canonical ? PLATFORMS[new URL(canonical).hostname] || null : null;
  }
  function owner(state) { return state.user?.email?.toLowerCase().trim() || null; }
  function allowed(state, value) {
    const url = conversationUrl(value), account = owner(state);
    return !!(url && account && state.enabled === true && state.accessToken && state.conversationConsents?.[url] === account);
  }
  root.PROMPTUTOR_PRIVACY = Object.freeze({ conversationUrl, platform, owner, allowed });
})(globalThis);
