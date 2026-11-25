import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getConfig } from '../services/integrationService.js';
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
async function call(method, path, { body, headers = {}, host = env.LINE_API_URL, timeout = 10_000 } = {}) {
  const { line_channel_access_token: token } = await getConfig();
  if (!token) return { status: 401, body: null };
  try {
    const res = await fetch(host + path, { method, redirect: 'error', signal: AbortSignal.timeout(timeout), headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch { return { status: 0, body: null }; }
}
export const reply = (replyToken, messages) => call('POST', '/v2/bot/message/reply', { body: { replyToken, messages } });
/** retry key ทำให้ส่งซ้ำได้โดยผู้รับได้ข้อความเดียว (409 = LINE รับไปแล้ว) */
export const push = (to, messages, retryKey) => call('POST', '/v2/bot/message/push', { body: { to, messages }, headers: { 'X-Line-Retry-Key': retryKey } });
export const profile = (userId) => call('GET', `/v2/bot/profile/${encodeURIComponent(userId)}`);
export const loading = (chatId) => call('POST', '/v2/bot/chat/loading/start', { body: { chatId, loadingSeconds: 40 }, timeout: 4000 });

let quotaCache = { at: 0, value: null };
export async function quota({ fresh = false } = {}) {
  if (!fresh && Date.now() - quotaCache.at < 60_000) return quotaCache.value;
  const [limit, used] = await Promise.all([call('GET', '/v2/bot/message/quota'), call('GET', '/v2/bot/message/quota/consumption')]);
  const value = limit.status === 200 && used.status === 200 && Number.isFinite(used.body?.totalUsage)
    ? { limited: limit.body?.type === 'limited', limit: limit.body?.value ?? null, used: used.body.totalUsage, remaining: limit.body?.type === 'limited' ? Math.max(0, limit.body.value - used.body.totalUsage) : null } : null;
  quotaCache = { at: Date.now(), value };
  return value;
}
export const forgetQuota = () => { quotaCache = { at: 0, value: null }; };

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
