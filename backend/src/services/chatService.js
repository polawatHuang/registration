import crypto from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { logger } from '../config/logger.js';
import * as repo from '../repositories/chatRepository.js';
import * as line from '../integrations/lineMessagingClient.js';
import { isConfigured } from '../integrations/minimaxClient.js';
import { getSettings, setSetting } from '../repositories/catalogRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { answer } from './aiService.js';
import { aiSettings } from './aiReportService.js';
import { health } from './aiHealthService.js';
import { KIND_TEXT } from '../config/minimaxErrors.js';
import { command, kick as notify } from './notificationService.js';
import { insertEvent } from '../repositories/notificationRepository.js';
import { CONTACT_DATA, viewUrl, WELCOME_KEYS } from './richMenuService.js';
import { adminMessage, aiMessage, contactMessage, HANDOFF, HUMAN_TEXT, welcome } from './chatTemplates.js';
import { track } from '../utils/background.js';
import { credit } from './aiCreditService.js';

/** ยอดเครดิต AI โดยย่อสำหรับแถบหน้าแชต อ่านไม่ได้ก็ไม่ขวางหน้า */
const creditBrief = async () => { try { const c = await credit({ withSpending: false, waitFx: false }); return { remaining: c.remaining, currency: c.currency, level: c.level, rate: c.fx.rate }; } catch { return null; } };
import { readDocument, storeDocument } from './storageService.js';
import { flushFiles } from './retentionService.js';
import { env } from '../config/env.js';
import { decryptText, encryptText, keyedHash, sha256 } from '../utils/crypto.js';
import { AppError, conflict, notFound } from '../utils/errors.js';
import { STATUS_LABELS } from '../utils/status.js';

const AI_KEY = 'ai_chat_enabled';
const FRESH_MS = 120_000;
const TOKEN_MS = 50_000;
const HUMAN = /เจ้าหน้าที่|แอดมิน|admin|คุยกับคน|ติดต่อคน|พนักงาน/i;
const enc = (t) => encryptText(t, 'chat');
const dec = (v) => { try { return v ? decryptText(v, 'chat') : null; } catch { return null; } };
const preview = (t) => enc([...t.replace(/\s+/g, ' ')].slice(0, 80).join(''));

export const aiEnabled = async () => (await getSettings([AI_KEY]))[AI_KEY] === '1';

// ---------- รับ webhook ----------
export async function receive(rawBody, signature) {
  const check = await line.verifySignature(rawBody, signature);
  if (check === 'not_configured') throw new AppError(503, 'LINE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า LINE Messaging API');
  if (check !== 'ok') throw new AppError(401, 'INVALID_SIGNATURE', 'ลายเซ็นไม่ถูกต้อง');
  let body;
  try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError(400, 'INVALID_JSON', 'รูปแบบข้อมูลไม่ถูกต้อง'); }
  let stored = 0;
  for (const e of Array.isArray(body.events) ? body.events.slice(0, 500) : []) {
    const userId = e?.source?.userId;
    if (e?.source?.type !== 'user' || typeof userId !== 'string' || userId.length > 64) continue; // ไม่รับแชตกลุ่ม
    const eventId = typeof e.webhookEventId === 'string' && e.webhookEventId.length <= 64 ? e.webhookEventId : sha256(JSON.stringify(e));
    stored += await repo.insertEvent({ eventId, userHash: keyedHash('chat_user', userId), payload: encryptText(JSON.stringify(e), 'webhook') });
  }
  return stored;
}

