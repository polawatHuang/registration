/**
 * พารามิเตอร์ต่างกันตามรุ่น (เอกสาร OpenAI-compatible ของ MiniMax, ตรวจ พ.ย. 2569)
 * - M3.1-Flash คิดเสมอ ปิดไม่ได้ ค่าเริ่มต้นคือ max ซึ่งช้าและกิน token จึงตั้งให้ต่ำ
 * - M3 ปิดการคิดได้ งานเราตอบจากแหล่งที่ค้นมาให้แล้ว
 * ทั้งสองรุ่นไม่ใช้ temperature และนับ token การคิดรวมในเพดาน
 */
export const EFFORTS = ['low', 'medium', 'high'];
export const KNOWN_MODELS = ['MiniMax-M3.1-Flash', 'MiniMax-M3'];
/** ราคาทางการ USD ต่อ 1 ล้าน token (พ.ย. 2569) ใช้เมื่อ Admin ยังไม่ได้กรอกราคาเอง */
export const REFERENCE_PRICES = { 'MiniMax-M3.1-Flash': [0.15, 0.6], 'MiniMax-M3': [0.3, 1.2] };
/** พิมพ์ตัวเล็กใหญ่ผิด หรือไม่ใส่ "MiniMax-" ให้แก้เป็นชื่อทางการ */
export const canonicalModel = (name) => { const bare = (v) => v.toLowerCase().replace(/^minimax[-_ ]*/, ''); return KNOWN_MODELS.find((m) => bare(m) === bare(name)) ?? name; };
export const ignoresTemperature = (model) => /^MiniMax-M3(\.|-|$)/i.test(model ?? '');

export function modelOptions(model, { maxTokens, temperature, effort }) {
  if (/^MiniMax-M3\.1-Flash$/i.test(model)) return { max_completion_tokens: maxTokens, reasoning_effort: EFFORTS.includes(effort) ? effort : 'low', reasoning_split: true };
  if (/^MiniMax-M3$/i.test(model)) return { max_completion_tokens: maxTokens, thinking: { type: 'disabled' } };
  if (ignoresTemperature(model)) return { max_completion_tokens: maxTokens }; // รุ่นย่อยในอนาคต ไม่เดาพารามิเตอร์
  return { max_tokens: maxTokens, temperature };
}
