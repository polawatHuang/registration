// ใช้: npm run db:restore -- <ไฟล์ .lstb>  หรือ npm run db:restore -- --check <ไฟล์>
import path from 'node:path';
import fs from 'node:fs';
import { pool } from '../src/config/db.js';
import { BACKUP_DIR, listBackups, restore, verify } from '../src/utils/backup.js';

try {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    for (const b of await listBackups()) console.log(`${b.name}  ${(b.bytes / 1024).toFixed(0)} KB`);
    throw new Error('ระบุชื่อไฟล์สำรอง');
  }
  const file = fs.existsSync(name) ? name : path.join(BACKUP_DIR, path.basename(name));
  const v = await verify(file);
  console.log(`ไฟล์สมบูรณ์ สำรองเมื่อ ${v.at} มี ${v.rows} แถว`);
  if (!check) {
    const r = await restore(file);
    console.log(`กู้คืนแล้ว ${r.rows} แถว ขั้นต่อไป: npm run db:migrate แล้ว npm run retention:reapply`);
  }
} catch (err) {
  console.error(`ไม่สำเร็จ: ${err.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
