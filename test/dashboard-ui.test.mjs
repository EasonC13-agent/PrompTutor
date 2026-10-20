import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from '../backend/node_modules/jsdom/lib/api.js';
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const ok = body => ({ ok: true, status: 200, json: async () => body });
function page(t, kind, responder, signedIn = true) {
  const base = new URL(`../src/${kind}/`, import.meta.url);
  const dom = new JSDOM(fs.readFileSync(new URL(`${kind}.html`, base), 'utf8'), { runScripts: 'outside-only', url: 'https://extension.test/' });
  const w = dom.window, calls = [], timers = [];
  const storage = { accessToken: signedIn ? 'test-token' : null, apiEndpoint: 'http://localhost:3456' };
  const listeners = [];
  w.chrome = { storage: { onChanged: { addListener(fn) { listeners.push(fn); } }, local: { async get() { return { ...storage }; } } } };
  w.AbortController = AbortController;
  w.AbortSignal = AbortSignal;
  w.fetch = async (url, options) => { calls.push({ url, options }); return responder(url, options); };
  w.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  w.clearInterval = () => {};
  w.eval(fs.readFileSync(new URL(`${kind}.js`, base), 'utf8'));
  t.after(() => dom.window.close());
  return { w, calls, timers, storage, change(values) {
    const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: storage[key], newValue }]));
    Object.assign(storage, values);
    for (const fn of listeners) fn(changes, 'local');
  }, el: id => w.document.getElementById(id) };
}
const stats = { totalLogs: 6, totalUsers: 1, byPlatform: [], latestCapturedAt: '2026-05-09T00:43:30Z' };

test('admin refreshes stats and current filtered page every 15 seconds with bearer auth', async t => {
  let total = 6;
  const p = page(t, 'admin', url => ok(url.includes('/stats') ? { ...stats, totalLogs: total } : { logs: [], total }));
  await flush();
  assert.equal(p.timers.length, 1);
  assert.equal(p.timers[0].ms, 15000);
  total = 7; await p.timers[0].fn(); await flush();
  assert.equal(p.el('statTotal').textContent, '7');
  assert.ok(p.el('statLatest').textContent.includes('2026'));
  assert.ok(p.el('refreshStatus').textContent.includes('Updated'));
  assert.ok(p.calls.every(c => c.options.headers.Authorization === 'Bearer test-token' && c.options.cache === 'no-store'));
});

test('admin recovers from errors and retains data during temporary failures', async t => {
  let broken = false;
  const p = page(t, 'admin', url => broken ? { ok: false, status: 500 } : ok(url.includes('/stats') ? stats : { logs: [], total: 0 }));
  await flush(); broken = true;
  await p.w.refreshDashboard(); await flush();
  assert.equal(p.el('statTotal').textContent, '6');
  assert.ok(!p.el('error').classList.contains('hidden'));
  broken = false; await p.w.refreshDashboard(); await flush();
  assert.ok(p.el('error').classList.contains('hidden'));
});

test('admin pagination preserves filter during refresh and resets an out-of-range page', async t => {
  let total = 100;
  const p = page(t, 'admin', url => ok(url.includes('/stats') ? stats : { logs: [], total }));
  await flush();
  p.el('filterPlatform').value = 'claude'; p.el('applyFilter').click(); await flush();
  p.el('nextBtn').disabled = false; p.el('nextBtn').click(); await flush();
  assert.match(p.calls.at(-1).url, /offset=50/);
  assert.match(p.calls.at(-1).url, /platform=claude/);
  total = 1; await p.w.refreshDashboard(); await flush();
  assert.ok(p.calls.some(c => c.url.includes('offset=0') && c.url.includes('platform=claude')));
  assert.equal(p.el('prevBtn').disabled, true);
});

test('admin authorization errors clear private rows and stats', async t => {
  let forbidden = false;
  const p = page(t, 'admin', url => forbidden ? { ok: false, status: 403 } : ok(url.includes('/stats') ? stats : { logs: [{ id: 1, message_text: 'private' }], total: 1 }));
  await flush(); assert.match(p.el('logsBody').textContent, /private/);
  forbidden = true; await p.w.refreshDashboard(); await flush();
  assert.ok(!p.el('logsBody').textContent.includes('private'));
  assert.equal(p.el('statTotal').textContent, '—');
});

test('user refreshes existing conversation messages and preserves expansion without duplicates', async t => {
  let answer = 'first answer';
  const p = page(t, 'view', () => ok({ total: 1, logs: [{ chat_id: null, url: 'https://claude.ai/chat/one', platform: 'claude', message_count: 1, messages: [{ message_text: 'question', assistant_response: answer }] }] }));
  await flush(); p.w.document.querySelector('.chat-header').click(); await flush();
  assert.match(p.el('chatList').textContent, /first answer/);
  assert.equal(p.timers.length, 1);
  answer = 'updated answer'; await p.timers[0].fn(); await flush();
  assert.equal(p.w.document.querySelectorAll('.chat-item').length, 1);
  assert.ok(p.w.document.querySelector('.chat-item').classList.contains('expanded'));
  assert.match(p.el('chatList').textContent, /updated answer/);
  assert.match(p.calls[0].url, /includeData=1/);
});

