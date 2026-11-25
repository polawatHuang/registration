import { query, queryOne } from '../config/db.js';

const BASE = `SELECT a.*, p.national_id_enc, s.session_name, s.starts_at, s.ends_at, s.location, s.map_url, s.details AS session_details,
  c.name AS course_name, u.name AS university_name, o.label AS shop_duration
  FROM applications a JOIN applicants p ON p.id = a.applicant_id JOIN training_sessions s ON s.id = a.session_id
  JOIN courses c ON c.id = s.course_id JOIN universities u ON u.id = s.university_id JOIN lookup_options o ON o.id = a.shop_duration_option_id`;

export const findById = (id, conn) => queryOne(`${BASE} WHERE a.id = :id`, { id }, conn);
export const findByIdempotency = (key) => queryOne(`SELECT a.id, p.national_id_hash FROM applications a
  JOIN applicants p ON p.id = a.applicant_id WHERE a.idempotency_key = :key`, { key });
export const lockById = (id, conn) => queryOne('SELECT id, applicant_id, session_id, line_user_id, status, has_trained_before FROM applications WHERE id = :id FOR UPDATE', { id }, conn);
export const findForAccess = (applicationNo, nationalIdHash, mobile, conn) => queryOne(`SELECT a.id, a.applicant_id, a.line_user_id, a.status
  FROM applications a JOIN applicants p ON p.id = a.applicant_id
  WHERE a.application_no = :applicationNo AND p.national_id_hash = :nationalIdHash AND a.mobile = :mobile`, { applicationNo, nationalIdHash, mobile }, conn);
/** ใบสมัครที่ session นี้มีสิทธิ์: ใบที่ยืนยันด้วยเลข, ใบที่ส่งขณะล็อกอิน LINE, หรือของบุคคลที่ผูกและตรวจตัวตนแล้ว */
export const listAccessible = ({ lineUserId, applicationId }) => query(`${BASE}
  WHERE a.id = :applicationId OR a.line_user_id = :lineUserId
    OR a.applicant_id IN (SELECT k.applicant_id FROM line_account_links k WHERE k.line_user_id = :lineUserId AND k.status = 'active')
  ORDER BY a.submitted_at DESC, a.id DESC`, { lineUserId, applicationId });

