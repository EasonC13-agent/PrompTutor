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
