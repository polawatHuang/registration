import crypto from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { logger } from '../config/logger.js';
import * as repo from '../repositories/notificationRepository.js';
import * as apps from '../repositories/applicationRepository.js';
import { getSettings, setSetting } from '../repositories/catalogRepository.js';
import { permissionsOf } from '../repositories/adminRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import * as line from '../integrations/lineMessagingClient.js';
import { ADMIN_EVENTS, APPLICANT_TYPES, STATUS_TO_TYPE, VARIABLES } from '../config/notificationTypes.js';
import { adminFlex, compose, SAMPLE, toFlex, unknownVariables } from './notificationTemplates.js';
import { randomCode, sha256 } from '../utils/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';

const KEYS = { enabled: 'notify_enabled', daysBefore: 'notify_days_before', hoursBefore: 'notify_hours_before', evaluationUrl: 'notify_evaluation_url' };
export async function settings() {
  const s = await getSettings(Object.values(KEYS));
  return { enabled: s[KEYS.enabled] === '1', daysBefore: Number(s[KEYS.daysBefore] ?? 3), hoursBefore: Number(s[KEYS.hoursBefore] ?? 2), evaluationUrl: s[KEYS.evaluationUrl] || null };
}
const BACKOFF = [1, 5, 30, 120];
const EVENT_MAX_AGE = 24 * 3_600_000;

// ---------- template ----------
const defaults = (key) => { const t = APPLICANT_TYPES[key]; return t && { tone: t.tone, heading: t.heading, body: t.body, button: t.button }; };
async function templateOf(key) {
  const row = await repo.findTemplate(key);
  return { active: row ? Boolean(row.is_active) : true, content: row ? JSON.parse(row.content_json) : defaults(key) };
}
export async function listTemplates() {
  const saved = new Map((await repo.listTemplates()).map((t) => [t.template_key, t]));
  const view = (key, title, custom) => { const r = saved.get(key); return { key, title: r?.title ?? title, custom, active: r ? Boolean(r.is_active) : true, edited: Boolean(r) && !custom, ...(r ? JSON.parse(r.content_json) : defaults(key)) }; };
  return { items: [...Object.entries(APPLICANT_TYPES).map(([k, t]) => view(k, t.title, false)), ...[...saved.values()].filter((t) => t.is_custom).map((t) => view(t.template_key, t.title, true))], variables: VARIABLES };
}
function checkText(d) {
  const bad = [...unknownVariables(d.heading), ...unknownVariables(d.body)];
  if (bad.length) throw badRequest('UNKNOWN_VARIABLE', `ไม่รู้จักตัวแปร ${bad.map((b) => `{{${b}}}`).join(' ')}`, [{ field: 'body', message: 'ใช้เฉพาะตัวแปรที่มีให้' }]);
}
const contentOf = (d, base) => ({ tone: d.tone, heading: d.heading, body: d.body, button: d.buttonLabel ? { label: d.buttonLabel, path: base?.button?.path ?? '/tracking.html' } : null });
export async function saveTemplate(key, d, { adminId, ip }) {
  checkText(d);
  const base = APPLICANT_TYPES[key];
  const row = await repo.findTemplate(key);
  if (!base && !row) throw notFound('ไม่พบข้อความ');
  await withTransaction(async (conn) => {
    await repo.upsertTemplate({ key, title: base ? base.title : d.title ?? row.title, content: JSON.stringify(contentOf(d, base)), custom: base ? 0 : 1, active: d.active ? 1 : 0, adminId }, conn);
    await insertAudit({ adminId, action: 'notification.template', entityType: 'notification_template', entityId: key, ip }, conn);
  });
}
export async function createTemplate(d, { adminId, ip }) {
  checkText(d);
  if (!d.title) throw badRequest('VALIDATION_ERROR', 'กรุณาตั้งชื่อข้อความ', [{ field: 'title', message: 'กรุณาตั้งชื่อ' }]);
  const key = `custom_${randomCode(8).toLowerCase()}`;
  await withTransaction(async (conn) => { await repo.upsertTemplate({ key, title: d.title, content: JSON.stringify(contentOf(d)), custom: 1, active: 1, adminId }, conn); await insertAudit({ adminId, action: 'notification.template', entityType: 'notification_template', entityId: key, ip }, conn); });
  return key;
}
export async function removeTemplate(key, { adminId, ip }) {
  await withTransaction(async (conn) => { if (!(await repo.deleteTemplate(key, conn))) throw notFound('ลบได้เฉพาะข้อความที่สร้างเอง'); await insertAudit({ adminId, action: 'notification.template_delete', entityType: 'notification_template', entityId: key, ip }, conn); });
}
export async function preview(key, d) { checkText(d); return compose(contentOf(d, APPLICANT_TYPES[key]), SAMPLE, { evaluationUrl: (await settings()).evaluationUrl ?? 'https://example.com/evaluation' }); }
export async function sendTest(key, d, { adminId, ip }) {
  checkText(d);
  const me = await repo.adminRecipient(adminId);
  if (!me?.line_user_id) throw conflict('ADMIN_NOT_LINKED', 'เชื่อม LINE ของคุณก่อน จึงจะส่งทดสอบได้');
  const q = await line.quota();
  if (q?.limited && q.remaining <= 0) throw conflict('QUOTA_EXCEEDED', 'โควตาข้อความ LINE ของเดือนนี้หมดแล้ว');
  const m = await preview(key, d);
  const r = await line.push(me.line_user_id, [toFlex({ ...m, heading: `[ทดสอบ] ${m.heading}` })], crypto.randomUUID());
  line.forgetQuota();
  await insertAudit({ adminId, action: 'notification.test', entityType: 'notification_template', entityId: key ?? null, ip, metadata: { status: r.status } });
  if (r.status !== 200) throw new AppError(502, 'LINE_REJECTED', `LINE ไม่รับข้อความ (${r.status || 'หมดเวลา'})`);
}

