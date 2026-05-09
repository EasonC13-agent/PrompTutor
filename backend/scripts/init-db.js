import db from '../db/client.js';
import { ensureSchema } from '../db/schema.js';

await ensureSchema(db);
console.log('Database schema ready.');
await db.destroy();
