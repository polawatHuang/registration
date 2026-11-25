import { env } from '../config/env.js';
import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/certificateRepository.js';
import * as apps from '../repositories/applicationRepository.js';
import { getSettings, setSetting } from '../repositories/catalogRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { changeStatus, listMine } from './applicationService.js';
import { readDocument, removeDocuments, storeDocument } from './storageService.js';
import { detectFileType } from '../utils/fileType.js';
import { DEFAULT_LAYOUT, FIELD_LABELS, renderCertificate } from '../utils/certificatePdf.js';
import { randomCode } from '../utils/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';

const PREFIX_KEY = 'certificate_prefix';
const thaiYear = () => new Date(Date.now() + 7 * 3_600_000).getUTCFullYear() + 543;
const verifyUrl = (code) => `${env.APP_URL}/certificate/verify/${code}`;
export async function prefix() { return (await getSettings([PREFIX_KEY]))[PREFIX_KEY] || 'ET'; }
export async function savePrefix(value, { adminId, ip }) {
  await withTransaction(async (conn) => { await setSetting(PREFIX_KEY, value, conn); await insertAudit({ adminId, action: 'certificate.prefix', entityType: 'certificate', ip, metadata: { value } }, conn); });
}

// ---------- แบบใบประกาศ ----------
const templateView = (t) => ({ id: t.id, name: t.name, courseId: t.course_id, courseName: t.course_name ?? null, hasImage: Boolean(t.has_image ?? t.storage_name), layout: JSON.parse(t.layout_json), used: Number(t.used ?? 0) });
export async function templates() {
  return { items: (await repo.listTemplates()).map(templateView), defaults: DEFAULT_LAYOUT, labels: FIELD_LABELS, prefix: await prefix() };
}
function checkImage(file) {
  if (!file) return null;
  const mime = detectFileType(file.buffer, file.originalname);
  if (!['image/jpeg', 'image/png'].includes(mime)) throw badRequest('INVALID_FILE', 'ภาพพื้นหลังต้องเป็น JPG หรือ PNG', [{ field: 'image', message: 'ต้องเป็น JPG หรือ PNG' }]);
  return mime;
}
/** แบบที่เคยออกใบแล้วต้องไม่เปลี่ยน: สร้างแถวใหม่และเลิกใช้แถวเดิม */
export async function saveTemplate(id, d, file, { adminId, ip }) {
  const mime = checkImage(file);
  // ไฟล์ที่ตัวสร้าง PDF อ่านไม่ได้ต้องถูกปฏิเสธตั้งแต่ตอนอัปโหลด ไม่ใช่ตอนออกใบจริง
  if (mime) await preview(null, d.layout, file);
  const stored = mime ? await storeDocument(file) : null;
  let unused = null;
  try {
    return await withTransaction(async (conn) => {
      unused = null;
      const old = id ? await repo.findTemplate(id, conn) : null;
      if (id && (!old || !old.is_active)) throw notFound('ไม่พบแบบใบประกาศ');
      const image = stored ? { storageName: stored, mime } : d.removeImage || !old ? { storageName: null, mime: null } : { storageName: old.storage_name, mime: old.mime_type };
      const row = { name: d.name, courseId: d.courseId, layout: JSON.stringify(d.layout), adminId, ...image };
      let newId = id;
      if (old && !(await repo.usedCount(id, conn))) {
        await repo.updateTemplate({ ...row, id }, conn);
        if (old.storage_name && old.storage_name !== image.storageName && !(await repo.imageShared(old.storage_name, conn))) unused = old.storage_name;
      } else { if (old) await repo.retireTemplate(id, conn); newId = await repo.insertTemplate(row, conn); }
      await insertAudit({ adminId, action: 'certificate.template', entityType: 'certificate_template', entityId: newId, ip, metadata: { name: d.name, replaced: old && newId !== id ? id : null } }, conn);
      return newId;
    });
  } catch (err) {
    if (stored) await removeDocuments([stored]).catch(() => {});
    if (err.code === 'ER_NO_REFERENCED_ROW_2') throw notFound('ไม่พบหลักสูตร');
    throw err;
  } finally { if (unused) await removeDocuments([unused]).catch(() => {}); }
}
export async function retireTemplate(id, { adminId, ip }) {
  await withTransaction(async (conn) => { if (!(await repo.retireTemplate(id, conn))) throw notFound('ไม่พบแบบใบประกาศ'); await insertAudit({ adminId, action: 'certificate.template_retire', entityType: 'certificate_template', entityId: id, ip }, conn); });
}
export async function templateImage(id) {
  const t = await repo.findTemplate(id);
  if (!t?.storage_name) throw notFound('ไม่มีภาพพื้นหลัง');
  return { buffer: await readDocument(t.storage_name), mime: t.mime_type };
}
export async function preview(id, layout, file) {
  const mime = checkImage(file);
  const t = id ? await repo.findTemplate(id) : null;
  const background = mime ? file.buffer : t?.storage_name ? await readDocument(t.storage_name) : null;
  const make = async (o) => { try { return await renderCertificate(o); } catch (err) { if (!mime) throw err; throw badRequest('INVALID_FILE', 'อ่านภาพพื้นหลังไม่ได้ กรุณาบันทึกเป็น JPG หรือ PNG ใหม่', [{ field: 'image', message: 'อ่านไฟล์ไม่ได้' }]); } };
  return make({ layout, background, verifyUrl: verifyUrl('SAMPLE'), watermark: 'ตัวอย่าง', cert: { number: `${await prefix()}-${thaiYear()}-000000`, name: 'นายต้นข้าว ใจดี', course: 'หลักสูตรผู้ควบคุมการขายวัตถุอันตรายทางการเกษตร', university: 'มหาวิทยาลัยตัวอย่าง', session: 'รุ่นตัวอย่าง', startsAt: new Date('2027-01-15T02:00:00Z'), endsAt: new Date('2027-01-16T09:00:00Z'), issuedAt: new Date() } });
}

