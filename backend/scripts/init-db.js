import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'chat_collector',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function initDb() {
  const client = await pool.connect();
  
  try {
    console.log('Initializing database schema...');
    
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        firebase_uid VARCHAR(128) UNIQUE NOT NULL,
        email VARCHAR(255),
        consented_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ users table');
    
    // Chat logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_logs (
        id VARCHAR(64) PRIMARY KEY,
        user_uid VARCHAR(128) NOT NULL,
        platform VARCHAR(50) NOT NULL,
        url TEXT,
        method VARCHAR(10),
        captured_at TIMESTAMP,
        raw_data JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (user_uid) REFERENCES users(firebase_uid) ON DELETE CASCADE
      )
    `);
    console.log('✓ chat_logs table');
    
    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_logs_user ON chat_logs(user_uid);
      CREATE INDEX IF NOT EXISTS idx_chat_logs_platform ON chat_logs(platform);
      CREATE INDEX IF NOT EXISTS idx_chat_logs_captured ON chat_logs(captured_at);
    `);
    console.log('✓ indexes');
    
    console.log('\nDatabase initialization complete!');
    
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

initDb();
