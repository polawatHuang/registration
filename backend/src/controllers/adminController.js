import writeXlsxFile from 'write-excel-file/node';
import * as auth from '../services/adminAuthService.js';
import * as users from '../services/adminUserService.js';
import * as apps from '../services/applicationService.js';
import * as email from '../services/emailService.js';
import * as integrations from '../services/integrationService.js';
import * as legal from '../services/legalService.js';
import { kick as notify } from '../services/notificationService.js';
import { readiness } from '../services/readinessService.js';
import { runBackup } from '../services/backupService.js';
import * as retention from '../services/retentionService.js';
import * as catalog from '../services/catalogService.js';
import * as adminRepo from '../repositories/adminRepository.js';
import { listAudit } from '../repositories/auditRepository.js';
import { ADMIN_COOKIE, cookieOptions } from '../middleware/adminAuth.js';
import { parse } from '../middleware/validate.js';
import * as s from '../utils/schemas.js';
import { ok } from '../utils/response.js';

const actor = (req) => ({ adminId: req.admin.id, ip: req.ip });
const idOf = (req, key = 'id') => parse(s.id, req.params[key]);
const paged = (res, items, total, { page, pageSize }) => ok(res, items, { meta: { total, page, pageSize } });

export async function login(req, res) {
  const token = await auth.login({ ...parse(s.loginSchema, req.body), ip: req.ip, userAgent: req.get('user-agent') });
  res.cookie(ADMIN_COOKIE, token, { ...cookieOptions, maxAge: auth.SESSION_HOURS * 3_600_000 });
  ok(res);
}
export async function logout(req, res) {
  await auth.logout(req.admin, req.ip);
  res.clearCookie(ADMIN_COOKIE, cookieOptions);
  ok(res);
}
export const me = (req, res) => ok(res, {
  id: req.admin.id, username: req.admin.username, displayName: req.admin.display_name, role: req.admin.role_name, permissions: req.admin.permissions, csrfToken: req.admin.csrf_token,
});
export const dashboard = async (req, res) => ok(res, await apps.dashboard(req.admin.permissions));