// ---------- ออกและเพิกถอน ----------
export const candidates = (sessionId) => repo.candidates(sessionId);
export async function issue(ids, { adminId, ip }, nameOverride = null) {
  const result = { issued: 0, skipped: [] };
  const pre = await prefix(); const year = thaiYear();
  for (const id of new Set(ids)) {
    const out = await withTransaction(async (conn) => {
      const app = await apps.lockById(id, conn);
      if (!app || app.status !== 'passed') return 'สถานะไม่ใช่ "ผ่านการอบรม"';
      const full = await apps.findById(id, conn);
      const template = await repo.templateFor(full.course_id, conn);
      const no = `${pre}-${year}-${String(await repo.nextNumber(pre, year, conn)).padStart(6, '0')}`;
      const certId = await repo.insert({ no, code: randomCode(16), applicationId: id, name: nameOverride ?? full.full_name, course: full.course_name, university: full.university_name, session: full.session_name, startsAt: full.starts_at, endsAt: full.ends_at, templateId: template?.id ?? null, adminId }, conn);
      await changeStatus(app, 'certified', { actorType: 'admin', actorId: adminId }, conn);
      await insertAudit({ adminId, action: 'certificate.issue', entityType: 'application', entityId: id, ip, metadata: { certificateId: certId, no, nameEdited: Boolean(nameOverride && nameOverride !== full.full_name) } }, conn);
      return null;
    });
    if (out === null) result.issued += 1; else result.skipped.push({ id, reason: out });
  }
  return result;
}
/** เพิกถอนแล้วสถานะถอยเป็น "ผ่านการอบรม" เพื่อออกใหม่ได้ ไม่ส่งแจ้งเตือนซ้ำ */
export async function revoke(id, reason, { adminId, ip }) {
  await withTransaction(async (conn) => {
    const peek = await repo.findById(id, conn);
    if (!peek) throw notFound('ไม่พบใบประกาศ');
    const app = peek.application_id ? await apps.lockById(peek.application_id, conn) : null;
    const c = await repo.lock(id, conn);
    if (c.status !== 'valid') throw conflict('ALREADY_REVOKED', 'ใบนี้ถูกเพิกถอนแล้ว');
    await repo.revoke({ id, reason, adminId }, conn);
    if (app?.status === 'certified') {
      await apps.updateStatus(app.id, 'passed', null, conn);
      await apps.insertHistory({ applicationId: app.id, from: 'certified', to: 'passed', reason: 'เพิกถอนใบประกาศ', actorType: 'admin', actorId: adminId }, conn);
    }
    await insertAudit({ adminId, action: 'certificate.revoke', entityType: 'certificate', entityId: id, ip, metadata: { no: c.certificate_no, reason } }, conn);
  });
}
const listView = (c) => ({ id: c.id, number: c.certificate_no, code: c.verify_code, url: verifyUrl(c.verify_code), applicationId: c.application_id, name: c.holder_name, course: c.course_name, session: c.session_name, university: c.university_name, status: c.status, reason: c.revoke_reason, issuedAt: c.issued_at, issuedBy: c.admin_name });
export async function list(f) { const p = { ...f, limit: f.pageSize, offset: (f.page - 1) * f.pageSize }; return { items: (await repo.list(p)).map(listView), total: await repo.count(p) }; }

