import { query } from '../config/db.js';
import { flushFiles, syncLedger } from '../services/retentionService.js';
import { maintenance } from '../services/chatService.js';
import { processQueue } from '../services/emailService.js';

/** งานตั้งเวลา: ล็อกใน DB กันรันซ้อนเมื่อมีหลายโปรเซส */
const JOBS = {
  // เก็บงานลบไฟล์ที่ค้าง ไม่มีการลบข้อมูลใหม่อัตโนมัติ
  purgeFiles: async () => ({ ...(await flushFiles()), ...(await syncLedger()) }),
  chat: () => maintenance(),
  emails: () => processQueue(30),
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

export async function runJobs() {
  const results = {};
  for (const [name, job] of Object.entries(JOBS)) {
    await query('INSERT IGNORE INTO job_locks (job_name, locked_until) VALUES (:name, UTC_TIMESTAMP())', { name });
    const { affectedRows } = await query(`UPDATE job_locks SET locked_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)
      WHERE job_name = :name AND locked_until <= UTC_TIMESTAMP()`, { name });
    if (!affectedRows) { results[name] = 'skipped'; continue; }
    try {
      results[name] = await job();
    } finally {
      await query('UPDATE job_locks SET locked_until = UTC_TIMESTAMP(), last_finished_at = UTC_TIMESTAMP() WHERE job_name = :name', { name });
    }
  }
  return results;
}
