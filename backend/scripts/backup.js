import { pool } from '../src/config/db.js';
import { backup, prune, verify } from '../src/utils/backup.js';

try {
  const keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
  const b = await backup();
  await verify(b.file); // สำรองที่อ่านกลับไม่ได้ไม่ใช่การสำรอง
  console.log(`สำรองแล้ว ${b.name} (${b.tables} ตาราง ${b.rows} แถว ${(b.bytes / 1024).toFixed(0)} KB) ตรวจอ่านกลับได้`);
  console.log(`ลบไฟล์สำรองเก่า ${await prune(keep)} ไฟล์ (เก็บล่าสุด ${keep})`);
  console.log('อย่าลืมสำรองโฟลเดอร์ storage และไฟล์ .env แยกไว้คนละที่ กุญแจหาย = เปิดไม่ได้');
} catch (err) {
  console.error(`สำรองไม่สำเร็จ: ${err.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
