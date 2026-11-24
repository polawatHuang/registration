import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  connectionLimit: env.DB_POOL_SIZE, charset: 'utf8mb4_unicode_ci', timezone: 'Z', dateStrings: ['DATE'],
  namedPlaceholders: true, stringifyObjects: true, enableKeepAlive: true,
});
// ทุก connection ทำงานเป็น UTC (NOW() = UTC) ไม่ขึ้นกับเวลาของเครื่อง hosting
pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));

export async function query(sql, params = {}, conn = pool) {
  const [rows] = await conn.query(sql, params);
  return rows;
}
export async function queryOne(sql, params = {}, conn = pool) {
  return (await query(sql, params, conn))[0] ?? null;
}

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
export async function withTransaction(fn, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (RETRYABLE.has(err.code) && attempt < retries) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
}
