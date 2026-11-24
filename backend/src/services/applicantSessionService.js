import * as repo from '../repositories/lineRepository.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { env } from '../config/env.js';
import { cookieOptions } from '../middleware/adminAuth.js';

export const APPLICANT_COOKIE = env.secureCookies ? '__Host-lst_applicant' : 'lst_applicant';
const LINE_MINUTES = 60 * 24 * 7;
const ACCESS_MINUTES = 60;

/** ออก token ใหม่ทุกครั้งที่สิทธิ์เปลี่ยน (กัน session fixation) */
export async function issueSession(res, previous, { lineUserId, applicationId }) {
  const token = randomToken();
  const csrf = randomToken();
  const line = lineUserId ?? previous?.line_user_id ?? null;
  // สิทธิ์จากเลขที่ใบสมัครมีอายุสั้น จึงไม่ยืดตามอายุ session ของ LINE
  const minutes = applicationId || !line ? ACCESS_MINUTES : LINE_MINUTES;
  await repo.insertApplicantSession({ tokenHash: sha256(token), csrf, lineUserId: line, applicationId: applicationId ?? null, minutes });
  if (previous) await repo.deleteApplicantSession(previous.id);
  res.cookie(APPLICANT_COOKIE, token, { ...cookieOptions, maxAge: minutes * 60_000 });
  return csrf;
}

export const resolveApplicant = (token) => repo.findApplicantSession(sha256(token));

export async function endSession(res, session) {
  if (session) await repo.deleteApplicantSession(session.id);
  res.clearCookie(APPLICANT_COOKIE, cookieOptions);
}
