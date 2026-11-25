import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { withTransaction } from '../config/db.js';
import { logger } from '../config/logger.js';
import * as repo from '../repositories/emailRepository.js';
import * as apps from '../repositories/applicationRepository.js';
import { getSettings } from '../repositories/catalogRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { createTransport, explainMailError } from '../integrations/mailer.js';
import { emailConfig } from './integrationService.js';
import { erasureEmail, registrationEmail } from './emailTemplates.js';
import { decryptText, encryptText, sha256 } from '../utils/crypto.js';
import { notFound, tooMany } from '../utils/errors.js';

const BACKOFF = [1, 5, 30, 120];
const permanent = (err) => err.code !== 'EAUTH' && err.responseCode >= 500 && err.responseCode < 600;

/** เรียกใน transaction ของการสมัคร: ใบสมัครสำเร็จเมื่อไร อีเมลต้องอยู่ในคิวเสมอ */
export const queueRegistration = (applicationId, conn) => repo.enqueue({ applicationId, template: 'registration', key: `registration:${applicationId}` }, conn);

export const queueNotice = ({ template, to, key, payload }, conn) => repo.enqueueNotice({ template, key, recipient: encryptText(to, 'email_recipient'), payload: JSON.stringify(payload) }, conn);
export const retryNotice = (id, conn) => repo.retryNotice(id, conn);
export const clearNotice = (id, conn) => repo.clearNotice(id, conn);

/** ข้อความแจ้งสถานะทางอีเมล ผู้เรียกลงทะเบียนตัวสร้างเนื้อหาเอง เพื่อไม่ให้สอง service อ้างกันวน */
let statusRenderer = async () => null;
export const setStatusRenderer = (fn) => { statusRenderer = fn; };
export const queueStatus = ({ applicationId, type, startsAt = null, key }, conn) => repo.enqueueStatus({ applicationId, key, payload: JSON.stringify({ type, startsAt }) }, conn);

async function render(job, site) {
  if (job.template === 'status') {
    const app = await apps.findById(job.application_id);
    const mail = app && await statusRenderer(job, app);
    return mail ? { to: app.email, ...mail } : null;
  }
  if (job.template.startsWith('erasure_')) return { to: decryptText(job.recipient_enc, 'email_recipient'), ...erasureEmail(job.template === 'erasure_approved', JSON.parse(job.payload_json), site) };
  const row = await apps.findById(job.application_id);
  return { to: row.email, ...registrationEmail(row, decryptText(row.national_id_enc, 'national_id'), site) };
}

export async function processQueue(limit = 10) {
  const config = await emailConfig();
  if (!config) return { skipped: 'ยังไม่ได้ตั้งค่า SMTP' };
  const token = crypto.randomUUID();
  const jobs = await repo.claim(token, limit);
  const result = { sent: 0, retry: 0, failed: 0 };
  if (!jobs.length) return result;
  const site = await getSettings(['contact_phone', 'contact_email']);
  const transport = createTransport(config);
  try {
    for (const job of jobs) {
      try {
        const mail = await render(job, site);
        if (!mail) { await repo.markCancelled(job.id, token); continue; }
        await transport.sendMail({
          from: { name: config.smtp_from_name || 'E-Training', address: config.smtp_from_email }, ...mail,
          // Message-ID คงที่: ถ้าส่งซ้ำหลังโปรเซสล่ม โปรแกรมอีเมลส่วนใหญ่จะรวมเป็นฉบับเดียว
          messageId: `<${sha256(job.idempotency_key).slice(0, 32)}@${new URL(env.APP_URL).hostname}>`, headers: { 'Auto-Submitted': 'auto-generated' },
        });
        await repo.markSent(job.id, token);
        result.sent += 1;
      } catch (err) {
        const message = explainMailError(err);
        const wait = BACKOFF[job.retry_count];
        if (permanent(err) || wait === undefined) { await repo.markFailed(job.id, token, message); result.failed += 1; } else { await repo.markRetry(job.id, token, wait, message); result.retry += 1; }
        logger.warn({ emailId: job.id, code: err.code, responseCode: err.responseCode }, 'email delivery failed');
      }
    }
  } finally { transport.close(); }
  return result;
}
/** ส่งทันทีหลังตอบผู้สมัคร โดยไม่ให้ผู้สมัครรอ ถ้าพลาดงานตั้งเวลาจะเก็บต่อ */
export const kick = () => { processQueue().catch((err) => logger.error({ err: { message: err.message } }, 'email queue failed')); };

export async function resend(applicationId, { adminId, ip }) {
  await withTransaction(async (conn) => {
    if (!(await apps.lockById(applicationId, conn))) throw notFound('ไม่พบใบสมัคร');
    if (await repo.countRecent(applicationId, conn) >= 3) throw tooMany('ส่งอีเมลของใบนี้ครบ 3 ครั้งใน 1 ชั่วโมงแล้ว');
    await repo.enqueue({ applicationId, template: 'registration', key: `registration:${applicationId}:${crypto.randomUUID()}` }, conn);
    await insertAudit({ adminId, action: 'email.resend', entityType: 'application', entityId: applicationId, ip }, conn);
  });
  kick();
}
export const statusOf = (applicationId) => repo.latestOf(applicationId);
