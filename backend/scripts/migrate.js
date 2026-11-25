import { pool } from '../src/config/db.js';
import { migrate, seed } from '../src/utils/migrator.js';

await migrate(console.log);
await seed(); // สิทธิ์และบทบาทใหม่ต้องตรงกับโค้ดเสมอ (รันซ้ำได้)
console.log('database is up to date');
await pool.end();
