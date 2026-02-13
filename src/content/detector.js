// Answer-seeking detector
// Intercepts chat submissions and checks with backend if mode is "guidance"

(function() {
  'use strict';

  const API_ENDPOINT = 'https://YOUR_SERVER_URL';
  let mode = 'collect';
  let userAnonId = null;
  let isProcessing = false;

  // Load state
  chrome.storage.local.get(['mode', 'user', 'enabled'], (result) => {
    mode = result.mode || 'collect';
    userAnonId = result.user?.anonId || null;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.mode) mode = changes.mode.newValue || 'collect';
    if (changes.user) userAnonId = changes.user.newValue?.anonId || null;
  });

  // Detect platform
  function getPlatform() {
    if (location.hostname.includes('chatgpt') || location.hostname.includes('chat.openai')) return 'chatgpt';
    if (location.hostname.includes('claude')) return 'claude';
    return 'unknown';
  }

  // Get the chat input element
  function getChatInput() {
    const platform = getPlatform();
    if (platform === 'chatgpt') {
      return document.querySelector('#prompt-textarea') ||
             document.querySelector('textarea[data-id="root"]') ||
             document.querySelector('div[contenteditable="true"][id="prompt-textarea"]');
    }
    if (platform === 'claude') {
      return document.querySelector('div[contenteditable="true"].ProseMirror') ||
             document.querySelector('fieldset div[contenteditable="true"]') ||
             document.querySelector('div[contenteditable="true"]');
    }
    return null;
  }

  // Get text from input element
  function getInputText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value;
    return el.innerText || el.textContent || '';
  }

  // Set text in input element
  function setInputText(el, text) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // contenteditable
    el.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Call backend to detect answer-seeking
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

  // Log guidance interaction
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

  // Intercept submission
  async function handleSubmission(e) {
    if (mode !== 'guidance' || isProcessing) return;

    const input = getChatInput();
    const text = getInputText(input).trim();
    if (!text || text.length < 10) return; // Skip very short messages

    // Check if enabled
    const stored = await chrome.storage.local.get(['enabled']);
    if (!stored.enabled) return;

    // Prevent the submission
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    isProcessing = true;

    // Show checking indicator
    if (typeof window.ccGuidanceShowChecking === 'function') {
      window.ccGuidanceShowChecking();
    }

    try {
      const result = await detectAnswerSeeking(text);

      if (typeof window.ccGuidanceHideChecking === 'function') {
        window.ccGuidanceHideChecking();
      }

      if (result && result.isAnswerSeeking && result.confidence > 0.6) {
        // Show guidance overlay
        if (typeof window.ccGuidanceShow === 'function') {
          const choice = await window.ccGuidanceShow(text, result.suggestion, result.reason);

          // Log the interaction
          logGuidance({
            originalMessage: text,
            isAnswerSeeking: result.isAnswerSeeking,
            confidence: result.confidence,
            suggestion: result.suggestion,
            userAction: choice.action,
            finalMessage: choice.finalMessage
          });

          if (choice.action === 'accepted') {
            // Replace text with suggestion and submit
            setInputText(input, choice.finalMessage);
            isProcessing = false;
            // Trigger submit after a short delay
            setTimeout(() => triggerSubmit(), 100);
            return;
          } else if (choice.action === 'edited') {
            // Let user edit, don't submit
            isProcessing = false;
            return;
          } else {
            // dismissed - send original
            isProcessing = false;
            setTimeout(() => triggerSubmit(), 100);
            return;
          }
        }
      } else {
        // Not answer-seeking or low confidence, let it through
        if (result) {
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
        setTimeout(() => triggerSubmit(), 50);
        return;
      }
    } catch (err) {
      console.error('[Chat Collector] Detection failed:', err);
      if (typeof window.ccGuidanceHideChecking === 'function') {
        window.ccGuidanceHideChecking();
      }
      isProcessing = false;
      setTimeout(() => triggerSubmit(), 50);
    }
  }

  // Trigger the actual submit
  function triggerSubmit() {
    const platform = getPlatform();
    let submitBtn;
    if (platform === 'chatgpt') {
      submitBtn = document.querySelector('button[data-testid="send-button"]') ||
                  document.querySelector('button[aria-label="Send prompt"]') ||
                  document.querySelector('form button[type="submit"]');
    } else if (platform === 'claude') {
      submitBtn = document.querySelector('button[aria-label="Send Message"]') ||
                  document.querySelector('button[aria-label="Send message"]') ||
                  document.querySelector('fieldset button:last-of-type');
    }
    if (submitBtn) {
      submitBtn.click();
    }
  }

  // Hook into Enter key and submit button
  function setupInterception() {
    // Intercept Enter key on the input
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && mode === 'guidance' && !isProcessing) {
        const input = getChatInput();
        if (input && (input === document.activeElement || input.contains(document.activeElement))) {
          const text = getInputText(input).trim();
          if (text && text.length >= 10) {
            handleSubmission(e);
          }
        }
      }
    }, true); // capture phase

    // Intercept submit button clicks
    const observer = new MutationObserver(() => {
      const platform = getPlatform();
      let submitBtn;
      if (platform === 'chatgpt') {
        submitBtn = document.querySelector('button[data-testid="send-button"]') ||
                    document.querySelector('button[aria-label="Send prompt"]');
      } else if (platform === 'claude') {
        submitBtn = document.querySelector('button[aria-label="Send Message"]') ||
                    document.querySelector('button[aria-label="Send message"]');
      }
      if (submitBtn && !submitBtn._ccIntercepted) {
        submitBtn._ccIntercepted = true;
        submitBtn.addEventListener('click', (e) => {
          if (mode === 'guidance' && !isProcessing) {
            handleSubmission(e);
          }
        }, true);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupInterception);
  } else {
    setupInterception();
  }

  console.log('[Chat Collector] Detector loaded');
})();
