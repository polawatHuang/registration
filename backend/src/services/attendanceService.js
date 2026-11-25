import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/attendanceRepository.js';
import * as apps from '../repositories/applicationRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { changeStatus, listMine } from './applicationService.js';
import { readDocument } from './storageService.js';
import { keyedHash, randomCode, safeEqual } from '../utils/crypto.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { STATUS_LABELS } from '../utils/status.js';

// ---------- QR ----------
const signature = (id, nonce) => keyedHash('attendance_qr', `${id}.${nonce}`).slice(0, 24);
const tokenOf = (id, nonce) => `LST1.${id.toString(36)}.${nonce}.${signature(id, nonce)}`;
const FORMAT = /^LST1\.([0-9a-z]{1,7})\.([2-9A-HJ-NP-Z]{16})\.([0-9a-f]{24})$/;
export function parseToken(text) {
  const m = FORMAT.exec(String(text ?? '').trim());
  if (!m) return null;
  const id = parseInt(m[1], 36);
  return safeEqual(signature(id, m[2]), m[3]) ? { id, nonce: m[2] } : null;
}
/** ออก QR ได้เมื่ออนุมัติแล้ว และใช้ได้ถึงวันสุดท้ายของรุ่น */
export const QR_STATUSES = ['approved', 'awaiting_training', 'attended', 'passed', 'certified'];
const bkkDay = (d) => new Date(new Date(d).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
const endOfDay = (d) => new Date(new Date(`${bkkDay(d)}T23:59:59+07:00`));
export const qrUsable = (app, now = new Date()) => QR_STATUSES.includes(app.status) && now <= endOfDay(app.ends_at);
async function mineOf(session, id) {
  const app = (await listMine(session)).find((a) => a.id === id);
  if (!app) throw notFound('ไม่พบใบสมัคร');
  return app;
}
export async function myQr(session, applicationId) {
  const app = await mineOf(session, applicationId);
  if (!QR_STATUSES.includes(app.status)) throw conflict('QR_NOT_READY', 'QR จะพร้อมใช้หลังการสมัครได้รับอนุมัติ');
  if (!qrUsable(app)) throw conflict('QR_EXPIRED', 'รุ่นนี้สิ้นสุดแล้ว QR หมดอายุ');
  let row = await repo.findQr(applicationId);
  if (!row) { await repo.insertQr(applicationId, randomCode(16)); row = await repo.findQr(applicationId); }
  return { token: tokenOf(applicationId, row.nonce), applicationNo: app.application_no, fullName: app.full_name, sessionName: app.session_name, universityName: app.university_name, startsAt: app.starts_at, endsAt: app.ends_at, expiresAt: endOfDay(app.ends_at), records: await myAttendance(session, applicationId) };
}
export async function myAttendance(session, applicationId) { await mineOf(session, applicationId); return repo.recordsOf(applicationId).then((l) => l.map((r) => ({ day: r.day, checkInAt: r.check_in_at, checkOutAt: r.check_out_at }))); }
export async function renewQr(session, applicationId, ip) {
  const app = await mineOf(session, applicationId);
  if (!qrUsable(app)) throw conflict('QR_NOT_READY', 'ออก QR ใหม่ไม่ได้ในสถานะนี้');
  await repo.replaceQr(applicationId, randomCode(16));
  await insertAudit({ actorType: 'applicant', action: 'attendance.qr_renew', entityType: 'application', entityId: applicationId, ip });
  return myQr(session, applicationId);
}

// ---------- เช็กชื่อ ----------
const MESSAGES = {
  ok: { in: 'เช็กอินสำเร็จ', out: 'เช็กเอาต์สำเร็จ' }, already: { in: 'เช็กอินแล้ว', out: 'เช็กเอาต์แล้ว' }, not_in: { out: 'ยังไม่ได้เช็กอินวันนี้' },
  invalid: 'QR ไม่ถูกต้อง', revoked: 'QR ถูกยกเลิกแล้ว ให้ผู้เข้าอบรมเปิด QR ล่าสุด', unauthorized: 'ไม่มีสิทธิ์เข้าอบรม', wrong_session: 'ไม่ใช่รุ่นอบรมนี้', wrong_day: 'วันนี้ไม่อยู่ในช่วงอบรมของรุ่นนี้',
};
const messageOf = (result, action) => (typeof MESSAGES[result] === 'string' ? MESSAGES[result] : MESSAGES[result][action]);
const person = (a) => a && { id: a.id, fullName: a.full_name, applicationNo: a.application_no, sessionName: a.session_name, status: a.status, statusLabel: STATUS_LABELS[a.status] };

async function mustSession(id) {
  const s = await repo.findSession(id);
  if (!s) throw notFound('ไม่พบรุ่นอบรม');
  return s;
}
/** แกนเดียวของทุกช่องทาง: ล็อกใบสมัครก่อน สแกนพร้อมกันหลายเครื่องจึงได้บันทึกเดียว */
async function mark({ session, applicationId, action, method, at, note, adminId }) {
  const day = bkkDay(at);
  return withTransaction(async (conn) => {
    const app = await apps.lockById(applicationId, conn);
    if (!app) return { result: 'invalid' };
    const who = await repo.personOf(applicationId, conn);
    if (app.session_id !== session.id) return { result: 'wrong_session', who };
    if (!QR_STATUSES.includes(app.status)) return { result: 'unauthorized', who };
    if (day < bkkDay(session.starts_at) || day > bkkDay(session.ends_at)) return { result: 'wrong_day', who };
    const row = await repo.recordOfDay(applicationId, day, conn);
    if (action === 'in') {
      if (row) return { result: 'already', who, at: row.check_in_at };
      await repo.insertRecord({ applicationId, sessionId: session.id, day, at, adminId, method, note }, conn);
      if (['approved', 'awaiting_training'].includes(app.status)) { await changeStatus(app, 'attended', { actorType: 'admin', actorId: adminId }, conn); who.status = 'attended'; }
    } else {
      if (!row) return { result: 'not_in', who };
      if (row.check_out_at) return { result: 'already', who, at: row.check_out_at };
      if (at <= new Date(row.check_in_at)) throw badRequest('BAD_TIME', 'เวลาออกต้องหลังเวลาเข้า', [{ field: 'at', message: 'ต้องหลังเวลาเข้า' }]);
      await repo.setCheckout({ id: row.id, at, adminId, method, note }, conn);
    }
    if (method === 'manual') await insertAudit({ adminId, action: `attendance.manual_${action}`, entityType: 'application', entityId: applicationId, metadata: { day, note } }, conn);
    return { result: 'ok', who, at };
  });
}
async function finish(out, { session, applicationId, action, method, adminId, ip }) {
  await repo.insertScan({ sessionId: session.id, applicationId: out.who?.id ?? null, adminId, action, method, result: out.result, ip });
  return { result: out.result, message: messageOf(out.result, action), action, at: out.at ?? null, person: person(out.who) ?? null, applicationId };
}
export async function scan(sessionId, { token, action }, { adminId, ip }) {
  const session = await mustSession(sessionId);
  const base = { session, action, method: 'qr', adminId, ip };
  const t = parseToken(token);
  if (!t) return finish({ result: 'invalid' }, base);
  const qr = await repo.findQr(t.id);
  if (!qr || !safeEqual(qr.nonce, t.nonce)) return finish({ result: 'revoked', who: qr ? await repo.personOf(t.id) : null }, base);
  const at = new Date(Math.floor(Date.now() / 1000) * 1000);
  return finish(await mark({ ...base, applicationId: t.id, at }), { ...base, applicationId: t.id });
}
export async function manual(sessionId, applicationId, { action, at, note }, { adminId, ip }) {
  const session = await mustSession(sessionId);
  const when = at ?? new Date(Math.floor(Date.now() / 1000) * 1000);
  if (when > new Date(Date.now() + 60_000)) throw badRequest('BAD_TIME', 'เวลาต้องไม่อยู่ในอนาคต', [{ field: 'at', message: 'ต้องไม่อยู่ในอนาคต' }]);
  const base = { session, applicationId, action, method: 'manual', adminId, ip };
  return finish(await mark({ ...base, at: when, note }), base);
}
/** ลบบันทึกที่ผิด: สถานะถอยกลับเฉพาะเมื่อไม่เหลือบันทึกและยังไม่ประกาศผล */
export async function undo(recordId, { what, reason }, { adminId, ip }) {
  return withTransaction(async (conn) => {
    const found = await repo.findRecord(recordId, conn);
    if (!found) throw notFound('ไม่พบบันทึก');
    const app = await apps.lockById(found.application_id, conn);
    if (['passed', 'certified'].includes(app.status)) throw conflict('ALREADY_PASSED', 'ประกาศผลแล้ว แก้บันทึกการเข้าอบรมไม่ได้');
    if (what === 'out') { if (!(await repo.clearCheckout(recordId, conn))) throw conflict('NO_CHECKOUT', 'ยังไม่มีเวลาออก'); } else {
      await repo.deleteRecord(recordId, conn);
      if (app.status === 'attended' && !(await repo.recordsOf(app.id, conn)).length) await changeStatus(app, 'awaiting_training', { reason: null, actorType: 'admin', actorId: adminId }, conn);
    }
    await insertAudit({ adminId, action: `attendance.undo_${what}`, entityType: 'application', entityId: app.id, ip, metadata: { day: found.day, reason } }, conn);
  });
}

// ---------- รายชื่อ เกณฑ์ และผล ----------
export function criteria(session, r) {
  const missing = [];
  if (Number(r.days) < session.min_days) missing.push(`เข้า ${r.days}/${session.min_days} วัน`);
  if (session.require_checkout && Number(r.days_out) < Math.max(Number(r.days), session.min_days)) missing.push(`เช็กเอาต์ ${r.days_out}/${Math.max(Number(r.days), session.min_days)} วัน`);
  if (session.min_minutes && Number(r.minutes) < session.min_minutes) missing.push(`เข้าอบรม ${Math.floor(r.minutes / 60)} ชม. ${r.minutes % 60} นาที จาก ${Math.floor(session.min_minutes / 60)} ชม. ${session.min_minutes % 60} นาที`);
  return { met: !missing.length, missing };
}
const sessionView = (s) => ({ id: s.id, name: s.session_name, universityName: s.university_name, courseName: s.course_name, startsAt: s.starts_at, endsAt: s.ends_at, status: s.status, requireCheckout: Boolean(s.require_checkout), minMinutes: s.min_minutes, minDays: s.min_days });
export const sessions = async () => (await repo.sessions()).map((s) => ({ ...sessionView(s), expected: s.expected, attended: s.attended }));
export async function roster(sessionId, { q, day, filter } = {}) {
  const session = await mustSession(sessionId);
  const today = day ?? bkkDay(new Date());
  const rows = (await repo.roster({ sessionId, day: today, q })).map((r) => ({
    id: r.id, applicationNo: r.application_no, fullName: r.full_name, mobile: r.mobile, status: r.status, statusLabel: STATUS_LABELS[r.status], days: Number(r.days), daysOut: Number(r.days_out), minutes: Number(r.minutes), todayIn: r.today_in, todayOut: r.today_out, firstIn: r.first_in, ...criteria(session, r),
  }));
  const counts = { expected: rows.length, attended: rows.filter((r) => r.days).length, today: rows.filter((r) => r.todayIn).length, out: rows.filter((r) => r.todayOut).length, ready: rows.filter((r) => r.met && r.status === 'attended').length, passed: rows.filter((r) => ['passed', 'certified'].includes(r.status)).length };
  const pick = { all: () => true, present: (r) => r.days > 0, absent: (r) => !r.days, ready: (r) => r.met && r.status === 'attended', failing: (r) => r.days > 0 && !r.met }[filter ?? 'all'];
  return { session: sessionView(session), day: today, counts, items: rows.filter(pick) };
}
export async function personDetail(sessionId, applicationId) {
  const app = await repo.personOf(applicationId);
  if (!app || app.session_id !== sessionId) throw notFound('ไม่พบผู้เข้าอบรมในรุ่นนี้');
  return { ...person(app), records: await repo.recordsOf(applicationId) };
}
export const scans = (sessionId) => repo.recentScans(sessionId);
/** ภาพหน้าตรงเพื่อเทียบตัวบุคคลตอนสแกนเท่านั้น */
export async function portrait(sessionId, applicationId, { adminId, ip }) {
  const app = await repo.personOf(applicationId);
  if (!app || app.session_id !== sessionId || !QR_STATUSES.includes(app.status)) throw notFound('ไม่พบภาพ');
  const doc = (await apps.currentDocuments(applicationId)).find((d) => d.doc_type === 'portrait_photo' && d.storage_name);
  if (!doc) throw notFound('ไม่พบภาพ');
  const buffer = await readDocument(doc.storage_name);
  await insertAudit({ adminId, action: 'attendance.view_portrait', entityType: 'application', entityId: applicationId, ip });
  return { buffer, mime: doc.mime_type };
}
export async function announce(sessionId, { ids, override, reason }, { adminId, ip }) {
  const session = await mustSession(sessionId);
  if (override && !reason) throw badRequest('REASON_REQUIRED', 'ต้องระบุเหตุผลที่ให้ผ่านโดยไม่ครบเกณฑ์', [{ field: 'reason', message: 'กรุณาระบุเหตุผล' }]);
  const result = { passed: 0, skipped: [] };
  for (const id of new Set(ids)) {
    const out = await withTransaction(async (conn) => {
      const app = await apps.lockById(id, conn);
      if (!app || app.session_id !== sessionId || app.status !== 'attended') return 'สถานะไม่ใช่ "เข้าอบรมแล้ว"';
      const [r] = await repo.roster({ sessionId, day: bkkDay(new Date()), ids: [id] }, conn);
      const c = criteria(session, r);
      if (!c.met && !override) return c.missing.join(', ');
      await changeStatus(app, 'passed', { actorType: 'admin', actorId: adminId }, conn);
      await insertAudit({ adminId, action: c.met ? 'attendance.pass' : 'attendance.pass_override', entityType: 'application', entityId: id, ip, metadata: { missing: c.missing, reason: c.met ? null : reason } }, conn);
      return null;
    });
    if (out === null) result.passed += 1; else result.skipped.push({ id, reason: out });
  }
  return result;
}