// ---------- เหตุการณ์ → คิว ----------
async function applicantEvent(e, type, conn, payload = null) {
  const r = await repo.lineOfApplication(e.aggregate_id, conn);
  if (!r?.line_user_id) return;
  const t = await repo.findTemplate(type, conn);
  if (t && !t.is_active) return;
  await repo.enqueue({ lineUserId: r.line_user_id, applicationId: e.aggregate_id, type, payload, key: `event:${e.id}:${type}` }, conn);
}
const adminEvent = (event, conn) => repo.enqueueAdmin(event, ADMIN_EVENTS[event].window ?? 300, conn);
/** ปิดระบบอยู่: ทิ้งเหตุการณ์ ไม่สะสมไว้ส่งรวดเดียวตอนเปิด */
export async function processEvents() {
  for (let total = 0; ;) {
    const n = await withTransaction(async (conn) => {
      const events = await repo.pendingEvents(conn);
      if (!events.length) return 0;
      const { enabled } = await settings();
      for (const e of events) {
        if (!enabled || Date.now() - new Date(e.created_at) > EVENT_MAX_AGE) continue;
        const payload = e.payload_json ? JSON.parse(e.payload_json) : {};
        if (e.event_type === 'application.submitted') { await applicantEvent(e, 'submitted', conn); await adminEvent('new_applicant', conn); }
        else if (e.event_type === 'application.documents_resubmitted') { await applicantEvent(e, 'documents_received', conn); await adminEvent('documents_received', conn); }
        else if (e.event_type === 'application.status_changed' && STATUS_TO_TYPE[payload.to]) await applicantEvent(e, STATUS_TO_TYPE[payload.to], conn);
        else if (e.event_type === 'chat.help_requested') await adminEvent('help_requested', conn);
        else if (e.event_type === 'chat.ai_unanswered') await adminEvent('ai_unanswered', conn);
        else if (['consent.withdrawn', 'erasure.requested'].includes(e.event_type)) await adminEvent('privacy_request', conn);
        else if (e.event_type === 'notification.failed') await adminEvent('send_failed', conn);
      }
      await repo.eventsDone(events.map((e) => e.id), conn);
      return events.length;
    });
    total += n;
    if (n < 200) return total;
  }
}

