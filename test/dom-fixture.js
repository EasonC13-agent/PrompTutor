// Shared SYNTHETIC jsdom fixture harness (not a test file; not matched by the test glob).
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
module.exports = { fixture, source, flush };
