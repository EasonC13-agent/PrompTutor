import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import OpenAI from 'openai';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import db, { isPg } from './db/client.js';
import { ensureSchema } from './db/schema.js';

dotenv.config();

const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

if (!googleClient) {
  throw new Error('GOOGLE_CLIENT_ID environment variable is required for authentication');
}

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

if (!openai) {
  console.warn('OPENAI_API_KEY not configured - /api/detect will be unavailable');
}

// Initialize schema before starting
await ensureSchema(db);
console.log(`Database ready (${isPg ? 'PostgreSQL' : 'SQLite'})`);

const app = express();
const PORT = 13001;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Token verification cache: token -> { userId, isAdmin, expiresAt }
const tokenCache = new Map();

async function verifyGoogleToken(token) {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const info = await googleClient.getTokenInfo(token);
  const userId = crypto.createHash('sha256').update(info.email.toLowerCase().trim()).digest('hex');
  const result = {
    userId,
    isAdmin: ADMIN_EMAILS.includes(info.email),
    expiresAt: info.expiry_date,
  };
  tokenCache.set(token, result);
  return result;
}

async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer token' });
  }

  try {
    const info = await verifyGoogleToken(token);
    req.user = { id: info.userId, email: info.email, isAdmin: info.isAdmin };
    next();
  } catch (e) {
    console.error('Token verification failed:', e.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

const standardLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: (req) => req.user.id,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests, slow down' }),
  skip: (req) => !req.user,
});

const detectLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user.id,
  handler: (req, res) => res.status(429).json({ error: 'Detection rate limit exceeded (30/min)' }),
  skip: (req) => !req.user,
});

async function getUserMessageCount(userId) {
  const [{ count }] = await db('message_logs').where('user_id', userId).count('* as count');
  return Number(count);
}

app.use(express.static(new URL('public', import.meta.url).pathname));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/view', (req, res) => {
  res.sendFile(new URL('public/view.html', import.meta.url).pathname);
});

