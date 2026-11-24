import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { withTransaction, query } from '../config/db.js';
import { logger } from '../config/logger.js';
import * as repo from '../repositories/retentionRepository.js';
import * as apps from '../repositories/applicationRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { confirmPassword } from './adminAuthService.js';
import { getLegal } from './legalService.js';
import { kick, queueNotice, retryNotice, clearNotice } from './emailService.js';
import { removeDocuments } from './storageService.js';
import { keyedHash, randomCode } from '../utils/crypto.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

export const CONFIRM_TEXT = 'ลบถาวร';
export const KINDS = ['withdrawn', 'documents', 'rejected', 'applications', 'line_users', 'logs'];
/** ลบตามระยะเวลาได้เมื่อประกาศเผยแพร่แล้วเท่านั้น ยกเว้นการถอนความยินยอมซึ่งมีผลทันที */
const FIELD = { documents: 'retention_documents', rejected: 'retention_rejected', applications: 'retention_applications', line_users: 'retention_rejected', logs: 'retention_logs' };
const limitOf = (kind, legal) => (kind === 'withdrawn' ? 0 : legal.approved ? Number(legal.fields[FIELD[kind]]) : null);
const appRef = (no) => keyedHash('purge_application', no);
const lineRef = (lineUserId) => keyedHash('purge_line', lineUserId);
const REDO_REASON = 'ถอนความยินยอมข้อมูลอ่อนไหวแล้ว กรุณาส่งภาพบัตรที่ปิดทับศาสนาและหมู่โลหิต';

export async function summary() {
  const legal = await getLegal();
  const counts = {};
  for (const k of KINDS) { const l = limitOf(k, legal); counts[k] = l === null ? null : await repo.countDue(k, l); }
  const r = await repo.countRequests();
  return { ready: legal.approved, counts, due: KINDS.filter((k) => k !== 'logs').reduce((t, k) => t + (counts[k] ?? 0), 0), requests: { pending: Number(r.pending ?? 0), urgent: Number(r.urgent ?? 0) }, filesPending: (await repo.pendingFiles()).length };
}
export async function due(kind, paging) {
  const limit = limitOf(kind, await getLegal());
  if (limit === null) return { items: [], total: 0 };
  const rows = await repo.listDue(kind, limit, paging);
  const mask = (n) => (n ? `${[...n].slice(0, 2).join('')}***` : '-');
  return { total: await repo.countDue(kind, limit), items: rows.map((r) => (kind === 'line_users' ? { id: r.id, label: mask(r.display_name), detail: r.last_interaction_at }
    : { id: r.id, label: `${r.application_no} ${mask(r.full_name)}`, sessionName: r.session_name, universityName: r.university_name, endsAt: r.ends_at, status: r.status })) };
}

async function purgeOne(kind, app, reason, adminId, conn) {
  if (kind === 'documents') await repo.purgeDocumentFiles(app.id, conn);
  else if (kind === 'withdrawn') {
    const docs = await repo.purgeDocumentFiles(app.id, conn, { docType: 'id_card', before: await repo.withdrawnAt(app.id, conn) });
    if (docs.some((d) => d.is_current)) {
      await repo.rejectPurgedIdCard(app.id, REDO_REASON, conn);
      if (['submitted', 'under_review', 'documents_approved'].includes(app.status)) {
        await apps.updateStatus(app.id, 'documents_incomplete', REDO_REASON, conn);
        await apps.insertHistory({ applicationId: app.id, from: app.status, to: 'documents_incomplete', reason: REDO_REASON, actorType: 'system', actorId: null }, conn);
        await apps.insertEvent('application.status_changed', app.id, { from: app.status, to: 'documents_incomplete' }, conn);
      }
    }
  } else await repo.deleteApplication(app, conn);
  await repo.insertPurgeLog({ kind, reason, ref: appRef(app.application_no), sessionId: app.session_id, status: app.status, adminId }, conn);
}

/** ลบไฟล์จริงหลัง commit และทำซ้ำจนสำเร็จ (งานตั้งเวลาเรียกด้วย) */
export async function flushFiles() {
  let removed = 0;
  for (const { storage_name: name } of await repo.pendingFiles()) {
    try { await removeDocuments([name]); await repo.fileDone(name); removed += 1; } catch (err) { logger.error({ err: { message: err.message } }, 'file purge failed'); }
  }
  return { removed };
}
const LEDGER = path.join(env.storagePath, 'purge-ledger.jsonl');
const readLedger = async () => (await fs.readFile(LEDGER, 'utf8').catch((e) => { if (e.code === 'ENOENT') return ''; throw e; })).split('\n').filter(Boolean);
/** รวมของเดิมกับ DB เสมอ: ถ้า DB ถูกกู้คืนย้อนหลัง บัญชีการลบต้องไม่หายตาม */
let ledgerQueue = Promise.resolve();
export function syncLedger() {
  const run = async () => {
    const lines = new Set([...(await readLedger()), ...(await repo.ledgerRows()).map((r) => JSON.stringify({ kind: r.kind, ref: r.ref, at: r.at }))]);
    await fs.mkdir(env.storagePath, { recursive: true, mode: 0o700 });
    const tmp = `${LEDGER}.${process.pid}.tmp`;
    await fs.writeFile(tmp, lines.size ? `${[...lines].join('\n')}\n` : '', { mode: 0o600 });
    await fs.rename(tmp, LEDGER);
    return { entries: lines.size };
  };
  ledgerQueue = ledgerQueue.then(run, run);
  return ledgerQueue;
}
async function afterPurge() {
  await flushFiles();
  await syncLedger();
}

