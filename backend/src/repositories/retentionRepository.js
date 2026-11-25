import { query, queryOne } from '../config/db.js';
import * as notifications from './notificationRepository.js';
import { deleteForLineUser } from './chatRepository.js';

const APP = `SELECT a.id, a.application_no, a.full_name, a.status, a.session_id, s.session_name, s.ends_at, u.name AS university_name
  FROM applications a JOIN training_sessions s ON s.id = a.session_id JOIN universities u ON u.id = s.university_id`;
const PAST = (col) => `${col} < DATE_SUB(UTC_TIMESTAMP(), INTERVAL :limit MONTH)`;
const WHERE = {
  documents: `a.hold_at IS NULL AND a.status NOT IN ('rejected','cancelled') AND ${PAST('s.ends_at')}
    AND EXISTS (SELECT 1 FROM application_documents d WHERE d.application_id = a.id AND d.file_purged_at IS NULL)`,
  applications: `a.hold_at IS NULL AND a.status NOT IN ('rejected','cancelled') AND ${PAST('s.ends_at')}`,
  rejected: `a.hold_at IS NULL AND a.status IN ('rejected','cancelled')
    AND ${PAST('COALESCE((SELECT MAX(h.created_at) FROM application_status_history h WHERE h.application_id = a.id AND h.to_status = a.status), a.updated_at)')}`,
  withdrawn: `a.hold_at IS NULL AND EXISTS (SELECT 1 FROM consents c JOIN application_documents d ON d.application_id = c.application_id AND d.doc_type = 'id_card'
    WHERE c.application_id = a.id AND c.purpose = 'sensitive_id_card' AND c.withdrawn_at IS NOT NULL AND d.file_purged_at IS NULL AND d.created_at <= c.withdrawn_at)`,
};
const LINE_WHERE = `NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.line_user_id = l.id) AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.line_user_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM line_account_links k WHERE k.line_user_id = l.id AND k.status = 'active') AND ${PAST('COALESCE(l.last_interaction_at, l.created_at)')}`;
const LOG_WHERE = 'created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL :limit DAY)';

export const isAppKind = (kind) => kind in WHERE;
export async function countDue(kind, limit) {
  const sql = kind === 'line_users' ? `SELECT COUNT(*) AS n FROM line_users l WHERE ${LINE_WHERE}` : kind === 'logs' ? `SELECT COUNT(*) AS n FROM admin_audit_logs WHERE ${LOG_WHERE}`
    : `SELECT COUNT(*) AS n FROM applications a JOIN training_sessions s ON s.id = a.session_id WHERE ${WHERE[kind]}`;
  return (await queryOne(sql, { limit })).n;
}
export function listDue(kind, limit, { page, pageSize }) {
  const p = { limit, size: pageSize, offset: (page - 1) * pageSize };
  if (kind === 'line_users') return query(`SELECT l.id, l.display_name, l.last_interaction_at FROM line_users l WHERE ${LINE_WHERE} ORDER BY l.id LIMIT :size OFFSET :offset`, p);
  if (kind === 'logs') return [];
  return query(`${APP} WHERE ${WHERE[kind]} ORDER BY s.ends_at, a.id LIMIT :size OFFSET :offset`, p);
}
/** ตรวจเงื่อนไขซ้ำใน transaction หลังล็อกแถว กันข้อมูลเปลี่ยนระหว่างที่เจ้าหน้าที่ดูรายการ */
export const lockDueApplication = (kind, id, limit, conn) => queryOne(`SELECT a.id, a.applicant_id, a.application_no, a.session_id, a.status, a.line_user_id
  FROM applications a JOIN training_sessions s ON s.id = a.session_id WHERE a.id = :id AND ${WHERE[kind]} FOR UPDATE`, { id, limit }, conn);
export const lockApplication = (id, conn) => queryOne('SELECT id, applicant_id, application_no, session_id, status, line_user_id, email, hold_at FROM applications WHERE id = :id FOR UPDATE', { id }, conn);
export const lockDueLineUser = (id, limit, conn) => queryOne(`SELECT l.id, l.line_user_id FROM line_users l WHERE l.id = :id AND ${LINE_WHERE} FOR UPDATE`, { id, limit }, conn);