let running = null; let again = false;
export function kickEvents() {
  if (running) { again = true; return running; }
  running = track((async () => { do { again = false; await processEvents(); } while (again); })()
    .catch((err) => logger.error({ err: { message: err.message } }, 'webhook processing failed')).finally(() => { running = null; }));
  return running;
}
export async function processEvents(limit = 40) {
  const result = { done: 0, failed: 0 };
  for (;;) {
    const jobs = await repo.claimEvents(crypto.randomUUID(), limit);
    if (!jobs.length) return result;
    const byUser = Map.groupBy(jobs, (j) => j.user_hash);
    // คนละคนทำพร้อมกัน คนเดียวกันทำตามลำดับ
    await Promise.all([...byUser.values()].map(async (list) => {
      for (const job of list) {
        try { await handle(JSON.parse(decryptText(job.payload_enc, 'webhook')), job.attempts); await repo.eventDone(job.id); result.done += 1; } catch (err) {
          logger.error({ err: { message: err.message, code: err.code }, eventRow: job.id }, 'webhook event failed');
          await repo.eventFailed(job.id, job.attempts >= 5); result.failed += 1;
        }
      }
    }));
    if (result.failed) return result; // ให้งานตั้งเวลาลองใหม่ ไม่วนซ้ำทันที
  }
}

const describe = (m) => {
  const s = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
  switch (m.type) {
    case 'text': return s(m.text, 10_000);
    case 'sticker': return `[สติกเกอร์]${Array.isArray(m.keywords) ? ` ${m.keywords.slice(0, 3).join(', ')}` : ''}`;
    case 'location': return ['[ตำแหน่ง]', s(m.title), s(m.address)].filter(Boolean).join(' ');
    case 'image': return '[รูปภาพ]';
    case 'file': return `[ไฟล์] ${s(m.fileName)}`;
    case 'video': return '[วิดีโอ]';
    case 'audio': return '[เสียง]';
    default: return '[ข้อความชนิดที่ไม่รองรับ]';
  }
};

async function handle(e, attempts) {
  if (e.type === 'unsend') return onUnsend(e);
  if (!['message', 'follow', 'unfollow', 'postback'].includes(e.type)) return undefined;
  const at = Number.isFinite(e.timestamp) ? new Date(e.timestamp) : new Date();
  const canSend = e.mode !== 'standby';
  const saved = await withTransaction(async (conn) => {
    const user = await repo.ensureUser(e.source.userId, conn);
    const conv = await repo.ensureConversation(user.id, conn);
    if (e.type === 'unfollow') { await repo.setFriend(user.id, 'blocked', conn); await repo.setToken(conv.id, null, null, conn); await repo.bump(conv.id, conn); return { user, conv }; }
    await repo.setFriend(user.id, 'friend', conn);
    const token = canSend && typeof e.replyToken === 'string' ? e.replyToken.slice(0, 100) : null;
    if (e.type === 'postback') return { user, conv, postback: String(e.postback?.data ?? '').slice(0, 300), token };
    if (e.type === 'follow') { await repo.setToken(conv.id, token, at, conn); return { user, conv }; }
    // คำสั่ง (รหัสเชื่อมเจ้าหน้าที่ / หยุดรับข่าว) ไม่เก็บเป็นแชต และไม่เข้า AI
    if (e.message?.type === 'text' && await isCommand(e.message.text)) return { user, conv, command: String(e.message.text), token };
    const lineMessageId = String(e.message?.id ?? '').slice(0, 64);
    const dup = lineMessageId && await repo.findByLineMessage(lineMessageId, conn);
    if (dup) return { user, conv, messageId: dup.id, text: dup.message_type === 'text' ? dec(dup.content_enc) : null, dup: true };
    const text = describe(e.message ?? {});
    const messageId = await repo.insertMessage({ conversationId: conv.id, direction: 'in', sender: 'user', type: String(e.message?.type ?? 'unknown').slice(0, 20), content: enc(text), lineMessageId: lineMessageId || null, status: 'received', at }, conn);
    await repo.onInbound({ id: conv.id, preview: preview(text), replyToken: token, tokenAt: token ? at : null }, conn);
    return { user, conv, messageId, text: e.message?.type === 'text' ? text : null };
  });
  if (e.type !== 'unfollow' && (!saved.user.profile_at || Date.now() - new Date(saved.user.profile_at) > 86_400_000)) await refreshProfile(saved.user);
  if (saved.command) { const reply = attempts === 1 ? await command(saved.command, saved.user) : null; if (reply && saved.token) await line.reply(saved.token, [adminMessage(reply)]); return undefined; }
  // ปุ่ม "ติดต่อ / AI" บน Rich Menu: ตอบช่องทางติดต่อด้วย reply ซึ่งไม่กินโควตา
  if (saved.postback === CONTACT_DATA && saved.token && attempts === 1) { const c = await getSettings(['contact_phone', 'contact_email', 'contact_line_url']); await line.reply(saved.token, [contactMessage(c, await aiEnabled())]); return undefined; }
  if (e.type === 'follow') return canSend && attempts === 1 && Date.now() - at < FRESH_MS ? sendWelcome(saved.conv.id, saved.user) : undefined;
  if (e.type !== 'message') return undefined;
  if (['image', 'file'].includes(e.message.type)) await fetchMedia(saved.messageId, e.message);
  if (saved.text !== null && canSend) return maybeAnswer(saved.conv.id, saved.messageId, saved.text, at, e.source.userId);
  if (saved.text === null && !saved.dup && await aiEnabled()) await repo.setAttention(saved.conv.id, 'ส่งไฟล์/รูป/สติกเกอร์');
  return undefined;
}

