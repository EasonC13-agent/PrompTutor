import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

// Google OAuth client for token verification
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

if (!googleClient) {
  console.warn('GOOGLE_CLIENT_ID not configured - running in dev mode (no auth)');
}
// OpenAI client for answer-seeking detection
// NOTE: Eason needs to set OPENAI_API_KEY in .env
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

if (!openai) {
  console.warn('OPENAI_API_KEY not configured - /api/detect will be unavailable');
}


const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

// Database connection (supports DATABASE_URL or individual params)
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'chat_collector',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    });

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Auth middleware - uses anonymous user ID (hashed email)
// No server-side verification needed - user authenticated locally via Google
function authenticate(req, res, next) {
  // Get anonymous user ID from header
  const userId = req.headers['x-user-id'];
  
  if (!userId) {
    return res.status(401).json({ error: 'Missing X-User-Id header' });
  }
  
  // User ID is a SHA-256 hash of the email - completely anonymous
  req.user = {
    id: userId,
    isAdmin: false, // Admin check not possible with anonymous IDs
  };
  
  next();
}

// Admin-only middleware
function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check (public)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// View page redirect
app.get('/view', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'view.html'));
});

// Register consent (must be called before uploading data)
app.post('/api/consent', authenticate, async (req, res) => {
  const { agreed } = req.body;
  
  if (!agreed) {
    return res.status(400).json({ error: 'Must agree to terms' });
  }
  
  try {
    await pool.query(
      `INSERT INTO users (google_id, email, consented_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (google_id) DO UPDATE SET consented_at = NOW()`,
      [req.user.id, req.user.email]
    );
    
    res.json({ success: true, message: 'Consent recorded' });
  } catch (error) {
    console.error('Consent error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Check if user has consented
app.get('/api/consent', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT consented_at FROM users WHERE google_id = $1',
      [req.user.id]
    );
    
    res.json({
      consented: result.rows.length > 0 && result.rows[0].consented_at != null,
      consentedAt: result.rows[0]?.consented_at,
    });
  } catch (error) {
    console.error('Consent check error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Upload chat logs (authenticated users only)
app.post('/api/chats', authenticate, async (req, res) => {
  const { logs } = req.body;
  
  if (!logs || !Array.isArray(logs)) {
    return res.status(400).json({ error: 'Invalid payload: logs array required' });
  }
  
  // Consent is checked locally - user agreed before login
  console.log(`[${new Date().toISOString()}] User ${req.user.id.slice(0,8)}... uploading ${logs.length} logs`);
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const log of logs) {
        await client.query(
          `INSERT INTO chat_logs (
            id, user_id, platform, url, method, captured_at, raw_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO NOTHING`,
          [
            log.id,
            req.user.id,
            log.platform,
            log.url,
            log.method,
            log.capturedAt,
            JSON.stringify(log.data)
          ]
        );
      }
      
      await client.query('COMMIT');
      res.json({ success: true, stored: logs.length });
      
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get user's own uploads
app.get('/api/my-chats', authenticate, async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  
  try {
    const result = await pool.query(
      `SELECT id, platform, url, captured_at, created_at
       FROM chat_logs 
       WHERE user_id = $1
       ORDER BY captured_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, parseInt(limit), parseInt(offset)]
    );
    
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM chat_logs WHERE user_id = $1',
      [req.user.id]
    );
    
    res.json({
      logs: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get single chat log with full data
app.get('/api/chat/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM chat_logs WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete user's own data
app.delete('/api/my-chats', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM chat_logs WHERE user_id = $1 RETURNING id',
      [req.user.id]
    );
    
    console.log(`[${new Date().toISOString()}] User ${req.user.id.slice(0,8)}... deleted ${result.rowCount} logs`);
    
    res.json({ success: true, deleted: result.rowCount });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete logs by conversation URL (when user closes/leaves a conversation with toggle off)
app.delete('/api/conversation', authenticate, async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL required' });
  }
  
  try {
    // Delete all logs matching this URL pattern for this user
    const result = await pool.query(
      'DELETE FROM chat_logs WHERE user_id = $1 AND url LIKE $2 RETURNING id',
      [req.user.id, `${url}%`]
    );
    
    console.log(`[${new Date().toISOString()}] User ${req.user.id.slice(0,8)}... deleted ${result.rowCount} logs for ${url}`);
    
    res.json({ success: true, deleted: result.rowCount });
  } catch (error) {
    console.error('Delete error:', error);
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

// Detect answer-seeking behavior
app.post('/api/detect', authenticate, async (req, res) => {
  if (!openai) {
    return res.status(503).json({ error: 'OpenAI not configured' });
  }

  const { message, platform, context } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: DETECTION_SYSTEM_PROMPT },
        { role: 'user', content: message }
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
  } catch (error) {
    console.error('Detection error:', error);
    res.status(500).json({ error: 'Detection failed' });
  }
});

// Log guidance interaction
app.post('/api/guidance-log', authenticate, async (req, res) => {
  const {
    platform, url, originalMessage, isAnswerSeeking,
    confidence, suggestion, userAction, finalMessage
  } = req.body;

  try {
    await pool.query(
      `INSERT INTO guidance_logs (
        user_id, platform, url, original_message, is_answer_seeking,
        confidence, suggestion, user_action, final_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.user.id, platform, url, originalMessage, isAnswerSeeking,
        confidence, suggestion, userAction, finalMessage
      ]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Guidance log error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// === ADMIN ENDPOINTS ===

// Get all chat logs (admin only)
app.get('/api/admin/chats', authenticate, adminOnly, async (req, res) => {
  const { platform, limit = 100, offset = 0 } = req.query;
  
  try {
    let query = 'SELECT * FROM chat_logs';
    const params = [];
    
    if (platform) {
      query += ' WHERE platform = $1';
      params.push(platform);
    }
    
    query += ` ORDER BY captured_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    
    res.json({
      logs: result.rows,
      count: result.rows.length,
      offset: parseInt(offset),
      limit: parseInt(limit),
    });
    
  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get stats (admin only)
app.get('/api/admin/stats', authenticate, adminOnly, async (req, res) => {
  try {
    const platformStats = await pool.query(`
      SELECT 
        platform,
        COUNT(*) as log_count,
        COUNT(DISTINCT user_id) as user_count,
        MIN(captured_at) as first_capture,
        MAX(captured_at) as last_capture
      FROM chat_logs
      GROUP BY platform
    `);
    
    const totalLogs = await pool.query('SELECT COUNT(*) as total FROM chat_logs');
    const totalUsers = await pool.query('SELECT COUNT(*) as total FROM users WHERE consented_at IS NOT NULL');
    
    res.json({
      totalLogs: parseInt(totalLogs.rows[0].total),
      totalUsers: parseInt(totalUsers.rows[0].total),
      byPlatform: platformStats.rows,
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Chat Collector API running on port ${PORT}`);
  console.log(`Admin emails: ${ADMIN_EMAILS.join(', ') || '(none configured)'}`);
});
