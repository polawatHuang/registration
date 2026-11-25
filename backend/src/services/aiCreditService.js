import { env } from '../config/env.js';
import { query, queryOne, withTransaction } from '../config/db.js';
import { getSettings, setSetting } from '../repositories/catalogRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { insertEvent } from '../repositories/notificationRepository.js';
import { isConfigured, ping } from '../integrations/minimaxClient.js';
import { KIND_TEXT } from '../config/minimaxErrors.js';
import { health, setHealthListener } from './aiHealthService.js';
import { kick as kickEmail, queueNotice } from './emailService.js';
import { aiSettings, prices } from './aiReportService.js';
import { aiEnabledNow } from './aiReportService.js';

const LEVEL_KEY = 'ai_credit_level'; const PCT_KEY = 'ai_credit_low_pct'; const MAIL_KEY = 'ai_alert_email';
export const LINKS = { recharge: 'https://platform.minimax.io/user-center/payment/balance', usage: 'https://platform.minimax.io/console/consumption-detail', keys: 'https://platform.minimax.io/user-center/basic-information/interface-key' };
const RANK = { unknown: 0, ok: 0, low: 1, critical: 2, empty: 3 };
export async function options() { const s = await getSettings([PCT_KEY, MAIL_KEY]); return { lowPct: Number(s[PCT_KEY] || 20), email: s[MAIL_KEY] || null }; }

