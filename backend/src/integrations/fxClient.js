import { env } from '../config/env.js';

/**
 * อัตรา USD → THB จากแหล่งฟรีที่ไม่ต้องใช้ key (ไม่ส่งข้อมูลใดของระบบออกไป)
 * 1) Frankfurter = อัตราอ้างอิงธนาคารกลางยุโรป (ECB) อัปเดตวันทำการละครั้ง
 * 2) ExchangeRate-API (open access) สำรองเมื่อแหล่งแรกล่ม
 */
const SOURCES = [
  { name: 'ECB (Frankfurter)', url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB', pick: (j) => j?.rates?.THB, date: (j) => j?.date },
  { name: 'ExchangeRate-API', url: 'https://open.er-api.com/v6/latest/USD', pick: (j) => (j?.result === 'success' ? j?.rates?.THB : undefined), date: (j) => j?.time_last_update_utc },
];

export async function fetchUsdThb() {
  const list = !env.isProd && env.FX_TEST_URL ? [{ ...SOURCES[0], name: 'test', url: env.FX_TEST_URL }] : SOURCES;
  let last = 'ไม่มีแหล่งข้อมูล';
  for (const s of list) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
      if (!res.ok) { last = `${s.name} ตอบ ${res.status}`; continue; }
      const j = await res.json();
      const rate = Number(s.pick(j));
      // กันค่าผิดปกติ: เงินบาทไม่น่าจะออกนอกช่วงนี้
      if (!Number.isFinite(rate) || rate < 10 || rate > 100) { last = `${s.name} ให้ค่าผิดปกติ`; continue; }
      return { rate: Math.round(rate * 10000) / 10000, source: s.name, date: s.date(j) ?? null };
    } catch (err) { last = `${s.name}: ${err.name === 'TimeoutError' ? 'หมดเวลา' : 'เชื่อมต่อไม่ได้'}`; }
  }
  throw Object.assign(new Error(last), { code: 'FX_UNAVAILABLE' });
}
