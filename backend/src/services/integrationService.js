import { z } from 'zod';
import { env } from '../config/env.js';
import { withTransaction } from '../config/db.js';
import { logger } from '../config/logger.js';
import * as repo from '../repositories/catalogRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { createTransport, explainMailError } from '../integrations/mailer.js';
import { classify, KIND_TEXT } from '../config/minimaxErrors.js';
import { reportFail, reportOk, retryNow } from './aiHealthService.js';
import { canonicalModel, modelOptions } from '../config/minimaxModels.js';
import { decryptText, encryptText } from '../utils/crypto.js';
import { badRequest } from '../utils/errors.js';

/** จำกัดปลายทาง MiniMax เพื่อไม่ให้ key ถูกส่งไปเซิร์ฟเวอร์อื่น */
export const MINIMAX_URLS = ['https://api.minimax.io/v1', 'https://api.minimaxi.com/v1'];
const digits = z.string().regex(/^\d{6,20}$/, 'ต้องเป็นตัวเลข');
const token = z.string().regex(/^[\x21-\x7e]{16,2000}$/, 'รูปแบบไม่ถูกต้อง ตรวจว่าคัดลอกครบและไม่มีช่องว่าง');
const FIELDS = {
  line_login_channel_id: { group: 'line_login', label: 'LINE Login Channel ID', env: 'LINE_LOGIN_CHANNEL_ID', schema: digits },
  line_login_channel_secret: { group: 'line_login', label: 'LINE Login Channel secret', env: 'LINE_LOGIN_CHANNEL_SECRET', secret: true, schema: token },
  line_channel_id: { group: 'line_messaging', label: 'Messaging API Channel ID', env: 'LINE_CHANNEL_ID', schema: digits },
  line_channel_secret: { group: 'line_messaging', label: 'Messaging API Channel secret', env: 'LINE_CHANNEL_SECRET', secret: true, schema: token },
  line_channel_access_token: { group: 'line_messaging', label: 'Channel access token', env: 'LINE_CHANNEL_ACCESS_TOKEN', secret: true, schema: token },
  line_liff_id: { group: 'line_messaging', label: 'LIFF ID', env: 'LINE_LIFF_ID', schema: z.string().regex(/^\d{6,20}-[A-Za-z0-9]{4,20}$/, 'รูปแบบเช่น 1234567890-AbCdEfGh') },
  minimax_api_key: { group: 'minimax', label: 'MiniMax API key', env: 'MINIMAX_API_KEY', secret: true, schema: token },
  minimax_base_url: { group: 'minimax', label: 'ภูมิภาค', env: 'MINIMAX_BASE_URL', schema: z.enum(MINIMAX_URLS, 'เลือกภูมิภาคที่รองรับ'), options: [[MINIMAX_URLS[0], 'สากล (api.minimax.io)'], [MINIMAX_URLS[1], 'จีน (api.minimaxi.com)']] },
  smtp_host: { group: 'email', label: 'SMTP server', env: 'SMTP_HOST', schema: z.string().regex(/^(?=.{3,253}$)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, 'ชื่อ server ไม่ถูกต้อง เช่น mail.example.com') },
  smtp_port: { group: 'email', label: 'พอร์ต', env: 'SMTP_PORT', schema: z.enum(['465', '587'], 'เลือก 465 หรือ 587'), options: [['587', '587 (STARTTLS)'], ['465', '465 (SSL/TLS)']] },
  smtp_user: { group: 'email', label: 'ชื่อผู้ใช้ SMTP', env: 'SMTP_USER', schema: z.string().regex(/^[\x21-\x7e]{1,200}$/, 'รูปแบบไม่ถูกต้อง') },
  smtp_password: { group: 'email', label: 'รหัสผ่าน SMTP', env: 'SMTP_PASSWORD', secret: true, schema: z.string().min(1).max(200) },
  smtp_from_name: { group: 'email', label: 'ชื่อผู้ส่ง', env: 'SMTP_FROM_NAME', schema: z.string().min(1).max(100).regex(/^[^\r\n<>"]+$/, 'มีอักขระที่ใช้ไม่ได้') },
  smtp_from_email: { group: 'email', label: 'อีเมลผู้ส่ง', env: 'SMTP_FROM_EMAIL', schema: z.email('อีเมลไม่ถูกต้อง').max(200) },
  minimax_model: { group: 'minimax', label: 'ชื่อ model (แนะนำ MiniMax-M3.1-Flash)', env: 'MINIMAX_MODEL', schema: z.string().regex(/^[A-Za-z0-9._-]{2,80}$/, 'ชื่อ model ไม่ถูกต้อง').transform(canonicalModel) },
};
const KEYS = Object.keys(FIELDS);
const aad = (key) => `setting:${key}`;

async function load() {
  const rows = new Map((await repo.getSettingRows(KEYS)).map((r) => [r.setting_key, r]));
  return Object.fromEntries(KEYS.map((key) => {
    const row = rows.get(key);
    if (row) {
      try { return [key, { value: row.is_encrypted ? decryptText(row.setting_value, aad(key)) : row.setting_value, source: 'admin', updatedAt: row.updated_at }]; } catch {
        // กุญแจเข้ารหัสเปลี่ยน: ถือว่ายังไม่ตั้งค่า แทนที่จะทำให้ทั้งเว็บล่ม
        logger.error({ key }, 'cannot decrypt integration setting');
        return [key, { value: null, source: 'unreadable' }];
      }
    }
    const value = env[FIELDS[key].env];
    return [key, value ? { value, source: 'env' } : { value: null, source: null }];
  }));
}
// อ่านจาก DB ทุกครั้ง: ค่ามีผลทันทีทุกโปรเซสของ Passenger
export const getConfig = async () => Object.fromEntries(Object.entries(await load()).map(([k, v]) => [k, v.value]));
export async function lineLoginConfig() {
  const c = await getConfig();
  return c.line_login_channel_id && c.line_login_channel_secret ? { channelId: c.line_login_channel_id, channelSecret: c.line_login_channel_secret } : null;
}

export async function emailConfig() {
  const c = await getConfig();
  return c.smtp_host && c.smtp_port && c.smtp_from_email ? c : null;
}
const mask = (v) => `••••••••${v.length >= 12 ? v.slice(-4) : ''}`;

/** ไม่ส่งค่าลับกลับหน้าเว็บ ให้เห็นเฉพาะ 4 ตัวท้าย */
export async function describe() {
  const values = await load();
  return {
    fields: KEYS.map((key) => {
      const f = FIELDS[key]; const v = values[key];
      return { key, group: f.group, label: f.label, secret: Boolean(f.secret), options: f.options ?? null, isSet: Boolean(v.value), source: v.source, updatedAt: v.updatedAt ?? null,
        value: f.secret ? (v.value ? mask(v.value) : '') : v.value ?? '' };
    }),
    callbackUrl: env.lineCallbackUrl, webhookUrl: env.lineWebhookUrl,
  };
}

export async function save(values, { adminId, ip }) {
  const changes = []; const errors = [];
  for (const [key, raw] of Object.entries(values)) {
    const f = FIELDS[key];
    if (!f) { errors.push({ field: key, message: 'ไม่รู้จักค่านี้' }); continue; }
    if (raw === null) { changes.push([key, null]); continue; }
    if (raw === '') continue; // เว้นว่าง = ไม่เปลี่ยน
    const r = f.schema.safeParse(raw);
    if (r.success) changes.push([key, r.data]); else errors.push({ field: key, message: r.error.issues[0].message });
  }
  if (errors.length) throw badRequest('VALIDATION_ERROR', 'กรุณาตรวจสอบข้อมูลที่กรอก', errors);
  if (!changes.length) return;
  await withTransaction(async (conn) => {
    for (const [key, value] of changes) {
      if (value === null) await repo.deleteSetting(key, conn);
      else await repo.putSetting(key, FIELDS[key].secret ? encryptText(value, aad(key)) : value, FIELDS[key].secret ? 1 : 0, conn);
    }
    await insertAudit({ adminId, action: 'integration.update', entityType: 'integration', ip, metadata: { updated: changes.filter((c) => c[1] !== null).map((c) => c[0]), cleared: changes.filter((c) => c[1] === null).map((c) => c[0]) } }, conn);
  });
  if (changes.some(([k]) => k.startsWith('minimax_'))) await retryNow();
}

async function call(url, options) {
  try {
    const res = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch { return { status: 0, body: null }; }
}
const result = (ok, message) => ({ ok, message });
const explain = (status) => (status === 0 ? 'เชื่อมต่อปลายทางไม่ได้' : status === 401 || status === 403 ? 'key ไม่ถูกต้องหรือไม่มีสิทธิ์' : status === 429 ? 'เกินโควตาหรือเรียกถี่เกินไป' : `ปลายทางตอบรหัส ${status}`);

const TESTS = {
  async email() {
    const c = await emailConfig();
    if (!c) return result(false, 'กรอก SMTP server พอร์ต และอีเมลผู้ส่งให้ครบ');
    const t = await createTransport(c);
    try { await t.verify(); return result(true, 'เชื่อมต่อ SMTP สำเร็จ'); } catch (err) { return result(false, explainMailError(err)); } finally { t.close(); }
  },
  async line_messaging(c) {
    if (!c.line_channel_access_token) return result(false, 'ยังไม่ได้ใส่ Channel access token');
    const r = await call(`${env.LINE_API_URL}/v2/bot/info`, { headers: { authorization: `Bearer ${c.line_channel_access_token}` } });
    if (r.status !== 200) return result(false, explain(r.status));
    return result(true, `เชื่อมต่อ LINE OA "${String(r.body?.displayName ?? '').slice(0, 60)}" สำเร็จ${c.line_channel_secret ? '' : ' (ยังไม่ได้ใส่ Channel secret)'}`);
  },
  async line_login(c) {
    if (!c.line_login_channel_id || !c.line_login_channel_secret) return result(false, 'กรอก Channel ID และ Channel secret ให้ครบ');
    return result(true, 'ตั้งค่าครบแล้ว ยืนยันผลจริงโดยลงทะเบียน Callback URL ใน LINE Developers แล้วลองเข้าสู่ระบบที่หน้าเว็บ');
  },
  async minimax(c) {
    if (!c.minimax_api_key || !c.minimax_model) return result(false, 'กรอก API key และชื่อ model ให้ครบ');
    const base = (!env.isProd && env.MINIMAX_TEST_URL) || (MINIMAX_URLS.includes(c.minimax_base_url) ? c.minimax_base_url : MINIMAX_URLS[0]);
    const r = await call(`${base}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${c.minimax_api_key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: canonicalModel(c.minimax_model), messages: [{ role: 'user', content: 'ping' }], ...modelOptions(canonicalModel(c.minimax_model), { maxTokens: 64, temperature: 0.1, effort: 'low' }) }) });
    // MiniMax อาจตอบ HTTP 200 พร้อมรหัสผิดพลาดใน base_resp
    if (r.status !== 200 || r.body?.base_resp?.status_code) {
      const { kind, code } = classify(r.status, r.body);
      await reportFail(kind, code);
      return result(false, `${KIND_TEXT[kind]}${code ? ` (${code})` : r.status ? ` (${r.status})` : ''}${['params', 'model'].includes(kind) ? ' ตรวจชื่อ model ให้ตรง เช่น MiniMax-M3.1-Flash' : kind === 'credit' ? ' เติมเครดิตแล้วกดทดสอบอีกครั้ง' : ''}`);
    }
    if (!Array.isArray(r.body?.choices)) return result(false, 'รูปแบบคำตอบไม่ตรงที่คาด');
    await reportOk();
    return result(true, `เชื่อมต่อ ${canonicalModel(c.minimax_model)} สำเร็จ`);
  },
};
export async function test(target, { adminId, ip }) {
  const r = await TESTS[target](await getConfig());
  await insertAudit({ adminId, action: 'integration.test', entityType: 'integration', entityId: target, ip, metadata: { ok: r.ok } });
  return r;
}