async function authorize({ password, confirm }, { adminId, ip }) {
  if (confirm !== CONFIRM_TEXT) throw badRequest('CONFIRM_REQUIRED', `พิมพ์คำว่า "${CONFIRM_TEXT}" เพื่อยืนยัน`, [{ field: 'confirm', message: `พิมพ์ ${CONFIRM_TEXT}` }]);
  await confirmPassword(adminId, password, ip);
}
export async function purge({ kind, ids, password, confirm }, actor) {
  await authorize({ password, confirm }, actor);
  const limit = limitOf(kind, await getLegal());
  if (limit === null) throw conflict('RETENTION_NOT_READY', 'ต้องเผยแพร่ประกาศที่ระบุระยะเวลาเก็บข้อมูลก่อน');
  const result = { purged: 0, skipped: 0 };
  const reason = kind === 'withdrawn' ? 'withdrawal' : 'retention';
  if (kind === 'logs') {
    result.purged = await withTransaction(async (conn) => { const n = await repo.deleteLogs(limit, conn); if (n) await repo.insertPurgeLog({ kind, reason, count: n, adminId: actor.adminId }, conn); return n; });
  } else {
    if (!ids.length) throw badRequest('NO_SELECTION', 'กรุณาเลือกรายการ');
    // ทีละรายการ: รายการหนึ่งล้มเหลวไม่ทำให้รายการอื่นย้อนกลับ และข้ามรายการที่ไม่เข้าเงื่อนไขแล้ว
    for (const id of new Set(ids)) {
      const done = await withTransaction(async (conn) => {
        if (kind === 'line_users') {
          const l = await repo.lockDueLineUser(id, limit, conn);
          if (!l) return false;
          await repo.deleteLineUser(id, conn);
          await repo.insertPurgeLog({ kind, reason, ref: lineRef(l.line_user_id), adminId: actor.adminId }, conn);
          return true;
        }
        const app = await repo.lockDueApplication(kind, id, limit, conn);
        if (!app) return false;
        await purgeOne(kind, app, reason, actor.adminId, conn);
        return true;
      });
      result[done ? 'purged' : 'skipped'] += 1;
    }
  }
  await insertAudit({ adminId: actor.adminId, action: 'retention.purge', entityType: 'retention', entityId: kind, ip: actor.ip, metadata: result });
  await afterPurge();
  return result;
}

export async function setHold(id, reason, { adminId, ip }) {
  await withTransaction(async (conn) => {
    if (!(await repo.lockApplication(id, conn))) throw notFound('ไม่พบใบสมัคร');
    await repo.setHold({ id, reason, adminId: reason ? adminId : null }, conn);
    await insertAudit({ adminId, action: reason ? 'retention.hold' : 'retention.release', entityType: 'application', entityId: id, ip }, conn);
  });
}

