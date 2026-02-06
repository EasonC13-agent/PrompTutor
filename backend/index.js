import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config();

const { Pool } = pg;

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

// Database connection
const pool = new Pool({
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

// Auth middleware - verifies Firebase token
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  
  const token = authHeader.split('Bearer ')[1];
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
      isAdmin: ADMIN_EMAILS.includes(decodedToken.email),
    };
    next();
  } catch (error) {
    console.error('Auth error:', error.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Admin-only middleware
function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Health check (public)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Register consent (must be called before uploading data)
app.post('/api/consent', authenticate, async (req, res) => {
  const { agreed } = req.body;
  
  if (!agreed) {
    return res.status(400).json({ error: 'Must agree to terms' });
  }
  
  try {
    await pool.query(
      `INSERT INTO users (firebase_uid, email, consented_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (firebase_uid) DO UPDATE SET consented_at = NOW()`,
      [req.user.uid, req.user.email]
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
      'SELECT consented_at FROM users WHERE firebase_uid = $1',
      [req.user.uid]
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
  
  // Check consent
  const consentCheck = await pool.query(
    'SELECT consented_at FROM users WHERE firebase_uid = $1',
    [req.user.uid]
  );
  
  if (consentCheck.rows.length === 0 || !consentCheck.rows[0].consented_at) {
    return res.status(403).json({ error: 'Must agree to terms before uploading' });
  }
  
  console.log(`[${new Date().toISOString()}] User ${req.user.email} uploading ${logs.length} logs`);
  
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const log of logs) {
        await client.query(
          `INSERT INTO chat_logs (
            id, user_uid, platform, url, method, captured_at, raw_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO NOTHING`,
          [
            log.id,
            req.user.uid,
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
       WHERE user_uid = $1
       ORDER BY captured_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.uid, parseInt(limit), parseInt(offset)]
    );
    
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM chat_logs WHERE user_uid = $1',
      [req.user.uid]
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

// Delete user's own data
app.delete('/api/my-chats', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM chat_logs WHERE user_uid = $1 RETURNING id',
      [req.user.uid]
    );
    
    console.log(`[${new Date().toISOString()}] User ${req.user.email} deleted ${result.rowCount} logs`);
    
    res.json({ success: true, deleted: result.rowCount });
  } catch (error) {
    console.error('Delete error:', error);
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
        COUNT(DISTINCT user_uid) as user_count,
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