test('user load more and periodic refresh preserve loaded pages, then remove deleted data', async t => {
  let count = 21;
  const p = page(t, 'view', url => { const q = new URL(url).searchParams; const offset = Number(q.get('offset')); return ok({ total: count, logs: Array.from({ length: Math.min(20, Math.max(0, count - offset)) }, (_, i) => ({ chat_id: String(offset + i), url: String(offset + i), message_count: 1, messages: [] })) }); });
  await flush(); p.el('loadMoreBtn').click(); await flush();
  assert.equal(p.w.document.querySelectorAll('.chat-item').length, 21);
  await p.w.refreshChats(); await flush();
  assert.equal(p.w.document.querySelectorAll('.chat-item').length, 21);
  count = 0; await p.w.refreshChats(); await flush();
  assert.match(p.el('chatList').textContent, /No data/);
  assert.equal(p.el('loadMore').style.display, 'none');
});

test('user view still loads details from the existing backend without includeData support', async t => {
  const p = page(t, 'view', url => ok(url.includes('/api/chat/') ? [{ message_text: 'legacy question', assistant_response: 'legacy answer' }] : { total: 1, logs: [{ chat_id: 'one', platform: 'claude', message_count: 1 }] }));
  await flush(); p.w.document.querySelector('.chat-header').click(); await flush();
  assert.match(p.el('chatList').textContent, /legacy answer/);
  assert.ok(p.calls.some(call => call.url.endsWith('/api/chat/one')));
});

test('user errors recover, auth failure clears data, and fresh credentials are read on retry', async t => {
  let status = 200;
  const p = page(t, 'view', () => status === 200 ? ok({ total: 1, logs: [{ chat_id: 'a', platform: 'claude', messages: [{ message_text: 'private question' }] }] }) : { ok: false, status });
  await flush(); status = 500; await p.w.refreshChats();
  assert.match(p.el('chatList').textContent, /private question/);
  status = 401; await p.w.refreshChats();
  assert.ok(!p.el('chatList').textContent.includes('private question'));
  p.storage.accessToken = 'new-token'; status = 200; await p.w.refreshChats();
  assert.equal(p.calls.at(-1).options.headers.Authorization, 'Bearer new-token');
  assert.equal(p.el('error').style.display, 'none');
});

test('dashboard data is rendered as text, not executable markup', async t => {
  const payload = '<img src=x onerror=alert(1)>';
  const p = page(t, 'view', () => ok({ total: 1, logs: [{ chat_id: payload, url: payload, platform: payload, message_count: 1, messages: [{ message_text: payload, assistant_response: payload }] }] }));
  await flush();
  assert.equal(p.w.document.querySelectorAll('img').length, 0);
  assert.match(p.el('chatList').textContent, /<img/);
});

test('an old admin response cannot overwrite a newly selected filter', async t => {
  let resolveOld, hold = false;
  const p = page(t, 'admin', url => {
    if (hold && url.includes('/chats') && !url.includes('platform=')) return new Promise(r => { resolveOld = r; });
    return ok(url.includes('/stats') ? stats : { logs: [{ id: 2, message_text: 'new filter' }], total: 1 });
  });
  await flush(); hold = true;
  const old = p.w.refreshDashboard(); await flush();
  p.el('filterPlatform').value = 'claude'; p.el('applyFilter').click(); await flush();
  resolveOld(ok({ logs: [{ id: 1, message_text: 'stale response' }], total: 1 })); await old; await flush();
  assert.match(p.el('logsBody').textContent, /new filter/);
  assert.ok(!p.el('logsBody').textContent.includes('stale response'));
});

test('credential changes clear the previous account snapshot even if the new request fails', async t => {
  for (const kind of ['admin', 'view']) {
    let failed = false;
    const p = page(t, kind, url => failed ? { ok: false, status: 500 } : ok(kind === 'admin' ? (url.includes('/stats') ? stats : { logs: [{ id: 1, message_text: 'previous account' }], total: 1 }) : { total: 1, logs: [{ messages: [{ message_text: 'previous account' }] }] }));
    await flush(); p.storage.accessToken = 'another-account'; failed = true;
    await (kind === 'admin' ? p.w.refreshDashboard() : p.w.refreshChats());
    assert.ok(!p.w.document.body.textContent.includes('previous account'));
  }
});

test('signed-out dashboards do not request private APIs or start timers', async t => {
  for (const kind of ['admin', 'view']) {
    const p = page(t, kind, () => { throw new Error('must not fetch'); }, false);
    await flush(); assert.equal(p.calls.length, 0); assert.equal(p.timers.length, 0);
  }
});


