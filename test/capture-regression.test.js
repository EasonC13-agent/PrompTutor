// SYNTHETIC DOM fixtures, not captured live-site evidence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const source = p => fs.readFileSync(path.join(root, p), 'utf8');
const flush = () => new Promise(r => setImmediate(r));
function fixture(host, html, overrides = {}, route) {
  const url = route || `https://${host}/${host === 'claude.ai' ? 'chat' : 'c'}/fixture-a`;
  const dom = new JSDOM(`<main>${html}</main>`, { url, runScripts: 'outside-only' });
  const sent = [], timers = new Map(), intervals = new Map(), listeners = []; let timerId = 0;
  const state = { enabled: true, accessToken: 'fixture-token', user: { email: 'fixture@example.invalid' }, conversationConsents: { [url]: 'fixture@example.invalid' }, ...overrides };
  Object.assign(dom.window, {
    console: { log() {}, error() {} }, navigation: new dom.window.EventTarget(),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id),
    chrome: { storage: { local: { get: (keys, cb) => { cb?.(structuredClone(state)); return Promise.resolve(structuredClone(state)); } }, onChanged: { addListener: fn => listeners.push(fn) } }, runtime: { id: 'fixture', sendMessage: (m, cb) => { sent.push(m); cb?.({ accepted: true }); } } }
  });
  if (fs.existsSync(path.join(root, 'src/privacy.js'))) dom.window.eval(source('src/privacy.js'));
  dom.window.eval(source('src/content/dom-parser.js'));
  return { dom, sent, state, url, async start() { dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded')); await flush(); const batch = [...timers.values()]; timers.clear(); for (const fn of batch) await fn(); await flush(); },
    async tick() { for (const fn of [...intervals.values()]) await fn(); await flush(); const batch = [...timers.values()]; timers.clear(); for (const fn of batch) await fn(); await flush(); },
    async change(values) { const changes = {}; for (const [k,v] of Object.entries(values)) { changes[k] = { oldValue: state[k], newValue: v }; state[k] = v; } listeners.forEach(fn => fn(changes, 'local')); await flush(); }
  };
}
test('fixture: global enable does not consent to every conversation', async () => {
  const f = fixture('chatgpt.com', '<div data-message-author-role="user">private</div>', { conversationConsents: {} });
  await f.start(); assert.equal(f.sent.length, 0);
});
test('fixture: Claude role roots without render wrappers preserve all text exactly once', async () => {
  const f = fixture('claude.ai', `<div data-testid="user-message"><p>Question one</p><p>Question two</p></div><div data-testid="assistant-message"><div class="font-claude-response"><p>Answer one</p><p>Answer two</p></div><button>Copy</button></div>`);
  await f.start();
  assert.ok(f.sent.length);
  const messages = f.sent[0].payload.fullConversation;
  assert.deepEqual(Array.from(messages, m => m.role), ['user', 'assistant']);
  assert.match(messages[0].content, /Question one\s+Question two/);
  assert.match(messages[1].content, /Answer one\s+Answer two/);
  assert.doesNotMatch(messages[1].content, /Copy/);
});
test('fixture: repeated turns and role changes are not lost to content-only deduplication', async () => {
  const turn = '<div data-message-author-role="user">Repeat</div><div data-message-author-role="assistant"><div class="markdown">Same answer</div></div>';
  const f = fixture('chatgpt.com', turn); await f.start();
  const before = f.sent.length;
  f.dom.window.document.querySelector('main').insertAdjacentHTML('beforeend', turn);
  await f.tick();
  assert.ok(f.sent.length > before, 'repeated turn must trigger update');
  assert.equal(f.sent.at(-1).payload.messages.length, 4, 'send coherent full snapshot');
});
test('fixture: all scans suppress active streaming and collect its final text', async () => {
  const f = fixture('chatgpt.com', '<div data-message-author-role="user">Question</div><div data-message-author-role="assistant" data-stream-active="true"><div class="markdown">Partial</div></div>');
  await f.start(); await f.tick(); assert.equal(f.sent.length, 0);
  const response = f.dom.window.document.querySelector('[data-stream-active]');
  response.setAttribute('data-stream-active', 'false'); response.querySelector('.markdown').textContent = 'Complete';
  await f.tick(); assert.equal(f.sent.at(-1).payload.messages[1].content, 'Complete');
});
test('fixture: SPA route change never relabels stale DOM as the next consented chat', async () => {
  const f = fixture('chatgpt.com', '<div data-message-author-role="user">Old chat</div>'); await f.start();
  const nextUrl = 'https://chatgpt.com/c/fixture-b';
  await f.change({ conversationConsents: { [f.url]: 'fixture@example.invalid', [nextUrl]: 'fixture@example.invalid' } });
  const count = f.sent.length;
  f.dom.window.history.pushState({}, '', nextUrl);
  f.dom.window.document.querySelector('[data-message-author-role]').textContent = 'Old chat late mutation';
  await f.tick();
  assert.equal(f.sent.length, count, 'old nodes cannot be retagged');
  f.dom.window.document.querySelector('main').innerHTML = '<div data-message-author-role="user">New chat</div>';
  await f.tick();
  assert.equal(f.sent.at(-1).payload.url, nextUrl);
  assert.equal(f.sent.at(-1).payload.messages[0].content, 'New chat');
});
test('fixture: a rejected background handoff is retried without requiring DOM changes', async () => {
  const f = fixture('chatgpt.com', '<div data-message-author-role="user">Retry me</div>');
  let accepted = false;
  f.dom.window.chrome.runtime.sendMessage = (message, callback) => { f.sent.push(message); callback({ accepted }); };
  await f.start(); const count = f.sent.length; accepted = true;
  await f.tick(); assert.ok(f.sent.length > count);
});
// Reconstructed regression fixture, NOT a live capture. Structural/text anchors from
// browser-qa/unsigned-live-20261020/r3/evidence/{03-after-send,04-policy-dom-pin}.json:
// ol[aria-label=Conversation], direct li turns, role labels and assistant DIL section.
// Heading element tags and live streaming markers were not retained by that receipt;
// use plain label text here rather than inventing platform attributes/classes.
const unsignedUrl = 'https://chatgpt.com/uc/6ad77208-1270-83ea-8a8c-92576bd4528a';
const unsignedPrompt = 'Harmless extension acceptance test PROMPTUTOR_UNSIGNED_LIVE_20261020_R3_1358. Reply with exactly: Test acknowledged.';
const unsignedUser = `<li id="186fa031-9b82-4684-84d2-a3c4b7c3588f">You said:\n\n<div><div><div><div><p>${unsignedPrompt}</p></div></div></div></div></li>`;
const unsignedAssistant = '<li>ChatGPT said:\n\n<div><div><div><div><div><div><section aria-label="DIL content"><p>Test acknowledged.</p></section></div></div></div></div></div></div></li>';
const unsignedList = turns => `<ol aria-label="Conversation">${turns}</ol>`;
function unsignedFixture(turns, overrides = {}) {
  return fixture('chatgpt.com', unsignedList(turns), overrides, unsignedUrl);
}
test('evidence-derived fixture: unsigned ChatGPT extracts role-aware user and assistant content', async () => {
  const f = unsignedFixture(unsignedUser + unsignedAssistant);
  await f.start();
  assert.ok(f.sent.length, 'observed anonymous conversation must be parsed');
  assert.deepEqual(Array.from(f.sent.at(-1).payload.messages, m => [m.role, m.content]), [
    ['user', unsignedPrompt], ['assistant', 'Test acknowledged.']
  ]);
  assert.equal(f.sent.at(-1).payload.url, unsignedUrl, 'never rewrite anonymous identity to /c/');
});
test('evidence-derived fixture: anonymous navigation cannot relabel connected stale turns', async () => {
  const f = unsignedFixture(unsignedUser + unsignedAssistant); await f.start();
  const nextUrl = 'https://chatgpt.com/uc/next-fixture';
  await f.change({ conversationConsents: { [unsignedUrl]: 'fixture@example.invalid', [nextUrl]: 'fixture@example.invalid' } });
  const count = f.sent.length;
  f.dom.window.history.pushState({}, '', nextUrl);
  f.dom.window.document.querySelector('p').textContent = 'Old chat late mutation';
  await f.tick();
  assert.equal(f.sent.length, count, 'connected old list turns must block collection on the next route');
  f.dom.window.document.querySelector('main').innerHTML = unsignedList(unsignedUser.replace(unsignedPrompt, 'New anonymous chat'));
  await f.tick();
  assert.equal(f.sent.at(-1).payload.url, nextUrl);
  assert.equal(f.sent.at(-1).payload.messages[0].content, 'New anonymous chat');
});
test('evidence-derived fixture: user text and nested list items are never inferred as assistant turns', async () => {
  const prompt = '<li>You said:\n\n<div><p>ChatGPT said: is quoted user text</p><section aria-label="DIL content"><p>Also user text</p></section><ul><li>Nested list text</li></ul></div></li>';
  const f = unsignedFixture(prompt + '<li>Unrecognized role<section aria-label="DIL content"><p>Not an assistant</p></section></li><li>ChatGPT said: but no DIL section</li>');
  f.dom.window.document.querySelector('main').insertAdjacentHTML('beforeend', '<ul><li>ChatGPT said:<section aria-label="DIL content">Unrelated list</section></li></ul>');
  await f.start();
  const messages = f.sent.at(-1).payload.messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.match(messages[0].content, /^ChatGPT said: is quoted user text/);
  assert.match(messages[0].content, /Also user text\s+Nested list text/);
});
test('evidence-derived fixture: repeated anonymous turns preserve order and unchanged snapshots deduplicate', async () => {
  const f = unsignedFixture(unsignedUser + unsignedAssistant); await f.start();
  const count = f.sent.length; await f.tick(); assert.equal(f.sent.length, count);
  f.dom.window.document.querySelector('ol').insertAdjacentHTML('beforeend', unsignedUser + unsignedAssistant);
  await f.tick();
  assert.deepEqual(Array.from(f.sent.at(-1).payload.messages, m => [m.role, m.content]), [
    ['user', unsignedPrompt], ['assistant', 'Test acknowledged.'], ['user', unsignedPrompt], ['assistant', 'Test acknowledged.']
  ]);
});
test('evidence-derived fixture: delayed anonymous assistant is collected after a user-only snapshot', async () => {
  const f = unsignedFixture(unsignedUser); await f.start();
  assert.deepEqual(Array.from(f.sent.at(-1).payload.messages, m => m.role), ['user']);
  f.dom.window.document.querySelector('ol').insertAdjacentHTML('beforeend', unsignedAssistant);
  await f.tick();
  assert.deepEqual(Array.from(f.sent.at(-1).payload.messages, m => m.role), ['user', 'assistant']);
});
test('fixture variant: anonymous list parsing retains existing ChatGPT streaming suppression', async () => {
  // Synthetic marker variant: the real completed-page receipt has no live streaming marker.
  const f = unsignedFixture(unsignedUser + unsignedAssistant);
  const section = f.dom.window.document.querySelector('section');
  section.setAttribute('data-stream-active', '');
  await f.start(); await f.tick(); assert.equal(f.sent.length, 0);
  section.setAttribute('data-stream-active', 'null');
  await f.tick(); assert.equal(f.sent.at(-1).payload.messages[1].content, 'Test acknowledged.');
  const count = f.sent.length;
  section.querySelector('p').textContent = 'Next final answer';
  f.dom.window.document.querySelector('main').insertAdjacentHTML('beforeend', '<button data-testid="stop-button">Stop</button>');
  await f.tick(); assert.equal(f.sent.length, count);
  f.dom.window.document.querySelector('button').remove();
  await f.tick(); assert.equal(f.sent.at(-1).payload.messages[1].content, 'Next final answer');
});
test('evidence-derived fixture: anonymous collection remains owner-consented and stops on revoke/account switch', async () => {
  for (const overrides of [{ conversationConsents: {} }, { user: { email: 'other@example.invalid' } }, { accessToken: null }, { enabled: false }]) {
    const denied = unsignedFixture(unsignedUser + unsignedAssistant, overrides);
    await denied.start(); await denied.tick(); assert.equal(denied.sent.length, 0);
  }
  const f = unsignedFixture(unsignedUser + unsignedAssistant); await f.start();
  const count = f.sent.length;
  await f.change({ conversationConsents: {} });
  f.dom.window.document.querySelector('p').textContent = 'Revoked edit';
  await f.tick(); assert.equal(f.sent.length, count);
  await f.change({ user: { email: 'other@example.invalid' }, conversationConsents: { [unsignedUrl]: 'fixture@example.invalid' } });
  await f.tick(); assert.equal(f.sent.length, count);
});
test('evidence-derived fixture: navigating to root or an unconsented anonymous sibling fails closed', async () => {
  for (const destination of ['https://chatgpt.com/', 'https://chatgpt.com/uc/unconsented-sibling']) {
    const f = unsignedFixture(unsignedUser + unsignedAssistant); await f.start();
    const count = f.sent.length;
    f.dom.window.history.pushState({}, '', destination);
    f.dom.window.document.querySelector('main').innerHTML = unsignedList(unsignedUser + unsignedAssistant);
    await f.tick(); assert.equal(f.sent.length, count);
  }
});
module.exports = { fixture, source, flush };
