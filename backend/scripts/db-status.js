import { pool } from '../src/config/db.js';
import { migrationStatus } from '../src/utils/migrator.js';

try {
  const s = await migrationStatus();
  console.log(`ฐานข้อมูล: ${s.version}`);
  for (const m of s.migrations) console.log(`${m.applied ? '✓' : '–'} ${m.file}`);
  console.log(`ตาราง: ${s.expected - s.missing.length}/${s.expected}${s.missing.length ? ` ยังไม่มี: ${s.missing.join(', ')}` : ''}`);
  console.log(`บทบาท: ${s.roles} | ผู้ดูแล: ${s.admins}`);
} catch (err) {
  console.error(`ตรวจไม่สำเร็จ: ${err.code ?? ''} ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