app.post('/api/consent', authenticate, standardLimit, async (req, res) => {
  const { agreed } = req.body;
  if (!agreed) return res.status(400).json({ error: 'Must agree to terms' });

  try {
    await db('users')
      .insert({ google_id: req.user.id, email: req.user.email || '', consented_at: new Date().toISOString() })
      .onConflict('google_id')
      .merge(['consented_at']);
    res.json({ success: true });
  } catch (e) {
    console.error('Consent error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/consent', authenticate, standardLimit, async (req, res) => {
  try {
    const row = await db('users').select('consented_at').where('google_id', req.user.id).first();
    res.json({ consented: !!row?.consented_at, consentedAt: row?.consented_at ?? null });
  } catch (e) {
    console.error('Consent check error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/message-logs/batch', authenticate, standardLimit, async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid payload: messages array required' });
  }

  console.log(`[${new Date().toISOString()}] User ${req.user.id.slice(0, 8)}... uploading ${messages.length} messages`);

  try {
    await db.transaction(async (trx) => {
      for (const msg of messages) {
        const messageHash = msg.messageHash ||
          crypto.createHash('sha256').update(`${req.user.id}:${msg.url}:${(msg.messageText || '').slice(0, 200)}`).digest('hex').slice(0, 16);
        await trx('message_logs')
          .insert({
            user_id: req.user.id,
            chat_id: msg.chatId || null,
            platform: msg.platform,
            url: msg.url,
            message_text: msg.messageText,
            assistant_response: msg.assistantResponse || null,
            message_hash: messageHash,
            captured_at: msg.capturedAt || new Date().toISOString(),
          })
          .onConflict(['user_id', 'message_hash'])
          .ignore();
      }
    });
    const total = await getUserMessageCount(req.user.id);
    res.json({ success: true, stored: messages.length, total });
  } catch (e) {
    console.error('Database error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/my-chats', authenticate, standardLimit, async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const [logs, [{ count }]] = await Promise.all([
      db('message_logs')
        .select('chat_id', 'url', 'platform')
        .max('captured_at as last_message_at')
        .count('* as message_count')
        .where('user_id', req.user.id)
        .groupBy('chat_id', 'url', 'platform')
        .orderBy('last_message_at', 'desc')
        .limit(limit)
        .offset(offset),
      db('message_logs').where('user_id', req.user.id).countDistinct('url as count'),
    ]);
    res.json({ logs, total: Number(count), limit, offset });
  } catch (e) {
    console.error('Query error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/chat/:id', authenticate, standardLimit, async (req, res) => {
  try {
    const rows = await db('message_logs')
      .where({ chat_id: req.params.id, user_id: req.user.id })
      .orderBy('captured_at', 'asc');
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows);
  } catch (e) {
    console.error('Query error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/my-chats', authenticate, standardLimit, async (req, res) => {
  try {
    const deleted = await db('message_logs').where('user_id', req.user.id).delete();
    console.log(`[${new Date().toISOString()}] User ${req.user.id.slice(0, 8)}... deleted ${deleted} messages`);
    res.json({ success: true, deleted });
  } catch (e) {
    console.error('Delete error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/conversation', authenticate, standardLimit, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const deleted = await db('message_logs')
      .where('user_id', req.user.id)
      .where('url', 'like', `${url}%`)
      .delete();
    console.log(`[${new Date().toISOString()}] User ${req.user.id.slice(0, 8)}... deleted ${deleted} messages for ${url}`);
    res.json({ success: true, deleted });
  } catch (e) {
    console.error('Delete error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// === GUIDANCE / DETECTION ENDPOINTS ===

const DETECTION_SYSTEM_PROMPT = `You are an educational AI assistant analyzer. Your task is to determine if a student's message to an AI chatbot is "answer-seeking" (asking for direct answers/solutions) vs "help-seeking" (asking for explanations, guidance, or learning support).

Answer-seeking examples:
- "Solve this equation for me: 2x + 3 = 7"
- "Write me an essay about climate change"
- "What's the answer to question 3?"
- "Give me the code for a binary search"

Help-seeking examples:
- "Can you explain how to approach this type of equation?"
- "I'm stuck on this step, what concept am I missing?"
- "Can you give me a hint for question 3?"
- "I wrote this code but it's not working, can you help me understand why?"

Respond in JSON: { "isAnswerSeeking": boolean, "confidence": 0-1, "reason": "brief explanation", "suggestion": "a rephrased help-seeking version of their message" }`;

app.post('/api/detect', authenticate, detectLimit, async (req, res) => {
  if (!openai) return res.status(503).json({ error: 'OpenAI not configured' });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: DETECTION_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 300,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json({
      isAnswerSeeking: result.isAnswerSeeking ?? false,
      confidence: result.confidence ?? 0,
      reason: result.reason ?? '',
      suggestion: result.suggestion ?? '',
    });
  } catch (e) {
    console.error('Detection error:', e);
    res.status(500).json({ error: 'Detection failed' });
  }
});

app.post('/api/guidance-log', authenticate, standardLimit, async (req, res) => {
  const { platform, url, originalMessage, isAnswerSeeking, confidence, suggestion, userAction, finalMessage } = req.body;

  try {
    await db('guidance_logs').insert({
      user_id: req.user.id,
      platform,
      url,
      original_message: originalMessage,
      is_answer_seeking: isAnswerSeeking,
      confidence,
      suggestion,
      user_action: userAction,
      final_message: finalMessage,
    });
    res.json({ success: true });
  } catch (e) {
    console.error('Guidance log error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/message-log', authenticate, standardLimit, async (req, res) => {
  const { platform, url, chatId, messageText, assistantResponse, messageHash, capturedAt } = req.body;
  if (!messageText) return res.status(400).json({ error: 'messageText required' });

  const resolvedHash = messageHash ||
    crypto.createHash('sha256').update(`${req.user.id}:${url}:${(messageText || '').slice(0, 200)}`).digest('hex').slice(0, 16);

  try {
    await db('message_logs')
      .insert({
        user_id: req.user.id,
        chat_id: chatId || null,
        platform,
        url,
        message_text: messageText,
        assistant_response: assistantResponse || null,
        message_hash: resolvedHash,
        captured_at: capturedAt || new Date().toISOString(),
      })
      .onConflict(['user_id', 'message_hash'])
      .ignore();
    res.json({ success: true });
  } catch (e) {
    console.error('Message log error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// === ADMIN ENDPOINTS ===

app.get('/api/admin/chats', authenticate, adminOnly, standardLimit, async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  const { platform } = req.query;

  try {
    const baseQuery = () => {
      const q = db('message_logs');
      if (platform) q.where('platform', platform);
      return q;
    };
    const [logs, [{ count: total }]] = await Promise.all([
      baseQuery().orderBy('captured_at', 'desc').limit(limit).offset(offset),
      baseQuery().count('* as count'),
    ]);
    res.json({ logs, total: Number(total), offset, limit });
  } catch (e) {
    console.error('Query error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/admin/stats', authenticate, adminOnly, standardLimit, async (req, res) => {
  try {
    const [byPlatform, [{ count: totalLogs }], [{ count: totalUsers }]] = await Promise.all([
      db('message_logs')
        .select('platform')
        .count('id as log_count')
        .countDistinct('user_id as user_count')
        .min('captured_at as first_capture')
        .max('captured_at as last_capture')
        .groupBy('platform'),
      db('message_logs').count('* as count'),
      db('users').whereNotNull('consented_at').count('* as count'),
    ]);

    res.json({ totalLogs: Number(totalLogs), totalUsers: Number(totalUsers), byPlatform });
  } catch (e) {
    console.error('Stats error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.listen(PORT, () => {
  console.log(`PrompTutor API running on port ${PORT}`);
  console.log(`Admin emails: ${ADMIN_EMAILS.join(', ') || '(none configured)'}`);
});