// ---------- เตือนตามเวลา ----------
const DAY = 86_400_000;
const bkkNine = (date, daysBefore) => { const d = new Date(new Date(date).getTime() + 7 * 3_600_000); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - daysBefore * DAY + 2 * 3_600_000); };
export async function scheduleReminders(now = new Date()) {
  const s = await settings();
  if (!s.enabled) return { scheduled: 0 };
  let scheduled = 0;
  const add = async (type, rows, atOf, expiresOf, keyOf) => {
    if (!rows.length || !(await templateOf(type)).active) return;
    for (const r of rows) {
      const at = atOf(r);
      if (at > now) continue;
      const lineUser = await repo.lineOfApplication(r.id);
      if (!lineUser?.line_user_id) continue; // เชื่อม LINE ทีหลังยังได้รับ เพราะยังไม่บันทึกคีย์
      scheduled += await repo.enqueue({ lineUserId: lineUser.line_user_id, applicationId: r.id, type, payload: JSON.stringify({ startsAt: new Date(r.starts_at).getTime() }), at: now, expires: expiresOf(r), key: `${type}:${r.id}:${Math.floor(new Date(keyOf(r)).getTime() / 1000)}` });
    }
  };
  const hours = s.hoursBefore * 3_600_000;
  // เตือนก่อนวันส่ง 09:00 เวลาไทย และไม่ส่งถ้าใกล้จะเริ่มจนใช้การเตือนก่อนเริ่มแทนแล้ว
  if (s.daysBefore > 0) await add('reminder_day', await repo.dueReminders('reminder_day', new Date(now.getTime() + Math.max(hours, 3_600_000)), new Date(now.getTime() + (s.daysBefore + 1) * DAY)), (r) => bkkNine(r.starts_at, s.daysBefore), (r) => new Date(new Date(r.starts_at).getTime() - Math.max(hours, 3_600_000)), (r) => r.starts_at);
  if (s.hoursBefore > 0) await add('reminder_hour', await repo.dueReminders('reminder_hour', now, new Date(now.getTime() + hours)), (r) => new Date(new Date(r.starts_at).getTime() - hours), (r) => r.starts_at, (r) => r.starts_at);
  if (s.evaluationUrl) await add('evaluation', await repo.dueReminders('evaluation', new Date(now.getTime() - 3 * DAY), now), (r) => r.ends_at, (r) => new Date(new Date(r.ends_at).getTime() + 4 * DAY), (r) => r.ends_at);
  return { scheduled };
}

