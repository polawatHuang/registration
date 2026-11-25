import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { PassThrough, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';

/**
 * สำรองฐานข้อมูลด้วย Node ล้วน (shared hosting มักไม่มี mysqldump ให้ผู้ใช้)
 * ไฟล์: JSONL → gzip → AES-256-GCM รูปแบบ "LSTB1" + iv 12 ไบต์ + ciphertext + tag 16 ไบต์
 * กุญแจแยกจากกุญแจข้อมูลด้วย HKDF แต่ได้จาก DATA_ENCRYPTION_KEY เดียวกัน กุญแจหาย = กู้ไม่ได้
 */
const MAGIC = Buffer.from('LSTB1');
const KEY = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64'), Buffer.alloc(0), 'lst-backup', 32));
export const BACKUP_DIR = path.join(env.storagePath, 'backups');
/** session ที่หมดอายุเองได้ ไม่สำรอง เพื่อไม่ให้ไฟล์สำรองใช้เข้าระบบแทนใครได้ */
const SKIP_ROWS = new Set(['admin_sessions', 'applicant_sessions', 'line_login_states', 'auth_attempts', 'job_locks', 'admin_line_codes']);
const ident = (n) => { if (!/^\w+$/.test(n)) throw new Error(`ชื่อไม่ถูกต้อง ${n}`); return `\`${n}\``; };
const encode = (v) => (v instanceof Date ? { $d: v.toISOString() } : Buffer.isBuffer(v) ? { $b: v.toString('base64') } : typeof v === 'bigint' ? String(v) : v);
const decode = (v) => (v && typeof v === 'object' ? ('$d' in v ? new Date(v.$d) : Buffer.from(v.$b, 'base64')) : v);

export async function backup() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const name = `db-${new Date().toISOString().replace(/[:.]/g, '-')}.lstb`;
  const tmp = path.join(BACKUP_DIR, `${name}.part`);
  const conn = await pool.getConnection();
  const counts = {};
  let source = null;
  const lock = `lst_backup_${crypto.createHash('sha256').update(env.DB_NAME).digest('hex').slice(0, 32)}`;
  const [[{ ok }]] = await conn.query('SELECT GET_LOCK(?, 0) AS ok', [lock]);
  if (Number(ok) !== 1) { conn.release(); throw Object.assign(new Error('กำลังสำรองอยู่แล้ว'), { code: 'BACKUP_RUNNING' }); }
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT'); // ทุกตารางเห็นข้อมูลเวลาเดียวกัน
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    source = new PassThrough();
    const out = fs.createWriteStream(tmp, { mode: 0o600, flags: 'wx' });
    out.write(Buffer.concat([MAGIC, iv]));
    const sink = new Writable({ write(c, _e, cb) { if (out.write(c)) cb(); else out.once('drain', cb); }, final(cb) { out.end(cipher.getAuthTag(), cb); } });
    out.on('error', (e) => source.destroy(e));
    const flow = pipeline(source, zlib.createGzip({ level: 6 }), cipher, sink);
    flow.catch(() => {});
    const emit = async (o) => { if (!source.write(`${JSON.stringify(o)}\n`)) await Promise.race([new Promise((r) => { source.once('drain', r); }), flow]); };
    const [tables] = await conn.query("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
    await emit({ type: 'meta', version: 1, at: new Date().toISOString() });
    for (const { n: table } of tables) {
      const [[ddl]] = await conn.query(`SHOW CREATE TABLE ${ident(table)}`);
      const [cols] = await conn.query("SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA NOT LIKE '%STORED GENERATED%' AND EXTRA NOT LIKE '%VIRTUAL GENERATED%' AND EXTRA NOT LIKE '%PERSISTENT%' ORDER BY ORDINAL_POSITION", [table]);
      // DEFAULT_GENERATED ของ MySQL 8 คือค่าเริ่มต้นเวลา ไม่ใช่คอลัมน์คำนวณ ต้องสำรองด้วย
      const columns = cols.map((c) => c.n);
      await emit({ type: 'table', table, ddl: ddl['Create Table'], columns });
      counts[table] = 0;
      if (SKIP_ROWS.has(table)) continue;
      const [keys] = await conn.query("SELECT COLUMN_NAME AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX", [table]);
      const order = keys.length ? `ORDER BY ${keys.map((k) => ident(k.n)).join(', ')}` : '';
      for (let offset = 0; ; offset += 1000) {
        const [rows] = await conn.query(`SELECT ${columns.map(ident).join(', ')} FROM ${ident(table)} ${order} LIMIT 1000 OFFSET ${offset}`);
        for (const r of rows) await emit({ type: 'row', v: columns.map((c) => encode(r[c])) });
        counts[table] += rows.length;
        if (rows.length < 1000) break;
      }
    }
    await emit({ type: 'end', counts });
    source.end();
    await flow;
    await conn.query('COMMIT');
    await fsp.rename(tmp, path.join(BACKUP_DIR, name));
  } catch (err) {
    source?.destroy(err); // ปิดไฟล์และ stream ที่เปิดค้าง
    await conn.query('ROLLBACK').catch(() => {});
    await fsp.rm(tmp, { force: true });
    throw err;
  } finally { await conn.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {}); conn.release(); }
  const file = path.join(BACKUP_DIR, name);
  return { file, name, bytes: (await fsp.stat(file)).size, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), counts };
}

