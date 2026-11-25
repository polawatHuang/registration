import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, query } from '../config/db.js';
import { ROOT } from '../config/env.js';
import { PERMISSIONS, ROLES } from '../config/permissions.js';

const DIR = path.join(ROOT, 'backend/database/migrations');

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

async function loadMigrations() {
  const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(files.map(async (file) => {
    const sql = await fs.readFile(path.join(DIR, file), 'utf8');
    return { file, checksum: sha(sql), statements: sql.replace(/^--.*$/gm, '').split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean) };
  }));
}

/** แยกด้วย comma ชั้นนอกสุด ไม่ตัดในวงเล็บหรือในเครื่องหมายคำพูด */
function splitTopLevel(text) {
  const parts = ['']; let depth = 0; let quoted = false;
  for (const ch of text) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') parts.push(''); else parts[parts.length - 1] += ch;
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

const NAMED_KEY = /^(?:UNIQUE\s+|FULLTEXT\s+)?(?:KEY|INDEX)\s+`?(\w+)/i;
const NAMED_FK = /^CONSTRAINT\s+`?(\w+)/i;
const NOT_A_COLUMN = /^(?:PRIMARY|UNIQUE|FULLTEXT|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK)\b/i;

/** สิ่งที่คำสั่งสร้างขึ้น: ใช้ยืนยันว่าของที่มีอยู่แล้วมาจากคำสั่งนี้จริง */
export function statementCreates(sql) {
  const create = sql.match(/^CREATE TABLE\s+`?(\w+)`?\s*\(([\s\S]*)\)[^)]*$/i);
  const alter = sql.match(/^ALTER TABLE\s+`?(\w+)`?\s+([\s\S]*)$/i);
  if (!create && !alter) return null;
  const parts = create ? splitTopLevel(create[2])
    : splitTopLevel(alter[2]).filter((p) => /^ADD\s/i.test(p)).map((p) => p.replace(/^ADD\s+(?:COLUMN\s+)?/i, ''));
  const out = { table: (create ?? alter)[1], columns: [], keys: [], constraints: [] };
  for (const p of parts) {
    if (NAMED_FK.test(p)) out.constraints.push(p.match(NAMED_FK)[1]);
    else if (NAMED_KEY.test(p)) out.keys.push(p.match(NAMED_KEY)[1]);
    else if (!NOT_A_COLUMN.test(p)) out.columns.push(p.match(/^`?(\w+)/)[1]);
  }
  return out;
}

async function missingParts(want, conn) {
  const names = async (sql) => new Set((await query(sql, { t: want.table }, conn)).map((r) => String(r.n).toLowerCase()));
  const where = 'TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t';
  const have = [
    await names(`SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS WHERE ${where}`),
    await names(`SELECT DISTINCT INDEX_NAME AS n FROM information_schema.STATISTICS WHERE ${where}`),
    await names(`SELECT CONSTRAINT_NAME AS n FROM information_schema.TABLE_CONSTRAINTS WHERE ${where}`),
  ];
  return [want.columns, want.keys, want.constraints].flatMap((list, i) => list.filter((n) => !have[i].has(n.toLowerCase())));
}

const ALREADY = new Set(['ER_TABLE_EXISTS_ERROR', 'ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME']);

async function runStatement(sql, where, conn, log) {
  try { await conn.query(sql); } catch (err) {
    const want = statementCreates(sql);
    if (!ALREADY.has(err.code) || !want) throw new Error(`${where} ไม่สำเร็จ: ${err.message}`, { cause: err });
    const missing = await missingParts(want, conn);
    if (missing.length) {
      throw new Error(`${where}: มีตาราง ${want.table} อยู่แล้วแต่โครงสร้างไม่ตรง (ขาด ${missing.join(', ')}) อาจเป็นตารางของระบบอื่น จึงหยุดโดยไม่แก้ไขหรือลบตารางนั้น ให้ใช้ฐานข้อมูลที่ว่างหรือตรวจสอบก่อน`, { cause: err });
    }
    log(`พบ ${want.table} จากการรันครั้งก่อน โครงสร้างตรงกัน ใช้ต่อ`);
  }
}

/**
 * DDL ของ MySQL ย้อนไม่ได้ จึงจดทุกคำสั่งที่สำเร็จ เพื่อให้รันซ้ำแล้วทำต่อจากจุดที่ค้าง
 * ฐานข้อมูลที่ค้างโดยไม่มีบันทึกจะใช้ของเดิมต่อเมื่อโครงสร้างตรงเท่านั้น และไม่มีการลบตารางในทุกกรณี
 */
export async function migrate(log = () => {}) {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [{ db }] = await query('SELECT DATABASE() AS db', {}, conn);
    const lock = `lst_migrate_${sha(db).slice(0, 32)}`;
    const [{ ok }] = await query('SELECT GET_LOCK(:lock, 10) AS ok', { lock }, conn);
    if (Number(ok) !== 1) throw new Error('มีการรัน db:migrate อีกชุดกำลังทำงานอยู่ รอให้เสร็จแล้วรันใหม่ครั้งเดียว');
    locked = lock;
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(150) PRIMARY KEY, checksum CHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migration_steps (
      filename VARCHAR(150) NOT NULL, statement_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (filename, statement_hash)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const done = new Map((await query('SELECT filename, checksum FROM schema_migrations', {}, conn)).map((r) => [r.filename, r.checksum]));
    for (const { file, checksum, statements } of await loadMigrations()) {
      if (done.has(file)) {
        if (done.get(file) !== checksum) throw new Error(`Migration ${file} ถูกแก้หลังใช้งานแล้ว ให้สร้างไฟล์ใหม่แทน`);
        continue;
      }
      const steps = new Set((await query('SELECT statement_hash AS h FROM schema_migration_steps WHERE filename = :file', { file }, conn)).map((r) => r.h));
      for (const [i, sql] of statements.entries()) {
        const hash = sha(sql);
        if (steps.has(hash)) continue;
        await runStatement(sql, `${file} คำสั่งที่ ${i + 1}/${statements.length}`, conn, log);
        await query('INSERT IGNORE INTO schema_migration_steps (filename, statement_hash) VALUES (:file, :hash)', { file, hash }, conn);
      }
      await query('INSERT INTO schema_migrations (filename, checksum) VALUES (:file, :checksum)', { file, checksum }, conn);
      await query('DELETE FROM schema_migration_steps WHERE filename = :file', { file }, conn);
      log(`applied ${file}`);
    }
  } finally {
    if (locked) await query('SELECT RELEASE_LOCK(:lock)', { lock: locked }, conn).catch(() => {});
    conn.release();
  }
}

/** อ่านอย่างเดียว ไม่มีข้อมูลส่วนบุคคลหรือความลับในผลลัพธ์ */
export async function migrationStatus() {
  const [{ version }] = await query('SELECT VERSION() AS version');
  const tables = new Set((await query('SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')).map((r) => r.n));
  const done = new Set(tables.has('schema_migrations') ? (await query('SELECT filename FROM schema_migrations')).map((r) => r.filename) : []);
  const migrations = await loadMigrations();
  const expected = migrations.flatMap((m) => m.statements).filter((s) => /^CREATE TABLE/i.test(s)).map((s) => statementCreates(s).table);
  const count = async (t) => (tables.has(t) ? Number((await query(`SELECT COUNT(*) AS n FROM ${t}`))[0].n) : 0);
  return {
    version,
    migrations: migrations.map((m) => ({ file: m.file, applied: done.has(m.file) })),
    expected: expected.length,
    missing: expected.filter((t) => !tables.has(t)),
    roles: await count('roles'), admins: await count('admin_users'),
  };
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