// ---------- ส่ง ----------
const STOP = Symbol('stop');
async function buildApplicant(q) {
  const app = await apps.findById(q.application_id);
  if (!app) return { cancel: 'ใบสมัครถูกลบแล้ว' };
  if (q.campaign_id) {
    const c = await repo.findCampaign(q.campaign_id);
    if (c.status !== 'active') return { cancel: 'ยกเลิกการส่งกลุ่ม' };
    return { message: compose(JSON.parse(c.content_json), app, { footer: 'พิมพ์ "หยุดรับข่าว" เพื่อไม่รับข้อความกลุ่ม' }) };
  }
  const type = APPLICANT_TYPES[q.notification_type];
  if (type?.status && app.status !== type.status) return { cancel: 'สถานะเปลี่ยนไปแล้ว ข้อความล้าสมัย' };
  if (q.notification_type.startsWith('reminder_')) {
    if (!['approved', 'awaiting_training'].includes(app.status)) return { cancel: 'สถานะเปลี่ยนไปแล้ว ข้อความล้าสมัย' };
    if (new Date(app.starts_at).getTime() !== JSON.parse(q.payload_json).startsAt) return { cancel: 'เวลาอบรมเปลี่ยน จะเตือนตามเวลาใหม่' };
  }
  // ลิงก์ LINE เปลี่ยนหรือยกเลิกหลังเข้าคิว ต้องไม่ส่งไปคนเดิม
  if ((await repo.lineOfApplication(app.id))?.line_user_id !== q.line_user_id) return { cancel: 'ยกเลิกการเชื่อม LINE แล้ว' };
  const t = await templateOf(q.notification_type);
  if (!t.active) return { cancel: 'ปิดใช้ข้อความนี้แล้ว' };
  return { message: compose(t.content, app, { evaluationUrl: (await settings()).evaluationUrl }) };
}
async function buildAdmin(q) {
  const event = ADMIN_EVENTS[q.notification_type.slice(6)];
  const a = await repo.adminRecipient(q.admin_id);
  if (!event || !a || a.status !== 'active') return { cancel: 'ผู้รับถูกปิดใช้งาน' };
  if (!a.line_id) return { cancel: 'ผู้รับยกเลิกการเชื่อม LINE แล้ว' };
  if (!(await permissionsOf(a.role_id)).includes(event.permission)) return { cancel: 'ผู้รับไม่มีสิทธิ์แล้ว' };
  return { flex: adminFlex(event, q.item_count), lineId: a.line_id };
}
async function sendOne(q, token) {
  const end = (status, error = null, tried = 0) => repo.finish({ id: q.id, token, status, error, tried });
  if (!(await settings()).enabled) return end('cancelled', 'ปิดระบบแจ้งเตือน');
  const built = q.admin_id ? await buildAdmin(q) : await buildApplicant(q);
  if (built.cancel) return end('cancelled', built.cancel);
  const user = await repo.findLineUser(q.admin_id ? built.lineId : q.line_user_id);
  if (!user || user.status !== 'active') return end('cancelled', 'บัญชี LINE ถูกระงับ');
  if (user.friend_status === 'blocked') return end('cancelled', 'ผู้รับบล็อก LINE OA');
  if (q.campaign_id && user.campaign_opt_out) return end('cancelled', 'ผู้รับไม่รับข้อความกลุ่ม');
  if (user.friend_status === 'unknown') {
    const p = await line.profile(user.line_user_id);
    if (p.status === 404) return end('cancelled', 'ผู้รับยังไม่ได้เพิ่มเพื่อน LINE OA');
    if (p.status === 200) await repo.setFriend(user.id, 'friend');
  }
  const quota = await line.quota();
  if (quota?.limited && quota.remaining <= 0) { await repo.retryLater({ id: q.id, token, error: 'โควตา LINE ของเดือนนี้หมด', minutes: 60, tried: 0 }); return STOP; }
  const r = await line.push(user.line_user_id, [built.flex ?? toFlex(built.message)], q.retry_key);
  line.countPush(r.status);
  await repo.insertLog({ queueId: q.id, request: JSON.stringify({ type: q.notification_type, retryKey: q.retry_key }), response: JSON.stringify(r.body ?? {}).slice(0, 1000), status: r.status === 200 || r.status === 409 ? 'sent' : 'error', code: String(r.status) });
  if (r.status === 200 || r.status === 409) return end('sent', null, 1);
  if (r.status === 401 || r.status === 403) { await repo.retryLater({ id: q.id, token, error: 'Channel access token ไม่ถูกต้อง', minutes: 10, tried: 0 }); return STOP; }
  const wait = BACKOFF[q.retry_count];
  if ((r.status === 0 || r.status === 429 || r.status >= 500) && wait !== undefined) { await repo.retryLater({ id: q.id, token, error: r.status ? `LINE ตอบรหัส ${r.status}` : 'เชื่อมต่อ LINE ไม่ได้', minutes: wait, tried: 1 }); return undefined; }
  await end('failed', r.status ? `LINE ปฏิเสธข้อความ (${r.status})` : 'เชื่อมต่อ LINE ไม่ได้', 1);
  if (!q.admin_id) await repo.insertEvent('notification.failed', 'notification', q.id); // แจ้งเจ้าหน้าที่เฉพาะข้อความถึงผู้สมัคร ไม่วนแจ้งตัวเอง
  return undefined;
}
export async function processQueue(rounds = 10) {
  const result = { processed: 0 };
  if (!(await line.isReady())) return { skipped: 'ยังไม่ได้ตั้งค่า LINE Messaging API' };
  for (let i = 0; i < rounds; i += 1) {
    const token = crypto.randomUUID();
    const jobs = await repo.claim(token, 20);
    if (!jobs.length) return result;
    let stop = false;
    for (let k = 0; k < jobs.length && !stop; k += 4) {
      const out = await Promise.all(jobs.slice(k, k + 4).map((q) => sendOne(q, token).catch(async (err) => {
        logger.error({ err: { message: err.message, code: err.code }, queueId: q.id }, 'notification failed');
        const wait = BACKOFF[q.retry_count];
        await (wait === undefined ? repo.finish({ id: q.id, token, status: 'failed', error: 'ระบบขัดข้อง', tried: 1 }) : repo.retryLater({ id: q.id, token, error: 'ระบบขัดข้อง', minutes: wait, tried: 1 }));
      })));
      result.processed += out.length;
      stop = out.includes(STOP);
    }
    if (stop) { await repo.release(token); return { ...result, stopped: true }; }
  }
  return result;
}
let running = null; let again = false; let timer = null;
/** ปลุกตัวเองตอนหน้าต่างรวมข้อความปิด ถ้าโปรเซสถูกปิดไปก่อน งานตั้งเวลาจะส่งให้ */
async function wake() {
  try {
    const s = await repo.nextDue();
    clearTimeout(timer);
    if (s !== null) { timer = setTimeout(kick, Math.max(2, s + 1) * 1000); timer.unref(); }
  } catch { /* งานตั้งเวลาจะเก็บต่อ */ }
}
export function kick() {
  if (running) { again = true; return running; }
  running = (async () => { do { again = false; await processEvents(); await processQueue(); } while (again); })().catch((err) => logger.error({ err: { message: err.message } }, 'notification run failed')).finally(() => { running = null; wake(); });
  return running;
}
export async function job() { const events = await processEvents(); return { events, ...(await scheduleReminders()), ...(await processQueue()) }; }

