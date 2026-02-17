// Answer-seeking detector
// Triggered when user clicks the overlay in guidance mode

(function() {
  'use strict';

  const API_ENDPOINT = 'https://YOUR_SERVER_URL';
  let mode = 'collect';
  let userAnonId = null;
  let isProcessing = false;

  chrome.storage.local.get(['mode', 'user', 'enabled'], (result) => {
    mode = result.mode || 'collect';
    userAnonId = result.user?.anonId || null;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.mode) mode = changes.mode.newValue || 'collect';
    if (changes.user) userAnonId = changes.user.newValue?.anonId || null;
  });

  function getPlatform() {
    if (location.hostname.includes('chatgpt') || location.hostname.includes('chat.openai')) return 'chatgpt';
    if (location.hostname.includes('claude')) return 'claude';
    if (location.hostname.includes('grok.com') || (location.hostname.includes('x.com') && location.pathname.startsWith('/i/grok'))) return 'grok';
    if (location.hostname.includes('copilot.microsoft.com') || (location.hostname.includes('bing.com') && location.pathname.startsWith('/chat'))) return 'copilot';
    if (location.hostname.includes('chat.deepseek.com')) return 'deepseek';
    if (location.hostname.includes('doubao.com')) return 'doubao';
    if (location.hostname.includes('gemini.google.com')) return 'gemini';
    if (location.hostname.includes('perplexity.ai')) return 'perplexity';
    if (location.hostname.includes('poe.com')) return 'poe';
    if (location.hostname.includes('huggingface.co') && location.pathname.startsWith('/chat')) return 'huggingchat';
    return 'unknown';
  }

  function getChatInput() {
    const platform = getPlatform();
    if (platform === 'chatgpt') {
      // #prompt-textarea is a contenteditable DIV (ProseMirror), not a textarea
      return document.querySelector('div#prompt-textarea[contenteditable="true"]') ||
             document.querySelector('#prompt-textarea') ||
             document.querySelector('div.ProseMirror[contenteditable="true"]') ||
             document.querySelector('textarea[data-id="root"]');
    }
    if (platform === 'claude') {
      // Claude uses ProseMirror (tiptap) contenteditable div
      return document.querySelector('div.tiptap.ProseMirror[contenteditable="true"]') ||
             document.querySelector('div.ProseMirror[contenteditable="true"]') ||
             document.querySelector('fieldset div[contenteditable="true"]') ||
             document.querySelector('[data-testid="chat-input"] [contenteditable="true"]');
    }
    if (platform === 'grok') {
      return document.querySelector('textarea[placeholder]') ||
             document.querySelector('div[contenteditable="true"]') ||
             document.querySelector('[role="textbox"]');
    }
    if (platform === 'copilot') {
      // Copilot uses textarea#userInput, data-testid="composer-input"
      return document.querySelector('textarea#userInput') ||
             document.querySelector('[data-testid="composer-input"] textarea') ||
             document.querySelector('textarea[placeholder]') ||
             document.querySelector('[role="textbox"]') ||
             document.querySelector('#searchbox');
    }
    if (platform === 'deepseek') {
      return document.querySelector('textarea[placeholder]') ||
             document.querySelector('div[contenteditable="true"]') ||
             document.querySelector('[role="textbox"]');
    }
    if (platform === 'doubao') {
      // Doubao uses textarea with data-testid="chat_input"
      return document.querySelector('[data-testid="chat_input"] textarea') ||
             document.querySelector('textarea[placeholder]') ||
             document.querySelector('div[contenteditable="true"]') ||
             document.querySelector('[role="textbox"]');
    }
    if (platform === 'gemini') {
      // Gemini uses .ql-editor (Quill) inside rich-textarea, contenteditable
      return document.querySelector('.ql-editor[contenteditable="true"]') ||
             document.querySelector('rich-textarea [contenteditable="true"]') ||
             document.querySelector('div[contenteditable="true"]') ||
             document.querySelector('.ql-editor');
    }
    if (platform === 'perplexity') {
      // Perplexity uses div#ask-input contenteditable
      return document.querySelector('div#ask-input[contenteditable="true"]') ||
             document.querySelector('div#ask-input') ||
             document.querySelector('div[contenteditable="true"]') ||
             document.querySelector('[role="textbox"]');
    }
    if (platform === 'poe') {
      return document.querySelector('textarea[placeholder]') ||
             document.querySelector('div[contenteditable="true"]') ||
             document.querySelector('[role="textbox"]');
    }
    if (platform === 'huggingchat') {
      return document.querySelector('textarea[placeholder]') ||
             document.querySelector('div[contenteditable="true"]') ||
             document.querySelector('[role="textbox"]');
    }
    return null;
  }

  function getInputText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value;
    return el.innerText || el.textContent || '';
  }

  function setInputText(el, text) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    el.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function detectAnswerSeeking(message) {
    try {
      const response = await fetch(`${API_ENDPOINT}/api/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userAnonId || 'anonymous'
        },
        body: JSON.stringify({
          message,
          platform: getPlatform(),
          context: { url: location.href }
        })
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.error('[Chat Collector] Detection error:', e);
      return null;
    }
  }

  async function logGuidance(data) {
    try {
      await fetch(`${API_ENDPOINT}/api/guidance-log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userAnonId || 'anonymous'
        },
        body: JSON.stringify({
          platform: getPlatform(),
          url: location.href,
          ...data
        })
      });
    } catch (e) {
      console.error('[Chat Collector] Guidance log error:', e);
    }
  }

  // Main function: analyze current input and show guidance
  // Exposed globally so overlay.js can call it
  // skipChecks: overlay already verified enabled + guidance mode
  window.ccAnalyzeAndGuide = async function(skipChecks) {
    console.log('[Chat Collector] ccAnalyzeAndGuide called, isProcessing:', isProcessing);
    if (isProcessing) return;

    if (!skipChecks) {
      const stored = await chrome.storage.local.get(['enabled']);
      if (!stored.enabled || mode !== 'guidance') {
        console.log('[Chat Collector] Not enabled or not guidance mode');
        return;
      }
    }

    const input = getChatInput();
    console.log('[Chat Collector] Input element:', input?.tagName, input?.id);
    const text = getInputText(input).trim();
    console.log('[Chat Collector] Input text length:', text.length, 'text:', text.substring(0, 50));

    if (!text || text.length < 5) {
      if (typeof window.ccGuidanceShowChecking === 'function') {
        window.ccGuidanceShowChecking('Type a prompt first');
        setTimeout(() => {
          if (typeof window.ccGuidanceHideChecking === 'function')
            window.ccGuidanceHideChecking();
        }, 2000);
      }
      return;
    }

    isProcessing = true;

    if (typeof window.ccGuidanceShowChecking === 'function') {
      window.ccGuidanceShowChecking();
    }

    console.log('[Chat Collector] Calling detect API...');
    const result = await detectAnswerSeeking(text);
    console.log('[Chat Collector] Detect result:', result);

    if (typeof window.ccGuidanceHideChecking === 'function') {
      window.ccGuidanceHideChecking();
    }

    if (!result) {
      console.log('[Chat Collector] No result from API');
      isProcessing = false;
      return;
    }

    if (result.isAnswerSeeking && result.confidence > 0.6) {
      if (typeof window.ccGuidanceShow === 'function') {
        const choice = await window.ccGuidanceShow(text, result.suggestion, result.reason);

        logGuidance({
          originalMessage: text,
          isAnswerSeeking: result.isAnswerSeeking,
          confidence: result.confidence,
          suggestion: result.suggestion,
          userAction: choice.action,
          finalMessage: choice.finalMessage
        });

        if (choice.action === 'accepted') {
          setInputText(input, choice.finalMessage);
        }
        // 'edited' or 'dismissed' - leave as-is
      }
    } else {
      // Not answer-seeking: show brief "looks good" feedback
      if (typeof window.ccGuidanceShowChecking === 'function') {
        window.ccGuidanceShowChecking('✅ Your prompt looks good!');
        setTimeout(() => {
          if (typeof window.ccGuidanceHideChecking === 'function')
            window.ccGuidanceHideChecking();
        }, 2000);
      }

      logGuidance({
        originalMessage: text,
        isAnswerSeeking: result.isAnswerSeeking,
        confidence: result.confidence,
        suggestion: result.suggestion,
        userAction: 'passed',
        finalMessage: text
      });
    }

    isProcessing = false;
  };

  console.log('[Chat Collector] Detector loaded (click-to-analyze mode)');
})();
