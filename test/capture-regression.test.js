// SYNTHETIC DOM fixtures, not captured live-site evidence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const source = p => fs.readFileSync(path.join(root, p), 'utf8');
const flush = () => new Promise(r => setImmediate(r));
function fixture(host, html, overrides = {}) {
  const url = `https://${host}/${host === 'claude.ai' ? 'chat' : 'c'}/fixture-a`;
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
module.exports = { fixture, source, flush };
