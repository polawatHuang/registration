// ใช้: ADMIN_PASSWORD='...' npm run admin:create -- <username> "<ชื่อที่แสดง>"
// ไม่มี SSH: ใส่ ADMIN_USERNAME ADMIN_NAME ADMIN_PASSWORD ใน .env ชั่วคราว แล้วกด Run script ใน Plesk จากนั้นลบออก
import { pool, queryOne } from '../src/config/db.js';
import { createAdminUser } from '../src/services/adminUserService.js';

const [username = process.env.ADMIN_USERNAME, displayName = process.env.ADMIN_NAME] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
try {
  if (!username || !displayName || !password) throw new Error('ต้องระบุ username, ชื่อที่แสดง และ ADMIN_PASSWORD');
  const role = await queryOne("SELECT id FROM roles WHERE role_key = 'super_admin'");
  if (!role) throw new Error('ยังไม่มีบทบาท ให้รัน npm run db:seed ก่อน');
  await createAdminUser({ username, displayName, password, roleId: role.id }, { adminId: null, ip: 'cli' });
  console.log(`สร้าง Super Admin "${username}" แล้ว ลบ ADMIN_PASSWORD ออกจาก .env ทันที`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