for (const kind of ['admin', 'view']) {
  for (const change of [{ accessToken: null }, { accessToken: 'B' }, { user: { email: 'b@test' } }, { apiEndpoint: 'http://localhost:9999' }]) {
    test(`${kind} invalidates in-flight results synchronously on ${JSON.stringify(change)}`, async t => {
      let hold = false; const pending = [];
      const data = url => kind === 'admin' ? (url.includes('/stats') ? stats : { logs: [{ id: 1, message_text: 'PRIVATE' }], total: 1 }) : { logs: [{ chat_id: 'one', messages: [{ message_text: 'PRIVATE' }] }], total: 1 };
      const p = page(t, kind, url => hold ? new Promise(resolve => pending.push({ resolve, url })) : ok(data(url)));
      await flush(); assert.match(p.w.document.body.textContent, /PRIVATE/);
      hold = true;
      const request = kind === 'admin' ? p.w.refreshDashboard() : p.w.refreshChats(); await flush();
      p.change(change);
      assert.ok(!p.w.document.body.textContent.includes('PRIVATE'), 'clear synchronously');
      assert.ok(p.calls.at(-1).options.signal.aborted, 'abort outstanding request');
      // Returning to A must not revive A's old generation.
      p.change({ accessToken: 'test-token', user: undefined, apiEndpoint: 'http://localhost:3456' });
      for (const x of pending) x.resolve(ok(data(x.url)));
      await request; await flush();
      assert.ok(!p.w.document.body.textContent.includes('PRIVATE'));
    });
  }
  test(`${kind} rechecks storage before rendering success or errors without an event`, async t => {
    for (const failure of [false, true]) {
      const pending = [];
      const p = page(t, kind, () => new Promise(resolve => { pending.push(resolve); }));
      await flush(); p.storage.accessToken = null;
      for (const resolve of pending) resolve(failure ? { ok: false, status: 500 } : ok({ ...stats, total: 1, logs: [{ message_text: 'PRIVATE', messages: [{ message_text: 'PRIVATE' }] }] }));
      await flush();
      assert.ok(!p.w.document.body.textContent.includes('PRIVATE'));
      assert.ok(!p.el('error').textContent.includes('HTTP 500'));
    }
  });
}

test('legacy detail success and errors cannot render across session changes', async t => {
  for (const failure of [false, true]) {
    let resolve;
    const p = page(t, 'view', url => url.includes('/api/chat/') ? new Promise(r => { resolve = r; }) : ok({ total: 1, logs: [{ chat_id: 'one' }] }));
    await flush(); p.w.document.querySelector('.chat-header').click(); await flush();
    const detached = p.w.document.querySelector('.chat-messages');
    p.change({ accessToken: null });
    resolve(failure ? { ok: false, status: 500 } : ok([{ message_text: 'LEGACY PRIVATE' }])); await flush();
    assert.ok(!p.w.document.body.textContent.includes('LEGACY PRIVATE'));
    assert.ok(!detached.textContent.includes('LEGACY PRIVATE'));
    assert.ok(!detached.textContent.includes('HTTP 500'));
  }
});


for (const kind of ['admin', 'view']) {
  test(`${kind} permits B refresh while A is pending and suppresses A errors`, async t => {
    const pending = [];
    let hold = true;
    const p = page(t, kind, url => hold ? new Promise(resolve => pending.push(resolve)) : ok(kind === 'admin' ? (url.includes('/stats') ? stats : { total: 1, logs: [{ id: 2, message_text: 'ACCOUNT B' }] }) : { total: 1, logs: [{ messages: [{ message_text: 'ACCOUNT B' }] }] }));
    await flush();
    p.change({ accessToken: 'B', user: { email: 'b@test' } }); hold = false;
    await (kind === 'admin' ? p.w.refreshDashboard() : p.w.refreshChats());
    assert.match(p.w.document.body.textContent, /ACCOUNT B/);
    for (const resolve of pending) resolve({ ok: false, status: 401 }); await flush();
    assert.match(p.w.document.body.textContent, /ACCOUNT B/);
    assert.ok(!p.el('error').textContent.includes('expired'));
  });
  test(`${kind} aborts and rejects a response held inside json parsing`, async t => {
    const pending = [];
    const p = page(t, kind, () => ({ ok: true, json: () => new Promise(resolve => pending.push(resolve)) }));
    await flush(); p.change({ accessToken: null });
    assert.ok(p.calls.every(call => call.options.signal.aborted));
    for (const resolve of pending) resolve({ ...stats, total: 1, logs: [{ message_text: 'PRIVATE JSON', messages: [{ message_text: 'PRIVATE JSON' }] }] });
    await flush(); assert.ok(!p.w.document.body.textContent.includes('PRIVATE JSON'));
  });
}
