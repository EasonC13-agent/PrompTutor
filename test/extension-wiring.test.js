// Synthetic extension wiring/UI checks, not a real OAuth or site login.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
test('manifest grants production/OAuth access and loads privacy policy before content scripts', () => {
  const manifest = JSON.parse(read('manifest.json'));
  for (const host of ['https://chat-collector.eason.phd/*', 'https://www.googleapis.com/*', 'https://accounts.google.com/*']) assert.ok(manifest.host_permissions?.includes(host), host);
  for (const entry of manifest.content_scripts) assert.equal(entry.js[0], 'src/privacy.js');
});
test('fixture: overlay does not present global enable as conversation consent', async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://chatgpt.com/c/fixture-a', runScripts: 'outside-only' });
  const sent = [];
  const state = { enabled: true, accessToken: 'fixture-token', user: { email: 'fixture@example.invalid' }, conversationConsents: {} };
  Object.assign(dom.window, { console: { log() {}, error() {} }, setInterval() {}, chrome: {
    storage: { local: { get: async () => structuredClone(state) }, onChanged: { addListener() {} } },
    alarms: { get: async () => null }, runtime: { sendMessage: async m => { sent.push(m); return { success: true }; } }
  } });
  if (fs.existsSync(path.join(root, 'src/privacy.js'))) dom.window.eval(read('src/privacy.js'));
  dom.window.eval(read('src/content/overlay.js'));
  await new Promise(r => setImmediate(r));
  const checkbox = dom.window.document.querySelector('#cc-enabled');
  assert.equal(checkbox.checked, false);
  checkbox.checked = true; checkbox.dispatchEvent(new dom.window.Event('change'));
  await new Promise(r => setImmediate(r));
  assert.equal(sent[0].type, 'SET_CONVERSATION_CONSENT');
  assert.equal(sent[0].url, 'https://chatgpt.com/c/fixture-a');
  assert.equal(sent[0].granted, true);
});
test('fixture: popup master switch does not claim to collect unconsented chats', async () => {
  const dom = new JSDOM(read('src/popup/index.html'), { url: 'https://fixture.invalid', runScripts: 'outside-only' });
  const state = { enabled: true, user: { email: 'fixture@example.invalid' }, accessToken: 'fixture-token', uploadedCount: 0, conversationCache: {} };
  Object.assign(dom.window, { fetch: async () => ({ ok: false }), chrome: { storage: { local: { get: async () => state } }, runtime: {}, tabs: {} } });
  dom.window.eval(read('src/popup/popup.js')); await new Promise(r => setImmediate(r));
  assert.match(dom.window.document.querySelector('#statusText').textContent, /Ready/);
});
test('fixture: popup sync count retains queued arrivals rather than claiming zero', async () => {
  const dom = new JSDOM(read('src/popup/index.html'), { url: 'https://fixture.invalid', runScripts: 'outside-only' });
  const state = { enabled: true, user: { email: 'fixture@example.invalid' }, accessToken: 'fixture-token', uploadedCount: 0, conversationCache: { fixture: { messages: [{}, {}] } } };
  Object.assign(dom.window, { setTimeout() {}, fetch: async () => ({ ok: false }), chrome: { storage: { local: { get: async () => state } }, runtime: { sendMessage: (m, cb) => cb({ success: true, synced: 1 }) }, tabs: {} } });
  dom.window.eval(read('src/popup/popup.js')); await new Promise(r => setImmediate(r));
  dom.window.document.querySelector('#syncBtn').click(); await new Promise(r => setImmediate(r));
  assert.equal(dom.window.document.querySelector('#pendingCount').textContent, '2');
});
test('fixture: sign-out preserves content-free pending deletion receipts for the original account', async () => {
  const dom = new JSDOM(read('src/popup/index.html'), { url: 'https://fixture.invalid', runScripts: 'outside-only' });
  const pendingDeletions = { 'https://chatgpt.com/c/fixture-a': 'fixture@example.invalid' };
  const state = { enabled: true, user: { email: 'fixture@example.invalid' }, accessToken: 'fixture-token', uploadedCount: 0, pendingDeletions };
  Object.assign(dom.window, { fetch: async () => ({ ok: false }), chrome: { identity: { removeCachedAuthToken: async () => {}, clearAllCachedAuthTokens: async () => {} }, storage: { local: { get: async () => state, clear: async () => { for (const key of Object.keys(state)) delete state[key]; }, remove: async keys => { for (const key of keys) delete state[key]; } } }, runtime: {}, tabs: {} } });
  dom.window.eval(read('src/popup/popup.js')); await new Promise(r => setImmediate(r));
  dom.window.document.querySelector('#logoutBtn').click(); await new Promise(r => setImmediate(r));
  assert.deepEqual(state.pendingDeletions, pendingDeletions);
  assert.equal(state.accessToken, undefined);
});
