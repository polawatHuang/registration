import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  connectionLimit: env.DB_POOL_SIZE, charset: 'utf8mb4_unicode_ci', timezone: 'Z', dateStrings: ['DATE'],
  namedPlaceholders: true, stringifyObjects: true, enableKeepAlive: true,
});
// ทุก connection ทำงานเป็น UTC (NOW() = UTC) ไม่ขึ้นกับเวลาของเครื่อง hosting
pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));

const pause = (attempt) => new Promise((r) => { setTimeout(r, 15 * 2 ** attempt + Math.random() * 20); });
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
/** คำสั่งเดี่ยวนอก transaction: ผู้แพ้ deadlock ถูกย้อนทั้งคำสั่ง จึงลองใหม่ได้ ส่วนใน transaction ให้ withTransaction เริ่มใหม่ทั้งชุด */
export async function query(sql, params = {}, conn = pool) {
  for (let attempt = 0; ; attempt += 1) {
    try { return (await conn.query(sql, params))[0]; } catch (err) {
      if (conn !== pool || err.code !== 'ER_LOCK_DEADLOCK' || attempt >= 4) throw err;
      await pause(attempt);
    }
  }
}
export async function queryOne(sql, params = {}, conn = pool) {
  return (await query(sql, params, conn))[0] ?? null;
}

export async function withTransaction(fn, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (!RETRYABLE.has(err.code) || attempt >= retries) throw err;
    } finally {
      conn.release();
    }
    await pause(attempt); // หลังคืน connection แล้ว ไม่ให้ pool ตันระหว่างรอ
  }
}
