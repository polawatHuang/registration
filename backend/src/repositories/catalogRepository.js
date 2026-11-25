import { query, queryOne } from '../config/db.js';

export const listUniversities = (onlyActive) => query(`SELECT id, name, is_active, sort_order FROM universities ${onlyActive ? 'WHERE is_active = 1' : ''} ORDER BY sort_order, name`);
export const listCourses = () => query('SELECT id, code, name, is_active FROM courses ORDER BY id');
export const listOptions = (category, onlyActive) => query(`SELECT id, category, label, is_active, sort_order FROM lookup_options
  WHERE category = :category ${onlyActive ? 'AND is_active = 1' : ''} ORDER BY sort_order, id`, { category });
export const findActiveOption = (id, category) => queryOne('SELECT id FROM lookup_options WHERE id = :id AND category = :category AND is_active = 1', { id, category });

const SESSION = `SELECT s.*, c.name AS course_name, u.name AS university_name,
  (SELECT COUNT(*) FROM applications a WHERE a.session_id = s.id AND a.active_flag = 1) AS registered
  FROM training_sessions s JOIN courses c ON c.id = s.course_id JOIN universities u ON u.id = s.university_id`;
export const listSessions = () => query(`${SESSION} ORDER BY s.starts_at DESC, s.id DESC`);
export const findSession = (id, conn) => queryOne(`${SESSION} WHERE s.id = :id`, { id }, conn);
/** ไม่ระบุมหาวิทยาลัย = ทุกแห่ง */
export const listOpenSessions = (universityId = null) => query(`${SESSION}
  WHERE (:universityId IS NULL OR s.university_id = :universityId) AND s.status = 'open' AND s.starts_at > UTC_TIMESTAMP() AND u.is_active = 1 AND c.is_active = 1
    AND (s.registration_opens_at IS NULL OR s.registration_opens_at <= UTC_TIMESTAMP())
    AND (s.registration_closes_at IS NULL OR s.registration_closes_at > UTC_TIMESTAMP())
  ORDER BY s.starts_at`, { universityId });
/** ล็อกแถวรุ่นไว้จนจบ transaction เพื่อนับที่นั่งให้ถูกแม้สมัครพร้อมกัน */
export const lockOpenSession = (id, universityId, conn) => queryOne(`SELECT s.id, s.capacity FROM training_sessions s
  JOIN universities u ON u.id = s.university_id JOIN courses c ON c.id = s.course_id
  WHERE s.id = :id AND s.university_id = :universityId AND s.status = 'open' AND s.starts_at > UTC_TIMESTAMP() AND u.is_active = 1 AND c.is_active = 1
    AND (s.registration_opens_at IS NULL OR s.registration_opens_at <= UTC_TIMESTAMP())
    AND (s.registration_closes_at IS NULL OR s.registration_closes_at > UTC_TIMESTAMP()) FOR UPDATE`, { id, universityId }, conn);
export const countActive = async (sessionId, conn) => (await queryOne('SELECT COUNT(*) AS n FROM applications WHERE session_id = :sessionId AND active_flag = 1', { sessionId }, conn)).n;

export const insertUniversity = async (u, conn) => (await query('INSERT INTO universities (name, is_active, sort_order) VALUES (:name, :isActive, :sortOrder)', u, conn)).insertId;
export const updateUniversity = async (u, conn) => (await query('UPDATE universities SET name = :name, is_active = :isActive, sort_order = :sortOrder WHERE id = :id', u, conn)).affectedRows;
export const insertCourse = async (c, conn) => (await query('INSERT INTO courses (code, name, is_active) VALUES (:code, :name, :isActive)', c, conn)).insertId;
export const updateCourse = async (c, conn) => (await query('UPDATE courses SET code = :code, name = :name, is_active = :isActive WHERE id = :id', c, conn)).affectedRows;
export const insertOption = async (o, conn) => (await query('INSERT INTO lookup_options (category, label, is_active, sort_order) VALUES (:category, :label, :isActive, :sortOrder)', o, conn)).insertId;
export const updateOption = async (o, conn) => (await query('UPDATE lookup_options SET label = :label, is_active = :isActive, sort_order = :sortOrder WHERE id = :id', o, conn)).affectedRows;
export const insertSession = async (s, conn) => (await query(`INSERT INTO training_sessions
  (course_id, university_id, session_name, starts_at, ends_at, location, map_url, details, capacity, registration_opens_at, registration_closes_at, status, require_checkout, min_minutes, min_days)
  VALUES (:courseId, :universityId, :sessionName, :startsAt, :endsAt, :location, :mapUrl, :details, :capacity, :opensAt, :closesAt, :status, :requireCheckout, :minMinutes, :minDays)`, s, conn)).insertId;
export const updateSession = async (s, conn) => (await query(`UPDATE training_sessions SET course_id = :courseId, university_id = :universityId,
  session_name = :sessionName, starts_at = :startsAt, ends_at = :endsAt, location = :location, map_url = :mapUrl, details = :details, capacity = :capacity,
  registration_opens_at = :opensAt, registration_closes_at = :closesAt, status = :status,
  require_checkout = :requireCheckout, min_minutes = :minMinutes, min_days = :minDays WHERE id = :id`, s, conn)).affectedRows;

const remover = (table) => async (id, conn) => (await query(`DELETE FROM ${table} WHERE id = :id`, { id }, conn)).affectedRows;
export const deleteUniversity = remover('universities');
export const deleteCourse = remover('courses');
export const deleteOption = remover('lookup_options');
export const deleteSession = remover('training_sessions');

export const getSettings = async (keys) => Object.fromEntries((await query('SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (:keys)', { keys }))
  .map((r) => [r.setting_key, r.setting_value]));
export const getSettingRows = (keys) => query('SELECT setting_key, setting_value, is_encrypted, updated_at FROM system_settings WHERE setting_key IN (:keys)', { keys });
export const putSetting = (key, value, encrypted, conn) => query(`INSERT INTO system_settings (setting_key, setting_value, is_encrypted) VALUES (:key, :value, :encrypted)
  ON DUPLICATE KEY UPDATE setting_value = :value, is_encrypted = :encrypted`, { key, value, encrypted }, conn);
export const deleteSetting = (key, conn) => query('DELETE FROM system_settings WHERE setting_key = :key', { key }, conn);
export const insertLegalVersion = (version, json, adminId) => query('INSERT IGNORE INTO legal_versions (version, fields_json, published_by) VALUES (:version, :json, :adminId)', { version, json, adminId });
export const setSetting = (key, value, conn) => query(`INSERT INTO system_settings (setting_key, setting_value) VALUES (:key, :value)
  ON DUPLICATE KEY UPDATE setting_value = :value`, { key, value }, conn);
