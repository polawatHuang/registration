import { pool } from '../src/config/db.js';
import { runBackup } from '../src/services/backupService.js';

try {
  const b = await runBackup();
  console.log(`สำรองแล้ว ${b.name} (${b.tables} ตาราง ${b.rows} แถว ${(b.bytes / 1024).toFixed(0)} KB) ตรวจอ่านกลับได้`);
  console.log(`ลบไฟล์สำรองเก่า ${b.pruned} ไฟล์ (เก็บล่าสุด ${b.keep})`);
  console.log('อย่าลืมสำรองโฟลเดอร์ storage และไฟล์ .env แยกไว้คนละที่ กุญแจหาย = เปิดไม่ได้');
} catch (err) {
  console.error(`สำรองไม่สำเร็จ: ${err.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
