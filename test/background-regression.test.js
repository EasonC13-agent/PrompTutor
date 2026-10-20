// SYNTHETIC service-worker, storage, and network fixtures. No live requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const root = path.join(__dirname, '..');
const url = 'https://chatgpt.com/c/fixture-a';
const flush = () => new Promise(r => setImmediate(r));
async function background(extra = {}, fetcher) {
  const state = { enabled: true, accessToken: 'fixture-token', user: { email: 'fixture@example.invalid' }, conversationConsents: { [url]: 'fixture@example.invalid' }, ...extra };
  const requests = [], changes = []; let listener;
  const context = vm.createContext({ URL, URLSearchParams, TextEncoder, Uint8Array, crypto: webcrypto, console: { log() {}, error() {} },
    setTimeout() {},
    fetch: async (u, options) => { requests.push({ url: u, ...options }); return fetcher ? fetcher(u, options) : { ok: true, status: 200, json: async () => ({ success: true, total: 1, deleted: 1 }) }; },
    chrome: { alarms: { create() {}, onAlarm: { addListener() {} } }, action: { setBadgeText() {}, setBadgeBackgroundColor() {} }, storage: { local: {
      get: (keys, cb) => { const copy = structuredClone(state); cb?.(copy); return Promise.resolve(copy); },
      set: async values => { const delta = {}; for (const [k,v] of Object.entries(values)) { delta[k] = { oldValue: state[k], newValue: structuredClone(v) }; state[k] = structuredClone(v); } changes.forEach(fn => fn(delta, 'local')); },
      remove: async keys => { const delta = {}; for (const k of keys) { delta[k] = { oldValue: state[k] }; delete state[k]; } changes.forEach(fn => fn(delta, 'local')); }
    }, onChanged: { addListener: fn => changes.push(fn) } }, runtime: { onMessage: { addListener: fn => listener = fn } } }
  });
  context.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'src', f.replace(/^\.\.\//, '')), 'utf8'), context); };
  vm.runInContext(fs.readFileSync(path.join(root, 'src/background/index.js'), 'utf8'), context);
  await flush();
  return { state, requests, context, async send(message, sender = { tab: { url }, url }) {
    let response, resolve; const done = new Promise(r => { resolve = r; });
    const asyncReply = listener(message, sender, r => { response = r; resolve(); });
    if (message.type === 'CHAT_DATA' && asyncReply === true) await done;
    await flush(); return response;
  }, async change(values) { await context.chrome.storage.local.set(values); await flush(); } };
}
const payload = n => ({ url, platform: 'chatgpt', messages: [{ role: 'user', content: `fixture ${n}`, hash: `u${n}` }, { role: 'assistant', content: `answer ${n}`, hash: `a${n}` }] });
test('fixture: background rejects unconsented content before caching', async () => {
  const f = await background({ conversationConsents: {} }); await f.send({ type: 'CHAT_DATA', payload: payload(1) });
  assert.equal(Object.keys(f.state.conversationCache || {}).length, 0);
});
test('fixture: serialized batch acknowledgement preserves arrivals during upload', async () => {
  let release;
  const f = await background({}, async () => new Promise(r => { release = () => r({ ok: true, status: 200, json: async () => ({ total: 1 }) }); }));
  await f.send({ type: 'CHAT_DATA', payload: payload(1) });
  await f.send({ type: 'SYNC_NOW' });
  await f.send({ type: 'CHAT_DATA', payload: payload(2) });
  await f.send({ type: 'SYNC_NOW' });
  assert.equal(f.requests.length, 1, 'concurrent sync entry points share one request');
  assert.equal(f.requests[0].headers.Authorization, 'Bearer fixture-token');
  release(); await flush(); await flush();
  assert.equal(f.state.conversationCache[url].messages.length, 1);
  assert.equal(f.state.conversationCache[url].messages[0].messageText, 'fixture 2');
});
test('fixture: delayed replies and identical prompts retain complete distinct pairs', async () => {
  const f = await background();
  const p = payload(1);
  await f.send({ type: 'CHAT_DATA', payload: { ...p, messages: [p.messages[0]] } });
  await f.send({ type: 'CHAT_DATA', payload: p });
  await f.send({ type: 'CHAT_DATA', payload: { ...p, messages: [...p.messages, ...p.messages] } });
  await f.send({ type: 'SYNC_NOW' }); await flush();
  const messages = JSON.parse(f.requests[0].body).messages;
  assert.equal(messages.length, 2);
  assert.ok(messages.every(m => m.assistantResponse === 'answer 1'));
  assert.notEqual(messages[0].messageHash, messages[1].messageHash);
  assert.match(messages[0].messageHash, /^[a-f0-9]{64}$/);
});
test('fixture: revocation discards local content and deletes only after in-flight upload settles', async () => {
  let release;
  const f = await background({}, async (u, options) => options.method === 'POST' ? new Promise(r => { release = () => r({ ok: true, json: async () => ({ total: 1 }) }); }) : { ok: true, json: async () => ({ deleted: 1 }) });
  await f.send({ type: 'CHAT_DATA', payload: payload(1) });
  await f.send({ type: 'SYNC_NOW' });
  await f.send({ type: 'SET_CONVERSATION_CONSENT', url, granted: false });
  assert.equal(f.state.conversationCache[url], undefined);
  assert.equal(f.state.conversationConsents[url], undefined);
  assert.equal(f.requests.length, 1);
  release(); await flush(); await flush();
  assert.equal(f.requests.at(-1).method, 'DELETE');
  assert.equal(f.requests.at(-1).headers.Authorization, 'Bearer fixture-token');
});
test('fixture: account changes cannot upload or retain another account queue', async () => {
  const f = await background(); await f.send({ type: 'CHAT_DATA', payload: payload(1) });
  await f.change({ user: { email: 'other@example.invalid' }, accessToken: 'other-fixture-token' });
  await f.send({ type: 'SYNC_NOW' });
  assert.equal(f.requests.length, 0);
  assert.equal(Object.keys(f.state.conversationCache).length, 0);
  assert.equal(Object.keys(f.state.conversationConsents).length, 0);
});
test('fixture: guidance cannot bypass conversation consent', async () => {
  const f = await background({ conversationConsents: {} });
  await f.send({ type: 'DETECT', message: 'private prompt', url, platform: 'chatgpt' });
  await f.send({ type: 'LOG_GUIDANCE', originalMessage: 'private prompt', url, platform: 'chatgpt' });
  assert.equal(f.requests.length, 0);
});
test('fixture: OAuth rejects a callback with mismatched state before userinfo', async () => {
  const f = await background();
  f.context.chrome.runtime.getManifest = () => ({ oauth2: { client_id: 'fixture-client', scopes: ['openid', 'email', 'profile'] } });
  f.context.chrome.identity = { getRedirectURL: () => 'https://fixture.chromiumapp.org/', launchWebAuthFlow: async () => 'https://fixture.chromiumapp.org/#access_token=fixture-token&state=wrong' };
  await f.send({ type: 'GOOGLE_SIGN_IN' }); await flush();
  assert.equal(f.requests.length, 0);
});
test('fixture: failed deletion is durable and retryable while collection is disabled', async () => {
  let succeed = false;
  const f = await background({ enabled: false }, async () => ({ ok: succeed, status: succeed ? 200 : 503, json: async () => ({ deleted: 1 }) }));
  await f.send({ type: 'SET_CONVERSATION_CONSENT', url, granted: false });
  assert.equal(f.state.pendingDeletions[url], 'fixture@example.invalid');
  succeed = true;
  await f.send({ type: 'SYNC_NOW' }); await flush();
  assert.equal(f.state.pendingDeletions[url], undefined);
});
test('fixture: startup discards legacy cache with no provable account and consent', async () => {
  const f = await background({ conversationCache: { [url]: { messages: [{ messageText: 'legacy private' }] } } });
  assert.equal(Object.keys(f.state.conversationCache).length, 0);
});
test('fixture: custom GPT conversations keep distinct actual chat IDs', async () => {
  const custom = 'https://chatgpt.com/g/g-fixture/c/chat-fixture';
  const f = await background({ conversationConsents: { [custom]: 'fixture@example.invalid' } });
  await f.send({ type: 'CHAT_DATA', payload: { ...payload(1), url: custom } }, { tab: { url: custom } });
  await f.send({ type: 'SYNC_NOW' }); await flush();
  assert.equal(JSON.parse(f.requests[0].body).messages[0].chatId, 'chat-fixture');
});
test('fixture: guidance auth retry rechecks consent after asynchronous refresh', async () => {
  const f = await background({}, async () => ({ ok: false, status: 401 }));
  f.context.trySilentRefresh = async () => { await f.change({ conversationConsents: {} }); return true; };
  await f.send({ type: 'DETECT', message: 'fixture prompt', url, platform: 'chatgpt' }); await flush();
  assert.equal(f.requests.length, 1);
});
for (const status of [401, 503]) test(`fixture: HTTP ${status} preserves the exact batch for retry`, async () => {
  let failing = true;
  const f = await background({}, async () => failing ? { ok: false, status } : { ok: true, json: async () => ({ total: 1 }) });
  await f.send({ type: 'CHAT_DATA', payload: payload(1) }); await f.send({ type: 'SYNC_NOW' });
  assert.equal(f.state.conversationCache[url].messages.length, 1);
  failing = false; await f.send({ type: 'SYNC_NOW' });
  assert.equal(f.state.conversationCache[url].messages.length, 0);
  assert.equal(f.requests[0].body, f.requests[1].body);
});
test('fixture: delete-all fences the queue before awaiting any upload', async () => {
  let release;
  const f = await background({}, async (u, options) => options.method === 'POST' ? new Promise(r => { release = () => r({ ok: true, json: async () => ({ total: 1 }) }); }) : { ok: true, json: async () => ({ deleted: 1 }) });
  await f.send({ type: 'CHAT_DATA', payload: payload(1) }); await f.send({ type: 'SYNC_NOW' });
  await f.send({ type: 'DELETE_ALL_DATA' });
  assert.equal(f.state.enabled, false);
  assert.equal(Object.keys(f.state.conversationCache).length, 0);
  assert.equal(f.requests.length, 1);
  release(); await flush(); await flush();
  assert.equal(f.requests.at(-1).url, 'https://chat-collector.eason.phd/api/my-chats');
  assert.equal(f.requests.at(-1).method, 'DELETE');
});
module.exports = { background, payload, url, flush };
