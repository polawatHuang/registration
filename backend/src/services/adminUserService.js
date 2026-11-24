import bcrypt from 'bcryptjs';
import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/adminRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

function checkPassword(password) {
  if (password.length < 12 || Buffer.byteLength(password) > 72) {
    throw badRequest('WEAK_PASSWORD', 'รหัสผ่านต้องยาวอย่างน้อย 12 ตัวอักษร (ไม่เกิน 72 ไบต์)', [{ field: 'password', message: 'รหัสผ่านสั้นหรือยาวเกินไป' }]);
  }
}

export async function createAdminUser({ username, displayName, password, roleId }, { adminId, ip }) {
  checkPassword(password);
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    return await withTransaction(async (conn) => {
      if (!(await repo.findRole(roleId, conn))) throw badRequest('INVALID_ROLE', 'ไม่พบบทบาทที่เลือก');
      const id = await repo.insertUser({ username, displayName, passwordHash, roleId }, conn);
      await insertAudit({ actorType: adminId ? 'admin' : 'system', adminId, action: 'user.create', entityType: 'admin_user', entityId: id, ip, metadata: { username, roleId } }, conn);
      return id;
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('USERNAME_TAKEN', 'มีชื่อผู้ใช้นี้แล้ว');
    throw err;
  }
}

export async function updateAdminUser(id, { displayName, roleId, status, password }, { adminId, ip }) {
  if (password) checkPassword(password);
  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  return withTransaction(async (conn) => {
    const supers = await repo.lockActiveSuperAdmins(conn);
    const user = await repo.findUser(id, conn);
    if (!user) throw notFound('ไม่พบผู้ใช้');
    const role = await repo.findRole(roleId, conn);
    if (!role) throw badRequest('INVALID_ROLE', 'ไม่พบบทบาทที่เลือก');
    const losesSuper = supers.some((s) => s.id === id) && (role.role_key !== 'super_admin' || status !== 'active');
    if (losesSuper && supers.length === 1) throw conflict('LAST_SUPER_ADMIN', 'ต้องมี Super Admin ที่ใช้งานได้อย่างน้อย 1 คน');
    await repo.updateUser({ id, displayName, roleId, status }, conn);
    if (passwordHash) await repo.updatePassword(id, passwordHash, conn);
    if (passwordHash || status !== 'active' || roleId !== user.role_id) await repo.deleteSessionsOf(id, conn);
    await insertAudit({ adminId, action: 'user.update', entityType: 'admin_user', entityId: id, ip,
      metadata: { roleId, status, passwordChanged: Boolean(passwordHash) } }, conn);
  });
}
