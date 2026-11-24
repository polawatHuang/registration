// รันทุกครั้งหลังกู้คืนข้อมูลสำรอง ก่อนเปิดเว็บให้ใช้งาน
import { pool } from '../src/config/db.js';
import { reapply } from '../src/services/retentionService.js';

const r = await reapply();
console.log(`ตรวจบัญชีการลบ ${r.checked} รายการ ลบซ้ำ ${r.purged} รายการ`);
await pool.end();
