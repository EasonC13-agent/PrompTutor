import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Knex from '../backend/node_modules/knex/knex.js';
import { createApp } from '../backend/index.js';
import { ensureSchema } from '../backend/db/schema.js';

const userId = email => crypto.createHash('sha256').update(email).digest('hex');
const headers = { Authorization: 'Bearer test-a' };
async function local(t, adminEmails = []) {
  const db = Knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await ensureSchema(db);
  const app = createApp({ database: db, googleClient: { async getTokenInfo(token) {
    if (!['test-a', 'test-b', 'wrong-audience', 'expired', 'unverified'].includes(token)) throw new Error('invalid');
    return { email: token === 'test-b' ? 'b@example.test' : 'a@example.test',
      email_verified: token !== 'unverified', aud: token === 'wrong-audience' ? 'other-client' : 'test-client', expiry_date: token === 'expired' ? 1 : Date.now() + 60000 };
  } }, clientId: 'test-client', adminEmails });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.destroy(); });
  return { db, base: `http://127.0.0.1:${server.address().port}` };
}

test('private APIs require verified bearer tokens, never trust X-User-Id', async t => {
  const { base } = await local(t);
  for (const route of ['/api/my-chats', '/api/chat/one', '/api/admin/chats']) {
    for (const h of [{}, { 'X-User-Id': userId('a@example.test') }, { Authorization: 'Bearer invalid' }, { Authorization: 'Bearer expired' }, { Authorization: 'Bearer wrong-audience' }, { Authorization: 'Bearer unverified' }]) {
      assert.equal((await fetch(base + route, { headers: h })).status, 401, route);
    }
  }
  assert.equal((await fetch(base + '/api/admin/chats', { headers })).status, 403);
});

test('batch collection is visible on the next refresh and isolates other users', async t => {
  const { base, db } = await local(t);
  const message = { chatId: 'one', platform: 'ChatGPT', url: 'https://chatgpt.com/c/one', messageText: 'question', assistantResponse: 'answer', messageHash: 'hash-one' };
  const upload = await fetch(base + '/api/message-logs/batch', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [message] }) });
  assert.equal(upload.status, 200);
  const get = () => fetch(base + '/api/my-chats?includeData=1', { headers });
  const response = await get();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.total, 1);
  assert.equal(data.logs[0].messages[0].message_text, 'question');
  assert.equal(data.logs[0].messages[0].assistant_response, 'answer');
  await db('message_logs').insert({ user_id: userId('b@example.test'), chat_id: 'secret', url: 'secret-url', message_text: 'private', message_hash: 'b', captured_at: '2026-01-01' });
  assert.equal((await (await get()).json()).total, 1);
  const other = await fetch(base + '/api/chat/secret', { headers });
  assert.equal(other.status, 404);
  await fetch(base + '/api/message-logs/batch', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ ...message, messageHash: 'hash-two', messageText: 'new question' }] }) });
  assert.equal((await (await get()).json()).logs[0].message_count, 2);
});

test('conversation count matches grouping, including null chat IDs and shared URLs', async t => {
  const { base, db } = await local(t);
  await db('message_logs').insert([
    { user_id: userId('a@example.test'), chat_id: null, url: 'same', platform: 'Claude', message_text: 'one' },
    { user_id: userId('a@example.test'), chat_id: 'other', url: 'same', platform: 'Claude', message_text: 'two' },
  ]);
  const data = await (await fetch(base + '/api/my-chats?includeData=1', { headers })).json();
  assert.equal(data.total, 2);
  assert.equal(data.logs.length, 2);
  assert.equal(data.logs.find(log => log.chat_id === null).messages[0].message_text, 'one');
});

test('researcher stats and filtered pagination describe real stored messages', async t => {
  const { base, db } = await local(t, ['a@example.test']);
  await db('message_logs').insert([
    { user_id: userId('a@example.test'), chat_id: 'a', platform: 'chatgpt', message_text: 'first', captured_at: '2026-05-09T01:00:00Z' },
    { user_id: userId('a@example.test'), chat_id: 'a', platform: 'claude', message_text: 'second', captured_at: '2026-05-09T02:00:00Z' },
    { user_id: userId('b@example.test'), chat_id: 'b', platform: 'chatgpt', message_text: 'third', captured_at: '2026-05-09T03:00:00Z' }
  ]);
  const stats = await fetch(base + '/api/admin/stats', { headers });
  assert.equal(stats.status, 200);
  const body = await stats.json();
  assert.equal(body.totalLogs, 3);
  assert.equal(body.totalUsers, 2);
  assert.equal(body.latestCapturedAt, '2026-05-09T03:00:00Z');
  const page = await (await fetch(base + '/api/admin/chats?platform=chatgpt&limit=1&offset=1', { headers })).json();
  assert.equal(page.total, 2);
  assert.equal(page.logs.length, 1);
  assert.equal(page.logs[0].message_text, 'first');
});