/** ยอดคงเหลือโดยประมาณ = ยอดตั้งต้นล่าสุด + เติมหลังจากนั้น − ค่าใช้จ่ายหลังจากนั้น */
export async function credit() {
  const [settings, price, opt, h] = [await aiSettings(), await prices(), await options(), await health()];
  const base = await queryOne("SELECT id, amount, created_at FROM ai_credit_entries WHERE kind = 'balance' ORDER BY created_at DESC, id DESC LIMIT 1");
  const entries = await query('SELECT e.id, e.kind, e.amount, e.note, e.created_at, u.display_name AS admin_name FROM ai_credit_entries e LEFT JOIN admin_users u ON u.id = e.created_by ORDER BY e.created_at DESC, e.id DESC LIMIT 30');
  const since = (from) => queryOne('SELECT COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(tokens_total), 0) AS tokens, SUM(cost IS NULL AND tokens_total > 0) AS unpriced FROM ai_interactions WHERE created_at >= :from', { from });
  const week = await queryOne('SELECT COALESCE(SUM(cost), 0) AS cost, TIMESTAMPDIFF(HOUR, MIN(created_at), UTC_TIMESTAMP()) AS hours, COUNT(*) AS n FROM ai_interactions WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)');
  const perDay = week.n ? Number(week.cost) / Math.max(1, Math.min(7, Number(week.hours ?? 0) / 24)) : 0;
  const out = { currency: price.currency, price, health: h, kindText: h.kind ? KIND_TEXT[h.kind] : null, options: opt, entries: entries.map((e) => ({ ...e, amount: Number(e.amount) })), perDay, links: LINKS, configured: await isConfigured(), settings, base: null, remaining: null, spent: null, total: null, daysLeft: null, level: 'unknown' };
  if (base) {
    // created_at ของการเรียกละเอียดระดับวินาที จึงปัดลงให้การเรียกในวินาทีเดียวกันถูกนับ ไม่ประเมินยอดสูงเกินจริง
    const from = new Date(Math.floor(new Date(base.created_at).getTime() / 1000) * 1000);
    const used = await since(from);
    const top = await queryOne("SELECT COALESCE(SUM(amount), 0) AS n FROM ai_credit_entries WHERE kind = 'topup' AND (created_at > :at OR (created_at = :at AND id > :id))", { at: base.created_at, id: base.id });
    out.base = { amount: Number(base.amount), at: base.created_at };
    out.total = Number(base.amount) + Number(top.n); out.spent = Number(used.cost); out.unpriced = Number(used.unpriced ?? 0);
    out.remaining = Math.max(0, out.total - out.spent);
    out.daysLeft = perDay > 0 ? out.remaining / perDay : null;
    const pct = out.total > 0 ? (out.remaining / out.total) * 100 : 0;
    out.level = out.remaining <= 0 ? 'empty' : pct <= Math.min(5, opt.lowPct / 2) || (out.daysLeft !== null && out.daysLeft < 2) ? 'critical' : pct <= opt.lowPct || (out.daysLeft !== null && out.daysLeft < 7) ? 'low' : 'ok';
  }
  // MiniMax ยืนยันว่าหมดจริง สำคัญกว่าตัวเลขประมาณ
  if (h.status === 'blocked' && h.kind === 'credit') out.level = 'empty';
  return out;
}
export async function addEntry(d, { adminId, ip }) {
  await withTransaction(async (conn) => {
    await query('INSERT INTO ai_credit_entries (kind, amount, note, created_by, created_at) VALUES (:kind, :amount, :note, :adminId, UTC_TIMESTAMP(3))', { ...d, adminId }, conn);
    await insertAudit({ adminId, action: `ai.credit_${d.kind}`, entityType: 'ai', ip, metadata: { amount: d.amount } }, conn);
  });
  await checkLevel();
  return credit();
}
export async function saveOptions(d, { adminId, ip }) {
  await withTransaction(async (conn) => { await setSetting(PCT_KEY, String(d.lowPct), conn); await setSetting(MAIL_KEY, d.email ?? '', conn); await insertAudit({ adminId, action: 'ai.credit_options', entityType: 'ai', ip, metadata: { lowPct: d.lowPct, email: Boolean(d.email) } }, conn); });
  return credit();
}
async function mail(subject, lines, key) {
  const { email } = await options();
  if (!email) return;
  await queueNotice({ template: 'ai_alert', to: email, key: key.slice(0, 100), payload: { subject, lines, url: `${env.APP_URL}/admin/ai-knowledge.html#credit` } }).catch((err) => { if (err.code !== 'ER_DUP_ENTRY') throw err; });
  kickEmail();
}
const money = (v, c) => `${v.toFixed(v < 1 ? 4 : 2)} ${c}`;
/** แจ้งเมื่อระดับแย่ลงเท่านั้น เติมแล้วกลับมาปกติจึงเริ่มนับใหม่ */
export async function checkLevel() {
  const c = await credit();
  await query('INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (:k, :v)', { k: LEVEL_KEY, v: 'unknown' });
  const worse = await withTransaction(async (conn) => {
    const prev = (await queryOne('SELECT setting_value FROM system_settings WHERE setting_key = :k FOR UPDATE', { k: LEVEL_KEY }, conn)).setting_value || 'unknown';
    if (prev === c.level) return false;
    await query('UPDATE system_settings SET setting_value = :v WHERE setting_key = :k', { k: LEVEL_KEY, v: c.level }, conn);
    if (RANK[c.level] <= (RANK[prev] ?? 0)) return false;
    await insertEvent('ai.credit_low', 'ai', 0, conn);
    return true;
  });
  // กรณีหมดจริงจาก MiniMax มีอีเมลของตัวเองแล้ว ไม่ส่งซ้ำ
  if (worse && !(c.level === 'empty' && c.health.status === 'blocked')) await mail(c.level === 'empty' ? 'เครดิต AI น่าจะหมดแล้ว' : c.level === 'critical' ? 'เครดิต AI ใกล้หมด' : 'เครดิต AI เหลือน้อย', [`ยอดคงเหลือโดยประมาณ ${money(c.remaining ?? 0, c.currency)}`, c.daysLeft !== null ? `ใช้ได้อีกประมาณ ${Math.max(0, Math.floor(c.daysLeft))} วันตามอัตราล่าสุด` : '', 'เติมเครดิตที่ MiniMax แล้วบันทึกยอดในหน้าเครดิต'], `ai:level:${c.level}:${new Date().toISOString().slice(0, 16)}`);
  return c.level;
}
setHealthListener(async ({ before, after }) => {
  if (after.status !== 'ok' && (before.status !== after.status || before.kind !== after.kind)) await mail(`AI หยุดตอบ: ${KIND_TEXT[after.kind] ?? 'ขัดข้อง'}`, ['ลูกค้าได้รับคำตอบจากคลังความรู้ที่ตรงคำถาม หรือถูกส่งต่อให้เจ้าหน้าที่', after.kind === 'credit' ? 'เติมเครดิตที่ MiniMax ระบบจะกลับมาเองภายใน 10 นาที หรือกด "ตรวจอีกครั้ง"' : 'ตรวจสาเหตุที่หน้าเครดิต ระบบจะลองใหม่เองทุกไม่กี่นาที'], `ai:down:${after.kind}:${after.since}`);
  if (before.status !== 'ok' && after.status === 'ok') await mail('AI กลับมาตอบแล้ว', ['MiniMax ใช้งานได้ตามปกติ'], `ai:up:${after.lastOkAt}`);
  await checkLevel();
});
/** ตรวจจริงกับ MiniMax ใช้ token เล็กน้อย ผลลัพธ์ปรับสถานะให้เอง */
export async function check({ adminId = null, ip = null } = {}) {
  const r = await ping();
  if (adminId) await insertAudit({ adminId, action: 'ai.credit_check', entityType: 'ai', ip, metadata: { ok: r.ok, kind: r.kind ?? null } });
  return r;
}
/** งานตั้งเวลา: ฟื้นตัวเองหลังเติมเครดิต แม้ไม่มีลูกค้าถาม */
export async function creditJob() {
  if (!(await isConfigured())) return { skipped: 'ยังไม่ได้ตั้งค่า MiniMax' };
  const h = await health();
  let probe = null;
  if (h.status !== 'ok' && (await aiEnabledNow()) && (!h.nextProbeAt || Date.now() >= new Date(h.nextProbeAt))) probe = (await check()).ok;
  return { level: await checkLevel(), health: h.status, probe };
}
