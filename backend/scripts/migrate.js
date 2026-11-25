import { pool } from '../src/config/db.js';
import { migrate, seed } from '../src/utils/migrator.js';

try {
  await migrate(console.log);
  await seed(); // สิทธิ์และบทบาทใหม่ต้องตรงกับโค้ดเสมอ (รันซ้ำได้)
  console.log('database is up to date');
} catch (err) {
  console.error(`db:migrate หยุด: ${err.message}`);
  if (err.cause?.code || err.code) console.error(`รหัส: ${err.cause?.code ?? err.code}`);
  console.error('ไม่มีข้อมูลถูกลบ แก้สาเหตุแล้วรันซ้ำได้ ระบบจะทำต่อจากจุดที่ค้าง');
  process.exitCode = 1;
} finally {
  await pool.end();
}