// ---------- หน้า Admin ----------
export async function state(adminId) {
  const [s, stats, ready, me] = await Promise.all([settings(), repo.stats(), line.isReady(), repo.adminRecipient(adminId)]);
  return { settings: s, stats: Object.fromEntries(stats.map((r) => [r.status, r.n])), daily: await repo.daily(), lineReady: ready, quota: ready ? await line.quota() : null, linked: Boolean(me?.line_id) };
}
export async function saveSettings(d, { adminId, ip }) {
  if (d.enabled && !(await line.isReady())) throw conflict('LINE_NOT_READY', 'ตั้งค่า LINE Messaging API ก่อนเปิดแจ้งเตือน');
  await withTransaction(async (conn) => {
    for (const [k, v] of Object.entries({ enabled: d.enabled ? '1' : '', daysBefore: String(d.daysBefore), hoursBefore: String(d.hoursBefore), evaluationUrl: d.evaluationUrl ?? '' })) await setSetting(KEYS[k], v, conn);
    await insertAudit({ adminId, action: 'notification.settings', entityType: 'notification', ip, metadata: { enabled: d.enabled } }, conn);
  });
}
export async function queue(f) { const p = { ...f, limit: f.pageSize, offset: (f.page - 1) * f.pageSize }; return { items: await repo.listQueue(p), total: await repo.countQueue(p) }; }
export const logs = (id) => repo.logsOf(id);
export async function act(id, action, { adminId, ip }) {
  if (!(await (action === 'retry' ? repo.requeue(id) : repo.cancel(id)))) throw conflict('NOT_ALLOWED', action === 'retry' ? 'ส่งซ้ำได้เฉพาะรายการที่ล้มเหลว' : 'ยกเลิกได้เฉพาะรายการที่รอส่ง');
  await insertAudit({ adminId, action: `notification.${action}`, entityType: 'notification', entityId: id, ip });
  if (action === 'retry') kick();
}
export async function estimate(filter) {
  const [count, q] = [await repo.countTargets(filter), await line.quota()];
  return { count, quota: q, enough: !q?.limited || q.remaining >= count };
}
export async function createCampaign(d, { adminId, ip }) {
  checkText(d);
  const existing = await repo.findCampaignByKey(d.clientKey);
  if (existing) return { id: existing.id, count: existing.recipient_count };
  if (!(await settings()).enabled) throw conflict('NOTIFY_DISABLED', 'เปิดระบบแจ้งเตือนก่อน');
  const at = d.scheduledAt && d.scheduledAt > new Date() ? d.scheduledAt : null;
  const e = await estimate(d.filter);
  if (!e.count) throw conflict('NO_TARGETS', 'ไม่มีผู้รับตามเงื่อนไข');
  if (e.count !== d.expectedCount) throw conflict('COUNT_CHANGED', `จำนวนผู้รับเปลี่ยนเป็น ${e.count} คน กรุณาตรวจสอบอีกครั้ง`);
  if (!e.enough) throw conflict('QUOTA_EXCEEDED', `โควตาเหลือ ${e.quota.remaining} ไม่พอสำหรับ ${e.count} คน`);
  let id;
  try {
    id = await withTransaction(async (conn) => {
      const cid = await repo.insertCampaign({ title: d.title, content: JSON.stringify(contentOf(d)), filter: JSON.stringify(d.filter), count: e.count, at, clientKey: d.clientKey, adminId }, conn);
      const n = await repo.enqueueCampaign({ ...d.filter, campaignId: cid, at }, conn);
      if (n !== e.count) throw conflict('COUNT_CHANGED', 'จำนวนผู้รับเปลี่ยน กรุณาตรวจสอบอีกครั้ง');
      await insertAudit({ adminId, action: 'notification.campaign', entityType: 'campaign', entityId: cid, ip, metadata: { count: n } }, conn);
      return cid;
    });
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    const again2 = await repo.findCampaignByKey(d.clientKey);
    return { id: again2.id, count: again2.recipient_count };
  }
  kick();
  return { id, count: e.count };
}
export const campaigns = () => repo.listCampaigns();
export async function cancelCampaign(id, { adminId, ip }) {
  const n = await withTransaction(async (conn) => { const c = await repo.cancelCampaign(id, conn); if (c === null) throw conflict('NOT_ALLOWED', 'ยกเลิกไม่ได้'); await insertAudit({ adminId, action: 'notification.campaign_cancel', entityType: 'campaign', entityId: id, ip, metadata: { cancelled: c } }, conn); return c; });
  return { cancelled: n };
}
export async function recipients() {
  const perms = new Map();
  const rows = await repo.prefs();
  for (const r of rows) if (!perms.has(r.role_id)) perms.set(r.role_id, await permissionsOf(r.role_id));
  return { events: Object.entries(ADMIN_EVENTS).map(([key, e]) => ({ key, title: e.title })), admins: rows.map((r) => ({ id: r.id, name: r.display_name, role: r.role_name, linked: Boolean(r.linked), lineName: r.line_name, events: r.events ? r.events.split(',') : [], allowed: Object.entries(ADMIN_EVENTS).filter(([, e]) => perms.get(r.role_id).includes(e.permission)).map(([k]) => k) })) };
}
export async function setRecipient(adminId, events, actor) {
  const target = (await recipients()).admins.find((a) => a.id === adminId);
  if (!target) throw notFound('ไม่พบผู้ใช้');
  if (events.some((e) => !target.allowed.includes(e))) throw badRequest('NOT_PERMITTED', 'ผู้ใช้นี้ไม่มีสิทธิ์เกี่ยวข้องกับเหตุการณ์ที่เลือก');
  await withTransaction(async (conn) => { await repo.setPrefs(adminId, [...new Set(events)], conn); await insertAudit({ adminId: actor.adminId, action: 'notification.recipients', entityType: 'admin_user', entityId: adminId, ip: actor.ip, metadata: { events } }, conn); });
}

