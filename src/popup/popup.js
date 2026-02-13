// Popup UI logic with Chrome Identity API (Google OAuth)

// Config - will be replaced during build or set via storage
const CONFIG = {
  apiEndpoint: 'https://YOUR_SERVER_URL',
};

// Hash email for anonymous ID
async function hashEmail(email) {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// State
let currentUser = null;
let accessToken = null;

// DOM Elements
const loadingView = document.getElementById('loadingView');
const termsView = document.getElementById('termsView');
const loginView = document.getElementById('loginView');
const mainView = document.getElementById('mainView');
const agreeTerms = document.getElementById('agreeTerms');
const continueBtn = document.getElementById('continueBtn');
const googleLoginBtn = document.getElementById('googleLoginBtn');
const backToTerms = document.getElementById('backToTerms');
const enableToggle = document.getElementById('enableToggle');
const status = document.getElementById('status');
const statusText = document.getElementById('statusText');
const pendingCount = document.getElementById('pendingCount');
const uploadedCount = document.getElementById('uploadedCount');
const syncBtn = document.getElementById('syncBtn');
const viewDataBtn = document.getElementById('viewDataBtn');
const deleteDataBtn = document.getElementById('deleteDataBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const userAvatar = document.getElementById('userAvatar');

const modeRadios = document.querySelectorAll('input[name="mode"]');

// Mode change handler
modeRadios.forEach(radio => {
  radio.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ mode: e.target.value });
  });
});

// Show a specific view
function showView(viewId) {
  [loadingView, termsView, loginView, mainView].forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

// Initialize
async function init() {
  // Load config
  const config = await chrome.storage.local.get(['apiEndpoint']);
  if (config.apiEndpoint) {
    CONFIG.apiEndpoint = config.apiEndpoint;
  }
  
  // Load stored state
  const stored = await chrome.storage.local.get([
    'user', 'accessToken', 'hasConsented', 'enabled', 'pendingData', 'mode'
  ]);
  
  if (stored.user && stored.accessToken) {
    currentUser = stored.user;
    accessToken = stored.accessToken;
    
    // Set mode radio
    const mode = stored.mode || 'collect';
    const modeRadio = document.querySelector(`input[name="mode"][value="${mode}"]`);
    if (modeRadio) modeRadio.checked = true;

    // User is logged in locally - show main view
    updateMainView(stored.enabled ?? false, stored.pendingData?.length ?? 0);
    showView('mainView');
    return;
  }
  
  if (stored.hasConsented) {
    showView('loginView');
  } else {
    showView('termsView');
  }
}

// Terms checkbox
agreeTerms.addEventListener('change', () => {
  continueBtn.disabled = !agreeTerms.checked;
});

// Continue to login
continueBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ hasConsented: true });
  showView('loginView');
});

// Back to terms
backToTerms.addEventListener('click', () => {
  showView('termsView');
});

