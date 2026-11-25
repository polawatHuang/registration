import { query, queryOne } from '../config/db.js';

// ---------- เหตุการณ์ ----------
export const pendingEvents = (conn) => query('SELECT id, event_type, aggregate_type, aggregate_id, payload_json, created_at FROM domain_events WHERE processed_at IS NULL ORDER BY id LIMIT 200 FOR UPDATE', {}, conn);
export const eventsDone = (ids, conn) => query('UPDATE domain_events SET processed_at = UTC_TIMESTAMP() WHERE id IN (:ids)', { ids }, conn);
export const insertEvent = (type, aggregateType, aggregateId, conn) => query('INSERT INTO domain_events (event_type, aggregate_type, aggregate_id) VALUES (:type, :aggregateType, :aggregateId)', { type, aggregateType, aggregateId }, conn);

// ---------- ผู้รับ ----------
/** LINE ของใบสมัคร: ที่ผูกกับใบ หรือที่ผูกกับบุคคลหลังตรวจตัวตนแล้วเท่านั้น */
export const lineOfApplication = (id, conn) => queryOne(`SELECT COALESCE(a.line_user_id, k.line_user_id) AS line_user_id FROM applications a
  LEFT JOIN line_account_links k ON k.applicant_id = a.applicant_id AND k.status = 'active' WHERE a.id = :id`, { id }, conn);
export const checkinOf = (recordId, applicationId) => queryOne('SELECT check_in_at FROM attendance_records WHERE id = :recordId AND application_id = :applicationId', { recordId, applicationId });
export const findLineUser = (id) => queryOne('SELECT id, line_user_id, status, friend_status, campaign_opt_out FROM line_users WHERE id = :id', { id });
export const setFriend = (id, status) => query('UPDATE line_users SET friend_status = :status WHERE id = :id', { id, status });
export const setOptOut = (id, value, conn) => query('UPDATE line_users SET campaign_opt_out = :value WHERE id = :id', { id, value }, conn);

// ---------- template ----------
export const listTemplates = () => query('SELECT template_key, title, content_json, is_custom, is_active, updated_at FROM notification_templates ORDER BY is_custom, title');
export const findTemplate = (key, conn) => queryOne('SELECT template_key, title, content_json, is_custom, is_active FROM notification_templates WHERE template_key = :key', { key }, conn);
export const upsertTemplate = (t, conn) => query(`INSERT INTO notification_templates (template_key, title, content_json, is_custom, is_active, updated_by) VALUES (:key, :title, :content, :custom, :active, :adminId)
  ON DUPLICATE KEY UPDATE title = :title, content_json = :content, is_active = :active, updated_by = :adminId`, t, conn);
export const deleteTemplate = async (key, conn) => (await query('DELETE FROM notification_templates WHERE template_key = :key AND is_custom = 1', { key }, conn)).affectedRows;

// ---------- คิว ----------
const INSERT = `INSERT IGNORE INTO notification_queue (line_user_id, application_id, admin_id, campaign_id, notification_type, payload_json, scheduled_at, expires_at, next_attempt_at, idempotency_key, retry_key, created_at)`;
export const enqueue = async (n, conn) => (await query(`${INSERT} VALUES (:lineUserId, :applicationId, NULL, NULL, :type, :payload, COALESCE(:at, UTC_TIMESTAMP()), COALESCE(:expires, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 48 HOUR)), COALESCE(:at, UTC_TIMESTAMP()), :key, UUID(), UTC_TIMESTAMP())`,
  { payload: null, at: null, expires: null, ...n }, conn)).affectedRows;
