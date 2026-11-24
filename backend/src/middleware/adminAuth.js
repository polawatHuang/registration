import { resolveSession } from '../services/adminAuthService.js';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { isWrite, verifyCsrf } from './security.js';

export const ADMIN_COOKIE = env.secureCookies ? '__Host-lst_admin' : 'lst_admin';
export const cookieOptions = { httpOnly: true, secure: env.secureCookies, sameSite: 'lax', path: '/' };

export async function requireAdmin(req, res, next) {
  const token = req.cookies[ADMIN_COOKIE];
  const admin = token && await resolveSession(token);
  if (!admin) throw unauthorized();
  if (isWrite(req)) verifyCsrf(req, admin.csrf_token);
  req.admin = admin;
  res.set('Cache-Control', 'no-store');
  next();
}
export const requirePermission = (key) => (req, _res, next) => next(req.admin.permissions.includes(key) ? undefined : forbidden());
