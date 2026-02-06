// Popup UI logic with Firebase Auth

// Config - will be replaced during build
const CONFIG = {
  apiEndpoint: 'http://localhost:3000',
  firebaseConfig: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
  }
};

// State
let currentUser = null;
let idToken = null;

// DOM Elements
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

// Show a specific view
function showView(viewId) {
  [termsView, loginView, mainView].forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

// Initialize
async function init() {
  // Load stored state
  const stored = await chrome.storage.local.get([
    'user', 'idToken', 'hasConsented', 'enabled', 'pendingData'
  ]);
  
  if (stored.user && stored.idToken) {
    currentUser = stored.user;
    idToken = stored.idToken;
    
    // Verify token is still valid
    const valid = await verifyToken();
    if (valid) {
      updateMainView(stored.enabled ?? false, stored.pendingData?.length ?? 0);
      showView('mainView');
      return;
    }
  }
  
  if (stored.hasConsented) {
    showView('loginView');
  } else {
    showView('termsView');
  }
}

// Verify token with backend
async function verifyToken() {
  try {
    const response = await fetch(`${CONFIG.apiEndpoint}/api/consent`, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    return response.ok;
  } catch {
    return false;
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

// Google Login
googleLoginBtn.addEventListener('click', async () => {
  googleLoginBtn.disabled = true;
  googleLoginBtn.textContent = '登入中...';
  
  try {
    // Use Chrome Identity API
    const authResult = await chrome.identity.getAuthToken({ 
      interactive: true,
      scopes: ['openid', 'email', 'profile']
    });
    
    if (authResult.token) {
      // Exchange Chrome token for Firebase token
      // Note: In production, you'd use Firebase Auth with Google credential
      const userInfo = await fetch(
        `https://www.googleapis.com/oauth2/v3/userinfo`,
        { headers: { 'Authorization': `Bearer ${authResult.token}` } }
      ).then(r => r.json());
      
      currentUser = {
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
      };
      
      // For now, use the Google token directly
      // In production, exchange this for a Firebase ID token
      idToken = authResult.token;
      
      // Register consent with backend
      await fetch(`${CONFIG.apiEndpoint}/api/consent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ agreed: true })
      });
      
      // Save state
      await chrome.storage.local.set({
        user: currentUser,
        idToken: idToken,
      });
      
      updateMainView(false, 0);
      showView('mainView');
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('登入失敗，請重試');
  } finally {
    googleLoginBtn.disabled = false;
    googleLoginBtn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      使用 Google 登入
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
  statusText.textContent = enabled ? '收集中' : '已停用';
  pendingCount.textContent = pending;
  
  // Get uploaded count
  fetchUploadedCount();
}

// Fetch uploaded count
async function fetchUploadedCount() {
  try {
    const response = await fetch(`${CONFIG.apiEndpoint}/api/my-chats?limit=1`, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (response.ok) {
      const data = await response.json();
      uploadedCount.textContent = data.total || 0;
    }
  } catch (error) {
    console.error('Failed to fetch count:', error);
  }
}

// Toggle enable
enableToggle.addEventListener('change', async () => {
  const enabled = enableToggle.checked;
  
  await chrome.storage.local.set({ enabled });
  
  // Notify background worker
  chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled });
  
  status.className = `status ${enabled ? 'enabled' : 'disabled'}`;
  statusText.textContent = enabled ? '收集中' : '已停用';
});

// Sync button
syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = '同步中...';
  
  chrome.runtime.sendMessage({ type: 'SYNC_NOW', idToken }, (response) => {
    if (response?.success) {
      syncBtn.textContent = `已同步 ${response.synced} 筆!`;
      pendingCount.textContent = '0';
      fetchUploadedCount();
    } else {
      syncBtn.textContent = `錯誤: ${response?.error || '未知'}`;
    }
    
    setTimeout(() => {
      syncBtn.disabled = false;
      syncBtn.textContent = '立即同步';
    }, 2000);
  });
});

// View data
viewDataBtn.addEventListener('click', () => {
  // Open a new tab with user's data view
  chrome.tabs.create({ 
    url: `${CONFIG.apiEndpoint}/view?token=${idToken}` 
  });
});

// Delete all data
deleteDataBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    '確定要刪除所有已上傳的資料嗎？此操作無法復原。\n' +
    'Are you sure you want to delete all your uploaded data? This cannot be undone.'
  );
  
  if (!confirmed) return;
  
  deleteDataBtn.disabled = true;
  deleteDataBtn.textContent = '刪除中...';
  
  try {
    const response = await fetch(`${CONFIG.apiEndpoint}/api/my-chats`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      alert(`已刪除 ${data.deleted} 筆資料`);
      uploadedCount.textContent = '0';
    } else {
      alert('刪除失敗，請重試');
    }
  } catch (error) {
    console.error('Delete error:', error);
    alert('刪除失敗，請重試');
  } finally {
    deleteDataBtn.disabled = false;
    deleteDataBtn.textContent = '刪除所有資料';
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  // Clear Chrome identity token
  if (idToken) {
    try {
      await chrome.identity.removeCachedAuthToken({ token: idToken });
    } catch (e) {
      console.error('Failed to remove token:', e);
    }
  }
  
  // Clear storage
  await chrome.storage.local.remove(['user', 'idToken', 'enabled']);
  
  currentUser = null;
  idToken = null;
  
  showView('loginView');
});

// Initialize on load
init();
