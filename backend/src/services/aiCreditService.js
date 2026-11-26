import { env } from '../config/env.js';
import { query, queryOne, withTransaction } from '../config/db.js';
import { getSettings, setSetting } from '../repositories/catalogRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { insertEvent } from '../repositories/notificationRepository.js';
import { isConfigured, ping } from '../integrations/minimaxClient.js';
import { fetchUsdThb } from '../integrations/fxClient.js';
import { logger } from '../config/logger.js';
import { track } from '../utils/background.js';
import { KIND_TEXT } from '../config/minimaxErrors.js';
import { health, setHealthListener } from './aiHealthService.js';
import { kick as kickEmail, queueNotice } from './emailService.js';
import { aiSettings, prices } from './aiReportService.js';
import { aiEnabledNow } from './aiReportService.js';

const LEVEL_KEY = 'ai_credit_level'; const PCT_KEY = 'ai_credit_low_pct'; const MAIL_KEY = 'ai_alert_email'; const FX_KEY = 'ai_fx_rate'; const FX_MODE_KEY = 'ai_fx_mode'; const FX_AT_KEY = 'ai_fx_at'; const FX_SRC_KEY = 'ai_fx_source';
const FX_FRESH_MS = 12 * 3_600_000;
export const LINKS = { recharge: 'https://platform.minimax.io/user-center/payment/balance', usage: 'https://platform.minimax.io/console/consumption-detail', keys: 'https://platform.minimax.io/user-center/basic-information/interface-key' };
const RANK = { unknown: 0, ok: 0, low: 1, critical: 2, empty: 3 };
export async function options() {
  const s = await getSettings([PCT_KEY, MAIL_KEY, FX_KEY, FX_MODE_KEY, FX_AT_KEY, FX_SRC_KEY]);
  return { lowPct: Number(s[PCT_KEY] || 20), email: s[MAIL_KEY] || null, fxRate: s[FX_KEY] ? Number(s[FX_KEY]) : null, fxMode: s[FX_MODE_KEY] === 'manual' ? 'manual' : 'auto', fxAt: s[FX_AT_KEY] || null, fxSource: s[FX_SRC_KEY] || null };
}
/** โหมดอัตโนมัติ: ดึงอัตรา USD→THB ใหม่เมื่อเก่ากว่า 12 ชั่วโมง ล้มเหลวก็ใช้ค่าเดิมต่อ */
let fxRunning = null;
export function refreshFx({ force = false } = {}) {
  fxRunning ??= track((async () => {
    const o = await options();
    if (o.fxMode !== 'auto') return { skipped: 'ตั้งอัตราเอง' };
    if (!force && o.fxRate && o.fxAt && Date.now() - new Date(o.fxAt) < FX_FRESH_MS) return { rate: o.fxRate, fresh: true };
    try {
      const r = await fetchUsdThb();
      await withTransaction(async (conn) => { await setSetting(FX_KEY, String(r.rate), conn); await setSetting(FX_AT_KEY, new Date().toISOString(), conn); await setSetting(FX_SRC_KEY, r.source, conn); });
      return { rate: r.rate, source: r.source };
    } catch (err) { logger.warn({ err: { message: err.message } }, 'fx refresh failed'); return { error: err.message, rate: o.fxRate }; }
  })().finally(() => { fxRunning = null; }));
  return fxRunning;
}
/** แปลงเป็นบาท: MiniMax คิดเป็น USD จึงคูณอัตราที่ผู้ดูแลตั้ง หรือที่คำนวณจากการเติมล่าสุด */
export async function fx() {
  const { fxRate } = await options();
  return { rate: fxRate, currency: 'THB' };
}
/** ค่าใช้จ่ายย้อนหลังรายเดือน (เวลาไทย): ประมาณจาก token และเงินที่เติมจริง */
async function spending(rate) {
  const BKK = (col) => `DATE_FORMAT(DATE_ADD(${col}, INTERVAL 7 HOUR), '%Y-%m')`;
  const [used, tops, all] = [
    await query(`SELECT ${BKK('created_at')} AS m, COALESCE(SUM(cost), 0) AS cost, COUNT(*) AS n FROM ai_interactions WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 MONTH) GROUP BY m`),
    await query(`SELECT ${BKK('created_at')} AS m, SUM(amount) AS amount, COALESCE(SUM(paid_thb), 0) AS paid, COALESCE(SUM(CASE WHEN paid_thb IS NULL THEN amount END), 0) AS unpaid FROM ai_credit_entries WHERE kind = 'topup' AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 MONTH) GROUP BY m`),
    await queryOne("SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(paid_thb), 0) AS paid, COALESCE(SUM(CASE WHEN paid_thb IS NULL THEN amount END), 0) AS unpaid, COUNT(*) AS n FROM ai_credit_entries WHERE kind = 'topup'"),
  ];
  const thb = (paid, unpaidUsd) => (rate ? Number(paid ?? 0) + Number(unpaidUsd ?? 0) * rate : (Number(unpaidUsd ?? 0) > 0 ? null : Number(paid ?? 0)));
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.now() + 7 * 3_600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7); });
  return {
    topups: { usd: Number(all.amount), thb: thb(all.paid, all.unpaid), count: Number(all.n) },
    months: months.map((m) => {
      const u = used.find((x) => x.m === m); const t = tops.find((x) => x.m === m);
      return { month: m, cost: u ? Number(u.cost) : 0, questions: u ? Number(u.n) : 0, topupUsd: t ? Number(t.amount) : 0, topupThb: t ? thb(t.paid, t.unpaid) : 0 };
    }),
  };
}

