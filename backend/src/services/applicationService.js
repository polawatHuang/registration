import { withTransaction } from '../config/db.js';
import { logger } from '../config/logger.js';
import * as repo from '../repositories/applicationRepository.js';
import * as catalog from '../repositories/catalogRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { guardAttempt } from './lockoutService.js';
import { linkVerifiedApplicant } from './lineLoginService.js';
import { queueRegistration, statusOf } from './emailService.js';
import * as retention from './retentionService.js';
import { summaryOf as certificateSummary } from './certificateService.js';
import { qrUsable } from './attendanceService.js';
import { requestOf } from '../repositories/retentionRepository.js';
import { countAttended, dailyCheckins } from '../repositories/attendanceRepository.js';
import { countValid } from '../repositories/certificateRepository.js';
import { daily as notificationDaily } from '../repositories/notificationRepository.js';
import { summary as aiSummary } from './aiReportService.js';
import { getLegal } from './legalService.js';
import { inspectDocument, readDocument, removeDocuments, storeDocument } from './storageService.js';
import { decryptText, encryptText, keyedHash, randomCode } from '../utils/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { isValidThaiId, maskEmail, maskMobile, maskThaiId, toAsciiDigits } from '../utils/thai.js';
import { ADMIN_TRANSITIONS, DOC_LABELS, IDENTITY_VERIFIED, NEEDS_REASON, STATUS_LABELS, TIMELINE, TIMELINE_STEP } from '../utils/status.js';

export const hashNationalId = (v) => keyedHash('national_id', v);
const nationalIdOf = (row) => decryptText(row.national_id_enc, 'national_id');
const thaiYear = () => (new Date(Date.now() + 7 * 3_600_000).getUTCFullYear() + 543) % 100;

async function storeAll(docs) {
  const stored = [];
  try {
    for (const d of docs) stored.push({ ...d, storageName: await storeDocument(d) });
    return stored;
  } catch (err) {
    await cleanup(stored);
    throw err;
  }
}
const cleanup = (stored) => removeDocuments(stored.map((s) => s.storageName)).catch((err) => logger.error({ err: { message: err.message } }, 'orphan file cleanup failed'));

/** ทุกการเปลี่ยนสถานะผ่านที่นี่ เพื่อให้มีประวัติและเหตุการณ์แจ้งเตือนเสมอ */
export async function changeStatus(app, to, { reason = null, actorType, actorId = null }, conn) {
  await repo.updateStatus(app.id, to, reason, conn);
  await repo.insertHistory({ applicationId: app.id, from: app.status, to, reason, actorType, actorId }, conn);
  await repo.insertEvent('application.status_changed', app.id, { from: app.status, to }, conn);
}

