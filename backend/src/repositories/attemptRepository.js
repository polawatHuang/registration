import { queryOne, query } from '../config/db.js';

export const countAttempts = async (scope, keyHash, minutes) => (await queryOne(`SELECT COUNT(*) AS n FROM auth_attempts
  WHERE scope = :scope AND key_hash = :keyHash AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL :minutes MINUTE)`, { scope, keyHash, minutes })).n;
export const addAttempt = async (scope, keyHash) => (await query('INSERT INTO auth_attempts (scope, key_hash, created_at) VALUES (:scope, :keyHash, UTC_TIMESTAMP())', { scope, keyHash })).insertId;
export const removeAttempts = (ids) => query('DELETE FROM auth_attempts WHERE id IN (:ids)', { ids });
/** ลบตาม primary key ตามลำดับ ลดการล็อกช่วงที่ชนกับการเพิ่มแถวพร้อมกัน */
export async function clearAttempts(scope, keyHash) {
  const ids = (await query('SELECT id FROM auth_attempts WHERE scope = :scope AND key_hash = :keyHash ORDER BY id', { scope, keyHash })).map((r) => r.id);
  if (ids.length) await query('DELETE FROM auth_attempts WHERE id IN (:ids)', { ids });
}
