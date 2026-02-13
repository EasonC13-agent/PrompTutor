import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'chat_collector',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    });

async function initDb() {
  console.log('Initializing database schema...');
  
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        consented_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ users table');
    
    // Chat logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_logs (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        platform VARCHAR(50) NOT NULL,
        url TEXT,
        method VARCHAR(10),
        captured_at TIMESTAMP NOT NULL,
        raw_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ chat_logs table');
    
    // Indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_logs_user_id ON chat_logs(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_logs_platform ON chat_logs(platform)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_logs_captured_at ON chat_logs(captured_at)');
    console.log('✓ indexes');
    
    console.log('\nDatabase initialized successfully!');
    
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDb();