export async function submit(input, files, { ip, lineUserId }) {
  if (input.privacyVersion !== (await getLegal()).version) throw conflict('PRIVACY_CHANGED', 'ประกาศความเป็นส่วนตัวมีการปรับปรุง กรุณารีเฟรชหน้าแล้วอ่านอีกครั้ง');
  const nidHash = hashNationalId(input.nationalId);
  const replay = async () => {
    const found = await repo.findByIdempotency(input.idempotencyKey);
    if (!found) return null;
    if (found.national_id_hash !== nidHash) throw conflict('IDEMPOTENCY_MISMATCH', 'คำขอนี้ถูกใช้แล้ว กรุณารีเฟรชหน้า');
    return repo.findById(found.id);
  };
  const existing = await replay();
  if (existing) return existing;

  const required = ['id_card', 'payment_slip', 'portrait_photo', ...(input.hasTrainedBefore ? ['previous_certificate'] : [])];
  const missing = required.filter((t) => !files[t]?.[0]);
  if (missing.length) throw badRequest('MISSING_DOCUMENTS', 'กรุณาแนบเอกสารให้ครบ', missing.map((field) => ({ field, message: `กรุณาแนบ${DOC_LABELS[field]}` })));
  const docs = required.map((t) => inspectDocument(t, files[t][0]));
  if (!(await catalog.findActiveOption(input.shopDurationId, 'shop_duration'))) throw badRequest('VALIDATION_ERROR', 'กรุณาเลือกระยะเวลาในการเปิดร้าน', [{ field: 'shopDurationId', message: 'กรุณาเลือก' }]);

  const stored = await storeAll(docs);
  try {
    const id = await withTransaction(async (conn) => {
      const session = await catalog.lockOpenSession(input.sessionId, input.universityId, conn);
      if (!session) throw conflict('SESSION_CLOSED', 'รุ่นที่เลือกปิดรับสมัครแล้ว กรุณาเลือกรุ่นอื่น');
      if (session.capacity !== null && await catalog.countActive(session.id, conn) >= session.capacity) throw conflict('SESSION_FULL', 'รุ่นที่เลือกเต็มแล้ว กรุณาเลือกรุ่นอื่น');
      const applicantId = await repo.upsertApplicant({ fullName: input.fullName, nationalIdEnc: encryptText(input.nationalId, 'national_id'), nationalIdHash: nidHash }, conn);
      const applicationId = await repo.insertApplication({
        ...input, applicantId, lineUserId, applicationNo: `ET${String(thaiYear()).padStart(2, '0')}-${randomCode(8)}`,
        hasTrainedBefore: input.hasTrainedBefore ? 1 : 0, taxIdEnc: input.taxId ? encryptText(input.taxId, 'tax_id') : null,
      }, conn);
      for (const s of stored) await repo.insertDocument({ ...s, applicationId, version: 1 }, conn);
      for (const purpose of ['privacy_notice_ack', 'terms', ...(input.sensitiveConsent ? ['sensitive_id_card'] : [])]) await repo.insertConsent({ applicationId, purpose, version: input.privacyVersion, ip }, conn);
      await repo.insertHistory({ applicationId, from: null, to: 'submitted', reason: null, actorType: 'applicant', actorId: null }, conn);
      await queueRegistration(applicationId, conn);
      await repo.insertEvent('application.submitted', applicationId, { sessionId: session.id }, conn);
      return applicationId;
    });
    return await repo.findById(id);
  } catch (err) {
    await cleanup(stored);
    if (err.code === 'ER_DUP_ENTRY') {
      const winner = await replay(); // กดส่งซ้ำพร้อมกัน: คำขอแรกสำเร็จไปแล้ว
      if (winner) return winner;
      if (/uq_applications_person_session/.test(err.message)) throw conflict('ALREADY_APPLIED', 'มีใบสมัครของเลขประจำตัวนี้ในรุ่นที่เลือกแล้ว กรุณาใช้เมนูติดตามสถานะ');
    }
    throw err;
  }
}

export async function verifyAccess({ applicationNo, nationalId, mobile }, ip) {
  const clear = await guardAttempt('application_access', [applicationNo, `ip:${ip}`], [5, 20]);
  const app = await repo.findForAccess(applicationNo, hashNationalId(nationalId), mobile);
  if (!app) throw new AppError(401, 'ACCESS_DENIED', 'ข้อมูลไม่ตรงกับใบสมัครในระบบ');
  await clear();
  return app;
}

/** ผู้เรียกต้องพิสูจน์สิทธิ์ในใบสมัครมาก่อนแล้ว คืน null เมื่อใบนี้เป็นของ LINE อื่น */
export function attachLine(applicationId, lineUserId, ip) {
  return withTransaction(async (conn) => {
    const app = await repo.lockById(applicationId, conn);
    if (app.line_user_id && app.line_user_id !== lineUserId) return null;
    await repo.setLineUser(app.id, lineUserId, conn);
    const accountLinked = IDENTITY_VERIFIED.includes(app.status)
      && await linkVerifiedApplicant({ lineUserId, applicantId: app.applicant_id, method: 'verification' }, conn);
    if (app.line_user_id !== lineUserId) await repo.insertEvent('line.linked', app.id, {}, conn);
    await insertAudit({ actorType: 'applicant', action: 'line.claim_application', entityType: 'application', entityId: app.id, ip, metadata: { lineUserId } }, conn);
    return { accountLinked };
  });
}
export async function claimForLine(input, lineUserId, ip) {
  const result = await attachLine((await verifyAccess(input, ip)).id, lineUserId, ip);
  if (!result) throw conflict('ALREADY_LINKED', 'ใบสมัครนี้เชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อเจ้าหน้าที่');
  return result;
}

export const listMine = (session) => repo.listAccessible({ lineUserId: session.line_user_id, applicationId: session.application_id });
async function findMine(session, id) {
  const app = (await listMine(session)).find((a) => a.id === id);
  if (!app) throw notFound('ไม่พบใบสมัคร');
  return app;
}

