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
test('unsupported and lookalike sites cannot acquire collection consent', () => {
  for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/g/g-a', 'http://chatgpt.com/c/a', 'https://chatgpt.com.evil.invalid/c/a', 'https://evilchatgpt.com/c/a', 'https://claude.ai/chat/a/settings', 'https://grok.com/c/a', 'https://gemini.google.com/app/a', 'not a URL']) assert.equal(policy.conversationUrl(url), null, url);
});
test('consent is specific to both the account and conversation with a global stop', () => {
  const url = 'https://claude.ai/chat/a';
  const state = { enabled: true, user: { email: 'fixture@example.invalid' }, accessToken: 'fixture-token', conversationConsents: { [url]: 'fixture@example.invalid' } };
  assert.equal(policy.allowed(state, url), true);
  for (const patch of [{ enabled: false }, { accessToken: null }, { user: null }, { user: { email: 'other@example.invalid' } }, { conversationConsents: {} }]) assert.equal(policy.allowed({ ...state, ...patch }, url), false);
  assert.equal(policy.allowed(state, 'https://claude.ai/chat/b'), false);
});
