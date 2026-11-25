import * as att from '../services/attendanceService.js';
import * as cert from '../services/certificateService.js';
import { kick as notify } from '../services/notificationService.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { parse } from '../middleware/validate.js';
import * as s from '../utils/schemas.js';
import { ok } from '../utils/response.js';

const actor = (req) => ({ adminId: req.admin.id, ip: req.ip });
const idOf = (req, key = 'id') => parse(s.id, req.params[key]);
const paged = (res, items, total, { page, pageSize }) => ok(res, items, { meta: { total, page, pageSize } });
const sendPdf = (res, { buffer, name }, download) => { res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(buffer); };
const sendImage = (res, { buffer, mime }) => { res.set({ 'Content-Type': mime, 'Content-Disposition': 'inline', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); res.end(buffer); };

// ---------- ผู้สมัคร ----------
export const myQr = async (req, res) => ok(res, await att.myQr(req.applicant, idOf(req)));
export async function myQrImage(req, res) {
  const { default: QRCode } = await import('qrcode');
  const { token } = await att.myQr(req.applicant, idOf(req));
  sendImage(res, { mime: 'image/svg+xml', buffer: await QRCode.toString(token, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#17142a', light: '#ffffff' } }) });
}
export const myAttendance = async (req, res) => ok(res, await att.myAttendance(req.applicant, idOf(req)));
export const renewQr = async (req, res) => ok(res, await att.renewQr(req.applicant, idOf(req), req.ip), { message: 'ออก QR ใหม่แล้ว QR เดิมใช้ไม่ได้' });
export const myPdf = async (req, res) => sendPdf(res, await cert.myPdf(req.applicant, idOf(req)), req.query.download === '1');
export const verify = async (req, res) => ok(res, await cert.verify(parse(s.verifyCode, req.params.code)));

// ---------- เช็กชื่อ ----------
export const sessions = async (_req, res) => ok(res, await att.sessions());
export const roster = async (req, res) => ok(res, await att.roster(idOf(req), parse(s.rosterSchema, req.query)));
export const scans = async (req, res) => ok(res, await att.scans(idOf(req)));
export async function scan(req, res) { ok(res, await att.scan(idOf(req), parse(s.scanSchema, req.body), actor(req))); notify(); }
export const person = async (req, res) => ok(res, await att.personDetail(idOf(req), idOf(req, 'appId')));
export const portrait = async (req, res) => sendImage(res, await att.portrait(idOf(req), idOf(req, 'appId'), actor(req)));
export async function manual(req, res) { ok(res, await att.manual(idOf(req), idOf(req, 'appId'), parse(s.manualSchema, req.body), actor(req))); notify(); }
export async function undo(req, res) { await att.undo(idOf(req), parse(s.undoSchema, req.body), actor(req)); ok(res, {}, { message: 'แก้บันทึกแล้ว' }); }
export async function announce(req, res) { ok(res, await att.announce(idOf(req), parse(s.announceSchema, req.body), actor(req))); notify(); }
const DT = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
export async function exportRoster(req, res) {
  const r = await att.roster(idOf(req), parse(s.rosterSchema, req.query));
  await insertAudit({ ...actor(req), action: 'attendance.export', entityType: 'training_session', entityId: r.session.id, metadata: { rows: r.items.length } });
  const cols = [['เลขที่ใบสมัคร', 18, (x) => x.applicationNo], ['ชื่อ-นามสกุล', 30, (x) => x.fullName], ['มือถือ', 14, (x) => x.mobile], ['สถานะ', 24, (x) => x.statusLabel], ['เช็กอินครั้งแรก', 22, (x) => (x.firstIn ? DT.format(x.firstIn) : '')], ['เข้าอบรม (วัน)', 14, (x) => String(x.days)], ['เช็กเอาต์ (วัน)', 14, (x) => String(x.daysOut)], ['รวมนาที', 12, (x) => String(x.minutes)], ['ครบเกณฑ์', 12, (x) => (x.met ? 'ครบ' : 'ไม่ครบ')], ['สิ่งที่ขาด', 40, (x) => x.missing.join(', ')]];
  const data = [cols.map(([h]) => ({ value: h, fontWeight: 'bold' })), ...r.items.map((x) => cols.map(([, , f]) => ({ type: String, value: f(x) })))];
  const { default: writeXlsxFile } = await import('write-excel-file/node');
  const buffer = await writeXlsxFile(data, { columns: cols.map(([, width]) => ({ width })), sheet: 'การเข้าอบรม' }).toBuffer();
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="attendance.xlsx"' });
  res.end(buffer);
}

// ---------- ใบประกาศ ----------
export async function certificates(req, res) { const f = parse(s.certListSchema, req.query); const { items, total } = await cert.list(f); paged(res, items, total, f); }
export const templates = async (_req, res) => ok(res, await cert.templates());
export const createTemplate = async (req, res) => ok(res, { id: await cert.saveTemplate(null, parse(s.certTemplateSchema, req.body), req.file, actor(req)) }, { status: 201, message: 'บันทึกแล้ว' });
export const updateTemplate = async (req, res) => ok(res, { id: await cert.saveTemplate(idOf(req), parse(s.certTemplateSchema, req.body), req.file, actor(req)) }, { message: 'บันทึกแล้ว' });
export async function retireTemplate(req, res) { await cert.retireTemplate(idOf(req), actor(req)); ok(res, {}, { message: 'เลิกใช้แบบนี้แล้ว' }); }
export const templateImage = async (req, res) => sendImage(res, await cert.templateImage(idOf(req)));
export const previewTemplate = async (req, res) => sendPdf(res, { buffer: await cert.preview(req.params.id ? idOf(req) : null, parse(s.certPreviewSchema, req.body).layout, req.file), name: 'preview.pdf' });
export async function savePrefix(req, res) { await cert.savePrefix(parse(s.certPrefixSchema, req.body).prefix, actor(req)); ok(res, {}, { message: 'บันทึกแล้ว' }); }
export const candidates = async (req, res) => ok(res, await cert.candidates(idOf(req)));
export async function issue(req, res) { const d = parse(s.issueSchema, req.body); ok(res, await cert.issue(d.ids, actor(req), d.name ?? null)); notify(); }
export const adminPdf = async (req, res) => sendPdf(res, await cert.adminPdf(idOf(req)), req.query.download === '1');
export async function revoke(req, res) { await cert.revoke(idOf(req), parse(s.revokeSchema, req.body).reason, actor(req)); ok(res, {}, { message: 'เพิกถอนแล้ว' }); }