async function erasureView(id) {
  const r = await requestOf(id);
  return r && r.status !== 'cancelled' ? { code: r.request_code, status: r.status, reason: r.decision_reason, dueAt: r.due_at } : null;
}
export async function requestErasure(session, id, note, ip) { await findMine(session, id); await retention.createRequest(id, note, ip); return applicantView(await findMine(session, id)); }
export async function cancelErasure(session, id, ip) { await findMine(session, id); await retention.cancelRequest(id, ip); return applicantView(await findMine(session, id)); }

export async function applicantView(row) {
  const [docs, consents] = [await repo.currentDocuments(row.id), await repo.consentsOf(row.id)];
  const stopped = ['rejected', 'cancelled'].includes(row.status);
  return {
    id: row.id, applicationNo: row.application_no, fullName: row.full_name, nationalId: maskThaiId(nationalIdOf(row)), mobile: maskMobile(row.mobile), email: maskEmail(row.email),
    courseName: row.course_name, universityName: row.university_name, sessionName: row.session_name, startsAt: row.starts_at, endsAt: row.ends_at,
    location: row.location, mapUrl: row.map_url, details: row.session_details, submittedAt: row.submitted_at,
    status: row.status, statusLabel: STATUS_LABELS[row.status], statusReason: row.status_reason,
    timeline: { steps: TIMELINE, current: stopped ? null : TIMELINE_STEP[row.status], stopped, attention: row.status === 'documents_incomplete' },
    erasure: await erasureView(row.id), certificate: await certificateSummary(row.id), qrReady: qrUsable(row),
    canWithdrawSensitive: consents.some((c) => c.purpose === 'sensitive_id_card' && !c.withdrawn_at),
    documents: docs.map((d) => ({ type: d.doc_type, label: DOC_LABELS[d.doc_type], status: d.review_status, reason: d.review_reason, version: d.version,
      canReplace: row.status === 'documents_incomplete' && d.review_status === 'rejected' })),
  };
}

export async function resubmit(session, applicationId, files, ip) {
  await findMine(session, applicationId);
  const types = Object.keys(files).filter((t) => files[t]?.[0]);
  if (!types.length) throw badRequest('NO_FILES', 'กรุณาเลือกไฟล์');
  const stored = await storeAll(types.map((t) => inspectDocument(t, files[t][0])));
  try {
    await withTransaction(async (conn) => {
      const app = await repo.lockById(applicationId, conn);
      if (app.status !== 'documents_incomplete') throw conflict('NOT_EDITABLE', 'ใบสมัครนี้ไม่ได้อยู่ในขั้นแก้ไขเอกสาร');
      const current = await repo.currentDocuments(applicationId, conn);
      for (const s of stored) {
        const old = current.find((d) => d.doc_type === s.docType);
        if (!old || old.review_status !== 'rejected') throw conflict('DOC_NOT_REJECTED', `${DOC_LABELS[s.docType]}ไม่ต้องแก้ไข`);
        await repo.retireDocument(old.id, conn);
        await repo.insertDocument({ ...s, applicationId, version: old.version + 1 }, conn);
      }
      await repo.insertEvent('application.documents_resubmitted', applicationId, { types }, conn);
      await insertAudit({ actorType: 'applicant', action: 'application.resubmit', entityType: 'application', entityId: applicationId, ip, metadata: { types } }, conn);
      const remaining = (await repo.currentDocuments(applicationId, conn)).some((d) => d.review_status === 'rejected');
      if (!remaining) await changeStatus(app, 'under_review', { actorType: 'applicant' }, conn);
    });
  } catch (err) {
    await cleanup(stored);
    throw err;
  }
  return applicantView(await findMine(session, applicationId));
}

