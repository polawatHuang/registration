import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getSettings, setSetting } from '../repositories/catalogRepository.js';
import { getConfig } from '../services/integrationService.js';
import { track } from '../utils/background.js';
import { safeEqual } from '../utils/crypto.js';

/** ตรวจลายเซ็นจาก raw body ตรงตามที่ได้รับ ห้าม parse ก่อน */
export async function verifySignature(rawBody, signature) {
  const { line_channel_secret: secret } = await getConfig();
  if (!secret) return 'not_configured';
  if (!signature) return 'invalid';
  return safeEqual(crypto.createHmac('sha256', secret).update(rawBody).digest('base64'), signature) ? 'ok' : 'invalid';
}
export const isReady = async () => { const c = await getConfig(); return Boolean(c.line_channel_access_token && c.line_channel_secret); };

/** status 0 = หมดเวลา/เครือข่าย ไม่รู้ว่าถึง LINE หรือไม่ */
async function call(method, path, { body, raw, headers = {}, host = env.LINE_API_URL, timeout = 10_000 } = {}) {
  const { line_channel_access_token: token } = await getConfig();
  if (!token) return { status: 401, body: null };
  try {
    const res = await fetch(host + path, { method, redirect: 'error', signal: AbortSignal.timeout(timeout), headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw ?? (body && JSON.stringify(body)) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch { return { status: 0, body: null }; }
}
export const reply = (replyToken, messages) => call('POST', '/v2/bot/message/reply', { body: { replyToken, messages } });
/** retry key ทำให้ส่งซ้ำได้โดยผู้รับได้ข้อความเดียว (409 = LINE รับไปแล้ว) */
export const push = (to, messages, retryKey) => call('POST', '/v2/bot/message/push', { body: { to, messages }, headers: { 'X-Line-Retry-Key': retryKey } });
export const profile = (userId) => call('GET', `/v2/bot/profile/${encodeURIComponent(userId)}`);
export const loading = (chatId) => call('POST', '/v2/bot/chat/loading/start', { body: { chatId, loadingSeconds: 40 }, timeout: 4000 });

export const createRichMenu = (menu) => call('POST', '/v2/bot/richmenu', { body: menu });
export const uploadRichMenu = (id, buffer) => call('POST', `/v2/bot/richmenu/${encodeURIComponent(id)}/content`, { raw: buffer, headers: { 'content-type': 'image/jpeg' }, host: env.LINE_DATA_URL, timeout: 30_000 });
export const setDefaultRichMenu = (id) => call('POST', `/v2/bot/user/all/richmenu/${encodeURIComponent(id)}`);
export const clearDefaultRichMenu = () => call('DELETE', '/v2/bot/user/all/richmenu');
export const deleteRichMenu = (id) => call('DELETE', `/v2/bot/richmenu/${encodeURIComponent(id)}`);

const QUOTA_KEY = 'line_quota_json'; const FRESH = 60_000; const USABLE = 24 * 3_600_000;
let quotaCache = null; let refreshing = null; let epoch = 0;
async function refreshQuota(started) {
  const [limit, used] = await Promise.all([call('GET', '/v2/bot/message/quota', { timeout: 4000 }), call('GET', '/v2/bot/message/quota/consumption', { timeout: 4000 })]);
  const ok = limit.status === 200 && used.status === 200 && Number.isFinite(used.body?.totalUsage);
  const value = ok ? { limited: limit.body?.type === 'limited', limit: limit.body?.value ?? null, used: used.body.totalUsage, remaining: limit.body?.type === 'limited' ? Math.max(0, limit.body.value - used.body.totalUsage) : null } : null;
  if (started !== epoch) return value; // มีการส่งหรือสั่งลืมค่าระหว่างถาม ยอดนี้เก่าแล้ว ไม่เก็บ
  quotaCache = { at: Date.now(), value };
  if (ok) await setSetting(QUOTA_KEY, JSON.stringify(quotaCache)).catch(() => {});
  return value;
}
function refresh() {
  if (!refreshing) { const p = track(refreshQuota(epoch)); refreshing = p; p.catch(() => {}).finally(() => { if (refreshing === p) refreshing = null; }); }
  return refreshing;
}
/** ยอดที่ใช้ตัดสินใจส่ง: มาจาก LINE โดยตรงเท่านั้น ไม่ใช้ค่าที่จำไว้ในฐานข้อมูล */
export async function quota({ fresh = false } = {}) {
  if (!fresh && quotaCache && Date.now() - quotaCache.at < FRESH) return quotaCache.value;
  return refresh();
}
/** ยอดสำหรับแสดงผล: คืนค่าล่าสุดที่รู้ทันทีแล้วอัปเดตเบื้องหลัง หน้าเว็บจึงไม่รอ LINE */
export async function quotaForView() {
  if (quotaCache && Date.now() - quotaCache.at < FRESH) return quotaCache.value;
  let last = quotaCache;
  if (!last) { try { last = JSON.parse((await getSettings([QUOTA_KEY]))[QUOTA_KEY] || 'null'); } catch { last = null; } }
  const next = refresh().catch(() => null);
  if (last?.value && Date.now() - last.at < USABLE) return last.value;
  return Promise.race([next, new Promise((r) => { setTimeout(() => r(null), 1500).unref(); })]);
}
/** ปรับยอดในหน่วยความจำ ไม่ต้องถาม LINE ใหม่ทุกข้อความ */
export const countPush = (status) => { const v = quotaCache?.value; if (status === 200 && v) { v.used += 1; if (v.remaining !== null) v.remaining -= 1; } };
export const forgetQuota = () => { quotaCache = null; refreshing = null; epoch += 1; };

const MAX_MEDIA = 10 * 1024 * 1024;
/** อ่านแบบจำกัดขนาด ไม่เชื่อ Content-Length อย่างเดียว */
export async function content(messageId) {
  const { line_channel_access_token: token } = await getConfig();
  try {
    const res = await fetch(`${env.LINE_DATA_URL}/v2/bot/message/${encodeURIComponent(messageId)}/content`, { redirect: 'error', signal: AbortSignal.timeout(25_000), headers: { authorization: `Bearer ${token}` } });
    if (res.status !== 200 || Number(res.headers.get('content-length') ?? 0) > MAX_MEDIA) { await res.body?.cancel(); return null; }
    const chunks = []; let size = 0;
    for await (const c of res.body) { size += c.length; if (size > MAX_MEDIA) return null; chunks.push(c); }
    return Buffer.concat(chunks);
  } catch { return null; }
}
