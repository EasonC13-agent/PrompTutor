// Guidance overlay UI for answer-seeking detection
// Shows intervention when student asks for direct answers

(function() {
  'use strict';

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #cc-guidance-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #cc-guidance-modal {
      background: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 480px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    .cc-guidance-title {
      font-size: 16px;
      font-weight: 600;
      color: #e65100;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cc-guidance-text {
      font-size: 14px;
      color: #333;
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .cc-guidance-suggestion {
      background: #e8f5e9;
      border: 1px solid #a5d6a7;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
      font-size: 13px;
      color: #2e7d32;
      line-height: 1.5;
    }
    .cc-guidance-suggestion strong {
      display: block;
      margin-bottom: 4px;
      font-size: 12px;
      text-transform: uppercase;
      color: #1b5e20;
    }
    .cc-guidance-reason {
      font-size: 12px;
      color: #666;
      margin-bottom: 16px;
      font-style: italic;
    }
    .cc-guidance-buttons {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cc-guidance-btn {
      padding: 10px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .cc-btn-accept {
      background: #4caf50;
      color: white;
    }
    .cc-btn-accept:hover { background: #43a047; }
    .cc-btn-edit {
      background: #f5f5f5;
      color: #333;
    }
    .cc-btn-edit:hover { background: #e0e0e0; }
    .cc-btn-dismiss {
      background: transparent;
      color: #999;
      font-size: 12px;
    }
    .cc-btn-dismiss:hover { color: #666; }
    #cc-checking-indicator {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #fff3e0;
      border: 1px solid #ffb74d;
      border-radius: 20px;
      padding: 6px 16px;
      font-size: 12px;
      color: #e65100;
      z-index: 100000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
  `;
  document.head.appendChild(style);

  // Show "Checking..." indicator
  window.ccGuidanceShowChecking = function() {
    let el = document.getElementById('cc-checking-indicator');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cc-checking-indicator';
      document.body.appendChild(el);
    }
    el.textContent = '🔍 Checking your prompt...';
    el.style.display = 'block';
  };

  // Hide checking indicator
  window.ccGuidanceHideChecking = function() {
    const el = document.getElementById('cc-checking-indicator');
    if (el) el.style.display = 'none';
  };

  // Show guidance overlay
  // Returns a promise that resolves with { action: 'accepted'|'edited'|'dismissed', finalMessage: string }
  window.ccGuidanceShow = function(originalMessage, suggestion, reason) {
    return new Promise((resolve) => {
      window.ccGuidanceHideChecking();

      const overlay = document.createElement('div');
      overlay.id = 'cc-guidance-overlay';
      overlay.innerHTML = `
        <div id="cc-guidance-modal">
          <div class="cc-guidance-title">💡 Learning Opportunity</div>
          <div class="cc-guidance-text">
            It looks like you might be asking for a direct answer. Try rephrasing to learn more!
          </div>
          <div class="cc-guidance-reason">${reason || ''}</div>
          <div class="cc-guidance-suggestion">
            <strong>Suggested rephrasing:</strong>
            ${suggestion || ''}
          </div>
          <div class="cc-guidance-buttons">
            <button class="cc-guidance-btn cc-btn-accept" id="cc-btn-accept">✨ Use Suggestion</button>
            <button class="cc-guidance-btn cc-btn-edit" id="cc-btn-edit">✏️ Edit My Prompt</button>
            <button class="cc-guidance-btn cc-btn-dismiss" id="cc-btn-dismiss">Send Anyway</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      function cleanup(action, finalMessage) {
        overlay.remove();
        resolve({ action, finalMessage });
      }

      document.getElementById('cc-btn-accept').addEventListener('click', () => {
        cleanup('accepted', suggestion);
      });

      document.getElementById('cc-btn-edit').addEventListener('click', () => {
        cleanup('edited', originalMessage);
      });

      document.getElementById('cc-btn-dismiss').addEventListener('click', () => {
        cleanup('dismissed', originalMessage);
      });

      // Close on background click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          cleanup('edited', originalMessage);
        }
      });
    });
  };

  console.log('[Chat Collector] Guidance UI loaded');
})();