// ---------- เชื่อม LINE ของเจ้าหน้าที่ ----------
const CODE = /^ADMIN-([2-9A-HJ-NP-Z]{10})$/i;
export async function linkCode({ adminId, ip }) {
  const code = `ADMIN-${randomCode(10)}`;
  await repo.saveCode(adminId, sha256(code));
  await insertAudit({ adminId, action: 'notification.link_code', entityType: 'admin_user', entityId: adminId, ip });
  return { code, minutes: 10 };
}
export async function unlinkAdmin({ adminId, ip }) {
  await withTransaction(async (conn) => { await repo.setAdminLine(adminId, null, conn); await insertAudit({ adminId, action: 'notification.unlink', entityType: 'admin_user', entityId: adminId, ip }, conn); });
}
/** เรียกจาก webhook: ข้อความคำสั่งไม่ถูกเก็บเป็นแชต คืนข้อความตอบ หรือ null ถ้าไม่ใช่คำสั่ง */
export async function command(text, lineUser) {
  const t = text.trim();
  if (t === 'หยุดรับข่าว' || t === 'รับข่าว') { await repo.setOptOut(lineUser.id, t === 'หยุดรับข่าว' ? 1 : 0); return t === 'หยุดรับข่าว' ? 'หยุดส่งข้อความกลุ่มแล้ว คุณยังได้รับแจ้งสถานะใบสมัครตามปกติ พิมพ์ "รับข่าว" เพื่อรับอีกครั้ง' : 'เปิดรับข้อความกลุ่มแล้ว'; }
  if (!CODE.test(t)) return null;
  return withTransaction(async (conn) => {
    const c = await repo.takeCode(sha256(t.toUpperCase()), conn);
    if (!c) return 'รหัสไม่ถูกต้องหรือหมดอายุ สร้างรหัสใหม่ได้ที่หน้าแจ้งเตือน';
    await repo.clearAdminLine(lineUser.id, conn); // LINE หนึ่งบัญชีเป็นของเจ้าหน้าที่ได้คนเดียว
    await repo.setAdminLine(c.admin_id, lineUser.id, conn);
    await repo.deleteCode(c.admin_id, conn);
    await insertAudit({ adminId: c.admin_id, action: 'notification.link', entityType: 'admin_user', entityId: c.admin_id }, conn);
    return 'เชื่อม LINE ของเจ้าหน้าที่แล้ว จะได้รับแจ้งเตือนตามที่ตั้งค่าไว้';
  });
}
