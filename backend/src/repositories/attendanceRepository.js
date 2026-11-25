import { query, queryOne } from '../config/db.js';

/** วันตามเวลาไทย (UTC+7 ตลอดปี) ไม่พึ่งตาราง timezone ของฐานข้อมูล */
const BKK = (col) => `DATE(DATE_ADD(${col}, INTERVAL 7 HOUR))`;

export const findQr = (applicationId, conn) => queryOne('SELECT nonce, issue_count, issued_at FROM attendance_qr WHERE application_id = :applicationId', { applicationId }, conn);
export const insertQr = (applicationId, nonce, conn) => query('INSERT IGNORE INTO attendance_qr (application_id, nonce, issued_at) VALUES (:applicationId, :nonce, UTC_TIMESTAMP())', { applicationId, nonce }, conn);
export const replaceQr = (applicationId, nonce, conn) => query(`INSERT INTO attendance_qr (application_id, nonce, issued_at) VALUES (:applicationId, :nonce, UTC_TIMESTAMP())
  ON DUPLICATE KEY UPDATE nonce = :nonce, issue_count = issue_count + 1, issued_at = UTC_TIMESTAMP()`, { applicationId, nonce }, conn);

export const sessions = () => query(`SELECT s.id, s.session_name, s.starts_at, s.ends_at, s.status, s.require_checkout, s.min_minutes, s.min_days, u.name AS university_name, c.name AS course_name,
  (SELECT COUNT(*) FROM applications a WHERE a.session_id = s.id AND a.status IN ('approved','awaiting_training','attended','passed','certified')) AS expected,
  (SELECT COUNT(DISTINCT r.application_id) FROM attendance_records r WHERE r.session_id = s.id) AS attended
  FROM training_sessions s JOIN universities u ON u.id = s.university_id JOIN courses c ON c.id = s.course_id
  WHERE s.status NOT IN ('draft','cancelled') ORDER BY ABS(TIMESTAMPDIFF(HOUR, s.starts_at, UTC_TIMESTAMP())) LIMIT 100`);
export const findSession = (id, conn) => queryOne(`SELECT s.*, u.name AS university_name, c.name AS course_name FROM training_sessions s
  JOIN universities u ON u.id = s.university_id JOIN courses c ON c.id = s.course_id WHERE s.id = :id`, { id }, conn);

export const personOf = (applicationId, conn) => queryOne('SELECT a.id, a.application_no, a.full_name, a.session_id, a.status, a.applicant_id, s.session_name FROM applications a JOIN training_sessions s ON s.id = a.session_id WHERE a.id = :applicationId', { applicationId }, conn);
export const recordOfDay = (applicationId, day, conn) => queryOne("SELECT id, DATE_FORMAT(day, '%Y-%m-%d') AS day, check_in_at, check_out_at FROM attendance_records WHERE application_id = :applicationId AND day = :day FOR UPDATE", { applicationId, day }, conn);
export const recordsOf = (applicationId, conn) => query(`SELECT r.id, DATE_FORMAT(r.day, '%Y-%m-%d') AS day, r.check_in_at, r.check_in_method, r.check_out_at, r.check_out_method, r.note, i.display_name AS in_by, o.display_name AS out_by
  FROM attendance_records r LEFT JOIN admin_users i ON i.id = r.check_in_by LEFT JOIN admin_users o ON o.id = r.check_out_by WHERE r.application_id = :applicationId ORDER BY r.day`, { applicationId }, conn);
export const insertRecord = async (r, conn) => (await query(`INSERT INTO attendance_records (application_id, session_id, day, check_in_at, check_in_by, check_in_method, note)
  VALUES (:applicationId, :sessionId, :day, :at, :adminId, :method, :note)`, r, conn)).insertId;
export const setCheckout = (r, conn) => query('UPDATE attendance_records SET check_out_at = :at, check_out_by = :adminId, check_out_method = :method, note = COALESCE(:note, note) WHERE id = :id', r, conn);
export const clearCheckout = async (id, conn) => (await query('UPDATE attendance_records SET check_out_at = NULL, check_out_by = NULL, check_out_method = NULL WHERE id = :id AND check_out_at IS NOT NULL', { id }, conn)).affectedRows;
export const deleteRecord = (id, conn) => query('DELETE FROM attendance_records WHERE id = :id', { id }, conn);
export const findRecord = (id, conn) => queryOne("SELECT id, application_id, session_id, DATE_FORMAT(day, '%Y-%m-%d') AS day, check_out_at FROM attendance_records WHERE id = :id", { id }, conn);
export const insertScan = (s, conn) => query(`INSERT INTO attendance_scans (session_id, application_id, admin_id, action, method, result, ip_address, created_at)
  VALUES (:sessionId, :applicationId, :adminId, :action, :method, :result, :ip, UTC_TIMESTAMP())`, s, conn);
export const recentScans = (sessionId) => query(`SELECT c.id, c.action, c.method, c.result, c.created_at, a.full_name, a.application_no, u.display_name AS admin_name FROM attendance_scans c
  LEFT JOIN applications a ON a.id = c.application_id LEFT JOIN admin_users u ON u.id = c.admin_id WHERE c.session_id = :sessionId ORDER BY c.id DESC LIMIT 100`, { sessionId });

const PRESENT = "a.status IN ('approved','awaiting_training','attended','passed','certified')";
/** นาทีรวมนับเฉพาะวันที่มีทั้งเข้าและออก */
export const roster = (f, conn) => query(`SELECT a.id, a.application_no, a.full_name, a.mobile, a.status,
  COUNT(r.id) AS days, COALESCE(SUM(r.check_out_at IS NOT NULL), 0) AS days_out, COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(MINUTE, r.check_in_at, r.check_out_at))), 0) AS minutes,
  MAX(CASE WHEN r.day = :day THEN r.check_in_at END) AS today_in, MAX(CASE WHEN r.day = :day THEN r.check_out_at END) AS today_out, MIN(r.check_in_at) AS first_in
  FROM applications a LEFT JOIN attendance_records r ON r.application_id = a.id
  WHERE a.session_id = :sessionId AND ${PRESENT} ${f.q ? 'AND (a.full_name LIKE :like OR CONVERT(a.application_no USING utf8mb4) LIKE :like OR a.mobile LIKE :like)' : ''} ${f.ids ? 'AND a.id IN (:ids)' : ''}
  GROUP BY a.id, a.application_no, a.full_name, a.mobile, a.status ORDER BY a.full_name LIMIT 3000`, { like: f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null, ...f }, conn);
export const dailyCheckins = () => query(`SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, COUNT(*) AS n FROM attendance_records WHERE day >= DATE_SUB(${BKK('UTC_TIMESTAMP()')}, INTERVAL 13 DAY) GROUP BY day ORDER BY day`);
export const countAttended = async () => (await queryOne('SELECT COUNT(DISTINCT application_id) AS n FROM attendance_records')).n;