export async function purgeDocumentFiles(applicationId, conn, { docType = null, before = null, olderThan = null } = {}) {
  const docs = await query(`SELECT id, storage_name, is_current FROM application_documents WHERE application_id = :applicationId AND file_purged_at IS NULL
    AND (:docType IS NULL OR doc_type = :docType) AND (:before IS NULL OR created_at <= :before) AND (:olderThan IS NULL OR created_at < :olderThan) FOR UPDATE`, { applicationId, docType, before, olderThan }, conn);
  for (const d of docs) {
    await query('INSERT IGNORE INTO purge_files (storage_name) VALUES (:name)', { name: d.storage_name }, conn);
    await query("UPDATE application_documents SET storage_name = NULL, original_name = '', sha256 = '', review_reason = NULL, file_purged_at = UTC_TIMESTAMP() WHERE id = :id", { id: d.id }, conn);
  }
  return docs;
}
export const withdrawnAt = async (applicationId, conn) => (await queryOne("SELECT withdrawn_at FROM consents WHERE application_id = :applicationId AND purpose = 'sensitive_id_card'", { applicationId }, conn))?.withdrawn_at ?? null;
export const rejectPurgedIdCard = (applicationId, reason, conn) => query(`UPDATE application_documents SET review_status = 'rejected', review_reason = :reason
  WHERE application_id = :applicationId AND doc_type = 'id_card' AND is_current = 1 AND file_purged_at IS NOT NULL`, { applicationId, reason }, conn);

/** ลบใบสมัครและทุกตารางลูกจริง แล้วลบบุคคล/LINE ถ้าไม่เหลือใบอื่น */
export async function deleteApplication(app, conn) {
  const id = app.id;
  await purgeDocumentFiles(id, conn);
  await notifications.deleteForApplication(id, conn);
  for (const sql of ['DELETE FROM attendance_records WHERE application_id = :id', 'DELETE FROM attendance_scans WHERE application_id = :id', 'DELETE FROM attendance_qr WHERE application_id = :id',
    'UPDATE certificates SET application_id = NULL, holder_name = NULL, revoke_reason = NULL WHERE application_id = :id',
    'DELETE FROM email_queue WHERE application_id = :id', 'DELETE FROM consents WHERE application_id = :id', 'DELETE FROM application_documents WHERE application_id = :id',
    'DELETE FROM application_status_history WHERE application_id = :id', 'DELETE FROM applicant_sessions WHERE application_id = :id',
    "DELETE FROM domain_events WHERE aggregate_type = 'application' AND aggregate_id = :id",
    "UPDATE admin_audit_logs SET metadata_json = NULL, ip_address = CASE WHEN actor_type = 'applicant' THEN NULL ELSE ip_address END WHERE entity_type = 'application' AND entity_id = CAST(:id AS CHAR)",
    'UPDATE data_requests SET application_id = NULL, note = NULL WHERE application_id = :id', 'DELETE FROM applications WHERE id = :id']) await query(sql, { id }, conn);
  const applicantId = app.applicant_id;
  await query('SELECT id FROM applicants WHERE id = :applicantId FOR UPDATE', { applicantId }, conn);
  if (!(await query('SELECT id FROM applications WHERE applicant_id = :applicantId LIMIT 1 FOR UPDATE', { applicantId }, conn)).length) {
    await query('DELETE FROM line_account_links WHERE applicant_id = :applicantId', { applicantId }, conn);
    await query("UPDATE admin_audit_logs SET metadata_json = NULL WHERE entity_type = 'applicant' AND entity_id = CAST(:applicantId AS CHAR)", { applicantId }, conn);
    await query('DELETE FROM applicants WHERE id = :applicantId', { applicantId }, conn);
  }
  if (app.line_user_id) {
    const used = await query(`SELECT 1 FROM applications WHERE line_user_id = :l LIMIT 1 FOR UPDATE`, { l: app.line_user_id }, conn);
    const linked = await query("SELECT 1 FROM line_account_links WHERE line_user_id = :l AND status = 'active' LIMIT 1 FOR UPDATE", { l: app.line_user_id }, conn);
    const staff = await query('SELECT 1 FROM admin_users WHERE line_user_id = :l LIMIT 1', { l: app.line_user_id }, conn);
    if (!used.length && !linked.length && !staff.length) await deleteLineUser(app.line_user_id, conn);
  }
}
export async function deleteLineUser(id, conn) {
  await deleteForLineUser(id, conn);
  await notifications.deleteForLineUser(id, conn);
  for (const sql of ['DELETE FROM applicant_sessions WHERE line_user_id = :id', 'DELETE FROM line_account_links WHERE line_user_id = :id',
    "UPDATE admin_audit_logs SET metadata_json = NULL, ip_address = NULL WHERE entity_type = 'line_user' AND entity_id = CAST(:id AS CHAR)", 'DELETE FROM line_users WHERE id = :id']) await query(sql, { id }, conn);
}
export const deleteLogs = async (limit, conn) => (await query(`DELETE FROM admin_audit_logs WHERE ${LOG_WHERE} LIMIT 20000`, { limit }, conn)).affectedRows + await notifications.deleteOld(limit, conn)
  + (await query(`DELETE FROM attendance_scans WHERE ${LOG_WHERE} LIMIT 20000`, { limit }, conn)).affectedRows;