test('pagination rejects malformed, negative, excessive and repeated values', async t => {
  const { base } = await local(t);
  for (const query of ['limit=-1', 'limit=abc', 'limit=101', 'offset=-1', 'limit=1oops', 'offset=1.5', 'limit=1&limit=2']) {
    const res = await fetch(base + '/api/my-chats?' + query, { headers });
    assert.equal(res.status, 400, query);
  }
});


for (const id of ['fixture_a', 'fixture%a']) for (const requestSuffix of ['', '/?source=delete#section']) {
  test(`conversation deletion matches literal identity and boundaries (${id}${requestSuffix})`, async t => {
    const { base, db } = await local(t);
    const a = userId('a@example.test'), b = userId('b@example.test');
    const target = `https://claude.ai/chat/${id}`;
    const related = ['', '?x=1', '#section', '/', '/?x=1', '/branch'].map(suffix => target + suffix);
    const siblings = [target + '-sibling', target + 'more', target.replace(id, 'fixtureXa'), target.toUpperCase()];
    const rows = [...related.map(url => ({ user_id: a, url })), ...siblings.map(url => ({ user_id: a, url })), ...related.map(url => ({ user_id: b, url }))];
    for (const table of ['message_logs', 'guidance_logs']) await db(table).insert(rows.map(row => ({ ...row,
      ...(table === 'message_logs' ? { message_text: 'fixture' } : { original_message: 'fixture' })
    })));
    const response = await fetch(base + '/api/conversation', { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target + requestSuffix }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, deleted: related.length, deletedGuidance: related.length });
    for (const table of ['message_logs', 'guidance_logs']) {
      assert.deepEqual((await db(table).where('user_id', a)).map(row => row.url).sort(), siblings.slice().sort(), `${table}: sibling URLs preserved`);
      assert.deepEqual((await db(table).where('user_id', b)).map(row => row.url).sort(), related.slice().sort(), `${table}: other account preserved`);
    }
  });
}

for (const route of ['/api/my-chats', '/api/conversation']) {
  test(`${route} deletes user-scoped guidance prompts with accurate independent counters`, async t => {
    const { base, db } = await local(t);
    const a = userId('a@example.test'), b = userId('b@example.test');
    const rows = [{ user_id: a, url: 'https://chat.test/one' }, { user_id: a, url: 'https://chat.test/one?x=1' }, { user_id: a, url: 'https://chat.test/other' }, { user_id: b, url: 'https://chat.test/one' }];
    await db('message_logs').insert(rows.map(row => ({ ...row, message_text: 'private message' })));
    await db('guidance_logs').insert([...rows, rows[0]].map(row => ({ ...row, original_message: 'original private', final_message: 'final private' })));
    const remove = () => fetch(base + route, { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://chat.test/one' }) });
    const res = await remove(); assert.equal(res.status, 200);
    const all = route === '/api/my-chats';
    assert.deepEqual(await res.json(), { success: true, deleted: all ? 3 : 2, deletedGuidance: all ? 4 : 3 });
    for (const table of ['message_logs', 'guidance_logs']) {
      assert.equal((await db(table).where('user_id', b)).length, 1, 'other user preserved');
      const own = await db(table).where('user_id', a);
      assert.equal(own.length, all ? 0 : 1);
      if (!all) assert.equal(own[0].url, 'https://chat.test/other');
    }
    assert.deepEqual(await (await remove()).json(), { success: true, deleted: 0, deletedGuidance: 0 });
  });
  test(`${route} rolls back messages if guidance deletion fails`, async t => {
    const { base, db } = await local(t);
    const row = { user_id: userId('a@example.test'), url: 'https://chat.test/one' };
    await db('message_logs').insert({ ...row, message_text: 'message' });
    await db('guidance_logs').insert({ ...row, original_message: 'prompt' });
    await db.raw("CREATE TRIGGER fail_guidance_delete BEFORE DELETE ON guidance_logs BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
    const response = await fetch(base + route, { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: row.url }) });
    assert.equal(response.status, 500);
    assert.equal((await db('message_logs')).length, 1);
    assert.equal((await db('guidance_logs')).length, 1);
  });
}
