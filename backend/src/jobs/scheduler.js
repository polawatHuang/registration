import { query } from '../config/db.js';
import { logger } from '../config/logger.js';
import { track } from '../utils/background.js';
import { runJobs } from './index.js';

const EVERY_MIN = 4;
let checkedAt = 0; let running = null;
async function due() {
  const [r] = await query('SELECT COUNT(*) AS n, MIN(TIMESTAMPDIFF(SECOND, COALESCE(last_finished_at, \'2000-01-01\'), UTC_TIMESTAMP())) AS s FROM job_locks');
  return !r.n || Number(r.s) >= EVERY_MIN * 60;
}
/**
 * รันงานเมื่อถึงรอบ เรียกได้จากทุกทาง (เปิดแอป ตัวปลุก /health ตัวจับเวลา) ล็อกในฐานข้อมูลกันรันซ้อนข้ามโปรเซส
 * โฮสต์ปิดโปรเซสเร็ว จึงพึ่งตัวจับเวลาอย่างเดียวไม่ได้
 */
export function runDue({ throttleMs = 30_000 } = {}) {
  if (running) return running;
  if (Date.now() - checkedAt < throttleMs) return Promise.resolve(null);
  checkedAt = Date.now();
  running = track((async () => {
    if (!(await due())) return null;
    const { failed } = await runJobs();
    if (failed.length) logger.warn({ failed }, 'scheduled jobs failed');
    return failed;
  })().catch((err) => { logger.error({ err: { message: err.message, code: err.code } }, 'scheduler failed'); return null; }).finally(() => { running = null; }));
  return running;
}
export function startScheduler({ every = 60_000, first = 3_000 } = {}) {
  const start = setTimeout(() => runDue({ throttleMs: 0 }), first); const timer = setInterval(() => runDue({ throttleMs: 0 }), every);
  start.unref(); timer.unref();
  return () => { clearTimeout(start); clearInterval(timer); };
}
