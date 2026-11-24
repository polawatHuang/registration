import { query, queryOne } from '../config/db.js';

const USER = `SELECT u.id, u.username, u.display_name, u.role_id, u.status, u.last_login_at, u.created_at, r.role_key, r.name AS role_name
  FROM admin_users u JOIN roles r ON r.id = u.role_id`;

export const findByUsername = (username) => queryOne(
  'SELECT id, username, password_hash, display_name, status FROM admin_users WHERE username = :username', { username });
export const findPasswordHash = async (id) => (await queryOne('SELECT password_hash FROM admin_users WHERE id = :id', { id }))?.password_hash;
export const findUser = (id, conn) => queryOne(`${USER} WHERE u.id = :id`, { id }, conn);
export const listUsers = () => query(`${USER} ORDER BY u.id`);
export const listRoles = () => query('SELECT id, role_key, name FROM roles ORDER BY id');
export const findRole = (id, conn) => queryOne('SELECT id, role_key, name FROM roles WHERE id = :id', { id }, conn);
export const permissionsOf = async (roleId) => (await query(
  'SELECT p.permission_key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = :roleId', { roleId }))
  .map((r) => r.permission_key);

export const insertUser = async (u, conn) => (await query(
  'INSERT INTO admin_users (username, password_hash, display_name, role_id) VALUES (:username, :passwordHash, :displayName, :roleId)', u, conn)).insertId;
export const updateUser = (u, conn) => query(
  'UPDATE admin_users SET display_name = :displayName, role_id = :roleId, status = :status WHERE id = :id', u, conn);
export const updatePassword = (id, passwordHash, conn) => query('UPDATE admin_users SET password_hash = :passwordHash WHERE id = :id', { id, passwordHash }, conn);
export const touchLogin = (id) => query('UPDATE admin_users SET last_login_at = UTC_TIMESTAMP() WHERE id = :id', { id });
/** ล็อกแถว Super Admin ทั้งหมดก่อนนับ กันสองคำสั่งพร้อมกันปิดคนสุดท้าย */
export const lockActiveSuperAdmins = (conn) => query(`SELECT u.id FROM admin_users u JOIN roles r ON r.id = u.role_id
  WHERE r.role_key = 'super_admin' AND u.status = 'active' FOR UPDATE`, {}, conn);

export const insertSession = (s) => query(`INSERT INTO admin_sessions (token_hash, csrf_token, admin_id, ip_address, user_agent, expires_at)
  VALUES (:tokenHash, :csrf, :adminId, :ip, :userAgent, DATE_ADD(UTC_TIMESTAMP(), INTERVAL :hours HOUR))`, s);
export const findSession = (tokenHash) => queryOne(`SELECT s.id AS session_id, s.csrf_token, u.id, u.username, u.display_name, u.role_id, r.role_key, r.name AS role_name
  FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id JOIN roles r ON r.id = u.role_id
  WHERE s.token_hash = :tokenHash AND s.expires_at > UTC_TIMESTAMP() AND u.status = 'active'`, { tokenHash });
export const deleteSession = (id) => query('DELETE FROM admin_sessions WHERE id = :id', { id });
export const deleteSessionsOf = (adminId, conn) => query('DELETE FROM admin_sessions WHERE admin_id = :adminId', { adminId }, conn);