/** ยอดคงเหลือโดยประมาณ = ยอดตั้งต้นล่าสุด + เติมหลังจากนั้น − ค่าใช้จ่ายหลังจากนั้น */
export async function credit({ withSpending = true, waitFx = true } = {}) {
  // ยังไม่มีอัตราเลย: รอดึงสั้นๆ ให้หน้าแสดงเป็นบาทได้ทันที / มีแล้วแต่เก่า: อัปเดตเบื้องหลัง
  const pre = await options();
  if (pre.fxMode === 'auto' && !pre.fxRate && waitFx) await Promise.race([refreshFx(), new Promise((r) => { setTimeout(r, 4000).unref(); })]);
  else if (pre.fxMode === 'auto' && (!pre.fxRate || !pre.fxAt || Date.now() - new Date(pre.fxAt) >= FX_FRESH_MS)) refreshFx().catch(() => {});
  const [settings, price, opt, h] = [await aiSettings(), await prices(), await options(), await health()];
  const base = await queryOne("SELECT id, amount, created_at FROM ai_credit_entries WHERE kind = 'balance' ORDER BY created_at DESC, id DESC LIMIT 1");
  const entries = await query('SELECT e.id, e.kind, e.amount, e.paid_thb, e.estimate, e.note, e.created_at, u.display_name AS admin_name FROM ai_credit_entries e LEFT JOIN admin_users u ON u.id = e.created_by ORDER BY e.created_at DESC, e.id DESC LIMIT 30');
  const since = (from) => queryOne('SELECT COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(tokens_total), 0) AS tokens, SUM(cost IS NULL AND tokens_total > 0) AS unpriced FROM ai_interactions WHERE created_at >= :from', { from });
  const week = await queryOne('SELECT COALESCE(SUM(cost), 0) AS cost, TIMESTAMPDIFF(HOUR, MIN(created_at), UTC_TIMESTAMP()) AS hours, COUNT(*) AS n FROM ai_interactions WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)');
  const perDay = week.n ? Number(week.cost) / Math.max(1, Math.min(7, Number(week.hours ?? 0) / 24)) : 0;
  const out = { currency: price.currency, price, health: h, kindText: h.kind ? KIND_TEXT[h.kind] : null, options: opt, entries: entries.map((e) => ({ ...e, amount: Number(e.amount), paid_thb: e.paid_thb === null ? null : Number(e.paid_thb), estimate: e.estimate === null ? null : Number(e.estimate) })), fx: { rate: opt.fxRate, currency: 'THB', mode: opt.fxMode, at: opt.fxAt, source: opt.fxSource }, spending: withSpending ? await spending(price.currency === 'USD' ? opt.fxRate : price.currency === 'THB' ? 1 : null) : null, perDay, links: LINKS, configured: await isConfigured(), settings, base: null, remaining: null, spent: null, total: null, daysLeft: null, level: 'unknown' };
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
  // ยอดที่ระบบประมาณไว้ก่อนกรอกยอดจริง เก็บไว้เทียบว่าการประมาณแม่นแค่ไหน
  const estimate = d.kind === 'balance' ? (await credit({ withSpending: false, waitFx: false })).remaining : null;
  const paidThb = d.kind === 'topup' ? d.paidThb ?? null : null;
  await withTransaction(async (conn) => {
    await query('INSERT INTO ai_credit_entries (kind, amount, paid_thb, estimate, note, created_by, created_at) VALUES (:kind, :amount, :paidThb, :estimate, :note, :adminId, UTC_TIMESTAMP(3))', { ...d, paidThb, estimate, adminId }, conn);
    // จ่ายเป็นบาทตอนเติม = อัตราแลกเปลี่ยนจริงล่าสุด ใช้แปลงยอดทั้งหน้าเป็นบาท
    if (paidThb && d.amount > 0 && (await options()).fxMode === 'manual') await setSetting(FX_KEY, String(Math.round((paidThb / d.amount) * 10000) / 10000), conn);
    await insertAudit({ adminId, action: `ai.credit_${d.kind}`, entityType: 'ai', ip, metadata: { amount: d.amount, paidThb } }, conn);
  });
  await checkLevel();
  return credit();
}
export async function saveOptions(d, { adminId, ip }) {
  await withTransaction(async (conn) => { await setSetting(PCT_KEY, String(d.lowPct), conn); await setSetting(MAIL_KEY, d.email ?? '', conn); if (d.fxMode) await setSetting(FX_MODE_KEY, d.fxMode, conn); if (d.fxRate !== undefined && d.fxMode !== 'auto') await setSetting(FX_KEY, d.fxRate === null ? '' : String(d.fxRate), conn); await insertAudit({ adminId, action: 'ai.credit_options', entityType: 'ai', ip, metadata: { lowPct: d.lowPct, email: Boolean(d.email), fxRate: d.fxRate ?? null, fxMode: d.fxMode ?? null } }, conn); });
  if (d.fxMode === 'auto') await refreshFx({ force: true });
  return credit();
}
async function mail(subject, lines, key) {
  const { email } = await options();
  if (!email) return;
  await queueNotice({ template: 'ai_alert', to: email, key: key.slice(0, 100), payload: { subject, lines, url: `${env.APP_URL}/admin/ai-knowledge.html#credit` } }).catch((err) => { if (err.code !== 'ER_DUP_ENTRY') throw err; });
  kickEmail();
}
const money = (v, c, rate) => (c === 'USD' && rate ? `${(v * rate).toFixed(2)} บาท (US$${v.toFixed(2)})` : `${v.toFixed(v < 1 ? 4 : 2)} ${c}`);
/** แจ้งเมื่อระดับแย่ลงเท่านั้น เติมแล้วกลับมาปกติจึงเริ่มนับใหม่ */
export async function checkLevel() {
  const c = await credit({ withSpending: false, waitFx: false });
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
  if (worse && !(c.level === 'empty' && c.health.status === 'blocked')) await mail(c.level === 'empty' ? 'เครดิต AI น่าจะหมดแล้ว' : c.level === 'critical' ? 'เครดิต AI ใกล้หมด' : 'เครดิต AI เหลือน้อย', [`ยอดคงเหลือโดยประมาณ ${money(c.remaining ?? 0, c.currency, c.fx.rate)}`, c.daysLeft !== null ? `ใช้ได้อีกประมาณ ${Math.max(0, Math.floor(c.daysLeft))} วันตามอัตราล่าสุด` : '', 'เติมเครดิตที่ MiniMax แล้วบันทึกยอดในหน้าเครดิต'], `ai:level:${c.level}:${new Date().toISOString().slice(0, 16)}`);
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
  const fx = (await refreshFx()).rate ?? null;
  if (!(await isConfigured())) return { skipped: 'ยังไม่ได้ตั้งค่า MiniMax', fx };
  const h = await health();
  let probe = null;
  if (h.status !== 'ok' && (await aiEnabledNow()) && (!h.nextProbeAt || Date.now() >= new Date(h.nextProbeAt))) probe = (await check()).ok;
  return { level: await checkLevel(), health: h.status, probe, fx };
}
