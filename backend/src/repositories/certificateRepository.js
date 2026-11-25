import { query, queryOne } from '../config/db.js';

export const listTemplates = () => query(`SELECT t.id, t.name, t.course_id, t.storage_name IS NOT NULL AS has_image, t.layout_json, t.created_at, c.name AS course_name,
  (SELECT COUNT(*) FROM certificates x WHERE x.template_id = t.id) AS used FROM certificate_templates t LEFT JOIN courses c ON c.id = t.course_id WHERE t.is_active = 1 ORDER BY t.course_id IS NULL, t.id DESC`);
export const findTemplate = (id, conn) => queryOne('SELECT * FROM certificate_templates WHERE id = :id', { id }, conn);
/** แบบเฉพาะหลักสูตรมาก่อนแบบกลาง แบบล่าสุดมาก่อน */
export const templateFor = (courseId, conn) => queryOne('SELECT * FROM certificate_templates WHERE is_active = 1 AND (course_id = :courseId OR course_id IS NULL) ORDER BY course_id IS NULL, id DESC LIMIT 1', { courseId }, conn);
export const insertTemplate = async (t, conn) => (await query(`INSERT INTO certificate_templates (name, course_id, storage_name, mime_type, layout_json, created_by) VALUES (:name, :courseId, :storageName, :mime, :layout, :adminId)`, t, conn)).insertId;
export const updateTemplate = (t, conn) => query('UPDATE certificate_templates SET name = :name, course_id = :courseId, storage_name = :storageName, mime_type = :mime, layout_json = :layout WHERE id = :id', t, conn);
export const retireTemplate = async (id, conn) => (await query('UPDATE certificate_templates SET is_active = 0 WHERE id = :id AND is_active = 1', { id }, conn)).affectedRows;
export const usedCount = async (id, conn) => (await queryOne('SELECT COUNT(*) AS n FROM certificates WHERE template_id = :id', { id }, conn)).n;
export const imageShared = async (name, conn) => (await queryOne('SELECT COUNT(*) AS n FROM certificate_templates WHERE storage_name = :name', { name }, conn)).n > 0;

export async function nextNumber(prefix, year, conn) {
  await query('INSERT IGNORE INTO certificate_counters (prefix, year) VALUES (:prefix, :year)', { prefix, year }, conn);
  const { last_no: last } = await queryOne('SELECT last_no FROM certificate_counters WHERE prefix = :prefix AND year = :year FOR UPDATE', { prefix, year }, conn);
  await query('UPDATE certificate_counters SET last_no = last_no + 1 WHERE prefix = :prefix AND year = :year', { prefix, year }, conn);
  return last + 1;
}
export const insert = async (c, conn) => (await query(`INSERT INTO certificates (certificate_no, verify_code, application_id, holder_name, course_name, university_name, session_name, starts_at, ends_at, template_id, issued_at, issued_by)
  VALUES (:no, :code, :applicationId, :name, :course, :university, :session, :startsAt, :endsAt, :templateId, UTC_TIMESTAMP(), :adminId)`, c, conn)).insertId;
export const findById = (id, conn) => queryOne('SELECT * FROM certificates WHERE id = :id', { id }, conn);
export const lock = (id, conn) => queryOne('SELECT * FROM certificates WHERE id = :id FOR UPDATE', { id }, conn);
export const findByCode = (code) => queryOne('SELECT * FROM certificates WHERE verify_code = :code', { code });
export const validOf = (applicationId, conn) => queryOne("SELECT * FROM certificates WHERE application_id = :applicationId AND status = 'valid'", { applicationId }, conn);
export const revoke = (c, conn) => query("UPDATE certificates SET status = 'revoked', revoke_reason = :reason, revoked_at = UTC_TIMESTAMP(), revoked_by = :adminId WHERE id = :id", c, conn);
export const candidates = (sessionId) => query(`SELECT a.id, a.application_no, a.full_name, a.status, c.id AS certificate_id, c.certificate_no, c.issued_at FROM applications a
  LEFT JOIN certificates c ON c.application_id = a.id AND c.status = 'valid' WHERE a.session_id = :sessionId AND a.status IN ('passed','certified') ORDER BY a.status = 'certified', a.full_name LIMIT 3000`, { sessionId });
const WHERE = (f) => `${f.q ? 'AND (c.holder_name LIKE :like OR CONVERT(c.certificate_no USING utf8mb4) LIKE :like)' : ''} ${f.status ? 'AND c.status = :status' : ''}`;
const params = (f) => ({ ...f, like: f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null });
export const list = (f) => query(`SELECT c.id, c.certificate_no, c.verify_code, c.application_id, c.holder_name, c.course_name, c.session_name, c.university_name, c.status, c.revoke_reason, c.issued_at, u.display_name AS admin_name
  FROM certificates c LEFT JOIN admin_users u ON u.id = c.issued_by WHERE 1 = 1 ${WHERE(f)} ORDER BY c.id DESC LIMIT :limit OFFSET :offset`, params(f));
export const count = async (f) => (await queryOne(`SELECT COUNT(*) AS n FROM certificates c WHERE 1 = 1 ${WHERE(f)}`, params(f))).n;
export const countValid = async () => (await queryOne("SELECT COUNT(*) AS n FROM certificates WHERE status = 'valid'")).n;
