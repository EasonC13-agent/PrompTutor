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
      }
      return match ? `${url.origin}${match[0].replace(/\/$/, '')}` : null;
    } catch { return null; }
  }
  function owner(state) { return state.user?.email?.toLowerCase().trim() || null; }
  function allowed(state, value) {
    const url = conversationUrl(value), account = owner(state);
    return !!(url && account && state.enabled === true && state.accessToken && state.conversationConsents?.[url] === account);
  }
  root.PROMPTUTOR_PRIVACY = Object.freeze({ conversationUrl, owner, allowed });
})(globalThis);