/** มาตรา 19: ถอนได้ง่ายเท่ากับตอนให้ เจ้าหน้าที่เห็นเพื่อปิดทับหรือขอภาพใหม่ */
export async function withdrawSensitive(session, applicationId, ip) {
  await findMine(session, applicationId);
  await withTransaction(async (conn) => {
    const { affectedRows } = await repo.withdrawConsent(applicationId, 'sensitive_id_card', conn);
    if (!affectedRows) throw conflict('NOTHING_TO_WITHDRAW', 'ไม่มีความยินยอมที่ต้องถอน');
    await repo.insertEvent('consent.withdrawn', applicationId, { purpose: 'sensitive_id_card' }, conn);
    await insertAudit({ actorType: 'applicant', action: 'consent.withdraw', entityType: 'application', entityId: applicationId, ip, metadata: { purpose: 'sensitive_id_card' } }, conn);
  });
  return applicantView(await findMine(session, applicationId));
}

// ---------- เจ้าหน้าที่ ----------
const listItem = (r) => ({
  id: r.id, applicationNo: r.application_no, fullName: r.full_name, nationalId: maskThaiId(nationalIdOf(r)), mobile: r.mobile, shopName: r.shop_name,
  universityName: r.university_name, sessionName: r.session_name, startsAt: r.starts_at, status: r.status, statusLabel: STATUS_LABELS[r.status], submittedAt: r.submitted_at, hasLine: Boolean(r.line_user_id),
});
function withIdSearch(f) {
  const digits = f.q ? toAsciiDigits(f.q).replace(/[\s-]/g, '') : '';
  return { ...f, nationalIdHash: isValidThaiId(digits) ? hashNationalId(digits) : null };
}
export async function adminList(filter) {
  const { rows, total } = await repo.search(withIdSearch(filter));
  return { items: rows.map(listItem), total };
}
async function mustFind(id) {
  const row = await repo.findById(id);
  if (!row) throw notFound('ไม่พบใบสมัคร');
  return row;
}
export async function adminDetail(id, admin) {
  const r = await mustFind(id);
  const canSee = admin.permissions.includes('documents.view');
  const base = { ...listItem(r), startsAt: r.starts_at, endsAt: r.ends_at, courseName: r.course_name, location: r.location, statusReason: r.status_reason, hold: r.hold_at ? { reason: r.hold_reason, at: r.hold_at } : null, history: await repo.historyOf(id), emailStatus: await statusOf(id), consents: await repo.consentsOf(id),
    allowedTransitions: admin.permissions.includes('applicants.review') ? ADMIN_TRANSITIONS[r.status].map((s) => ({ status: s, label: STATUS_LABELS[s], needsReason: NEEDS_REASON.includes(s) })) : [] };
  if (!canSee) return { ...base, mobile: maskMobile(r.mobile), documents: [] };
  return { ...base, address: r.address, email: r.email, lineContactId: r.line_contact_id, shopAddress: r.shop_address, shopDuration: r.shop_duration, hasTrainedBefore: Boolean(r.has_trained_before),
    receiptName: r.receipt_name, receiptAddress: r.receipt_address, taxId: r.tax_id_enc ? maskThaiId(decryptText(r.tax_id_enc, 'tax_id')) : null,
    documents: (await repo.currentDocuments(id)).map((d) => ({ id: d.id, type: d.doc_type, label: DOC_LABELS[d.doc_type], version: d.version, purged: Boolean(d.file_purged_at), mime: d.mime_type, size: d.size_bytes,
      reviewStatus: d.review_status, reviewReason: d.review_reason, uploadedAt: d.created_at })) };
}
export async function revealIds(id, { adminId, ip }) {
  const r = await mustFind(id);
  await insertAudit({ adminId, action: 'application.reveal_national_id', entityType: 'application', entityId: id, ip });
  return { nationalId: nationalIdOf(r), taxId: r.tax_id_enc ? decryptText(r.tax_id_enc, 'tax_id') : null };
}
export async function openDocument(applicationId, documentId, { adminId, ip }) {
  const doc = await repo.findDocument(documentId, applicationId);
  if (!doc) throw notFound('ไม่พบเอกสาร');
  if (!doc.storage_name) throw new AppError(410, 'FILE_PURGED', 'ไฟล์นี้ถูกลบตามระยะเวลาเก็บรักษาหรือการถอนความยินยอมแล้ว');
  const buffer = await readDocument(doc.storage_name);
  await insertAudit({ adminId, action: 'document.view', entityType: 'application', entityId: applicationId, ip, metadata: { documentId, type: doc.doc_type } });
  return { buffer, mime: doc.mime_type };
}
export async function review(applicationId, documentId, { decision, reason }, { adminId, ip }) {
  await withTransaction(async (conn) => {
    const app = await repo.lockById(applicationId, conn);
    if (!app) throw notFound('ไม่พบใบสมัคร');
    if (!['submitted', 'under_review'].includes(app.status)) throw conflict('NOT_REVIEWABLE', 'สถานะปัจจุบันไม่อยู่ในขั้นตรวจเอกสาร');
    const doc = await repo.findDocument(documentId, applicationId, conn);
    if (!doc || !doc.is_current) throw conflict('DOC_REPLACED', 'เอกสารนี้ถูกแทนที่แล้ว กรุณารีเฟรช');
    await repo.reviewDocument({ id: documentId, decision, reason: decision === 'rejected' ? reason : null, adminId }, conn);
    if (app.status === 'submitted') await changeStatus(app, 'under_review', { actorType: 'admin', actorId: adminId }, conn);
    await insertAudit({ adminId, action: `document.${decision}`, entityType: 'application', entityId: applicationId, ip, metadata: { documentId, type: doc.doc_type, reason } }, conn);
  });
}
export async function transition(applicationId, { status, expectedStatus, reason }, { adminId, ip }) {
  await withTransaction(async (conn) => {
    const app = await repo.lockById(applicationId, conn);
    if (!app) throw notFound('ไม่พบใบสมัคร');
    if (app.status !== expectedStatus) throw conflict('STATUS_CHANGED', 'มีเจ้าหน้าที่คนอื่นเปลี่ยนสถานะไปแล้ว กรุณารีเฟรช');
    if (!ADMIN_TRANSITIONS[app.status].includes(status)) throw conflict('INVALID_TRANSITION', `เปลี่ยนจาก "${STATUS_LABELS[app.status]}" เป็นสถานะนี้ไม่ได้`);
    const docs = await repo.currentDocuments(applicationId, conn);
    if (status === 'documents_approved' && docs.some((d) => d.review_status !== 'approved')) throw conflict('DOCS_NOT_APPROVED', 'ต้องตรวจเอกสารผ่านครบทุกรายการก่อน');
    const rejected = docs.filter((d) => d.review_status === 'rejected');
    if (status === 'documents_incomplete' && !rejected.length) throw conflict('NO_REJECTED_DOCS', 'กรุณาระบุเอกสารที่ไม่ผ่านอย่างน้อย 1 รายการก่อน');
    const why = reason ?? (status === 'documents_incomplete' ? rejected.map((d) => `${DOC_LABELS[d.doc_type]}: ${d.review_reason}`).join(' / ').slice(0, 500) : null);
    if (NEEDS_REASON.includes(status) && !why) throw badRequest('REASON_REQUIRED', 'กรุณาระบุเหตุผล', [{ field: 'reason', message: 'กรุณาระบุเหตุผล' }]);
    await changeStatus(app, status, { reason: why, actorType: 'admin', actorId: adminId }, conn);
    if (status === 'documents_approved' && app.line_user_id) await linkVerifiedApplicant({ lineUserId: app.line_user_id, applicantId: app.applicant_id, method: 'registration' }, conn);
    await insertAudit({ adminId, action: 'application.status', entityType: 'application', entityId: applicationId, ip, metadata: { from: app.status, to: status } }, conn);
  });
}
export const EXPORT_LIMIT = 5000;
export async function exportRows(filter, { adminId, ip }) {
  const { rows, total } = await repo.search({ ...withIdSearch(filter), page: 1, pageSize: EXPORT_LIMIT });
  await insertAudit({ adminId, action: 'application.export', entityType: 'application', ip, metadata: { rows: rows.length, total, status: filter.status ?? null, sessionId: filter.sessionId ?? null } });
  return rows.map((r) => ({ ...listItem(r), email: r.email, shopAddress: r.shop_address, receiptName: r.receipt_name, receiptAddress: r.receipt_address }));
}
export async function dashboard(permissions) {
  const d = await repo.dashboard();
  const extra = { attendance: { total: await countAttended(), daily: await dailyCheckins() }, certificates: await countValid(), notifications: await notificationDaily(), ai: permissions.includes('ai.manage') ? await aiSummary() : null };
  return { ...d, ...extra, statuses: d.statuses.map((s) => ({ ...s, label: STATUS_LABELS[s.status] })), total: d.statuses.reduce((t, s) => t + s.n, 0) };
}