async function pdfOf(c) {
  if (!c.holder_name) throw new AppError(410, 'PURGED', 'ข้อมูลผู้รับถูกลบตามระยะเวลาเก็บรักษาแล้ว');
  const tpl = c.template_id ? await repo.findTemplate(c.template_id) : null;
  return renderCertificate({ layout: tpl ? JSON.parse(tpl.layout_json) : DEFAULT_LAYOUT, background: tpl?.storage_name ? await readDocument(tpl.storage_name) : null, verifyUrl: verifyUrl(c.verify_code), watermark: c.status === 'revoked' ? 'เพิกถอนแล้ว' : null,
    cert: { number: c.certificate_no, name: c.holder_name, course: c.course_name, university: c.university_name, session: c.session_name, startsAt: c.starts_at, endsAt: c.ends_at, issuedAt: c.issued_at } });
}
export async function adminPdf(id) {
  const c = await repo.findById(id);
  if (!c) throw notFound('ไม่พบใบประกาศ');
  return { buffer: await pdfOf(c), name: `${c.certificate_no}.pdf` };
}
export async function myCertificate(session, applicationId) {
  if (!(await listMine(session)).some((a) => a.id === applicationId)) throw notFound('ไม่พบใบสมัคร');
  const c = await repo.validOf(applicationId);
  if (!c) throw notFound('ยังไม่มีใบประกาศ');
  return c;
}
export async function myPdf(session, applicationId) { const c = await myCertificate(session, applicationId); return { buffer: await pdfOf(c), name: `${c.certificate_no}.pdf` }; }
export async function summaryOf(applicationId) { const c = await repo.validOf(applicationId); return c ? { number: c.certificate_no, issuedAt: c.issued_at, verifyUrl: verifyUrl(c.verify_code), verifyPath: `/certificate/verify/${c.verify_code}` } : null; }

/** หน้าสาธารณะ: ชื่อเต็ม นามสกุลเห็นเพียง 2 อักษรแรก พอให้เทียบกับใบจริงได้ */
export function maskName(name) {
  const [first, ...rest] = name.trim().split(/\s+/);
  const seg = new Intl.Segmenter('th', { granularity: 'grapheme' });
  return [first, ...rest.map((w) => `${[...seg.segment(w)].slice(0, 2).map((s) => s.segment).join('')}***`)].join(' ');
}
export async function verify(code) {
  const c = await repo.findByCode(code);
  if (!c) throw notFound('ไม่พบใบประกาศรหัสนี้');
  return { number: c.certificate_no, name: c.holder_name ? maskName(c.holder_name) : null, course: c.course_name, university: c.university_name, issuedAt: c.issued_at, status: c.status, revokedAt: c.revoked_at };
}
