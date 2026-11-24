import { pool } from '../src/config/db.js';
import { migrate } from '../src/utils/migrator.js';

await migrate(console.log);
console.log('database is up to date');
await pool.end();