/** หน้าต่างเวลา (วินาที): รายการในหน้าต่างเดียวกันรวมเป็นข้อความเดียว และส่งเมื่อหน้าต่างปิดแล้วเท่านั้นจึงไม่มีการนับตกหล่น */
export const enqueueAdmin = (event, seconds, conn) => query(`INSERT INTO notification_queue (admin_id, notification_type, scheduled_at, expires_at, next_attempt_at, idempotency_key, retry_key, created_at)
  SELECT p.admin_id, :type, w.at, DATE_ADD(w.at, INTERVAL 12 HOUR), w.at, CONCAT('admin:', :event, ':', p.admin_id, ':', UNIX_TIMESTAMP(w.at)), UUID(), UTC_TIMESTAMP()
  FROM admin_notification_prefs p JOIN admin_users u ON u.id = p.admin_id AND u.status = 'active' AND u.line_user_id IS NOT NULL
  JOIN (SELECT FROM_UNIXTIME((FLOOR(UNIX_TIMESTAMP(UTC_TIMESTAMP()) / :seconds) + 1) * :seconds) AS at) w WHERE p.event_type = :event
  ON DUPLICATE KEY UPDATE item_count = item_count + 1`, { event, seconds, type: `admin_${event}` }, conn);

export async function claim(token, limit) {
  await query("UPDATE notification_queue SET status = 'pending', claim_token = NULL WHERE status = 'processing' AND claimed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)");
  await query("UPDATE notification_queue SET status = 'cancelled', error_message = 'พ้นเวลาที่ควรส่ง' WHERE status = 'pending' AND expires_at < UTC_TIMESTAMP()");
  await query(`UPDATE notification_queue SET status = 'processing', claim_token = :token, claimed_at = UTC_TIMESTAMP()
    WHERE status = 'pending' AND next_attempt_at <= UTC_TIMESTAMP() ORDER BY next_attempt_at, id LIMIT :limit`, { token, limit });
  return query("SELECT * FROM notification_queue WHERE claim_token = :token AND status = 'processing' ORDER BY id", { token });
}
export const nextDue = async () => (await queryOne("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), MIN(next_attempt_at)) AS s FROM notification_queue WHERE status = 'pending' AND next_attempt_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)")).s;
export const release = (token) => query("UPDATE notification_queue SET status = 'pending', claim_token = NULL, next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE) WHERE claim_token = :token AND status = 'processing'", { token });
export const finish = (q) => query(`UPDATE notification_queue SET status = :status, error_message = :error, sent_at = CASE WHEN :status = 'sent' THEN UTC_TIMESTAMP() ELSE NULL END,
  retry_count = retry_count + :tried WHERE id = :id AND claim_token = :token`, q);
export const retryLater = (q) => query(`UPDATE notification_queue SET status = 'pending', claim_token = NULL, error_message = :error, retry_count = retry_count + :tried,
  next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :minutes MINUTE) WHERE id = :id AND claim_token = :token`, q);
export const insertLog = (l) => query('INSERT INTO notification_logs (queue_id, request_payload, response_payload, status, error_code, created_at) VALUES (:queueId, :request, :response, :status, :code, UTC_TIMESTAMP())', l);
export const logsOf = (id) => query('SELECT id, request_payload, response_payload, status, error_code, created_at FROM notification_logs WHERE queue_id = :id ORDER BY id', { id });
export const requeue = async (id) => (await query("UPDATE notification_queue SET status = 'pending', retry_count = 0, next_attempt_at = UTC_TIMESTAMP(), expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 48 HOUR), error_message = NULL, claim_token = NULL, retry_key = CASE WHEN created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 23 HOUR) THEN retry_key ELSE UUID() END WHERE id = :id AND status = 'failed'", { id })).affectedRows;
export const cancel = async (id) => (await query("UPDATE notification_queue SET status = 'cancelled', error_message = 'เจ้าหน้าที่ยกเลิก' WHERE id = :id AND status = 'pending'", { id })).affectedRows;
const LIST_WHERE = (f) => `${f.status ? 'AND q.status = :status' : ''} ${f.type === 'admin' ? 'AND q.admin_id IS NOT NULL' : f.type === 'campaign' ? 'AND q.campaign_id IS NOT NULL' : f.type === 'applicant' ? 'AND q.application_id IS NOT NULL AND q.campaign_id IS NULL' : ''}`;
export const listQueue = (f) => query(`SELECT q.id, q.notification_type, q.status, q.item_count, q.scheduled_at, q.sent_at, q.retry_count, q.error_message, q.campaign_id, a.application_no, a.full_name, u.display_name AS admin_name, c.title AS campaign_title
  FROM notification_queue q LEFT JOIN applications a ON a.id = q.application_id LEFT JOIN admin_users u ON u.id = q.admin_id LEFT JOIN notification_campaigns c ON c.id = q.campaign_id
  WHERE 1 = 1 ${LIST_WHERE(f)} ORDER BY q.id DESC LIMIT :limit OFFSET :offset`, f);