/** ตรวจ tag ให้จบก่อนใช้ข้อมูลใดๆ ไฟล์ที่ถูกแก้หรือขาดจึงไม่มีทางถูกกู้ครึ่งเดียว */
async function* readLines(file) {
  const { size } = await fsp.stat(file);
  const fh = await fsp.open(file);
  const head = Buffer.alloc(17); const tag = Buffer.alloc(16);
  await fh.read(head, 0, 17, 0); await fh.read(tag, 0, 16, size - 16); await fh.close();
  if (size < 34 || !head.subarray(0, 5).equals(MAGIC)) throw new Error('ไม่ใช่ไฟล์สำรองของระบบนี้');
  const open = () => { const d = crypto.createDecipheriv('aes-256-gcm', KEY, head.subarray(5)); d.setAuthTag(tag); return [fs.createReadStream(file, { start: 17, end: size - 17 }), d]; };
  try { await pipeline(...open(), new Writable({ write(_c, _e, cb) { cb(); } })); } catch { throw new Error('ไฟล์เสียหาย ถูกแก้ไข หรือใช้กุญแจ DATA_ENCRYPTION_KEY คนละชุด'); }
  const [stream, d] = open();
  for await (const line of readline.createInterface({ input: stream.pipe(d).pipe(zlib.createGunzip()), crlfDelay: Infinity })) yield JSON.parse(line);
}
export async function verify(file) {
  const counts = {}; let table = null; let end = null; let at = null;
  for await (const o of readLines(file)) {
    if (o.type === 'meta') at = o.at;
    else if (o.type === 'table') { table = o.table; counts[table] = 0; } else if (o.type === 'row') counts[table] += 1; else if (o.type === 'end') end = o.counts;
  }
  if (!end || JSON.stringify(end) !== JSON.stringify(counts)) throw new Error('ไฟล์สำรองไม่ครบ');
  return { at, counts, rows: Object.values(counts).reduce((a, b) => a + b, 0) };
}
/** กู้ได้เฉพาะฐานข้อมูลว่าง ไม่มีทางเขียนทับข้อมูลจริงโดยพลาด */
export async function restore(file) {
  await verify(file);
  const [existing] = await pool.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  if (Number(existing[0].n)) throw new Error('ฐานข้อมูลปลายทางไม่ว่าง ให้สร้างฐานข้อมูลใหม่แล้วแก้ DB_NAME ใน .env ก่อน');
  const conn = await pool.getConnection();
  let rows = 0; let table = null; let columns = []; let batch = [];
  const flush = async () => { if (!batch.length) return; await conn.query(`INSERT INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES ?`, [batch]); rows += batch.length; batch = []; };
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_AUTO_VALUE_ON_ZERO')");
    for await (const o of readLines(file)) {
      if (o.type === 'table') { await flush(); table = o.table; columns = o.columns; await conn.query(o.ddl); } else if (o.type === 'row') { batch.push(o.v.map(decode)); if (batch.length >= 200) await flush(); }
    }
    await flush();
  } finally { await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {}); conn.destroy(); }
  return { rows };
}
export async function listBackups() {
  const names = (await fsp.readdir(BACKUP_DIR).catch(() => [])).filter((n) => /^db-.*\.lstb$/.test(n)).sort();
  return Promise.all(names.map(async (name) => ({ name, bytes: (await fsp.stat(path.join(BACKUP_DIR, name))).size })));
}
/** เก็บ keep ไฟล์ล่าสุด ลบเฉพาะไฟล์สำรองของระบบนี้ */
export async function prune(keep) {
  const all = await listBackups();
  const old = all.slice(0, Math.max(0, all.length - keep));
  for (const o of old) await fsp.rm(path.join(BACKUP_DIR, o.name), { force: true });
  // ไฟล์ค้างจากโปรเซสที่ถูกปิดกลางทาง
  for (const n of await fsp.readdir(BACKUP_DIR).catch(() => [])) if (n.endsWith('.lstb.part') && Date.now() - (await fsp.stat(path.join(BACKUP_DIR, n))).mtimeMs > 86_400_000) await fsp.rm(path.join(BACKUP_DIR, n), { force: true });
  return old.length;
}
