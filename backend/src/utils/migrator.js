import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, query } from '../config/db.js';
import { ROOT } from '../config/env.js';
import { PERMISSIONS, ROLES } from '../config/permissions.js';

const DIR = path.join(ROOT, 'backend/database/migrations');

export async function migrate(log = () => {}) {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(150) PRIMARY KEY, checksum CHAR(64) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const done = new Map((await query('SELECT filename, checksum FROM schema_migrations')).map((r) => [r.filename, r.checksum]));
  for (const file of (await fs.readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = await fs.readFile(path.join(DIR, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    if (done.has(file)) {
      if (done.get(file) !== checksum) throw new Error(`Migration ${file} ถูกแก้หลังใช้งานแล้ว ให้สร้างไฟล์ใหม่แทน`);
      continue;
    }
    const statements = sql.replace(/^--.*$/gm, '').split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
    const conn = await pool.getConnection();
    try { for (const s of statements) await conn.query(s); } finally { conn.release(); }
    await query('INSERT INTO schema_migrations (filename, checksum) VALUES (:file, :checksum)', { file, checksum });
    log(`applied ${file}`);
  }
}

/** ข้อมูลตั้งต้นที่ไม่ใช่ข้อมูลธุรกิจ: สิทธิ์ บทบาท และชื่อหลักสูตรตามแบบฟอร์ม (รันซ้ำได้) */
export async function seed() {
  for (const [key, name] of Object.entries(PERMISSIONS)) {
    await query('INSERT INTO permissions (permission_key, name) VALUES (:key, :name) ON DUPLICATE KEY UPDATE name = :name', { key, name });
  }
  for (const [key, role] of Object.entries(ROLES)) {
    await query('INSERT INTO roles (role_key, name) VALUES (:key, :name) ON DUPLICATE KEY UPDATE name = :name', { key, name: role.name });
    await query('DELETE rp FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.role_key = :key', { key });
    await query(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r JOIN permissions p ON p.permission_key IN (:perms) WHERE r.role_key = :key`, { key, perms: role.permissions });
  }
  await query('INSERT IGNORE INTO courses (code, name) VALUES (:code, :name)', {
    code: 'HAZ-SALES-CONTROLLER', name: 'หลักสูตรผู้ควบคุมการขายวัตถุอันตรายทางการเกษตร',
  });
}
