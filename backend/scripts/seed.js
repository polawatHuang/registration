import { pool } from '../src/config/db.js';
import { seed } from '../src/utils/migrator.js';

await seed();
console.log('seed complete');
await pool.end();
