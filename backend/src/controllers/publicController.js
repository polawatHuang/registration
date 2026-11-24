import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { runJobs } from '../jobs/index.js';
import * as catalog from '../services/catalogService.js';
import * as apps from '../services/applicationService.js';
import { getLegal } from '../services/legalService.js';
import { lineLoginConfig } from '../services/integrationService.js';
import { kick } from '../services/emailService.js';
import { emailConfig } from '../services/integrationService.js';
import * as line from '../services/lineLoginService.js';
import { endSession, issueSession } from '../services/applicantSessionService.js';
import { activeLinkOfLine } from '../repositories/lineRepository.js';
import { cookieOptions } from '../middleware/adminAuth.js';
import { parse } from '../middleware/validate.js';
import { accessSchema, applicationSchema, erasureSchema, id } from '../utils/schemas.js';
import { AppError, forbidden } from '../utils/errors.js';
import { safeEqual } from '../utils/crypto.js';
import { ok } from '../utils/response.js';

export async function health(_req, res) {
  await query('SELECT 1');
  ok(res, { status: 'ok', time: new Date().toISOString() });
}
export async function jobs(req, res) {
  if (!safeEqual(req.get('x-jobs-secret') ?? '', env.JOBS_SECRET)) throw forbidden();
  ok(res, await runJobs());
}
export const universities = async (_req, res) => ok(res, await catalog.publicUniversities());
export const sessions = async (req, res) => ok(res, await catalog.publicSessions(parse(id, req.query.universityId)));
export const options = async (_req, res) => ok(res, await catalog.publicOptions());
export const legal = async (_req, res) => ok(res, await getLegal());
export async function withdrawConsent(req, res) {
  ok(res, await apps.withdrawSensitive(req.applicant, parse(id, req.params.id), req.ip), { message: 'ถอนความยินยอมแล้ว' });
}
export async function requestErasure(req, res) {
  ok(res, await apps.requestErasure(req.applicant, parse(id, req.params.id), parse(erasureSchema, req.body).note, req.ip), { message: 'ส่งคำขอแล้ว' });
}
export async function cancelErasure(req, res) {
  ok(res, await apps.cancelErasure(req.applicant, parse(id, req.params.id), req.ip), { message: 'ยกเลิกคำขอแล้ว' });
}
export const siteInfo = async (_req, res) => ok(res, await catalog.siteInfo());

export async function submit(req, res) {
  const input = parse(applicationSchema, req.body);
  const row = await apps.submit(input, req.files ?? {}, { ip: req.ip, lineUserId: req.applicant?.line_user_id ?? null });
  const csrfToken = await issueSession(res, req.applicant, req.applicant?.line_user_id ? {} : { applicationId: row.id });
  ok(res, { ...(await apps.applicantView(row)), csrfToken, emailEnabled: Boolean(await emailConfig()) }, { status: 201, message: 'ส่งใบสมัครสำเร็จ' });
  kick();
}
export async function access(req, res) {
  const app = await apps.verifyAccess(parse(accessSchema, req.body), req.ip);
  const csrfToken = await issueSession(res, req.applicant, { applicationId: app.id });
  ok(res, { csrfToken });
}
export async function myStatus(req, res) {
  ok(res, await Promise.all((await apps.listMine(req.applicant)).map(apps.applicantView)));
}
export async function resubmit(req, res) {
  ok(res, await apps.resubmit(req.applicant, parse(id, req.params.id), req.files ?? {}, req.ip), { message: 'ส่งเอกสารใหม่แล้ว' });
}
export async function session(req, res) {
  const s = req.applicant;
  const lineLoginEnabled = Boolean(await lineLoginConfig());
  if (!s) return ok(res, { authenticated: false, lineLoginEnabled });
  return ok(res, {
    authenticated: true, lineLoginEnabled, csrfToken: s.csrf_token,
    line: s.line_user_id ? { displayName: s.display_name, pictureUrl: s.picture_url, accountLinked: Boolean(await activeLinkOfLine(s.line_user_id)) } : null,
  });
}
export async function logout(req, res) {
  await endSession(res, req.applicant);
  ok(res);
}

const STATE_COOKIE = env.secureCookies ? '__Host-lst_line_state' : 'lst_line_state';
export async function lineStart(req, res) {
  const { url, browser } = await line.startLogin(req.query.returnTo);
  res.cookie(STATE_COOKIE, browser, { ...cookieOptions, maxAge: 600_000 });
  res.redirect(302, url);
}
/** ปลายทางเป็นหน้าเว็บ จึงส่งกลับพร้อมรหัสข้อผิดพลาดแทน JSON */
export async function lineCallback(req, res) {
  const str = (v) => (typeof v === 'string' ? v : undefined);
  res.clearCookie(STATE_COOKIE, cookieOptions);
  try {
    if (req.query.error) throw new AppError(400, 'LOGIN_CANCELLED', 'ยกเลิกการเข้าสู่ระบบ');
    const r = await line.finishLogin({ code: str(req.query.code), state: str(req.query.state), browser: req.cookies[STATE_COOKIE], ip: req.ip });
    // ใบที่เบราว์เซอร์นี้ยืนยันไว้ก่อนแล้ว ผูกเข้ากับ LINE ให้เลย
    if (req.applicant?.application_id) await apps.attachLine(req.applicant.application_id, r.lineUserId, req.ip);
    await issueSession(res, req.applicant, { lineUserId: r.lineUserId });
    res.redirect(302, `${r.returnTo}?line=ok`);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    req.log?.warn({ code: err.code }, 'line login failed');
    res.redirect(302, `/tracking.html?line=${encodeURIComponent(err.code)}`);
  }
}
export async function linkAccount(req, res) {
  const r = await apps.claimForLine(parse(accessSchema, req.body), req.applicant.line_user_id, req.ip);
  ok(res, r, { message: r.accountLinked ? 'เชื่อมบัญชี LINE สำเร็จ' : 'เพิ่มใบสมัครเข้าบัญชี LINE แล้ว จะเชื่อมข้อมูลบุคคลเมื่อเอกสารผ่านการตรวจ' });
}
export async function unlinkAccount(req, res) {
  await line.unlink(req.applicant.line_user_id, req.ip);
  await endSession(res, req.applicant);
  ok(res, {}, { message: 'ยกเลิกการเชื่อมบัญชีแล้ว' });
}
