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
  assert.equal(f.state.pendingDeletions[receiptKey('fixture@example.invalid')], 'fixture@example.invalid');
  succeed = true;
  await f.send({ type: 'SYNC_NOW' }); await flush();
  assert.equal(f.state.pendingDeletions[receiptKey('fixture@example.invalid')], undefined);
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
function installRefresh(f, duringRefresh = async () => {}) {
  let calls = 0;
  f.context.chrome.runtime.getManifest = () => ({ oauth2: { client_id: 'fixture-client', scopes: ['openid', 'email'] } });
  f.context.chrome.identity = {
    getRedirectURL: () => 'https://fixture.chromiumapp.org/',
    launchWebAuthFlow: async ({ url: authUrl }) => {
      calls++; await duringRefresh();
      return `https://fixture.chromiumapp.org/#access_token=fresh-token&state=${new URL(authUrl).searchParams.get('state')}`;
    }
  };
  return () => calls;
}
const refreshedResponse = (u, options, posts) => u.includes('googleapis.com')
  ? { ok: true, json: async () => ({ email: 'fixture@example.invalid' }) }
  : { ok: posts > 1, status: posts > 1 ? 200 : 401, json: async () => ({ total: 1, deleted: 1 }) };
test('fixture: batch 401 refreshes authentication and retries the exact upload', async () => {
  let posts = 0;
  const f = await background({}, async (u, o) => refreshedResponse(u, o, u.includes('googleapis.com') ? posts : ++posts));
  const refreshes = installRefresh(f);
  await f.send({ type: 'CHAT_DATA', payload: payload(1) });
  await f.send({ type: 'SYNC_NOW' }); await flush();
  assert.equal(refreshes(), 1);
  const uploads = f.requests.filter(r => r.method === 'POST');
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].body, uploads[1].body);
  assert.equal(uploads[1].headers.Authorization, 'Bearer fresh-token');
  assert.equal(f.state.conversationCache[url].messages.length, 0);
});
for (const all of [false, true]) test(`fixture: ${all ? 'all-data' : 'conversation'} deletion refreshes while disabled`, async () => {
  let deletes = 0;
  const f = await background({ enabled: false }, async (u, o) => refreshedResponse(u, o, u.includes('googleapis.com') ? deletes : ++deletes));
  const refreshes = installRefresh(f);
  await f.send(all ? { type: 'DELETE_ALL_DATA' } : { type: 'SET_CONVERSATION_CONSENT', url, granted: false });
  await flush();
  assert.equal(refreshes(), 1);
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 2);
  assert.equal(Object.keys(f.state.pendingDeletions).length, 0);
});
for (const mutation of ['revoke', 'account', 'account-aba', 'consent-aba', 'token-revoked', 'pending-delete-aba']) test(`fixture: upload refresh fences ${mutation}`, async () => {
  const f = await background({}, async (u) => u.includes('googleapis.com')
    ? { ok: true, json: async () => ({ email: 'fixture@example.invalid' }) } : { ok: false, status: 401 });
  const refreshes = installRefresh(f, async () => {
    if (mutation.startsWith('account')) {
      await f.change({ user: { email: 'other@example.invalid' }, accessToken: 'other-token' });
      if (mutation === 'account-aba') await f.change({ user: { email: 'fixture@example.invalid' }, accessToken: 'replacement-token' });
    } else if (mutation === 'token-revoked') {
      await f.change({ accessToken: null });
    } else if (mutation === 'pending-delete-aba') {
      await f.change({ pendingDeletions: { [receiptKey('fixture@example.invalid')]: 'fixture@example.invalid' } });
      await f.change({ pendingDeletions: {} });
    } else {
      await f.change({ conversationConsents: {} });
      if (mutation === 'consent-aba') await f.change({ conversationConsents: { [url]: 'fixture@example.invalid' } });
    }
  });
  await f.send({ type: 'CHAT_DATA', payload: payload(1) });
  await vm.runInContext('syncAllCachedData()', f.context);
  assert.equal(refreshes(), 1);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  if (mutation.startsWith('account')) assert.notEqual(f.state.accessToken, 'fresh-token');
});
const receiptKey = (owner, conversation = url) => JSON.stringify([owner, conversation]);
for (const sameUrl of [false, true]) test(`fixture: foreign receipt cannot block current account upload (${sameUrl ? 'same' : 'different'} URL)`, async () => {
  const a = 'account-a@example.invalid', b = 'fixture@example.invalid';
  const f = await background({ pendingDeletions: { [url]: a } });
  const target = sameUrl ? url : 'https://chatgpt.com/c/fixture-b';
  const sender = { tab: { url: target } };
  const grant = await f.send({ type: 'SET_CONVERSATION_CONSENT', url: target, granted: true }, sender);
  assert.equal(grant.success, true);
  await f.send({ type: 'CHAT_DATA', payload: { ...payload(1), url: target } }, sender);
  await vm.runInContext('syncAllCachedData()', f.context);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0);
  assert.equal(f.state.pendingDeletions[receiptKey(a)], a);
  assert.notEqual(a, b);
});
test('fixture: startup migrates canonical owner receipts and retries only original owner', async () => {
  const owner = 'fixture@example.invalid';
  const f = await background({ enabled: false, pendingDeletions: { [`${url}/?legacy=1`]: owner } });
  assert.deepEqual(f.state.pendingDeletions, { [receiptKey(owner)]: owner });
  await f.change({ user: null, accessToken: null });
  await vm.runInContext('syncAllCachedData()', f.context);
  assert.equal(f.requests.length, 0);
  assert.equal(f.state.pendingDeletions[receiptKey(owner)], owner);
  await f.change({ user: { email: owner }, accessToken: 'original-owner-token' });
  await vm.runInContext('syncAllCachedData()', f.context);
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.parse(f.requests[0].body).url, url);
  assert.equal(Object.keys(f.state.pendingDeletions).length, 0);
});
test('fixture: same-URL deletion receipts coexist across owners', async () => {
  const a = 'account-a@example.invalid', b = 'fixture@example.invalid';
  const f = await background({ pendingDeletions: { [url]: a } }, async () => ({ ok: false, status: 503 }));
  await f.send({ type: 'SET_CONVERSATION_CONSENT', url, granted: false });
  assert.deepEqual(f.state.pendingDeletions, { [receiptKey(a)]: a, [receiptKey(b)]: b });
});
test('fixture: deletion and concurrent sync share serialized network work', async () => {
  let release;
  const owner = 'fixture@example.invalid', other = 'https://chatgpt.com/c/fixture-b';
  const f = await background({ conversationConsents: { [url]: owner, [other]: owner } }, async (u, o) => o.method === 'DELETE'
    ? new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ deleted: 1 }) }); })
    : { ok: true, json: async () => ({ total: 1 }) });
  await f.send({ type: 'CHAT_DATA', payload: { ...payload(1), url: other } }, { tab: { url: other } });
  await f.send({ type: 'SET_CONVERSATION_CONSENT', url, granted: false });
  await f.send({ type: 'SYNC_NOW' });
  await f.send({ type: 'SYNC_NOW' });
  assert.equal(f.requests.length, 1, 'sync must wait behind the already active deletion');
  release(); await flush(); await flush();
  await vm.runInContext('syncAllCachedData()', f.context);
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});
test('fixture: stale account 401 cannot start a refresh for the replacement account', async () => {
  let rejectUpload;
  const f = await background({}, async () => new Promise(resolve => { rejectUpload = () => resolve({ ok: false, status: 401 }); }));
  const refreshes = installRefresh(f);
  await f.send({ type: 'CHAT_DATA', payload: payload(1) });
  await f.send({ type: 'SYNC_NOW' });
  await f.change({ user: { email: 'other@example.invalid' }, accessToken: 'other-token' });
  rejectUpload(); await flush();
  assert.equal(refreshes(), 0);
});
for (const all of [false, true]) test(`fixture: ${all ? 'all-data' : 'conversation'} refresh account change retains original receipts`, async () => {
  const owner = 'fixture@example.invalid';
  const f = await background({ enabled: false }, async u => u.includes('googleapis.com')
    ? { ok: true, json: async () => ({ email: owner }) } : { ok: false, status: 401 });
  const refreshes = installRefresh(f, () => f.change({ user: { email: 'other@example.invalid' }, accessToken: 'other-token' }));
  await vm.runInContext(all ? 'deleteAllData()' : `setConversationConsent({ url: ${JSON.stringify(url)}, granted: false }, { tab: { url: ${JSON.stringify(url)} } })`, f.context);
  assert.equal(refreshes(), 1);
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1);
  assert.equal(f.state.pendingDeletions[receiptKey(owner)], owner);
  assert.equal(f.state.accessToken, 'other-token');
});
test('fixture: failed deletion queue retains receipts and unsent batches until retry succeeds', async () => {
  const owner = 'fixture@example.invalid', other = 'https://chatgpt.com/c/fixture-b';
  let failing = true;
  const f = await background({ pendingDeletions: { [url]: owner }, conversationConsents: { [other]: owner } }, async (u, o) => ({
    ok: o.method !== 'DELETE' || !failing, status: failing ? 503 : 200, json: async () => ({ total: 1 })
  }));
  await f.send({ type: 'CHAT_DATA', payload: { ...payload(1), url: other } }, { tab: { url: other } });
  const run = () => vm.runInContext('syncAllCachedData()', f.context);
  await Promise.all([run(), run()]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.pendingDeletions[receiptKey(owner)], owner);
  assert.equal(f.state.conversationCache[other].messages.length, 1);
  failing = false;
  await run();
  assert.deepEqual(f.requests.map(r => r.method), ['DELETE', 'DELETE', 'POST']);
  assert.equal(f.state.conversationCache[other].messages.length, 0);
  assert.equal(Object.keys(f.state.pendingDeletions).length, 0);
});
test('fixture: delete-all clears only current account receipts', async () => {
  const a = 'account-a@example.invalid', b = 'fixture@example.invalid';
  const f = await background({ pendingDeletions: { [receiptKey(a)]: a, [receiptKey(b)]: b } });
  await vm.runInContext('deleteAllData()', f.context);
  assert.deepEqual(f.state.pendingDeletions, { [receiptKey(a)]: a });
});
for (const type of ['LOG_GUIDANCE', 'DETECT']) for (const all of [false, true]) test(`fixture: ${type} settles before ${all ? 'all-data' : 'conversation'} deletion`, async () => {
  let release, rows = 0;
  const f = await background({}, async (u, o) => {
    if (o.method === 'POST') return new Promise(resolve => { release = () => { rows++; resolve({ ok: true, json: async () => ({ success: true }) }); }; });
    rows = 0;
    return { ok: true, json: async () => ({ deleted: 1 }) };
  });
  await f.send({ type, url, message: 'old prompt', originalMessage: 'old prompt' });
  const deletion = vm.runInContext(all ? 'deleteAllData()' : `setConversationConsent({url:${JSON.stringify(url)},granted:false},{tab:{url:${JSON.stringify(url)}}})`, f.context);
  await flush();
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0, 'deletion must wait for admitted content request');
  release();
  assert.equal((await deletion).success, true);
  assert.equal(rows, 0, 'no late guidance resurrection');
});
for (const type of ['LOG_GUIDANCE', 'DETECT']) {
  for (const mutation of ['consent-aba', 'account-aba', 'pending-delete-aba', 'enabled-aba']) test(`fixture: ${type} refresh fences ${mutation}`, async () => {
    const f = await background({}, async (u, o) => u.includes('googleapis.com')
      ? { ok: true, json: async () => ({ email: 'fixture@example.invalid' }) }
      : o.method === 'DELETE' ? { ok: true, json: async () => ({ deleted: 0 }) } : { ok: false, status: 401 });
    installRefresh(f, async () => {
      if (mutation === 'account-aba') {
        await f.change({ user: { email: 'other@example.invalid' }, accessToken: 'other-token' });
        await f.change({ user: { email: 'fixture@example.invalid' }, accessToken: 'fixture-token', conversationConsents: { [url]: 'fixture@example.invalid' } });
      } else if (mutation === 'pending-delete-aba') {
        await f.change({ pendingDeletions: { [receiptKey('fixture@example.invalid')]: 'fixture@example.invalid' } });
        await f.change({ pendingDeletions: {} });
      } else if (mutation === 'enabled-aba') {
        await f.change({ enabled: false });
        await f.change({ enabled: true, conversationConsents: { [url]: 'fixture@example.invalid' } });
      } else {
        await f.change({ conversationConsents: {} });
        await f.change({ conversationConsents: { [url]: 'fixture@example.invalid' } });
      }
    });
    await vm.runInContext(`${type === 'DETECT' ? 'handleDetect' : 'handleLogGuidance'}(${JSON.stringify({ url, message: 'old prompt', originalMessage: 'old prompt' })})`, f.context);
    assert.equal(f.requests.filter(r => r.method === 'POST').length, 1, 'old prompt cannot be resent after refresh');
  });
  test(`fixture: queued ${type} preserves original admission generation`, async () => {
    const f = await background();
    let release;
    f.context.hold = new Promise(resolve => { release = resolve; });
    vm.runInContext('serializeNetwork(() => hold)', f.context);
    const work = vm.runInContext(`${type === 'DETECT' ? 'handleDetect' : 'handleLogGuidance'}(${JSON.stringify({ url, message: 'old prompt', originalMessage: 'old prompt' })})`, f.context);
    await f.change({ conversationConsents: {} });
    await f.change({ conversationConsents: { [url]: 'fixture@example.invalid' } });
    release(); await work;
    assert.equal(f.requests.length, 0);
  });
}
test('fixture: DETECT completion discards stale JSON after consent ABA', async () => {
  let release;
  const f = await background({}, async () => ({ ok: true, json: () => new Promise(resolve => { release = () => resolve({ guidance: 'stale result' }); }) }));
  const work = vm.runInContext(`handleDetect({url:${JSON.stringify(url)},message:'old prompt'})`, f.context);
  await flush();
  await f.change({ conversationConsents: {} });
  await f.change({ conversationConsents: { [url]: 'fixture@example.invalid' } });
  release();
  assert.equal(await work, null);
});
for (const mutation of ['revoke-delete-regrant', 'account-aba']) test(`fixture: hashing capture fences ${mutation}`, async () => {
  const f = await background();
  let release;
  f.context.crypto = { subtle: { digest: (...args) => new Promise(resolve => { release = async () => resolve(await webcrypto.subtle.digest(...args)); }) } };
  const capture = vm.runInContext(`handleChatData(${JSON.stringify(payload(1))},${JSON.stringify(url)})`, f.context);
  assert.equal(typeof release, 'function');
  if (mutation === 'account-aba') {
    await f.change({ user: { email: 'other@example.invalid' } });
    await f.change({ user: { email: 'fixture@example.invalid' } });
    await f.change({ conversationConsents: { [url]: 'fixture@example.invalid' } });
  } else {
    await vm.runInContext(`setConversationConsent({url:${JSON.stringify(url)},granted:false},{tab:{url:${JSON.stringify(url)}}})`, f.context);
    await vm.runInContext(`setConversationConsent({url:${JSON.stringify(url)},granted:true},{tab:{url:${JSON.stringify(url)}}})`, f.context);
  }
  await release();
  assert.equal(await capture, false, 'old capture remains revoked even if current consent is restored');
  await vm.runInContext('syncAllCachedData()', f.context);
  assert.equal(f.state.conversationCache[url], undefined);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
});
test('fixture: in-memory consent changes fence capture before storage change notifications', async () => {
  const f = await background();
  let release;
  f.context.crypto = { subtle: { digest: (...args) => new Promise(resolve => { release = async () => resolve(await webcrypto.subtle.digest(...args)); }) } };
  f.context.chrome.storage.local.set = async () => {}; // onChanged may arrive later than the storage promise.
  const capture = vm.runInContext(`handleChatData(${JSON.stringify(payload(1))},${JSON.stringify(url)})`, f.context);
  for (const granted of [false, true]) await vm.runInContext(`setConversationConsent({url:${JSON.stringify(url)},granted:${granted}},{tab:{url:${JSON.stringify(url)}}})`, f.context);
  await release();
  assert.equal(await capture, false);
});
module.exports = { background, payload, url, flush };
