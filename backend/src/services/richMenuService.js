import { env } from '../config/env.js';
import { withTransaction } from '../config/db.js';
import { logger } from '../config/logger.js';
import * as line from '../integrations/lineMessagingClient.js';
import { getSettings, setSetting } from '../repositories/catalogRepository.js';
import { query, queryOne } from '../config/db.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { getConfig } from './integrationService.js';
import { AppError, badRequest, conflict } from '../utils/errors.js';

const SIZE = { width: 2500, height: 1686 };
const KEY = 'line_rich_menu_json';
export const WELCOME_KEYS = ['line_welcome_title', 'line_welcome_text'];
/** 6 ปุ่มตาม PART 4.1 ลำดับซ้ายไปขวา บนลงล่าง */
export const BUTTONS = [
  { key: 'apply', label: 'สมัคร / ข้อมูลอบรม', icon: 'pencil-square', path: '/' }, { key: 'status', label: 'ติดตามสถานะ', icon: 'search-heart', view: 'status' }, { key: 'schedule', label: 'ตารางอบรม', icon: 'calendar-heart-fill', view: 'schedule' },
  { key: 'qr', label: 'QR ประจำตัว', icon: 'qr-code', view: 'qr' }, { key: 'certificates', label: 'ใบประกาศ', icon: 'award-fill', view: 'certificates' }, { key: 'contact', label: 'ติดต่อ / AI', icon: 'robot' },
];
export const CONTACT_DATA = 'menu=contact';
/** มี LIFF ID: เปิดในแอป LINE และล็อกอินให้เอง ไม่มี: เปิดเว็บปกติ */
export async function viewUrl(view) {
  const { line_liff_id: liff } = await getConfig();
  return liff ? `https://liff.line.me/${liff}?view=${view}` : `${env.APP_URL}/me.html?view=${view}`;
}
async function areas() {
  const w = Math.floor(SIZE.width / 3); const h = SIZE.height / 2;
  return Promise.all(BUTTONS.map(async (b, i) => ({
    bounds: { x: (i % 3) * w, y: Math.floor(i / 3) * h, width: i % 3 === 2 ? SIZE.width - 2 * w : w, height: h },
    action: b.key === 'contact' ? { type: 'postback', label: b.label.slice(0, 20), data: CONTACT_DATA, displayText: 'ติดต่อสอบถาม', inputOption: 'openKeyboard' } : { type: 'uri', label: b.label.slice(0, 20), uri: b.path ? `${env.APP_URL}${b.path}` : await viewUrl(b.view) },
  })));
}
const current = async () => JSON.parse((await getSettings([KEY]))[KEY] || 'null');
export async function state() {
  const c = await getConfig();
  const [menu, ready, welcome, counts] = [await current(), await line.isReady(), await getSettings(WELCOME_KEYS), await queryOne("SELECT COUNT(*) AS users, SUM(friend_status = 'friend') AS friends, SUM(friend_status = 'blocked') AS blocked, (SELECT COUNT(*) FROM line_account_links WHERE status = 'active') AS linked FROM line_users")];
  return { ready, liffId: c.line_liff_id ?? null, loginChannel: c.line_login_channel_id ?? null, liffMismatch: Boolean(c.line_liff_id && c.line_login_channel_id && !c.line_liff_id.startsWith(`${c.line_login_channel_id}-`)), https: env.APP_URL.startsWith('https://'), webhookUrl: env.lineWebhookUrl, liffEndpoint: `${env.APP_URL}/me.html`, menu, buttons: BUTTONS, size: SIZE, welcome: { title: welcome.line_welcome_title || '', text: welcome.line_welcome_text || '' }, counts: { users: Number(counts.users), friends: Number(counts.friends ?? 0), blocked: Number(counts.blocked ?? 0), linked: Number(counts.linked) } };
}
const explain = (r, step) => new AppError(502, 'LINE_REJECTED', r.status === 401 || r.status === 403 ? 'Channel access token ไม่ถูกต้อง' : `LINE ไม่รับ${step} (${r.status || 'หมดเวลา'})${r.body?.message ? `: ${String(r.body.message).slice(0, 120)}` : ''}`);
const jpeg = (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
/** สร้างใหม่ให้เสร็จก่อนแล้วจึงลบอันเก่า ถ้าพลาดกลางทางผู้ใช้ยังเห็นเมนูเดิม */
export async function publish(file, chatBarText, { adminId, ip }) {
  if (!env.APP_URL.startsWith('https://') && env.isProd) throw conflict('HTTPS_REQUIRED', 'ต้องใช้ https');
  if (!(await line.isReady())) throw conflict('LINE_NOT_READY', 'ตั้งค่า LINE Messaging API ก่อน');
  if (!file || !jpeg(file.buffer)) throw badRequest('INVALID_FILE', 'ภาพเมนูต้องเป็น JPG');
  if (file.size > 1024 * 1024) throw badRequest('INVALID_FILE', 'ภาพเมนูต้องไม่เกิน 1 MB');
  const old = await current();
  const made = await line.createRichMenu({ size: SIZE, selected: true, name: `E-Training ${new Date().toISOString().slice(0, 16)}`, chatBarText, areas: await areas() });
  if (made.status !== 200 || typeof made.body?.richMenuId !== 'string') throw explain(made, 'เมนู');
  const id = made.body.richMenuId;
  const step = async (r, name) => { if (r.status !== 200) { await line.deleteRichMenu(id); throw explain(r, name); } };
  await step(await line.uploadRichMenu(id, file.buffer), 'ภาพเมนู');
  await step(await line.setDefaultRichMenu(id), 'การตั้งเป็นเมนูหลัก');
  await withTransaction(async (conn) => {
    await setSetting(KEY, JSON.stringify({ id, at: new Date().toISOString(), chatBarText }), conn);
    await insertAudit({ adminId, action: 'line.rich_menu_publish', entityType: 'rich_menu', entityId: id.slice(0, 50), ip }, conn);
  });
  if (old?.id && old.id !== id) { const r = await line.deleteRichMenu(old.id); if (r.status !== 200) logger.warn({ status: r.status }, 'old rich menu not deleted'); }
  return state();
}
export async function remove({ adminId, ip }) {
  const old = await current();
  if (!old) throw conflict('NO_MENU', 'ยังไม่มีเมนู');
  const r = await line.clearDefaultRichMenu();
  if (r.status !== 200) throw explain(r, 'คำสั่งปิดเมนู');
  await line.deleteRichMenu(old.id);
  await withTransaction(async (conn) => { await setSetting(KEY, '', conn); await insertAudit({ adminId, action: 'line.rich_menu_remove', entityType: 'rich_menu', entityId: old.id.slice(0, 50), ip }, conn); });
  return state();
}
export async function saveWelcome(d, { adminId, ip }) {
  await withTransaction(async (conn) => { await setSetting(WELCOME_KEYS[0], d.title ?? '', conn); await setSetting(WELCOME_KEYS[1], d.text ?? '', conn); await insertAudit({ adminId, action: 'line.welcome', entityType: 'line', ip }, conn); });
}
export async function users({ q, filter, page, pageSize }) {
  const where = `${q ? 'AND l.display_name LIKE :like' : ''} ${filter === 'linked' ? 'AND k.id IS NOT NULL' : filter === 'unlinked' ? 'AND k.id IS NULL' : filter === 'blocked' ? "AND l.friend_status = 'blocked'" : ''}`;
  const from = "FROM line_users l LEFT JOIN line_account_links k ON k.line_user_id = l.id AND k.status = 'active' LEFT JOIN applicants p ON p.id = k.applicant_id WHERE 1 = 1";
  const p = { like: q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null, limit: pageSize, offset: (page - 1) * pageSize };
  const items = await query(`SELECT l.id, l.display_name, l.picture_url, l.friend_status, l.last_interaction_at, k.linked_at, p.full_name, (SELECT COUNT(*) FROM applications a WHERE a.line_user_id = l.id) AS applications ${from} ${where} ORDER BY l.last_interaction_at DESC, l.id DESC LIMIT :limit OFFSET :offset`, p);
  return { items, total: (await queryOne(`SELECT COUNT(*) AS n ${from} ${where}`, p)).n };
}