export async function upsertApplicant({ fullName, nationalIdEnc, nationalIdHash }, conn) {
  return (await query(`INSERT INTO applicants (full_name, national_id_enc, national_id_hash) VALUES (:fullName, :nationalIdEnc, :nationalIdHash)
    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, { fullName, nationalIdEnc, nationalIdHash }, conn)).insertId;
}
export const insertApplication = async (a, conn) => (await query(`INSERT INTO applications
  (application_no, applicant_id, session_id, line_user_id, idempotency_key, full_name, address, mobile, line_contact_id, email, shop_name, shop_address,
   shop_duration_option_id, has_trained_before, receipt_name, receipt_address, tax_id_enc, submitted_at)
  VALUES (:applicationNo, :applicantId, :sessionId, :lineUserId, :idempotencyKey, :fullName, :address, :mobile, :lineContactId, :email, :shopName, :shopAddress,
   :shopDurationId, :hasTrainedBefore, :receiptName, :receiptAddress, :taxIdEnc, UTC_TIMESTAMP())`, a, conn)).insertId;
export const insertConsent = (c, conn) => query(`INSERT INTO consents (application_id, purpose, notice_version, ip_address, accepted_at)
  VALUES (:applicationId, :purpose, :version, :ip, UTC_TIMESTAMP())`, c, conn);
export const consentsOf = (id) => query('SELECT purpose, notice_version, accepted_at, withdrawn_at FROM consents WHERE application_id = :id ORDER BY id', { id });
export const withdrawConsent = (id, purpose, conn) => query('UPDATE consents SET withdrawn_at = UTC_TIMESTAMP(3) WHERE application_id = :id AND purpose = :purpose AND withdrawn_at IS NULL', { id, purpose }, conn);
export const insertHistory = (h, conn) => query(`INSERT INTO application_status_history (application_id, from_status, to_status, reason, actor_type, actor_id)
  VALUES (:applicationId, :from, :to, :reason, :actorType, :actorId)`, h, conn);
export const insertEvent = (type, applicationId, payload, conn) => query(`INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload_json)
  VALUES (:type, 'application', :applicationId, :payload)`, { type, applicationId, payload: JSON.stringify(payload) }, conn);
export const updateStatus = (id, status, reason, conn) => query('UPDATE applications SET status = :status, status_reason = :reason WHERE id = :id', { id, status, reason }, conn);
export const setLineUser = (id, lineUserId, conn) => query('UPDATE applications SET line_user_id = :lineUserId WHERE id = :id', { id, lineUserId }, conn);
export const historyOf = (id) => query(`SELECT h.from_status, h.to_status, h.reason, h.actor_type, h.created_at, u.display_name AS admin_name
  FROM application_status_history h LEFT JOIN admin_users u ON u.id = h.actor_id AND h.actor_type = 'admin' WHERE h.application_id = :id ORDER BY h.id`, { id });

export const insertDocument = (d, conn) => query(`INSERT INTO application_documents
  (application_id, doc_type, version, original_name, storage_name, mime_type, size_bytes, sha256)
  VALUES (:applicationId, :docType, :version, :originalName, :storageName, :mime, :size, :sha256)`, d, conn);
export const currentDocuments = (id, conn) => query(`SELECT id, application_id, doc_type, version, original_name, storage_name, mime_type, size_bytes, review_status, review_reason, reviewed_at, created_at, file_purged_at
  FROM application_documents WHERE application_id = :id AND is_current = 1 ORDER BY FIELD(doc_type, 'id_card', 'previous_certificate', 'payment_slip', 'portrait_photo')`, { id }, conn);
export const findDocument = (id, applicationId, conn) => queryOne('SELECT * FROM application_documents WHERE id = :id AND application_id = :applicationId', { id, applicationId }, conn);
export const retireDocument = (id, conn) => query('UPDATE application_documents SET is_current = 0 WHERE id = :id', { id }, conn);
export const reviewDocument = (d, conn) => query(`UPDATE application_documents SET review_status = :decision, review_reason = :reason, reviewed_by = :adminId, reviewed_at = UTC_TIMESTAMP()
  WHERE id = :id`, d, conn);

function buildFilter({ q, status, sessionId, universityId, nationalIdHash }) {
  const w = [];
  const p = { status, sessionId, universityId, nationalIdHash };
  if (status) w.push('a.status = :status');
  if (sessionId) w.push('a.session_id = :sessionId');
  if (universityId) w.push('s.university_id = :universityId');
  if (q) {
    p.like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    w.push(`(a.full_name LIKE :like OR CONVERT(a.application_no USING utf8mb4) LIKE :like OR a.mobile LIKE :like OR a.email LIKE :like OR a.shop_name LIKE :like ${nationalIdHash ? 'OR p.national_id_hash = :nationalIdHash' : ''})`);
  }
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', p };
}
export async function search({ page, pageSize, ...f }) {
  const { where, p } = buildFilter(f);
  const rows = await query(`${BASE} ${where} ORDER BY a.submitted_at DESC, a.id DESC LIMIT :limit OFFSET :offset`, { ...p, limit: pageSize, offset: (page - 1) * pageSize });
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM applications a JOIN applicants p ON p.id = a.applicant_id JOIN training_sessions s ON s.id = a.session_id ${where}`, p);
  return { rows, total };
}

// ไทยเป็น UTC+7 ตลอดปี จึงบวก 7 ชั่วโมงแทนตาราง timezone ซึ่ง shared hosting มักไม่ติดตั้ง
const BKK_DATE = 'DATE(DATE_ADD(a.submitted_at, INTERVAL 7 HOUR))';
export async function dashboard() {
  const [statuses, daily, [today], [line], sessions] = await Promise.all([
    query('SELECT status, COUNT(*) AS n FROM applications GROUP BY status'),
    query(`SELECT DATE_FORMAT(${BKK_DATE}, '%Y-%m-%d') AS day, COUNT(*) AS n FROM applications a
      WHERE a.submitted_at >= DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR)), INTERVAL 14 DAY) GROUP BY day ORDER BY day`),
    query(`SELECT COUNT(*) AS n FROM applications a WHERE ${BKK_DATE} = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR))`),
    query("SELECT (SELECT COUNT(*) FROM line_users) AS users, (SELECT COUNT(*) FROM line_account_links WHERE status = 'active') AS linked"),
    query(`SELECT s.id, s.session_name, u.name AS university_name, s.capacity, s.starts_at,
      (SELECT COUNT(*) FROM applications a WHERE a.session_id = s.id AND a.active_flag = 1) AS registered
      FROM training_sessions s JOIN universities u ON u.id = s.university_id WHERE s.status = 'open' AND s.starts_at > UTC_TIMESTAMP() ORDER BY s.starts_at LIMIT 8`),
  ]);
  return { statuses, daily, today: today.n, line, sessions };
}
