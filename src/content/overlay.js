// Inject floating toggle overlay into chat interfaces
// Shows collection status and allows quick toggle

(function() {
  'use strict';
  
  // Avoid duplicate injection
  if (document.getElementById('chat-collector-overlay')) return;
  
  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'chat-collector-overlay';
  overlay.innerHTML = `
    <style>
      #chat-collector-overlay {
        position: fixed;
        bottom: 80px;
        right: 20px;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #chat-collector-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 20px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        cursor: pointer;
        transition: all 0.2s;
        font-size: 13px;
      }
      #chat-collector-toggle:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      }
      #chat-collector-toggle.collecting {
        background: #e8f5e9;
        border-color: #4caf50;
      }
      #chat-collector-toggle.not-logged-in {
        background: #fff3e0;
        border-color: #ff9800;
      }
      .cc-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #9e9e9e;
      }
      .cc-indicator.active {
        background: #4caf50;
        animation: cc-pulse 2s infinite;
      }
      @keyframes cc-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .cc-label {
        color: #333;
        user-select: none;
      }
      .cc-switch {
        position: relative;
        width: 36px;
        height: 20px;
      }
      .cc-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .cc-slider {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background: #ccc;
        border-radius: 20px;
        transition: 0.3s;
      }
      .cc-slider:before {
        position: absolute;
        content: "";
        height: 14px;
        width: 14px;
        left: 3px;
        bottom: 3px;
        background: white;
        border-radius: 50%;
        transition: 0.3s;
      }
      input:checked + .cc-slider {
        background: #4caf50;
      }
      input:checked + .cc-slider:before {
        transform: translateX(16px);
      }
      .cc-minimize {
        position: absolute;
        top: -8px;
        right: -8px;
        width: 20px;
        height: 20px;
        background: #666;
        color: white;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        display: none;
      }
      #chat-collector-toggle:hover .cc-minimize {
        display: block;
      }
      #chat-collector-overlay.minimized #chat-collector-toggle {
        padding: 6px 10px;
      }
      #chat-collector-overlay.minimized .cc-label,
      #chat-collector-overlay.minimized .cc-switch {
        display: none;
      }
    </style>
    <div id="chat-collector-toggle">
      <button class="cc-minimize" title="Minimize">−</button>
      <span class="cc-indicator"></span>
      <span class="cc-label">Share Data</span>
      <label class="cc-switch">
        <input type="checkbox" id="cc-enabled">
        <span class="cc-slider"></span>
      </label>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Elements
  const toggle = document.getElementById('chat-collector-toggle');
  const indicator = toggle.querySelector('.cc-indicator');
  const label = toggle.querySelector('.cc-label');
  const checkbox = document.getElementById('cc-enabled');
  const minimizeBtn = toggle.querySelector('.cc-minimize');
  
  // State
  let isLoggedIn = false;
  let isEnabled = false;
  let currentMode = 'collect';
  
  // Load state from storage
  async function loadState() {
    const stored = await chrome.storage.local.get(['user', 'enabled', 'mode']);
    isLoggedIn = !!stored.user;
    isEnabled = stored.enabled || false;
    currentMode = stored.mode || 'collect';
    updateUI();
  }
  
  // Update UI based on state
  function updateUI() {
    if (!isLoggedIn) {
      toggle.className = 'not-logged-in';
      indicator.className = 'cc-indicator';
      label.textContent = 'Not signed in';
      checkbox.checked = false;
      checkbox.disabled = true;
    } else {
      toggle.className = isEnabled ? 'collecting' : '';
      indicator.className = isEnabled ? 'cc-indicator active' : 'cc-indicator';
      label.textContent = isEnabled ? (currentMode === 'guidance' ? 'Collecting + Guidance' : 'Collecting') : 'Share Data';
      checkbox.checked = isEnabled;
      checkbox.disabled = false;
    }
  }
  
  // Toggle handler
  checkbox.addEventListener('change', async (e) => {
    if (!isLoggedIn) {
      e.preventDefault();
      checkbox.checked = false;
      // Open extension popup
      alert('Please sign in to Chat Collector first by clicking the extension icon.');
      return;
    }
    
    isEnabled = checkbox.checked;
    await chrome.storage.local.set({ enabled: isEnabled });
    chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled: isEnabled });
    updateUI();
  });
  
  // Click on overlay when not logged in
  toggle.addEventListener('click', (e) => {
    if (!isLoggedIn && e.target !== checkbox) {
      alert('Please sign in to Chat Collector first by clicking the extension icon in your browser toolbar.');
    }
  });
  
  // Minimize button
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.classList.toggle('minimized');
  });
  
  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      isEnabled = changes.enabled.newValue;
      updateUI();
    }
    if (changes.user) {
      isLoggedIn = !!changes.user.newValue;
      updateUI();
    }
    if (changes.mode) {
      currentMode = changes.mode.newValue || 'collect';
      updateUI();
    }
  });
  
  // Initial load
  loadState();
  
  console.log('[Chat Collector] Overlay injected');
})();