export const countQueue = async (f) => (await queryOne(`SELECT COUNT(*) AS n FROM notification_queue q WHERE 1 = 1 ${LIST_WHERE(f)}`, f)).n;
export const stats = () => query("SELECT status, COUNT(*) AS n FROM notification_queue WHERE created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) GROUP BY status");
export const daily = () => query(`SELECT DATE_FORMAT(DATE(DATE_ADD(sent_at, INTERVAL 7 HOUR)), '%Y-%m-%d') AS day, COUNT(*) AS n FROM notification_queue WHERE status = 'sent' AND sent_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY) GROUP BY day ORDER BY day`);

// ---------- เตือนตามเวลา ----------
/** คีย์ผูกกับเวลาเริ่ม: เลื่อนรุ่นแล้วเตือนใหม่ตามเวลาจริง */
export const dueReminders = (type, from, to) => query(`SELECT a.id, s.starts_at, s.ends_at FROM applications a JOIN training_sessions s ON s.id = a.session_id
  WHERE ${type === 'evaluation' ? "a.status IN ('attended','passed','certified') AND s.ends_at > :from AND s.ends_at <= :to" : "a.status IN ('approved','awaiting_training') AND s.status NOT IN ('draft','cancelled') AND s.starts_at > :from AND s.starts_at <= :to"}
  AND NOT EXISTS (SELECT 1 FROM notification_queue q WHERE q.idempotency_key = CONCAT(:type, ':', a.id, ':', UNIX_TIMESTAMP(${type === 'evaluation' ? 's.ends_at' : 's.starts_at'}))) LIMIT 2000`, { type, from, to });

// ---------- ส่งกลุ่ม ----------
const CAMPAIGN_FROM = `FROM applications a JOIN training_sessions s ON s.id = a.session_id LEFT JOIN line_account_links k ON k.applicant_id = a.applicant_id AND k.status = 'active'
  JOIN line_users l ON l.id = COALESCE(a.line_user_id, k.line_user_id) WHERE l.status = 'active' AND l.friend_status <> 'blocked' AND l.campaign_opt_out = 0`;
const campaignWhere = (f) => `${f.sessionId ? 'AND a.session_id = :sessionId' : ''} ${f.universityId ? 'AND s.university_id = :universityId' : ''} AND a.status IN (:statuses)`;
export const countTargets = async (f, conn) => (await queryOne(`SELECT COUNT(DISTINCT l.id) AS n ${CAMPAIGN_FROM} ${campaignWhere(f)}`, f, conn)).n;
export const insertCampaign = async (c, conn) => (await query(`INSERT INTO notification_campaigns (title, content_json, filter_json, recipient_count, scheduled_at, client_key, created_by, created_at)
  VALUES (:title, :content, :filter, :count, COALESCE(:at, UTC_TIMESTAMP()), :clientKey, :adminId, UTC_TIMESTAMP())`, c, conn)).insertId;
/** หนึ่งคนได้หนึ่งข้อความ แม้มีหลายใบ */
export const enqueueCampaign = async (c, conn) => (await query(`${INSERT} SELECT t.line_id, t.app_id, NULL, :campaignId, 'campaign', NULL, COALESCE(:at, UTC_TIMESTAMP()), DATE_ADD(COALESCE(:at, UTC_TIMESTAMP()), INTERVAL 24 HOUR), COALESCE(:at, UTC_TIMESTAMP()), CONCAT('campaign:', :campaignId, ':', t.line_id), UUID(), UTC_TIMESTAMP()
  FROM (SELECT l.id AS line_id, MAX(a.id) AS app_id ${CAMPAIGN_FROM} ${campaignWhere(c)} GROUP BY l.id) t`, c, conn)).affectedRows;