export const insertPurgeLog = (p, conn) => query(`INSERT INTO purge_log (kind, reason, ref, session_id, final_status, item_count, approved_by, created_at)
  VALUES (:kind, :reason, :ref, :sessionId, :status, :count, :adminId, UTC_TIMESTAMP())`, { ref: null, sessionId: null, status: null, count: 1, adminId: null, ...p }, conn);
export const listPurgeLog = ({ page, pageSize }) => query(`SELECT l.id, l.kind, l.reason, l.final_status, l.item_count, l.created_at, s.session_name, u.display_name AS admin_name
  FROM purge_log l LEFT JOIN training_sessions s ON s.id = l.session_id LEFT JOIN admin_users u ON u.id = l.approved_by ORDER BY l.id DESC LIMIT :size OFFSET :offset`, { size: pageSize, offset: (page - 1) * pageSize });
export const countPurgeLog = async () => (await queryOne('SELECT COUNT(*) AS n FROM purge_log')).n;
export const ledgerRows = () => query("SELECT kind, ref, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS at FROM purge_log WHERE ref IS NOT NULL ORDER BY id");
export const pendingFiles = () => query('SELECT storage_name FROM purge_files LIMIT 500');
export const fileDone = (name) => query('DELETE FROM purge_files WHERE storage_name = :name', { name });

export const insertRequest = (r) => query(`INSERT INTO data_requests (request_code, application_id, note, due_at, created_at)
  VALUES (:code, :applicationId, :note, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 90 DAY), UTC_TIMESTAMP())`, r);
export const requestOf = (applicationId) => queryOne('SELECT id, request_code, status, decision_reason, due_at, decided_at, created_at FROM data_requests WHERE application_id = :applicationId ORDER BY id DESC LIMIT 1', { applicationId });
export const cancelRequest = async (applicationId) => (await query("UPDATE data_requests SET status = 'cancelled', note = NULL, decided_at = UTC_TIMESTAMP() WHERE application_id = :applicationId AND status = 'pending'", { applicationId })).affectedRows;
export const listRequests = ({ page, pageSize }) => query(`SELECT r.id, r.request_code, r.application_id, r.note, r.status, r.decision_reason, r.due_at, r.created_at, r.decided_at, r.notified_at,
  a.application_no, a.full_name, a.status AS app_status, a.hold_at, u.display_name AS admin_name, e.status AS email_status, e.error_message AS email_error
  FROM data_requests r LEFT JOIN applications a ON a.id = r.application_id LEFT JOIN admin_users u ON u.id = r.decided_by LEFT JOIN email_queue e ON e.id = r.email_id
  ORDER BY FIELD(r.status, 'pending', 'approved', 'rejected', 'cancelled'), r.due_at, r.id LIMIT :size OFFSET :offset`, { size: pageSize, offset: (page - 1) * pageSize });
export const countRequests = () => queryOne("SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending, SUM(status = 'pending' AND due_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 14 DAY)) AS urgent FROM data_requests");
export const lockRequest = (id, conn) => queryOne('SELECT * FROM data_requests WHERE id = :id FOR UPDATE', { id }, conn);
export const decideRequest = (r, conn) => query('UPDATE data_requests SET status = :status, decision_reason = :reason, decided_by = :adminId, decided_at = UTC_TIMESTAMP(), email_id = :emailId WHERE id = :id', r, conn);
export const markNotified = (id, conn) => query('UPDATE data_requests SET notified_at = UTC_TIMESTAMP() WHERE id = :id', { id }, conn);
export const setHold = (h, conn) => query('UPDATE applications SET hold_reason = :reason, hold_by = :adminId, hold_at = CASE WHEN :reason IS NULL THEN NULL ELSE UTC_TIMESTAMP() END WHERE id = :id', h, conn);
