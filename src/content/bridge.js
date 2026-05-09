// Bridge between MAIN world and extension
// Runs in isolated world, forwards intercepted API data to background

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'PROMPTUTOR_DATA') {
    console.log('[PrompTutor] Forwarding to background:', event.data.payload.url);
    try {
      chrome.runtime.sendMessage({ type: 'CHAT_DATA', payload: event.data.payload });
    } catch (e) {}
  }
});

console.log('[PrompTutor] Bridge loaded (isolated world)');
