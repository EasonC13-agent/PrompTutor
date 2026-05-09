import Knex from 'knex';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const clientType = process.env.DB_CLIENT || 'better-sqlite3';
export const isPg = ['pg', 'postgres', 'postgresql'].includes(clientType);

const db = Knex({
  client: isPg ? 'pg' : 'better-sqlite3',
  connection: isPg
    ? process.env.DATABASE_URL || {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }
    : {
        filename: process.env.SQLITE_PATH || path.join(__dirname, '..', 'data.db'),
      },
  useNullAsDefault: true,
  pool: isPg
    ? { min: 2, max: 10 }
    : {
        afterCreate: (conn, done) => {
          conn.pragma('journal_mode = WAL');
          conn.pragma('foreign_keys = ON');
          done(null, conn);
        },
      },
});

export default db;