// ---------- คำขอลบจากเจ้าของข้อมูล (มาตรา 33) ----------
export async function createRequest(applicationId, note, ip) {
  try { await repo.insertRequest({ code: `DR-${randomCode(8)}`, applicationId, note }); } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('REQUEST_EXISTS', 'มีคำขอที่อยู่ระหว่างพิจารณาแล้ว');
    throw err;
  }
  await insertAudit({ actorType: 'applicant', action: 'erasure.request', entityType: 'application', entityId: applicationId, ip });
}
export async function cancelRequest(applicationId, ip) {
  if (!(await repo.cancelRequest(applicationId))) throw conflict('NO_PENDING_REQUEST', 'ไม่มีคำขอที่ยกเลิกได้');
  await insertAudit({ actorType: 'applicant', action: 'erasure.cancel', entityType: 'application', entityId: applicationId, ip });
}
export async function decide(id, { decision, reason, password, confirm }, actor) {
  if (decision === 'approved') await authorize({ password, confirm }, actor);
  else {
    await confirmPassword(actor.adminId, password, actor.ip);
    if (!reason) throw badRequest('REASON_REQUIRED', 'ต้องระบุเหตุผลที่ปฏิเสธ', [{ field: 'reason', message: 'จำเป็นต้องระบุ' }]);
  }
  await withTransaction(async (conn) => {
    const r = await repo.lockRequest(id, conn);
    if (!r) throw notFound('ไม่พบคำขอ');
    if (r.status !== 'pending') throw conflict('ALREADY_DECIDED', 'คำขอนี้ดำเนินการแล้ว');
    const app = await repo.lockApplication(r.application_id, conn);
    if (!app) throw conflict('GONE', 'ใบสมัครถูกลบไปแล้ว');
    if (decision === 'approved' && app.hold_at) throw conflict('ON_HOLD', 'ใบสมัครนี้ถูกระงับการลบอยู่ ต้องปลดก่อน หรือปฏิเสธพร้อมเหตุผล');
    const emailId = await queueNotice({ template: `erasure_${decision}`, to: app.email, key: `erasure:${id}`, payload: { code: r.request_code, reason } }, conn);
    await repo.decideRequest({ id, status: decision, reason, adminId: actor.adminId, emailId }, conn);
    if (decision === 'approved') await purgeOne('applications', app, 'request', actor.adminId, conn);
    await insertAudit({ adminId: actor.adminId, action: `erasure.${decision}`, entityType: 'data_request', entityId: id, ip: actor.ip }, conn);
  });
  if (decision === 'approved') await afterPurge();
  kick();
}
/** แจ้งผลไม่สำเร็จ: ส่งซ้ำ หรือบันทึกว่าแจ้งทางอื่นแล้ว (ประกาศ 2567 ข้อ 8) */
export async function notice(id, action, { adminId, ip }) {
  await withTransaction(async (conn) => {
    const r = await repo.lockRequest(id, conn);
    if (!r?.email_id) throw notFound('ไม่พบรายการแจ้งผล');
    if (action === 'retry') { if (!(await retryNotice(r.email_id, conn))) throw conflict('NOT_RETRYABLE', 'ส่งซ้ำไม่ได้'); } else { await clearNotice(r.email_id, conn); await repo.markNotified(id, conn); }
    await insertAudit({ adminId, action: `erasure.notice_${action}`, entityType: 'data_request', entityId: id, ip }, conn);
  });
  kick();
}
export async function requests(paging) { return { items: await repo.listRequests(paging), total: (await repo.countRequests()).total }; }
export async function log(paging) { return { items: await repo.listPurgeLog(paging), total: await repo.countPurgeLog() }; }

/** หลังกู้คืนข้อมูลสำรอง: ลบซ้ำทุกรายการที่เคยลบ (ประกาศ 2567 ข้อ 3 วรรคสอง และข้อ 4) */
export async function reapply() {
  const entries = (await readLedger()).map((l) => JSON.parse(l));
  const byRef = new Map();
  for (const e of entries) byRef.set(e.ref, [...(byRef.get(e.ref) ?? []), e]);
  const result = { checked: entries.length, purged: 0 };
  const run = async (fn) => { if (await withTransaction(fn)) result.purged += 1; };
  for (const a of await query('SELECT id, application_no FROM applications')) {
    for (const e of byRef.get(appRef(a.application_no)) ?? []) {
      await run(async (conn) => {
        const app = await repo.lockApplication(a.id, conn);
        if (!app) return false;
        if (['documents', 'withdrawn'].includes(e.kind)) {
          // เวลาละเอียดระดับวินาที จึงใช้ "ก่อน" อย่างเคร่งครัด ไม่ให้โดนไฟล์ใหม่ที่ส่งหลังการลบเดิม
          const before = e.kind === 'withdrawn' ? await repo.withdrawnAt(app.id, conn) : null;
          const docs = await repo.purgeDocumentFiles(app.id, conn, { docType: e.kind === 'withdrawn' ? 'id_card' : null, before, olderThan: new Date(e.at) });
          return docs.length > 0;
        }
        await repo.deleteApplication(app, conn);
        return true;
      });
    }
  }
  for (const l of await query('SELECT id, line_user_id, created_at FROM line_users')) {
    // ผู้ใช้ LINE คนเดิมที่กลับมาหลังการลบ มีวันที่สร้างใหม่กว่า จึงไม่ถูกลบ
    if ((byRef.get(lineRef(l.line_user_id)) ?? []).some((e) => l.created_at <= new Date(e.at))) {
      await run(async (conn) => {
        if ((await query('SELECT 1 FROM applications WHERE line_user_id = :id LIMIT 1', { id: l.id }, conn)).length) return false;
        await repo.deleteLineUser(l.id, conn);
        return true;
      });
    }
  }
  if (result.purged) await repo.insertPurgeLog({ kind: 'applications', reason: 'restore', count: result.purged });
  await afterPurge();
  return result;
}