// Google Login using Chrome Identity API
googleLoginBtn.addEventListener('click', async () => {
  googleLoginBtn.disabled = true;
  googleLoginBtn.textContent = 'Signing in...';
  
  try {
    // Get OAuth token via Chrome Identity API
    const authResult = await chrome.identity.getAuthToken({ 
      interactive: true,
      scopes: ['openid', 'email', 'profile']
    });
    
    if (!authResult.token) {
      throw new Error('No token received from Google');
    }
    
    // Get user info from Google
    const userInfoRes = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { 'Authorization': `Bearer ${authResult.token}` } }
    );
    
    if (!userInfoRes.ok) {
      // Token might be invalid, clear it and retry
      await chrome.identity.removeCachedAuthToken({ token: authResult.token });
      throw new Error('Failed to get user info. Please try again.');
    }
    
    const userInfo = await userInfoRes.json();
    
    // Generate anonymous user ID from email hash
    const emailHash = await hashEmail(userInfo.email);
    
    currentUser = {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      anonId: emailHash, // Anonymous ID for server
    };
    
    accessToken = authResult.token;
    
    // Save state locally - no backend verification needed
    await chrome.storage.local.set({
      user: currentUser,
      accessToken: accessToken,
      hasConsented: true,
    });
    
    updateMainView(false, 0);
    showView('mainView');
    
  } catch (error) {
    console.error('Login error:', error);
    // Clear cached token on error so user can retry
    if (accessToken) {
      try {
        await chrome.identity.removeCachedAuthToken({ token: accessToken });
      } catch (e) { /* ignore */ }
    }
    alert(`Login failed: ${error.message || 'Unknown error'}`);
  } finally {
    googleLoginBtn.disabled = false;
    googleLoginBtn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Sign in with Google
    `;
  }
});

// Update main view with current state
function updateMainView(enabled, pending) {
  userName.textContent = currentUser?.name || 'User';
  userEmail.textContent = currentUser?.email || '';
  userAvatar.src = currentUser?.picture || '';
  
  enableToggle.checked = enabled;
  status.className = `status ${enabled ? 'enabled' : 'disabled'}`;
  statusText.textContent = enabled ? 'Collecting' : 'Disabled';
  
  // Get counts
  updateLocalCount();
  fetchUploadedCount();
}

// Fetch uploaded count from server
async function fetchUploadedCount() {
  try {
    const response = await fetch(`${CONFIG.apiEndpoint}/api/my-chats?limit=1`, {
      headers: { 'X-User-Id': currentUser?.anonId }
    });
    if (response.ok) {
      const data = await response.json();
      uploadedCount.textContent = data.total || 0;
    }
  } catch (error) {
    console.error('Failed to fetch count:', error);
    uploadedCount.textContent = '?';
  }
}

// Update local (pending) count from cache
async function updateLocalCount() {
  const stored = await chrome.storage.local.get(['conversationCache']);
  const cache = stored.conversationCache || {};
  let total = 0;
  for (const url in cache) {
    total += cache[url]?.data?.length || 0;
  }
  pendingCount.textContent = total;
}

// Toggle enable
enableToggle.addEventListener('change', async () => {
  const enabled = enableToggle.checked;
  
  await chrome.storage.local.set({ enabled });
  
  // Notify background worker
  chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled });
  
  const currentMode = document.querySelector('input[name="mode"]:checked')?.value || 'collect';
  status.className = `status ${enabled ? 'enabled' : 'disabled'}`;
  statusText.textContent = enabled ? (currentMode === 'guidance' ? 'Collecting + Guidance' : 'Collecting') : 'Disabled';
});

// Sync button
syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';
  
  chrome.runtime.sendMessage({ type: 'SYNC_NOW', accessToken }, (response) => {
    if (response?.success) {
      syncBtn.textContent = `Synced ${response.synced} logs!`;
      pendingCount.textContent = '0';
      fetchUploadedCount();
    } else {
      syncBtn.textContent = `Error: ${response?.error || 'Unknown'}`;
    }
    
    setTimeout(() => {
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync Now';
    }, 2000);
  });
});

// View data
viewDataBtn.addEventListener('click', () => {
  // Open a new tab with user's data view
  chrome.tabs.create({ 
    url: `${CONFIG.apiEndpoint}/view?userId=${currentUser?.anonId}` 
  });
});

// Delete all data
deleteDataBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    'Are you sure you want to delete all your uploaded data? This action cannot be undone.'
  );
  
  if (!confirmed) return;
  
  deleteDataBtn.disabled = true;
  deleteDataBtn.textContent = 'Deleting...';
  
  try {
    const response = await fetch(`${CONFIG.apiEndpoint}/api/my-chats`, {
      method: 'DELETE',
      headers: { 'X-User-Id': currentUser?.anonId }
    });
    
    if (response.ok) {
      const data = await response.json();
      alert(`Deleted ${data.deleted} logs`);
      uploadedCount.textContent = '0';
    } else {
      alert('Delete failed. Please try again.');
    }
  } catch (error) {
    console.error('Delete error:', error);
    alert('Delete failed. Please try again.');
  } finally {
    deleteDataBtn.disabled = false;
    deleteDataBtn.textContent = 'Delete All Data';
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  // Clear Chrome identity token
  if (accessToken) {
    try {
      await chrome.identity.removeCachedAuthToken({ token: accessToken });
    } catch (e) {
      console.error('Failed to remove token:', e);
    }
  }
  
  // Also clear all auth tokens
  try {
    await chrome.identity.clearAllCachedAuthTokens();
  } catch (e) {
    console.error('Failed to clear all tokens:', e);
  }
  
  // Clear ALL data including consent
  await chrome.storage.local.clear();
  
  currentUser = null;
  accessToken = null;
  
  // Go back to terms page
  showView('termsView');
});

// Initialize on load
init();
