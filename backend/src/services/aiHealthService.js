import { query, queryOne, withTransaction } from '../config/db.js';
import { logger } from '../config/logger.js';
import { track } from '../utils/background.js';
import { BLOCKING } from '../config/minimaxErrors.js';
import { insertEvent } from '../repositories/notificationRepository.js';

const KEY = 'ai_health_json';
const PROBE_MS = 10 * 60_000; // เครดิตหมด/คีย์เสีย: ลองใหม่ทุก 10 นาที
const COOL_MS = 2 * 60_000; // ขัดข้องชั่วคราว
const MAX_FAILS = 5;
const OK = { status: 'ok', kind: null, code: null, since: null, fails: 0, nextProbeAt: null, lastErrorAt: null, lastOkAt: null };
export async function health() { return { ...OK, ...JSON.parse((await queryOne('SELECT setting_value FROM system_settings WHERE setting_key = :k', { k: KEY }))?.setting_value || '{}') }; }

/** เปลี่ยนสถานะใต้ล็อก: หลายคำขอล้มพร้อมกันจึงแจ้งเหตุการณ์ครั้งเดียว */
async function change(fn) {
  await query('INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (:k, :v)', { k: KEY, v: '{}' });
  return withTransaction(async (conn) => {
    const row = await queryOne('SELECT setting_value FROM system_settings WHERE setting_key = :k FOR UPDATE', { k: KEY }, conn);
    const before = { ...OK, ...JSON.parse(row.setting_value || '{}') };
    const after = fn(before);
    if (!after) return { before, after: before, changed: false };
    await query('UPDATE system_settings SET setting_value = :v WHERE setting_key = :k', { k: KEY, v: JSON.stringify(after) }, conn);
    if (before.status === 'ok' && after.status !== 'ok') await insertEvent('ai.unavailable', 'ai', 0, conn);
    if (before.status !== 'ok' && after.status === 'ok') await insertEvent('ai.recovered', 'ai', 0, conn);
    return { before, after, changed: before.status !== after.status || before.kind !== after.kind };
  });
}
const iso = (ms = Date.now()) => new Date(ms).toISOString();
/** ผู้ฟังลงทะเบียนเอง (แจ้งอีเมล/LINE) เพื่อไม่ให้ service อ้างกันวน */
let onChange = () => {};
export const setHealthListener = (fn) => { onChange = fn; };
const announce = (r) => { if (r.changed) track(Promise.resolve(onChange(r))).catch((err) => logger.error({ err: { message: err.message } }, 'ai health listener failed')); };

export async function reportOk() {
  const h = await health();
  if (h.status === 'ok' && !h.fails && h.lastOkAt && Date.now() - new Date(h.lastOkAt) < 300_000) return;
  announce(await change((b) => ({ ...b, status: 'ok', kind: null, code: null, since: null, fails: 0, nextProbeAt: null, lastOkAt: iso() })));
}
export async function reportFail(kind, code) {
  if (['content', 'params'].includes(kind)) return; // ปัญหาเฉพาะคำถาม ไม่ใช่บริการล่ม
  announce(await change((b) => {
    const base = { ...b, lastErrorAt: iso(), fails: b.fails + 1 };
    if (BLOCKING.includes(kind)) return { ...base, status: 'blocked', kind, code, since: b.status === 'blocked' && b.kind === kind ? b.since : iso(), nextProbeAt: iso(Date.now() + PROBE_MS) };
    if (b.status === 'blocked') return base; // สาเหตุหลักยังอยู่ ไม่ให้ error ชั่วคราวมากลบ
    if (base.fails < MAX_FAILS) return { ...base, kind, code };
    return { ...base, status: 'degraded', kind, code, since: b.status === 'degraded' ? b.since : iso(), nextProbeAt: iso(Date.now() + COOL_MS) };
  }));
}
/** เปลี่ยนคีย์หรือ model แล้วให้ลองทันที */
export const retryNow = () => change((b) => (b.status === 'ok' ? null : { ...b, nextProbeAt: null }));
/** ระหว่างหยุดไม่เรียก MiniMax เลย มีเพียงคำขอเดียวต่อรอบที่ได้ลองใหม่ */
export async function mayCall() {
  const h = await health();
  if (h.status === 'ok') return true;
  if (h.nextProbeAt && Date.now() < new Date(h.nextProbeAt)) return false;
  let won = false;
  await change((b) => {
    if (b.status === 'ok') { won = true; return null; }
    if (b.nextProbeAt && Date.now() < new Date(b.nextProbeAt)) return null;
    won = true;
    return { ...b, nextProbeAt: iso(Date.now() + (b.status === 'blocked' ? PROBE_MS : COOL_MS)) };
  });
  return won;
}