const COMMANDS = /^\s*(ADMIN-[2-9A-HJ-NP-Z]{10}|หยุดรับข่าว|รับข่าว)\s*$/i;
const isCommand = (t) => typeof t === 'string' && COMMANDS.test(t);
/** เรียกเจ้าหน้าที่: ติดป้ายในแชต และส่งเหตุการณ์แจ้งเตือน */
async function callStaff(conversationId, reason, event = 'chat.ai_unanswered') {
  await repo.setAttention(conversationId, reason);
  await insertEvent(event, 'chat', conversationId);
  notify();
}
async function refreshProfile(user) {
  const r = await line.profile(user.line_user_id);
  if (r.status !== 200) return;
  const picture = typeof r.body?.pictureUrl === 'string' && /^https:\/\/s?profile\.line-scdn\.net\//.test(r.body.pictureUrl) ? r.body.pictureUrl.slice(0, 1000) : null;
  await repo.setProfile(user.id, typeof r.body?.displayName === 'string' ? r.body.displayName.slice(0, 255) : null, picture);
  user.display_name = r.body?.displayName;
}
const MAGIC = [['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff], ['image/png', (b) => b.subarray(0, 4).toString('hex') === '89504e47'], ['application/pdf', (b) => b.subarray(0, 5).toString('latin1') === '%PDF-']];
async function fetchMedia(messageId, m) {
  if (m.contentProvider && m.contentProvider.type !== 'line') return;
  const buffer = await line.content(String(m.id));
  const mime = buffer && MAGIC.find(([, test]) => test(buffer))?.[0];
  if (!mime) return; // ชนิดอื่นแสดงเป็นข้อความ ไม่เก็บไฟล์ที่เปิดดูอย่างปลอดภัยไม่ได้
  await repo.setMedia(messageId, await storeDocument({ buffer }), mime);
}
async function onUnsend(e) {
  await withTransaction(async (conn) => {
    const m = await repo.findByLineMessage(String(e.unsend?.messageId ?? ''), conn);
    if (!m) return;
    const last = await repo.isLastMessage(m, conn);
    await repo.unsend(m, conn);
    if (last) await repo.setPreview(m.conversation_id, preview('[ผู้ใช้ยกเลิกข้อความ]'), conn); else await repo.bump(m.conversation_id, conn);
  });
  await flushFiles();
}

// ---------- ส่งข้อความ ----------
const unknown = (s) => s === 0 || s >= 500;
/** reply token ไม่กินโควตาจึงใช้ก่อน ถ้าใช้ไม่ได้จึง push หลังตรวจโควตา */
async function deliver(conv, messageId, retryKey, messages) {
  const done = async (status, via, error = null) => { await repo.finishMessage({ id: messageId, status, via, error }); await repo.bump(conv.id); return status === 'sent'; };
  if (conv.reply_token && Date.now() - new Date(conv.reply_token_at) < TOKEN_MS && await repo.takeToken(conv.id, conv.reply_token)) {
    const r = await line.reply(conv.reply_token, messages);
    if (r.status === 200) return done('sent', 'reply');
    // reply ไม่มี retry key: ถ้าไม่รู้ผลห้ามส่งซ้ำเอง ไม่งั้นผู้รับอาจได้สองข้อความ
    if (unknown(r.status)) return done('failed', null, 'ไม่แน่ใจว่าถึงผู้รับหรือไม่ ตรวจใน LINE ก่อนส่งซ้ำ');
    if (r.status === 401 || r.status === 403) return done('failed', null, 'Channel access token ไม่ถูกต้อง');
  }
  const q = await line.quota();
  if (q?.limited && q.remaining <= 0) return done('failed', null, 'โควตาข้อความ LINE ของเดือนนี้หมดแล้ว');
  let r = await line.push(conv.line_uid, messages, retryKey);
  if (unknown(r.status)) r = await line.push(conv.line_uid, messages, retryKey);
  line.forgetQuota();
  if (r.status === 200 || r.status === 409) return done('sent', 'push');
  return done('failed', null, r.status === 429 ? 'โควตาเต็มหรือส่งถี่เกินไป' : r.status === 401 || r.status === 403 ? 'Channel access token ไม่ถูกต้อง' : unknown(r.status) ? 'เชื่อมต่อ LINE ไม่สำเร็จ ลองส่งอีกครั้งได้' : `LINE ปฏิเสธข้อความ (${r.status})`);
}
const lockFull = (id, conn) => repo.lockConversation(id, conn);

async function sendWelcome(conversationId, user) {
  const w = await getSettings(WELCOME_KEYS);
  const msg = welcome(user.display_name, { title: w.line_welcome_title, text: w.line_welcome_text, home: await viewUrl('home') });
  const retryKey = crypto.randomUUID();
  const { conv, id } = await withTransaction(async (conn) => {
    const c = await lockFull(conversationId, conn);
    const mid = await repo.insertMessage({ conversationId, direction: 'out', sender: 'system', type: 'flex', content: enc('[ข้อความต้อนรับ]'), status: 'pending', retryKey }, conn);
    await repo.onOutbound({ id: conversationId, preview: preview('[ข้อความต้อนรับ]'), sender: 'system' }, conn);
    return { conv: c, id: mid };
  });
  await deliver(conv, id, retryKey, [msg]);
}

// ---------- AI ----------
async function maybeAnswer(conversationId, messageId, text, at, lineUid) {
  if (!(await repo.claimAi(messageId))) {
    // โปรเซสหยุดระหว่าง AI คิด: ไม่รู้ว่าส่งไปแล้วหรือยัง จึงไม่ตอบซ้ำ แต่เรียกเจ้าหน้าที่
    if ((await repo.findMessage(messageId, conversationId)).ai_state === 'working') { await repo.setAttention(conversationId, 'AI ตอบไม่ทัน'); await repo.aiDone(messageId); }
    return;
  }
  const conv = await repo.findConversation(conversationId);
  if (!(await aiEnabled()) || conv.ai_mode !== 'auto') { await repo.aiDone(messageId); return; }
  if (Date.now() - at > FRESH_MS) { await repo.setAttention(conversationId, 'ข้อความเข้าช้า AI ไม่ได้ตอบ'); await repo.aiDone(messageId); return; }
  if (text.trim() === HUMAN_TEXT || HUMAN.test(text)) {
    await sendAi(conversationId, messageId, HANDOFF, { mode: 'handoff' }, { attention: 'ขอคุยกับเจ้าหน้าที่', stop: true });
  } else if (await repo.countAiReplies(conversationId) >= (await aiSettings()).perHour) await callStaff(conversationId, 'ถามเกินจำนวนที่ AI ตอบต่อชั่วโมง');
  else if (!(await isConfigured())) await callStaff(conversationId, 'ยังไม่ได้ตั้งค่า MiniMax');
  else {
    line.loading(lineUid);
    const r = await answer(text.slice(0, 500), { channel: 'line', conversationId });
    const meta = { mode: r.mode, sources: (r.sources ?? []).slice(0, 5).map((s) => s.title.slice(0, 80)), tokens: r.tokens ?? null };
    if (r.answer) await sendAi(conversationId, messageId, r.answer, meta, { attention: ['fallback', 'error', 'limit', 'offline'].includes(r.mode) ? (r.mode === 'offline' ? 'AI หยุดชั่วคราว' : r.mode === 'error' ? 'MiniMax ขัดข้อง' : r.mode === 'limit' ? 'ใช้ token ครบเพดานเดือนนี้' : 'AI ไม่มีข้อมูลตอบ') : null });
    else await callStaff(conversationId, ['offline', 'limit'].includes(r.mode) ? 'AI หยุดชั่วคราว' : 'AI ไม่มีข้อมูลตอบ');
  }
  await repo.aiDone(messageId);
}
async function sendAi(conversationId, inboundId, text, meta, { attention = null, stop = false }) {
  const retryKey = crypto.randomUUID();
  const job = await withTransaction(async (conn) => {
    const c = await lockFull(conversationId, conn);
    // ระหว่าง AI คิด เจ้าหน้าที่อาจปิด AI หรือตอบไปแล้ว จึงตรวจอีกครั้งหลังล็อก
    if (c.ai_mode !== 'auto' || !(await aiEnabled()) || await repo.adminRepliedAfter(conversationId, inboundId, conn)) return null;
    const id = await repo.insertMessage({ conversationId, direction: 'out', sender: 'ai', type: 'text', content: enc(text), status: 'pending', retryKey, aiMeta: JSON.stringify(meta).slice(0, 1000) }, conn);
    await repo.onOutbound({ id: conversationId, preview: preview(text), sender: 'ai' }, conn);
    if (attention) { await repo.setAttention(conversationId, attention, conn); await insertEvent(stop ? 'chat.help_requested' : 'chat.ai_unanswered', 'chat', conversationId, conn); }
    if (stop) await repo.setAiMode(conversationId, 'off', conn);
    return { conv: c, id };
  });
  if (job && !(await deliver(job.conv, job.id, retryKey, [aiMessage(text)]))) await callStaff(conversationId, 'AI ส่งข้อความไม่สำเร็จ');
  if (job && attention) notify();
}

// ---------- หน้าเจ้าหน้าที่ ----------
async function mustFind(id) { const c = await repo.findConversation(id); if (!c) throw notFound('ไม่พบแชต'); return c; }
const listView = (r) => ({ id: r.id, name: r.display_name ?? 'ผู้ใช้ LINE', picture: r.picture_url, status: r.status, aiMode: r.ai_mode, attention: r.attention_reason, unread: r.unread_count, assignedTo: r.assigned_admin_id, preview: dec(r.preview_enc) ?? '', lastSender: r.last_sender, lastAt: r.last_message_at, blocked: r.friend_status === 'blocked' });
const messageView = (m) => ({ id: m.id, direction: m.direction, sender: m.sender, type: m.message_type, text: dec(m.content_enc), media: m.has_media ? m.media_mime : null, status: m.status, via: m.delivered_via, error: m.error_message, ai: m.ai_meta_json ? JSON.parse(m.ai_meta_json) : null, adminName: m.admin_name, at: m.created_at });
const PAGE = 40;

export async function state() {
  const [enabled, aiReady, lineReady, h] = await Promise.all([aiEnabled(), isConfigured(), line.isReady(), health()]);
  return { aiEnabled: enabled, aiReady, aiHealth: { status: h.status, text: h.status === 'ok' ? null : KIND_TEXT[h.kind] ?? 'AI ขัดข้อง' }, lineReady, quota: lineReady ? await line.quotaForView() : null, aiCredit: await creditBrief(), webhookUrl: env.lineWebhookUrl };
}
export async function poll({ filter, q, open, after, since, rev, offset }, adminId) {
  const now = await repo.serverNow();
  const [current, enabled] = await Promise.all([repo.revision(), aiEnabled()]);
  const changed = rev !== current;
  const [rows, counts, messages] = await Promise.all([changed ? repo.listConversations({ filter, q, adminId, limit: PAGE + 1, offset }) : null, changed ? repo.counts(adminId) : null,
    open ? repo.messagesSince(open, after, new Date(since || now)) : []]);
  return { rev: current, now: new Date(now).getTime() - 3000, aiEnabled: enabled, conversations: rows && rows.slice(0, PAGE).map(listView), more: rows ? rows.length > PAGE : null, counts: counts && Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])), messages: messages.map(messageView), open: open && changed ? await detail(open, true) : null };
}
export async function detail(id, optional = false) {
  const c = await repo.findConversation(id);
  if (!c) { if (optional) return null; throw notFound('ไม่พบแชต'); }
  return { ...listView(c), assignedName: c.assigned_name, canReplyFree: Boolean(c.reply_token && Date.now() - new Date(c.reply_token_at) < TOKEN_MS),
    applications: (await repo.linkedApplications(c.line_user_id)).map((a) => ({ id: a.id, no: a.application_no, name: a.full_name, status: a.status, statusLabel: STATUS_LABELS[a.status], session: a.session_name, startsAt: a.starts_at })) };
}
export async function messages(id, before) {
  await mustFind(id);
  const rows = await repo.messagesBefore(id, before ?? null, PAGE + 1);
  return { items: rows.slice(0, PAGE).reverse().map(messageView), more: rows.length > PAGE };
}
export async function send(id, { text, clientId }, { adminId, ip }) {
  const existing = await repo.findByRetryKey(clientId);
  if (existing) { if (existing.conversation_id !== id || existing.admin_id !== adminId) throw conflict('DUPLICATE_KEY', 'คำขอซ้ำ'); return { id: existing.id, status: existing.status }; }
  let job;
  try {
    job = await withTransaction(async (conn) => {
      const c = await lockFull(id, conn);
      if (!c) throw notFound('ไม่พบแชต');
      if (c.friend_status === 'blocked') throw conflict('USER_BLOCKED', 'ผู้ใช้บล็อก LINE OA อยู่ ส่งข้อความไม่ได้');
      const mid = await repo.insertMessage({ conversationId: id, direction: 'out', sender: 'admin', adminId, type: 'text', content: enc(text), status: 'pending', retryKey: clientId }, conn);
      await repo.onOutbound({ id, preview: preview(text), sender: 'admin' }, conn);
      await repo.setAiMode(id, 'off', conn); // คนตอบแล้ว AI หยุด
      await repo.setAttention(id, null, conn);
      if (c.status === 'closed') await repo.setStatus(id, 'open', conn);
      if (!c.assigned_admin_id) await repo.assign(id, adminId, conn);
      await insertAudit({ adminId, action: 'chat.reply', entityType: 'chat', entityId: id, ip }, conn);
      return { conv: c, mid };
    });
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    const again2 = await repo.findByRetryKey(clientId);
    return { id: again2.id, status: again2.status };
  }
  await deliver(job.conv, job.mid, clientId, [adminMessage(text)]);
  const m = await repo.findMessage(job.mid, id);
  return { id: m.id, status: m.status, error: m.error_message, via: m.delivered_via };
}
export async function retry(id, messageId, { adminId, ip }) {
  const c = await mustFind(id);
  const m = await repo.findMessage(messageId, id);
  if (!m || m.direction !== 'out' || m.message_type !== 'text') throw notFound('ไม่พบข้อความ');
  if (c.friend_status === 'blocked') throw conflict('USER_BLOCKED', 'ผู้ใช้บล็อก LINE OA อยู่ ส่งข้อความไม่ได้');
  // retry key เดิมใช้ได้ 24 ชั่วโมง: LINE จะไม่ส่งซ้ำถ้ารับไปแล้ว
  const key = Date.now() - new Date(m.created_at) < 23 * 3_600_000 ? m.retry_key : crypto.randomUUID();
  if (!(await repo.beginRetry(messageId, key))) throw conflict('NOT_RETRYABLE', 'ข้อความนี้ส่งซ้ำไม่ได้');
  await insertAudit({ adminId, action: 'chat.retry', entityType: 'chat', entityId: id, ip });
  const text = dec(m.content_enc);
  await deliver({ ...c, reply_token: null }, messageId, key, [m.sender === 'ai' ? aiMessage(text) : adminMessage(text)]);
  return repo.findMessage(messageId, id).then((x) => ({ id: x.id, status: x.status, error: x.error_message }));
}
export async function update(id, { aiMode, status, assign, readUpTo, attention }, { adminId, ip }) {
  await withTransaction(async (conn) => {
    const c = await lockFull(id, conn);
    if (!c) throw notFound('ไม่พบแชต');
    if (readUpTo !== undefined) await repo.markRead(id, readUpTo, conn);
    if (aiMode) { await repo.setAiMode(id, aiMode, conn); await insertAudit({ adminId, action: `chat.ai_${aiMode === 'auto' ? 'on' : 'off'}`, entityType: 'chat', entityId: id, ip }, conn); }
    if (attention === false) await repo.setAttention(id, null, conn);
    if (assign !== undefined) await repo.assign(id, assign ? adminId : null, conn);
    if (status) {
      await repo.setStatus(id, status, conn);
      if (status === 'closed') { await repo.setAttention(id, null, conn); await repo.setAiMode(id, 'auto', conn); await repo.assign(id, null, conn); await repo.markRead(id, Number.MAX_SAFE_INTEGER, conn); }
      await insertAudit({ adminId, action: `chat.${status}`, entityType: 'chat', entityId: id, ip }, conn);
    }
  });
  return detail(id);
}
export async function setAi(enabled, { adminId, ip }) {
  if (enabled && !(await isConfigured())) throw conflict('AI_NOT_READY', 'ตั้งค่า MiniMax ที่หน้า "ตั้งค่า" ก่อนเปิด AI');
  await withTransaction(async (conn) => {
    await setSetting(AI_KEY, enabled ? '1' : '', conn);
    await insertAudit({ adminId, action: enabled ? 'chat.ai_global_on' : 'chat.ai_global_off', entityType: 'chat', ip }, conn);
  });
  return state();
}
export async function suggest(id) {
  await mustFind(id);
  const m = await repo.lastInboundText(id);
  if (!m) throw conflict('NO_QUESTION', 'ยังไม่มีข้อความให้ AI ช่วยร่าง');
  const r = await answer(dec(m.content_enc).slice(0, 500), { channel: 'suggest', conversationId: id });
  return { mode: r.mode, text: ['answer', 'personal', 'faq'].includes(r.mode) ? r.answer : null, sources: (r.sources ?? []).slice(0, 5).map((s) => ({ title: s.title, excerpt: s.excerpt })) };
}
export async function media(id, messageId, { adminId, ip }) {
  const m = await repo.findMessage(messageId, id);
  if (!m?.media_storage_name) throw notFound('ไม่พบไฟล์');
  const buffer = await readDocument(m.media_storage_name);
  await insertAudit({ adminId, action: 'chat.media_view', entityType: 'chat', entityId: id, ip, metadata: { messageId } });
  return { buffer, mime: m.media_mime };
}
export async function maintenance() { return { stuck: await repo.failStuck(), events: await repo.cleanEvents(), ...(await processEvents()) }; }