export const findCampaignByKey = (clientKey) => queryOne('SELECT id, recipient_count FROM notification_campaigns WHERE client_key = :clientKey', { clientKey });
export const findCampaign = (id) => queryOne('SELECT * FROM notification_campaigns WHERE id = :id', { id });
export const listCampaigns = () => query(`SELECT c.id, c.title, c.recipient_count, c.scheduled_at, c.status, c.created_at, u.display_name AS admin_name, SUM(q.status = 'sent') AS sent, SUM(q.status = 'failed') AS failed, SUM(q.status IN ('pending','processing')) AS pending
  FROM notification_campaigns c LEFT JOIN notification_queue q ON q.campaign_id = c.id LEFT JOIN admin_users u ON u.id = c.created_by GROUP BY c.id, c.title, c.recipient_count, c.scheduled_at, c.status, c.created_at, u.display_name ORDER BY c.id DESC LIMIT 50`);
export async function cancelCampaign(id, conn) {
  const { affectedRows } = await query("UPDATE notification_campaigns SET status = 'cancelled' WHERE id = :id AND status = 'active'", { id }, conn);
  if (!affectedRows) return null;
  return (await query("UPDATE notification_queue SET status = 'cancelled', error_message = 'ยกเลิกการส่งกลุ่ม' WHERE campaign_id = :id AND status = 'pending'", { id }, conn)).affectedRows;
}

// ---------- เจ้าหน้าที่ ----------
export const prefs = () => query("SELECT u.id, u.display_name, u.role_id, r.name AS role_name, u.line_user_id IS NOT NULL AS linked, l.display_name AS line_name, GROUP_CONCAT(p.event_type) AS events FROM admin_users u JOIN roles r ON r.id = u.role_id LEFT JOIN line_users l ON l.id = u.line_user_id LEFT JOIN admin_notification_prefs p ON p.admin_id = u.id WHERE u.status = 'active' GROUP BY u.id, u.display_name, u.role_id, r.name, u.line_user_id, l.display_name ORDER BY u.id");
export async function setPrefs(adminId, events, conn) {
  await query('DELETE FROM admin_notification_prefs WHERE admin_id = :adminId', { adminId }, conn);
  for (const event of events) await query('INSERT INTO admin_notification_prefs (admin_id, event_type) VALUES (:adminId, :event)', { adminId, event }, conn);
}
export const adminRecipient = (id) => queryOne('SELECT u.id, u.status, u.role_id, l.id AS line_id, l.line_user_id, l.friend_status FROM admin_users u LEFT JOIN line_users l ON l.id = u.line_user_id WHERE u.id = :id', { id });
export const setAdminLine = (adminId, lineUserId, conn) => query('UPDATE admin_users SET line_user_id = :lineUserId WHERE id = :adminId', { adminId, lineUserId }, conn);
export const clearAdminLine = (lineUserId, conn) => query('UPDATE admin_users SET line_user_id = NULL WHERE line_user_id = :lineUserId', { lineUserId }, conn);
export const saveCode = (adminId, codeHash) => query('INSERT INTO admin_line_codes (code_hash, admin_id, expires_at) VALUES (:codeHash, :adminId, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)) ON DUPLICATE KEY UPDATE code_hash = :codeHash, expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)', { adminId, codeHash });
export const takeCode = (codeHash, conn) => queryOne("SELECT c.admin_id FROM admin_line_codes c JOIN admin_users u ON u.id = c.admin_id AND u.status = 'active' WHERE c.code_hash = :codeHash AND c.expires_at > UTC_TIMESTAMP() FOR UPDATE", { codeHash }, conn);
export const deleteCode = (adminId, conn) => query('DELETE FROM admin_line_codes WHERE admin_id = :adminId', { adminId }, conn);

// ---------- PDPA ----------
export const deleteForApplication = (id, conn) => query('DELETE FROM notification_queue WHERE application_id = :id', { id }, conn);
export async function deleteForLineUser(id, conn) {
  await query('DELETE FROM notification_queue WHERE line_user_id = :id', { id }, conn);
  await clearAdminLine(id, conn);
}
export const deleteOld = async (days, conn) => (await query("DELETE FROM notification_queue WHERE status IN ('sent','failed','cancelled') AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL :days DAY)", { days }, conn)).affectedRows;
