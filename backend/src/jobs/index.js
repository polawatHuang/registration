import { logger } from '../config/logger.js';
import { query } from '../config/db.js';
import { flushFiles, syncLedger } from '../services/retentionService.js';
import { job } from '../services/notificationService.js';
import { maintenance } from '../services/chatService.js';
import { creditJob } from '../services/aiCreditService.js';
import { autoBackup } from '../services/backupService.js';
import { processQueue } from '../services/emailService.js';

/** งานตั้งเวลา: ล็อกใน DB กันรันซ้อนเมื่อมีหลายโปรเซส */
const JOBS = {
  // เก็บงานลบไฟล์ที่ค้าง ไม่มีการลบข้อมูลใหม่อัตโนมัติ
  purgeFiles: async () => ({ ...(await flushFiles()), ...(await syncLedger()) }),
  chat: () => maintenance(),
  notifications: () => job(),
  aiCredit: () => creditJob(),
  emails: () => processQueue(30),
  backup: () => autoBackup(),
  cleanup: async () => {
    const del = async (sql) => (await query(sql)).affectedRows;
    return {
      adminSessions: await del('DELETE FROM admin_sessions WHERE expires_at < UTC_TIMESTAMP()'),
      applicantSessions: await del('DELETE FROM applicant_sessions WHERE expires_at < UTC_TIMESTAMP()'),
      loginStates: await del('DELETE FROM line_login_states WHERE expires_at < UTC_TIMESTAMP()'),
      attempts: await del('DELETE FROM auth_attempts WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)'),
    };
  },
};

async function runJob(name, job) {
  await query('INSERT IGNORE INTO job_locks (job_name, locked_until) VALUES (:name, UTC_TIMESTAMP())', { name });
  const { affectedRows } = await query(`UPDATE job_locks SET locked_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)
    WHERE job_name = :name AND locked_until <= UTC_TIMESTAMP()`, { name });
  if (!affectedRows) return 'skipped';
  try {
    return await job();
  } finally {
    await query('UPDATE job_locks SET locked_until = UTC_TIMESTAMP(), last_finished_at = UTC_TIMESTAMP() WHERE job_name = :name', { name })
      .catch((err) => logger.error({ job: name, err: { code: err.code } }, 'job lock release failed'));
  }
}

/** งานที่ล้มต้องไม่ขวางงานอื่น ผลลัพธ์บอกเฉพาะรหัสสาเหตุ เพราะข้อความ error อาจมีข้อมูลส่วนบุคคล */
export async function runJobs(jobs = JOBS) {
  const results = {};
  const failed = [];
  for (const [name, job] of Object.entries(jobs)) {
    try { results[name] = await runJob(name, job); } catch (err) {
      const code = err.code ?? err.name ?? 'ERROR';
      logger.error({ job: name, err: { message: err.message, code: err.code, stack: err.stack } }, 'job failed');
      results[name] = { failed: code };
      failed.push(`${name} (${code})`);
    }
  }
  return { results, failed };
}
