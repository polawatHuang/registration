/**
 * งานที่ทำต่อหลังตอบคำขอแล้ว (AI ตอบแชต อีเมล แจ้งเตือน ตัวตั้งเวลา)
 * โฮสต์อาจสั่งปิดโปรเซสเมื่อไม่มีคำขอค้าง จึงต้องรอให้งานเหล่านี้จบก่อนปิดจริง
 */
const active = new Set();
export function track(promise) {
  const p = Promise.resolve(promise).catch(() => {}).finally(() => active.delete(p));
  active.add(p);
  return promise;
}
export const pendingTasks = () => active.size;
/** รอจนหมด รวมงานที่งอกเพิ่มระหว่างรอ หรือครบเวลา คืน true เมื่อหมดจริง */
export async function drain(ms) {
  const end = Date.now() + ms;
  while (active.size && Date.now() < end) {
    let timer;
    await Promise.race([Promise.allSettled([...active]), new Promise((r) => { timer = setTimeout(r, Math.max(1, end - Date.now())); })]);
    clearTimeout(timer);
  }
  return active.size === 0;
}