export async function listApplications(req, res) {
  const f = parse(s.listSchema, req.query);
  const { items, total } = await apps.adminList(f);
  paged(res, items, total, f);
}
export const getApplication = async (req, res) => ok(res, await apps.adminDetail(idOf(req), req.admin));
export const reveal = async (req, res) => ok(res, await apps.revealIds(idOf(req), actor(req)));
export async function getDocument(req, res) {
  const { buffer, mime } = await apps.openDocument(idOf(req), idOf(req, 'docId'), actor(req));
  res.set({ 'Content-Type': mime, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'" });
  res.end(buffer);
}
export async function resendEmail(req, res) {
  await email.resend(idOf(req), actor(req));
  ok(res, {}, { message: 'เข้าคิวส่งอีเมลแล้ว' });
}
export async function reviewDocument(req, res) {
  await apps.review(idOf(req), idOf(req, 'docId'), parse(s.reviewSchema, req.body), actor(req));
  ok(res, await apps.adminDetail(idOf(req), req.admin));
}
export async function changeStatus(req, res) {
  await apps.transition(idOf(req), parse(s.statusSchema, req.body), actor(req));
  notify();
  ok(res, await apps.adminDetail(idOf(req), req.admin));
}
const thaiDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
export async function exportApplications(req, res) {
  const rows = await apps.exportRows(parse(s.listSchema, req.query), actor(req));
  const cols = [['เลขที่ใบสมัคร', 'applicationNo', 18], ['ชื่อ-นามสกุล', 'fullName', 28], ['เลขบัตร (ปิดบัง)', 'nationalId', 22], ['มือถือ', 'mobile', 14], ['อีเมล', 'email', 28], ['ร้านค้า', 'shopName', 26],
    ['ที่ตั้งร้าน', 'shopAddress', 40], ['มหาวิทยาลัย', 'universityName', 28], ['รุ่น', 'sessionName', 20], ['สถานะ', 'statusLabel', 24], ['วันที่สมัคร', 'submittedAt', 22], ['ชื่อในใบเสร็จ', 'receiptName', 28], ['ที่อยู่ใบเสร็จ', 'receiptAddress', 40]];
  const data = [cols.map(([h]) => ({ value: h, fontWeight: 'bold' })),
    ...rows.map((r) => cols.map(([, k]) => ({ type: String, value: k === 'submittedAt' ? thaiDate.format(r[k]) : String(r[k] ?? '') })))];
  const buffer = await writeXlsxFile(data, { columns: cols.map(([, , width]) => ({ width })), sheet: 'ผู้สมัคร' }).toBuffer();
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="applications.xlsx"' });
  res.end(buffer);
}

export const getCatalog = async (_req, res) => ok(res, await catalog.adminCatalog());
const created = async (res, promise) => ok(res, { id: await promise }, { status: 201, message: 'บันทึกแล้ว' });
const saved = async (res, promise) => { await promise; ok(res, {}, { message: 'บันทึกแล้ว' }); };
export const createUniversity = (req, res) => created(res, catalog.createUniversity(parse(s.universitySchema, req.body), actor(req)));
export const updateUniversity = (req, res) => saved(res, catalog.updateUniversity(idOf(req), parse(s.universitySchema, req.body), actor(req)));
export const createCourse = (req, res) => created(res, catalog.createCourse(parse(s.courseSchema, req.body), actor(req)));
export const updateCourse = (req, res) => saved(res, catalog.updateCourse(idOf(req), parse(s.courseSchema, req.body), actor(req)));
export const deleteCourse = (req, res) => saved(res, catalog.deleteCourse(idOf(req), actor(req)));
export const createOption = (req, res) => created(res, catalog.createOption(parse(s.optionSchema, req.body), actor(req)));
export const updateOption = (req, res) => saved(res, catalog.updateOption(idOf(req), parse(s.optionSchema, req.body), actor(req)));
export const createSession = (req, res) => created(res, catalog.createSession(parse(s.sessionSchema, req.body), actor(req)));
export const updateSession = (req, res) => saved(res, catalog.updateSession(idOf(req), parse(s.sessionSchema, req.body), actor(req)));
export const deleteUniversity = (req, res) => saved(res, catalog.deleteUniversity(idOf(req), actor(req)));
export const deleteOption = (req, res) => saved(res, catalog.deleteOption(idOf(req), actor(req)));
export const deleteSession = (req, res) => saved(res, catalog.deleteSession(idOf(req), actor(req)));
export const saveSettings = (req, res) => saved(res, catalog.saveSettings(parse(s.settingsSchema, req.body), actor(req)));

export const system = async (_req, res) => ok(res, await readiness());
export const backupNow = async (req, res) => { const b = await runBackup(actor(req)); ok(res, { name: b.name, bytes: b.bytes, rows: b.rows }, { message: 'สำรองแล้ว' }); };
export const getSiteSettings = async (_req, res) => ok(res, await catalog.siteSettings());
export const getLegalSettings = async (_req, res) => ok(res, await legal.getLegal());
export const saveLegalSettings = async (req, res) => ok(res, await legal.saveLegal(parse(s.legalSchema, req.body), actor(req)), { message: 'บันทึกแล้ว' });
export const retentionSummary = async (_req, res) => ok(res, await retention.summary());
export async function retentionDue(req, res) {
  const p = parse(s.pageSchema, req.query);
  const { items, total } = await retention.due(parse(s.dueKind, req.params.kind), p);
  paged(res, items, total, p);
}
export async function retentionPurge(req, res) { ok(res, await retention.purge(parse(s.purgeSchema, req.body), actor(req)), { message: 'ดำเนินการแล้ว' }); notify(); }
export async function retentionRequests(req, res) { const p = parse(s.pageSchema, req.query); const { items, total } = await retention.requests(p); paged(res, items, total, p); }
export async function retentionLog(req, res) { const p = parse(s.pageSchema, req.query); const { items, total } = await retention.log(p); paged(res, items, total, p); }
export async function retentionDecide(req, res) { await retention.decide(idOf(req), parse(s.decideSchema, req.body), actor(req)); ok(res, {}, { message: 'บันทึกแล้ว' }); }
export async function retentionNotice(req, res) { await retention.notice(idOf(req), parse(s.noticeSchema, req.body).action, actor(req)); ok(res); }
export async function setHold(req, res) { await retention.setHold(idOf(req), parse(s.holdSchema, req.body).reason, actor(req)); ok(res, await apps.adminDetail(idOf(req), req.admin)); }
export const getIntegrations = async (_req, res) => ok(res, await integrations.describe());
export async function saveIntegrations(req, res) {
  const { password, values } = parse(s.integrationsSchema, req.body);
  await auth.confirmPassword(req.admin.id, password, req.ip);
  await integrations.save(values, actor(req));
  ok(res, await integrations.describe(), { message: 'บันทึกแล้ว' });
}
export const testIntegration = async (req, res) => ok(res, await integrations.test(parse(s.testTarget, req.params.target), actor(req)));

export const listUsers = async (_req, res) => ok(res, { users: await adminRepo.listUsers(), roles: await adminRepo.listRoles() });
export const createUser = (req, res) => created(res, users.createAdminUser(parse(s.userCreateSchema, req.body), actor(req)));
export const updateUser = (req, res) => saved(res, users.updateAdminUser(idOf(req), parse(s.userUpdateSchema, req.body), actor(req)));
export async function auditLogs(req, res) {
  const f = parse(s.auditSchema, req.query);
  const { rows, total } = await listAudit(f);
  paged(res, rows, total, f);
}
