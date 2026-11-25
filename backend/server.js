import * as nodeModule from 'node:module';
import { env } from './src/config/env.js';
import { logger } from './src/config/logger.js';
import { pool } from './src/config/db.js';
import { createApp } from './src/app.js';
import { startScheduler } from './src/jobs/scheduler.js';
import { drain, pendingTasks } from './src/utils/background.js';

const { flushCompileCache } = nodeModule;
// Passenger อาจกำหนด PORT เป็น socket path จึงไม่แปลงเป็นตัวเลขเสมอ
const port = /^\d+$/.test(env.PORT) ? Number(env.PORT) : env.PORT;
export const server = createApp().listen(port, (err) => {
  if (err) { logger.fatal({ err }, 'listen failed'); process.exit(1); }
  logger.info({ port: env.PORT }, 'LINE SMART TRAINING started');
  if (env.JOBS_IN_APP) startScheduler();
  // เขียนแคชทันที เผื่อโฮสต์ปิดโปรเซสแบบไม่รอ
  setTimeout(() => { try { flushCompileCache?.(); } catch { /* เขียนไม่ได้ก็ข้าม */ } }, 1500).unref();
});

let closing = false;
/** หยุดรับคำขอใหม่ รองานเบื้องหลังให้จบ (AI ใช้ได้ถึง 45 วินาที) แล้วจึงปิดฐานข้อมูล */
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info({ signal, tasks: pendingTasks() }, 'shutting down');
  setTimeout(() => process.exit(1), 58_000).unref();
  const closed = new Promise((r) => { server.close(r); });
  server.closeIdleConnections();
  await Promise.race([closed, new Promise((r) => { setTimeout(r, 10_000).unref(); })]);
  await drain(50_000);
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
process.on('uncaughtException', (err) => { logger.fatal({ err }, 'uncaught exception'); process.exit(1); });
