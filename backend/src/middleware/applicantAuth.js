import { APPLICANT_COOKIE, resolveApplicant } from '../services/applicantSessionService.js';
import { unauthorized } from '../utils/errors.js';
import { isWrite, verifyCsrf } from './security.js';

/** โหลด session ถ้ามี และบังคับ CSRF เมื่อคำขอนั้นใช้สิทธิ์จาก cookie */
export async function loadApplicant(req, res, next) {
  const token = req.cookies[APPLICANT_COOKIE];
  req.applicant = (token && await resolveApplicant(token)) || null;
  if (req.applicant && isWrite(req)) verifyCsrf(req, req.applicant.csrf_token);
  res.set('Cache-Control', 'no-store');
  next();
}
export function requireApplicant(req, _res, next) {
  next(req.applicant ? undefined : unauthorized('กรุณาเข้าสู่ระบบด้วย LINE หรือยืนยันด้วยเลขที่ใบสมัคร'));
}
export function requireLine(req, _res, next) {
  next(req.applicant?.line_user_id ? undefined : unauthorized('กรุณาเข้าสู่ระบบด้วย LINE'));
}
