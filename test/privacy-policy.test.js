// Pure policy fixtures: no browser or account authentication is claimed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/privacy.js'), 'utf8'), context);
const policy = context.PROMPTUTOR_PRIVACY;
test('canonical policy preserves exact supported conversation identity', () => {
  assert.equal(policy.conversationUrl('https://chatgpt.com/c/a/?q=secret#fragment'), 'https://chatgpt.com/c/a');
  assert.equal(policy.conversationUrl('https://chatgpt.com/g/g-a/c/chat-a'), 'https://chatgpt.com/g/g-a/c/chat-a');
  assert.equal(policy.conversationUrl('https://claude.ai/chat/a'), 'https://claude.ai/chat/a');
});
test('anonymous /uc/ conversation identity canonicalizes without admitting sibling paths', () => {
  const url = 'https://chatgpt.com/uc/6ad77208-1270-83ea-8a8c-92576bd4528a';
  assert.equal(policy.conversationUrl(`${url}/?q=private#fragment`), url);
  for (const rejected of ['https://chatgpt.com/', 'https://chatgpt.com/uc', 'https://chatgpt.com/uc/', `${url}/settings`, 'https://chatgpt.com/uc/a/b', 'https://chatgpt.com/ucx/a', 'https://chatgpt.com/g/a/uc/b', 'https://chatgpt.com.evil.invalid/uc/a', 'http://chatgpt.com/uc/a']) {
    assert.equal(policy.conversationUrl(rejected), null, rejected);
  }
});
test('unsupported and lookalike sites cannot acquire collection consent', () => {
  for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/g/g-a', 'http://chatgpt.com/c/a', 'https://chatgpt.com.evil.invalid/c/a', 'https://evilchatgpt.com/c/a', 'https://claude.ai/chat/a/settings', 'https://x.com/i/grok?conversation=a', 'https://grok.com/', 'https://gemini.google.com/', 'not a URL']) assert.equal(policy.conversationUrl(url), null, url);
});
test('anonymous conversation consent still requires its exact owner, token and master switch', () => {
  const url = 'https://chatgpt.com/uc/6ad77208-1270-83ea-8a8c-92576bd4528a';
  const state = { enabled: true, user: { email: ' Fixture@Example.Invalid ' }, accessToken: 'fixture-token', conversationConsents: { [url]: 'fixture@example.invalid' } };
  assert.equal(policy.allowed(state, `${url}?q=private#fragment`), true);
  for (const patch of [{ enabled: false }, { accessToken: null }, { user: null }, { user: { email: 'other@example.invalid' } }, { conversationConsents: {} }, { conversationConsents: { [url.replace('/uc/', '/c/')]: 'fixture@example.invalid' } }]) {
    assert.equal(policy.allowed({ ...state, ...patch }, url), false);
  }
  for (const other of ['https://chatgpt.com/', `${url}-sibling`, url.replace('/uc/', '/c/'), 'https://chat.openai.com/uc/a']) assert.equal(policy.allowed(state, other), false);
});
test('consent is specific to both the account and conversation with a global stop', () => {
  const url = 'https://claude.ai/chat/a';
  const state = { enabled: true, user: { email: 'fixture@example.invalid' }, accessToken: 'fixture-token', conversationConsents: { [url]: 'fixture@example.invalid' } };
  assert.equal(policy.allowed(state, url), true);
  for (const patch of [{ enabled: false }, { accessToken: null }, { user: null }, { user: { email: 'other@example.invalid' } }, { conversationConsents: {} }]) assert.equal(policy.allowed({ ...state, ...patch }, url), false);
  assert.equal(policy.allowed(state, 'https://claude.ai/chat/b'), false);
});

// Gemini/Grok route shapes are RECONSTRUCTED from first-party URL conventions, not retained live captures.
const geminiId = 'a1b2c3d4e5f60718';
const grokId = '3f2b8c1e-5d4a-4e7b-9c10-2a6d8e9f0b1c';
test('Gemini and Grok persisted conversation identities canonicalize exactly', () => {
  assert.equal(policy.conversationUrl(`https://gemini.google.com/app/${geminiId}/?q=secret#frag`), `https://gemini.google.com/app/${geminiId}`);
  assert.equal(policy.conversationUrl(`https://gemini.google.com/gem/gem-a/${geminiId}`), `https://gemini.google.com/gem/gem-a/${geminiId}`);
  assert.equal(policy.conversationUrl(`https://grok.com/c/${grokId}?rid=x#frag`), `https://grok.com/c/${grokId}`);
});
test('Gemini and Grok roots, siblings, non-persisted routes and lookalike hosts are rejected', () => {
  const rejected = ['https://gemini.google.com/', 'https://gemini.google.com/app', 'https://gemini.google.com/app/', `https://gemini.google.com/app/${geminiId}/settings`,
    'https://gemini.google.com/app/download', 'https://gemini.google.com/share/' + geminiId, `https://gemini.google.com/gem/gem-a`, `http://gemini.google.com/app/${geminiId}`,
    `https://gemini.google.com.evil.invalid/app/${geminiId}`, `https://evilgemini.google.com/app/${geminiId}`, `https://google.com/app/${geminiId}`,
    'https://grok.com/', 'https://grok.com/c', 'https://grok.com/c/', `https://grok.com/c/${grokId}/share`, `https://grok.com/chat/${grokId}`, `https://grok.com/g/${grokId}`,
    `http://grok.com/c/${grokId}`, `https://grok.com.evil.invalid/c/${grokId}`, `https://www.grok.com/c/${grokId}`, `https://x.com/i/grok?conversation=${grokId}`, `https://x.com/c/${grokId}`];
  for (const value of rejected) assert.equal(policy.conversationUrl(value), null, value);
});
test('platform label derives from the canonical host', () => {
  assert.equal(policy.platform(`https://gemini.google.com/app/${geminiId}`), 'gemini');
  assert.equal(policy.platform(`https://grok.com/c/${grokId}`), 'grok');
  assert.equal(policy.platform('https://claude.ai/chat/a'), 'claude');
  assert.equal(policy.platform('https://chatgpt.com/c/a'), 'chatgpt');
  assert.equal(policy.platform('https://chat.openai.com/c/a'), 'chatgpt');
  assert.equal(policy.platform('https://gemini.google.com/'), null);
  assert.equal(policy.platform('https://evil.invalid/app/' + geminiId), null);
});
test('Gemini and Grok consent requires exact owner, token, master switch and conversation', () => {
  for (const url of [`https://gemini.google.com/app/${geminiId}`, `https://grok.com/c/${grokId}`]) {
    const state = { enabled: true, user: { email: 'Fixture@Example.Invalid' }, accessToken: 'fixture-token', conversationConsents: { [url]: 'fixture@example.invalid' } };
    assert.equal(policy.allowed(state, `${url}?x=1#y`), true);
    for (const patch of [{ enabled: false }, { accessToken: null }, { user: null }, { user: { email: 'other@example.invalid' } }, { conversationConsents: {} }]) assert.equal(policy.allowed({ ...state, ...patch }, url), false);
    assert.equal(policy.allowed(state, url.replace(/.$/, c => c === '8' ? '9' : '8')), false);
    assert.equal(policy.allowed(state, new URL(url).origin + '/'), false);
  }
});
