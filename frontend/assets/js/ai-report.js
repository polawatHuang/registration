import { get, send } from './api.js';
import { fmtDateTime, h, icon, num, reduced, toast } from './ui.js';
import { empty, failed, formDialog, skeleton } from './admin.js';

export const money = (v, c) => (v === null ? '—' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: c, maximumFractionDigits: v < 1 ? 4 : 2 }).format(v));
const MODE = { answer: ['ok', 'ตอบได้'], personal: ['info', 'สถานะส่วนตัว'], fallback: ['warn', 'ไม่มีข้อมูล'], error: ['bad', 'ขัดข้อง'], limit: ['bad', 'ครบเพดาน'], search: ['', 'ค้นหาเท่านั้น'] };
const CHANNEL = { line: 'LINE', suggest: 'ช่วยร่าง', test: 'ทดสอบ' };
const days14 = (list, pick) => { const m = new Map(list.map((d) => [d.day, pick(d)])); return Array.from({ length: 14 }, (_, i) => { const day = new Date(Date.now() + 7 * 3_600_000 - (13 - i) * 86_400_000).toISOString().slice(0, 10); return { day, v: m.get(day) ?? 0 }; }); };
const label = (day) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day));
export function barChart(canvas, series, { color = '#6a4fc0', name }) {
  const { Chart } = window;
  if (!Chart) return;
  Chart.defaults.font.family = 'Prompt';
  new Chart(canvas, { type: 'bar', data: { labels: series.map((x) => label(x.day)), datasets: [{ label: name, data: series.map((x) => x.v), backgroundColor: color, borderRadius: 8, maxBarThickness: 26 }] }, options: { maintainAspectRatio: false, animation: reduced() ? false : { duration: 900 }, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0ebf9' } } } } });
}
export { days14 };

/** คืน element ทันทีแล้วเติมข้อมูลเมื่อโหลดเสร็จ */
function lazy(load) { const box = h('div', {}, skeleton(3, '110px')); const run = async () => { try { box.replaceChildren(...await load(run)); } catch (e) { box.replaceChildren(failed(e, run)); } }; run(); return [box]; }

export const reportView = (addFaq) => lazy(async (reload) => {
  const r = await get('/ai/report'); const s = r.settings;
  const total = Object.values(r.modes).reduce((a, b) => a + b, 0); const answered = (r.modes.answer ?? 0) + (r.modes.personal ?? 0);
  const kpi = (ic, c, l, v) => h('div', { class: 'kpi', style: { '--c': c } }, icon(ic), h('b', {}, v), h('span', {}, l));
  const c1 = h('canvas', { role: 'img', 'aria-label': 'จำนวนคำถามรายวัน' }); const c2 = h('canvas', { role: 'img', 'aria-label': 'token รายวัน' });
  setTimeout(() => { barChart(c1, days14(r.daily, (d) => d.n), { name: 'คำถาม', color: '#168447' }); barChart(c2, days14(r.daily, (d) => d.tokens), { name: 'token' }); });
  const pct = s.monthlyTokens ? Math.min(100, (r.month.tokens / s.monthlyTokens) * 100) : null;
  return [h('section', { class: 'kpis' }, kpi('chat-dots-fill', '#05a848', 'บทสนทนา AI เดือนนี้', num(r.month.conversations)), kpi('check2-circle', '#168447', 'ตอบได้ 30 วัน (LINE)', total ? `${Math.round((answered / total) * 100)}%` : '—'), kpi('coin', '#f5821f', s.priceIn === null && s.priceOut === null ? 'ยังไม่ได้ใส่ราคา' : 'ค่าใช้จ่ายเดือนนี้ (ประมาณ)', money(r.month.cost, s.currency)), kpi('lightning-charge-fill', '#6a4fc0', 'ตอบเฉลี่ย (วินาที)', r.month.avgMs ? (r.month.avgMs / 1000).toFixed(1) : '—')),
    h('section', { class: 'box' }, h('h2', {}, `ใช้ ${num(r.month.tokens)} token เดือนนี้${s.monthlyTokens ? ` จากเพดาน ${num(s.monthlyTokens)}` : ''}`), pct === null ? h('p', { class: 'muted' }, 'ยังไม่ได้ตั้งเพดานต่อเดือน') : h('div', { class: `bar ${pct >= 100 ? 'full' : ''}` }, h('i', { style: { '--w': `${pct}%` } })), h('div', { class: 'grid2', style: { 'margin-top': '16px' } }, h('div', { class: 'chart' }, c1), h('div', { class: 'chart' }, c2))),
    h('section', { class: 'box' }, h('h2', {}, `คำถามที่ AI ตอบไม่ได้ (${num(r.unanswered.length)})`), h('p', { class: 'muted' }, 'เพิ่มคำตอบเข้าคลังแล้วกด "จัดการแล้ว" ข้อมูลส่วนบุคคลถูกตัดออกก่อนบันทึก'), h('div', { class: 'list', style: { 'margin-top': '12px' } }, r.unanswered.length ? r.unanswered.map((u) => h('div', { class: 'qrow' }, h('div', {}, h('b', {}, u.question), h('small', {}, `ถาม ${num(u.count)} ครั้ง · ล่าสุด ${fmtDateTime(u.lastAt)}`)), h('div', { class: 'recact' }, h('button', { class: 'btn btn-green btn-sm', type: 'button', onclick: () => addFaq(u.question) }, icon('plus-lg'), 'เพิ่มคำตอบ'), h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await send('POST', '/ai/report/resolve', { ids: u.ids }); toast('บันทึกแล้ว'); reload(); } catch (e) { toast(e.message, 'error'); } } }, 'จัดการแล้ว')))) : empty('emoji-smile', 'ไม่มีคำถามค้าง'))),
    h('section', { class: 'box' }, h('h2', {}, 'คำถามที่พบบ่อย 30 วัน'), r.frequent.length ? r.frequent.map((f) => h('div', { class: 'occ' }, h('div', {}, h('span', {}, f.question), h('strong', {}, num(f.count))), h('div', { class: 'bar' }, h('i', { style: { '--w': `${(f.count / r.frequent[0].count) * 100}%` } })))) : empty('chat', 'ยังไม่มีข้อมูล'))];
});
export const historyView = () => lazy(async () => {
  const list = await get('/ai/history');
  return [h('section', { class: 'box' }, h('h2', {}, 'การถามล่าสุด 200 รายการ'), h('div', { class: 'list' }, list.length ? list.map((x) => h('div', { class: 'qrow' }, h('div', {}, h('b', {}, x.question ?? '(ถอดรหัสไม่ได้)'), h('small', {}, [fmtDateTime(x.at), CHANNEL[x.channel], x.intent, x.sources.length ? `แหล่ง: ${x.sources.join(', ')}` : null, x.tokens ? `${num(x.tokens)} token` : null, `${(x.ms / 1000).toFixed(1)} วินาที`].filter(Boolean).join(' · '))), h('span', { class: `badge ${MODE[x.mode]?.[0] ?? ''}` }, MODE[x.mode]?.[1] ?? x.mode))) : empty('clock-history', 'ยังไม่มีการถาม')))];
});
export const settingsView = () => lazy(async (reload) => {
  const { settings: s } = await get('/ai/report');
  const row = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v));
  return [h('section', { class: 'box' }, h('h2', {}, 'ตั้งค่า AI (MiniMax)'), h('dl', { class: 'kv' }, row('Max tokens ต่อคำตอบ', num(s.maxTokens)), row('Temperature', String(s.temperature)), row('คำตอบสูงสุดต่อคนต่อชั่วโมง', num(s.perHour)), row('เพดาน token ต่อเดือน', s.monthlyTokens ? num(s.monthlyTokens) : 'ไม่จำกัด'), row('ราคาขาเข้า / 1 ล้าน token', s.priceIn === null ? '— ยังไม่ระบุ —' : money(s.priceIn, s.currency)), row('ราคาขาออก / 1 ล้าน token', s.priceOut === null ? '— ยังไม่ระบุ —' : money(s.priceOut, s.currency)), h('div', { class: 'wide' }, h('dt', {}, 'ข้อความเมื่อไม่มีคำตอบ'), h('dd', { style: { 'white-space': 'pre-line' } }, s.fallback ?? 'ขออภัย ยังไม่มีข้อมูลยืนยันในเรื่องนี้ กรุณาติดต่อเจ้าหน้าที่ (ค่าเริ่มต้น)'))),
    h('div', { class: 'bar-actions', style: { margin: '16px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => formDialog({ title: 'ตั้งค่า AI', values: s, fields: [{ name: 'maxTokens', label: 'Max tokens', type: 'number', min: 200, required: true, hint: 'น้อยเกินไปคำตอบจะถูกตัดและไม่ถูกใช้' }, { name: 'temperature', label: 'Temperature (0–1)', type: 'number', min: 0, step: 0.1, required: true, hint: 'ต่ำ = ตอบตรงแหล่งข้อมูล' }, { name: 'perHour', label: 'คำตอบต่อคนต่อชั่วโมง', type: 'number', min: 1, required: true }, { name: 'monthlyTokens', label: 'เพดาน token ต่อเดือน', type: 'number', min: 1000, hint: 'ว่าง = ไม่จำกัด ครบแล้วส่งต่อเจ้าหน้าที่' }, { name: 'priceIn', label: 'ราคาขาเข้า / 1 ล้าน token', type: 'number', min: 0, step: 'any', hint: 'ใส่ตามราคาในบัญชี MiniMax ของคุณ' }, { name: 'priceOut', label: 'ราคาขาออก / 1 ล้าน token', type: 'number', min: 0, step: 'any' }, { name: 'currency', label: 'สกุลเงิน', type: 'select', options: [['USD', 'USD'], ['THB', 'บาท'], ['CNY', 'หยวน']] }, { name: 'fallback', label: 'ข้อความเมื่อไม่มีคำตอบ', type: 'textarea', wide: true }], onSave: async (v) => { await send('PUT', '/ai/settings', v); toast('บันทึกแล้ว'); reload(); } }) }, icon('pencil-fill'), 'แก้ไข'), h('a', { class: 'btn', href: '/admin/settings.html' }, 'API key และ model'), h('a', { class: 'btn', href: '/admin/chat.html' }, 'เปิด/ปิด AI')))];
});
