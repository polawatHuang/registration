import { logger } from '../config/logger.js';
import { runJobs } from './index.js';

/**
 * ตัวตั้งเวลาในแอป: ทำงานทุก 5 นาทีตราบที่โปรเซสยังอยู่ ไม่ต้องพึ่ง curl หรือ secret
 * ล็อกใน DB กันรันซ้อนกับโปรเซสอื่นและ Scheduled Task Passenger อาจปิดโปรเซสเมื่อไม่มีคนใช้
 * จึงควรมีตัวปลุกเรียก /api/v1/health ทุก 5 นาที (Plesk: Fetch a URL)
 */
export function startScheduler({ every = 300_000, first = 20_000 } = {}) {
  const run = async () => {
    try { const { failed } = await runJobs(); if (failed.length) logger.warn({ failed }, 'scheduled jobs failed'); } catch (err) { logger.error({ err: { message: err.message } }, 'scheduler failed'); }
  };
  const start = setTimeout(run, first); const timer = setInterval(run, every);
  start.unref(); timer.unref();
  return () => { clearTimeout(start); clearInterval(timer); };
}
