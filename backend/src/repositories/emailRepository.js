import { query, queryOne } from '../config/db.js';

export const enqueue = (e, conn) => query(`INSERT INTO email_queue (application_id, template, idempotency_key, next_attempt_at)
  VALUES (:applicationId, :template, :key, UTC_TIMESTAMP())`, e, conn);
export const enqueueStatus = async (e, conn) => (await query(`INSERT IGNORE INTO email_queue (application_id, template, idempotency_key, payload_json, next_attempt_at)
  VALUES (:applicationId, 'status', :key, :payload, UTC_TIMESTAMP())`, e, conn)).affectedRows;
export const markCancelled = (id, token) => query("UPDATE email_queue SET status = 'cancelled', error_message = 'ข้อความล้าสมัยหรือปิดใช้', payload_json = NULL WHERE id = :id AND claim_token = :token", { id, token });
export const enqueueNotice = async (e, conn) => (await query(`INSERT INTO email_queue (template, idempotency_key, recipient_enc, payload_json, next_attempt_at)
  VALUES (:template, :key, :recipient, :payload, UTC_TIMESTAMP())`, e, conn)).insertId;
export const retryNotice = async (id, conn) => (await query("UPDATE email_queue SET status = 'pending', retry_count = 0, next_attempt_at = UTC_TIMESTAMP(), error_message = NULL WHERE id = :id AND status IN ('failed','pending') AND recipient_enc IS NOT NULL", { id }, conn)).affectedRows;
export const clearNotice = (id, conn) => query("UPDATE email_queue SET status = CASE WHEN status = 'sent' THEN 'sent' ELSE 'cancelled' END, recipient_enc = NULL, payload_json = NULL WHERE id = :id", { id }, conn);
/** จองงานด้วย UPDATE ครั้งเดียว (ใช้ได้ทั้ง MySQL 8 และ MariaDB) หลายโปรเซสจึงไม่ส่งซ้ำ */
export async function claim(token, limit) {
  await query("UPDATE email_queue SET status = 'pending', claim_token = NULL WHERE status = 'processing' AND claimed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)");
  await query("UPDATE email_queue SET status = 'cancelled', error_message = 'เก่าเกิน 7 วัน' WHERE status = 'pending' AND template IN ('registration', 'status') AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)");
  await query(`UPDATE email_queue SET status = 'processing', claim_token = :token, claimed_at = UTC_TIMESTAMP()
    WHERE status = 'pending' AND next_attempt_at <= UTC_TIMESTAMP() ORDER BY id LIMIT :limit`, { token, limit });
  return query("SELECT id, application_id, template, idempotency_key, retry_count, recipient_enc, payload_json FROM email_queue WHERE claim_token = :token AND status = 'processing' ORDER BY id", { token });
}
export const markSent = (id, token) => query("UPDATE email_queue SET status = 'sent', sent_at = UTC_TIMESTAMP(), error_message = NULL, recipient_enc = NULL, payload_json = NULL WHERE id = :id AND claim_token = :token", { id, token });
export const markRetry = (id, token, minutes, error) => query(`UPDATE email_queue SET status = 'pending', retry_count = retry_count + 1, claim_token = NULL, error_message = :error,
  next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :minutes MINUTE) WHERE id = :id AND claim_token = :token`, { id, token, minutes, error });
export const markFailed = (id, token, error) => query("UPDATE email_queue SET status = 'failed', retry_count = retry_count + 1, error_message = :error WHERE id = :id AND claim_token = :token", { id, token, error });
export const latestOf = (applicationId) => queryOne("SELECT status, sent_at, retry_count, error_message, created_at FROM email_queue WHERE application_id = :applicationId AND template = 'registration' ORDER BY id DESC LIMIT 1", { applicationId });
export const countRecent = async (applicationId, conn) => (await queryOne("SELECT COUNT(*) AS n FROM email_queue WHERE application_id = :applicationId AND template = 'registration' AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)", { applicationId }, conn)).n;
