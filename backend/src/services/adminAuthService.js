import bcrypt from 'bcryptjs';
import * as repo from '../repositories/adminRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { guardAttempt } from './lockoutService.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { AppError } from '../utils/errors.js';

export const SESSION_HOURS = 8;
/** hash ของข้อความสุ่มที่ทิ้งไปแล้ว ไม่ใช่รหัสของใคร ใช้ให้เวลาตรวจเท่ากันแม้ไม่มีชื่อผู้ใช้ (เป็นค่าคงที่ เพราะคำนวณตอนเปิดแอปช้ามาก) */
const DUMMY = '$2b$12$j57a0XjZIsAUkjcymfjhCu3GodvDa5vx6sL7jeOtWrOysL.NMJbPW';

export async function login({ username, password, ip, userAgent }) {
  const clear = await guardAttempt('admin_login', [username.toLowerCase(), `ip:${ip}`], [5, 30]);
  const user = await repo.findByUsername(username);
  const match = await bcrypt.compare(password, user?.password_hash ?? DUMMY);
  if (!user || !match || user.status !== 'active') {
    await insertAudit({ adminId: user?.id ?? null, action: 'auth.login_failed', ip });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  await clear();
  const token = randomToken();
  const csrf = randomToken();
  await repo.insertSession({ tokenHash: sha256(token), csrf, adminId: user.id, ip, userAgent: (userAgent ?? '').slice(0, 255), hours: SESSION_HOURS });
  await repo.touchLogin(user.id);
  await insertAudit({ adminId: user.id, action: 'auth.login', ip });
  return token;
}

/** ยืนยันรหัสผ่านซ้ำก่อนทำเรื่องสำคัญ */
export async function confirmPassword(adminId, password, ip) {
  const clear = await guardAttempt('admin_confirm', [String(adminId)], [5]);
  if (!(await bcrypt.compare(password, (await repo.findPasswordHash(adminId)) ?? DUMMY))) {
    await insertAudit({ adminId, action: 'auth.confirm_failed', ip });
    throw new AppError(400, 'WRONG_PASSWORD', 'รหัสผ่านไม่ถูกต้อง', [{ field: 'password', message: 'รหัสผ่านไม่ถูกต้อง' }]);
  }
  await clear();
}

export async function resolveSession(token) {
  const s = await repo.findSession(sha256(token));
  return s && { ...s, permissions: await repo.permissionsOf(s.role_id) };
}

export async function logout(admin, ip) {
  await repo.deleteSession(admin.session_id);
  await insertAudit({ adminId: admin.id, action: 'auth.logout', ip });
}
