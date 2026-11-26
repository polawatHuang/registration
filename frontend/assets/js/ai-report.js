import { get, send } from './api.js';
import { fmtDateTime, h, icon, loadChart, num, reduced, toast } from './ui.js';
import { empty, failed, formDialog, skeleton } from './admin.js';

/** อัตรา USD → บาท ล่าสุดที่ได้จาก API ใช้แสดงเงินเป็นบาททุกจุด */
export let FX = null;
export const setFx = (f) => { if (f) FX = f; };
const fmt = (v, c) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 && v !== 0 ? 4 : 2 }).format(v);
export const thb = (v) => (v === null ? '—' : fmt(v, 'THB'));
export const usd = (v) => (v === null ? '—' : `US${fmt(v, 'USD')}`);
/** MiniMax คิดเป็น USD: มีอัตราแลกเปลี่ยนแล้วแสดงเป็นบาท */
export const money = (v, c) => (v === null || v === undefined ? '—' : c === 'USD' && FX?.rate ? thb(v * FX.rate) : c === 'USD' ? usd(v) : fmt(v, c));
const MODE = { answer: ['ok', 'ตอบได้'], faq: ['ok', 'ตอบจากคลังโดยตรง'], offline: ['bad', 'AI หยุด'], personal: ['info', 'สถานะส่วนตัว'], fallback: ['warn', 'ไม่มีข้อมูล'], error: ['bad', 'ขัดข้อง'], limit: ['bad', 'ครบเพดาน'], search: ['', 'ค้นหาเท่านั้น'] };
const CHANNEL = { line: 'LINE', suggest: 'ช่วยร่าง', test: 'ทดสอบ' };
const days14 = (list, pick) => { const m = new Map(list.map((d) => [d.day, pick(d)])); return Array.from({ length: 14 }, (_, i) => { const day = new Date(Date.now() + 7 * 3_600_000 - (13 - i) * 86_400_000).toISOString().slice(0, 10); return { day, v: m.get(day) ?? 0 }; }); };
const label = (day) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day));
export async function barChart(canvas, series, { color = '#6a4fc0', name }) {
  const Chart = await loadChart().catch(() => null);
  if (!Chart || !canvas.isConnected) return;
  Chart.defaults.font.family = 'Prompt';
  new Chart(canvas, { type: 'bar', data: { labels: series.map((x) => label(x.day)), datasets: [{ label: name, data: series.map((x) => x.v), backgroundColor: color, borderRadius: 8, maxBarThickness: 26 }] }, options: { maintainAspectRatio: false, animation: reduced() ? false : { duration: 900 }, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0ebf9' } } } } });
}
export { days14 };

/** คืน element ทันทีแล้วเติมข้อมูลเมื่อโหลดเสร็จ */
function lazy(load) { const box = h('div', {}, skeleton(3, '110px')); const run = async () => { try { box.replaceChildren(...(await load(run)).filter(Boolean)); } catch (e) { box.replaceChildren(failed(e, run)); } }; run(); return [box]; }

export const reportView = (addFaq) => lazy(async (reload) => {
  const r = await get('/ai/report'); setFx(r.fx); const s = r.settings;
  const total = Object.values(r.modes).reduce((a, b) => a + b, 0); const answered = (r.modes.answer ?? 0) + (r.modes.personal ?? 0) + (r.modes.faq ?? 0);
  const kpi = (ic, c, l, v) => h('div', { class: 'kpi', style: { '--c': c } }, icon(ic), h('b', {}, v), h('span', {}, l));
  const c1 = h('canvas', { role: 'img', 'aria-label': 'จำนวนคำถามรายวัน' }); const c2 = h('canvas', { role: 'img', 'aria-label': 'token รายวัน' });
  setTimeout(() => { barChart(c1, days14(r.daily, (d) => d.n), { name: 'คำถาม', color: '#168447' }); barChart(c2, days14(r.daily, (d) => d.tokens), { name: 'token' }); });
  const pct = s.monthlyTokens ? Math.min(100, (r.month.tokens / s.monthlyTokens) * 100) : null;
  return [h('section', { class: 'kpis' }, kpi('chat-dots-fill', '#05a848', 'บทสนทนา AI เดือนนี้', num(r.month.conversations)), kpi('check2-circle', '#168447', 'ตอบได้ 30 วัน (LINE)', total ? `${Math.round((answered / total) * 100)}%` : '—'), kpi('coin', '#f5821f', r.price.source ? 'ค่าใช้จ่ายเดือนนี้ (ประมาณ)' : 'ยังไม่ได้ใส่ราคา', money(r.month.cost, r.price.currency)), kpi('lightning-charge-fill', '#6a4fc0', 'ตอบเฉลี่ย (วินาที)', r.month.avgMs ? (r.month.avgMs / 1000).toFixed(1) : '—')),
    h('section', { class: 'box' }, h('h2', {}, `ใช้ ${num(r.month.tokens)} token เดือนนี้${s.monthlyTokens ? ` จากเพดาน ${num(s.monthlyTokens)}` : ''}`), pct === null ? h('p', { class: 'muted' }, 'ยังไม่ได้ตั้งเพดานต่อเดือน') : h('div', { class: `bar ${pct >= 100 ? 'full' : ''}` }, h('i', { style: { '--w': `${pct}%` } })), h('div', { class: 'grid2', style: { 'margin-top': '16px' } }, h('div', { class: 'chart' }, c1), h('div', { class: 'chart' }, c2))),
    h('section', { class: 'box' }, h('h2', {}, `คำถามที่ AI ตอบไม่ได้ (${num(r.unanswered.length)})`), h('p', { class: 'muted' }, 'เพิ่มคำตอบเข้าคลังแล้วกด "จัดการแล้ว" ข้อมูลส่วนบุคคลถูกตัดออกก่อนบันทึก'), h('div', { class: 'list', style: { 'margin-top': '12px' } }, r.unanswered.length ? r.unanswered.map((u) => h('div', { class: 'qrow' }, h('div', {}, h('b', {}, u.question), h('small', {}, `ถาม ${num(u.count)} ครั้ง · ล่าสุด ${fmtDateTime(u.lastAt)}`)), h('div', { class: 'recact' }, h('button', { class: 'btn btn-green btn-sm', type: 'button', onclick: () => addFaq(u.question) }, icon('plus-lg'), 'เพิ่มคำตอบ'), h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await send('POST', '/ai/report/resolve', { ids: u.ids }); toast('บันทึกแล้ว'); reload(); } catch (e) { toast(e.message, 'error'); } } }, 'จัดการแล้ว')))) : empty('emoji-smile', 'ไม่มีคำถามค้าง'))),
    h('section', { class: 'box' }, h('h2', {}, 'คำถามที่พบบ่อย 30 วัน'), r.frequent.length ? r.frequent.map((f) => h('div', { class: 'occ' }, h('div', {}, h('span', {}, f.question), h('strong', {}, num(f.count))), h('div', { class: 'bar' }, h('i', { style: { '--w': `${(f.count / r.frequent[0].count) * 100}%` } })))) : empty('chat', 'ยังไม่มีข้อมูล'))];
});
export const historyView = () => lazy(async () => {
  const list = await get('/ai/history');
  return [h('section', { class: 'box' }, h('h2', {}, 'การถามล่าสุด 200 รายการ'), h('div', { class: 'list' }, list.length ? list.map((x) => h('div', { class: 'qrow' }, h('div', {}, h('b', {}, x.question ?? '(ถอดรหัสไม่ได้)'), h('small', {}, [fmtDateTime(x.at), CHANNEL[x.channel], x.intent, x.sources.length ? `แหล่ง: ${x.sources.join(', ')}` : null, x.tokens ? `${num(x.tokens)} token` : null, `${(x.ms / 1000).toFixed(1)} วินาที`].filter(Boolean).join(' · '))), h('span', { class: `badge ${MODE[x.mode]?.[0] ?? ''}` }, MODE[x.mode]?.[1] ?? x.mode))) : empty('clock-history', 'ยังไม่มีการถาม')))];
});
export const settingsView = () => lazy(async (reload) => {
  const { settings: s, model, price, fx } = await get('/ai/report'); setFx(fx);
  const EFFORT = { low: 'ต่ำ (เร็วและถูก)', medium: 'กลาง', high: 'สูง' };
  const row = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v));
  return [h('section', { class: 'box' }, h('h2', {}, 'ตั้งค่า AI (MiniMax)'), h('dl', { class: 'kv' }, row('Max tokens ต่อคำตอบ', num(s.maxTokens)), row('Model', model?.name ?? '— ยังไม่ตั้ง —'), row('Temperature', model?.ignoresTemperature ? 'รุ่นนี้ไม่ใช้ค่านี้' : String(s.temperature)), model?.usesEffort && row('ระดับการคิด', EFFORT[s.effort]), row('คำตอบสูงสุดต่อคนต่อชั่วโมง', num(s.perHour)), row('เพดาน token ต่อเดือน', s.monthlyTokens ? num(s.monthlyTokens) : 'ไม่จำกัด'), row('ราคาขาเข้า / 1 ล้าน token', s.priceIn === null ? (price.source === 'reference' ? `${money(price.in, 'USD')} (ราคาอ้างอิง)` : '— ยังไม่ระบุ —') : money(s.priceIn, s.currency)), row('ราคาขาออก / 1 ล้าน token', s.priceOut === null ? (price.source === 'reference' ? `${money(price.out, 'USD')} (ราคาอ้างอิง)` : '— ยังไม่ระบุ —') : money(s.priceOut, s.currency)), h('div', { class: 'wide' }, h('dt', {}, 'ข้อความเมื่อไม่มีคำตอบ'), h('dd', { style: { 'white-space': 'pre-line' } }, s.fallback ?? 'ขออภัย ยังไม่มีข้อมูลยืนยันในเรื่องนี้ กรุณาติดต่อเจ้าหน้าที่ (ค่าเริ่มต้น)'))),
    h('div', { class: 'bar-actions', style: { margin: '16px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => formDialog({ title: 'ตั้งค่า AI', values: s, fields: [{ name: 'maxTokens', label: 'Max tokens', type: 'number', min: 200, required: true, hint: 'นับรวมการคิดของ AI น้อยเกินไปคำตอบจะถูกตัดและไม่ถูกใช้ แนะนำ 4000' }, { name: 'effort', label: 'ระดับการคิด (M3.1-Flash)', type: 'select', options: Object.entries(EFFORT) }, { name: 'temperature', label: 'Temperature (0–1)', type: 'number', min: 0, step: 0.1, required: true, hint: model?.ignoresTemperature ? 'รุ่นนี้ไม่ใช้ค่านี้' : 'ต่ำ = ตอบตรงแหล่งข้อมูล' }, { name: 'perHour', label: 'คำตอบต่อคนต่อชั่วโมง', type: 'number', min: 1, required: true }, { name: 'monthlyTokens', label: 'เพดาน token ต่อเดือน', type: 'number', min: 1000, hint: 'ว่าง = ไม่จำกัด ครบแล้วส่งต่อเจ้าหน้าที่' }, { name: 'priceIn', label: 'ราคาขาเข้า / 1 ล้าน token', type: 'number', min: 0, step: 'any', hint: 'ใส่ตามราคาในบัญชี MiniMax ของคุณ' }, { name: 'priceOut', label: 'ราคาขาออก / 1 ล้าน token', type: 'number', min: 0, step: 'any' }, { name: 'currency', label: 'สกุลเงิน', type: 'select', options: [['USD', 'USD'], ['THB', 'บาท'], ['CNY', 'หยวน']] }, { name: 'fallback', label: 'ข้อความเมื่อไม่มีคำตอบ', type: 'textarea', wide: true }], onSave: async (v) => { await send('PUT', '/ai/settings', v); toast('บันทึกแล้ว'); reload(); } }) }, icon('pencil-fill'), 'แก้ไข'), h('a', { class: 'btn', href: '/admin/settings.html' }, 'API key และ model'), h('a', { class: 'btn', href: '/admin/chat.html' }, 'เปิด/ปิด AI')))];
});

// ---------- เครดิต ----------
const LEVEL = { unknown: ['ยังไม่ได้ตั้งยอด', ''], ok: ['เพียงพอ', 'ok'], low: ['เหลือน้อย', 'warn'], critical: ['ใกล้หมด', 'bad'], empty: ['หมดแล้ว', 'bad'] };
const FIX = {
  credit: ['เปิดหน้าเติมเงินของ MiniMax แล้วเติมเครดิต', 'กด "ตรวจอีกครั้ง" ด้านบน หรือรอระบบลองเองภายใน 10 นาที', 'กด "บันทึกยอด" ใส่ยอดที่เห็นใน MiniMax เพื่อให้การเตือนแม่น'],
  quota: ['โควตาแพ็กเกจจะคืนตามรอบ (ราว 5 ชั่วโมง) หรืออัปเกรด/เปิดใช้เครดิตเสริม', 'ต้องใช้ทันที: เปลี่ยนเป็น API key แบบเติมเงินที่ตั้งค่า > API key'],
  auth: ['ตรวจว่า API key ยังใช้งานอยู่และภูมิภาคตรงกัน (สากล/จีน)', 'สร้าง key ใหม่แล้วใส่ที่ตั้งค่า > API key ระบบจะลองให้ทันที'],
  model: ['ตรวจชื่อ model ที่ตั้งค่า > API key แนะนำ MiniMax-M3.1-Flash'],
  rate: ['รอสักครู่ ระบบจะลองใหม่เอง ถ้าเกิดบ่อยให้ลดจำนวนคำตอบต่อคนต่อชั่วโมง'], server: ['ฝั่ง MiniMax ขัดข้อง ระบบลองใหม่เองทุก 2 นาที'], network: ['เซิร์ฟเวอร์ต่อออกไปหา MiniMax ไม่ได้ ติดต่อผู้ให้บริการโฮสต์ถ้าไม่หายใน 15 นาที'],
};
export const creditView = () => lazy(async (reload) => {
  const c = await get('/ai/credit'); setFx(c.fx); const down = c.health.status !== 'ok';
  const pct = c.total ? Math.max(0, Math.min(100, (c.remaining / c.total) * 100)) : null;
  const act = (fn) => async (v) => { await fn(v); toast('บันทึกแล้ว'); reload(); };
  const cur = c.currency === 'USD' ? 'US$' : c.currency;
  const both = (v) => (v === null ? '—' : c.currency === 'USD' && FX?.rate ? `${money(v, c.currency)} (${usd(v)})` : money(v, c.currency));
  const saveOptions = (extra) => send('PUT', '/ai/credit/options', { lowPct: c.options.lowPct, email: c.options.email ?? '', fxRate: c.options.fxRate ?? '', ...extra });
  const topup = () => formDialog({ title: 'บันทึกการเติมเครดิต', fields: [{ name: 'amount', label: `จำนวนที่เติมใน MiniMax (${cur})`, type: 'number', min: 0, step: 'any', required: true, wide: true, hint: 'บวกเพิ่มจากยอดเดิม' }, { name: 'paidThb', label: 'เงินที่จ่ายจริง (บาท)', type: 'number', min: 0, step: 'any', wide: true, hint: 'ดูจากใบเสร็จหรือ SMS บัตร ระบบจะใช้คำนวณอัตราแลกเปลี่ยนให้เอง ไม่ใส่ก็ได้' }, { name: 'note', label: 'หมายเหตุ', wide: true }], onSave: act((v) => send('POST', '/ai/credit', { ...v, kind: 'topup' })) });
  const rateDialog = () => formDialog({ title: 'อัตราแลกเปลี่ยน', values: { fxRate: c.options.fxRate ?? '' }, fields: [{ name: 'fxRate', label: '1 US$ = กี่บาท', type: 'number', min: 1, step: 'any', wide: true, hint: 'ใช้อัตราขายของธนาคาร หรือดูจากยอดที่บัตรตัดจริง เมื่อบันทึกการเติมพร้อมเงินบาทที่จ่าย ระบบจะอัปเดตให้เอง' }], onSave: act((v) => saveOptions({ fxRate: v.fxRate })) });
  const check = h('button', { class: 'btn btn-green', type: 'button', disabled: !c.configured, onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await send('POST', '/ai/credit/check'); toast(r.result.ok ? 'MiniMax ใช้งานได้' : r.result.message, r.result.ok ? 'ok' : 'error'); } catch (x) { toast(x.message, 'error'); } reload(); } }, icon('arrow-repeat'), 'ตรวจอีกครั้ง');
  const step = (t, i) => h('li', {}, h('b', {}, String(i + 1)), h('span', {}, t));

  // กรอกยอดจาก MiniMax ได้ทันทีบนหน้า ไม่ต้องเปิดหน้าต่างเพิ่ม
  const amount = h('input', { class: 'input', type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: '0.00', 'aria-label': `ยอดคงเหลือที่เห็นใน MiniMax (${cur})` });
  const preview = h('small', { class: 'muted' });
  const paintPreview = () => { const v = Number(amount.value); preview.textContent = amount.value === '' ? (c.base ? `ครั้งล่าสุด ${both(c.base.amount)} เมื่อ ${fmtDateTime(c.base.at)}` : 'ยังไม่เคยกรอกยอด') : c.currency === 'USD' && FX?.rate ? `≈ ${money(v, 'USD')}${c.remaining !== null ? ` · ระบบประมาณไว้ ${money(c.remaining, c.currency)}` : ''}` : ''; };
  amount.addEventListener('input', paintPreview); paintPreview();
  const saveBalance = h('button', { class: 'btn btn-green', type: 'submit' }, icon('check2-circle'), 'บันทึกยอด');
  const balanceForm = h('form', { class: 'balance-form', onsubmit: async (e) => {
    e.preventDefault();
    if (amount.value === '' || Number(amount.value) < 0) { amount.focus(); toast('กรอกยอดที่เห็นใน MiniMax', 'error'); return; }
    saveBalance.disabled = true;
    try { await send('POST', '/ai/credit', { kind: 'balance', amount: Number(amount.value) }); toast('บันทึกยอดแล้ว'); reload(); } catch (x) { toast(x.message, 'error'); saveBalance.disabled = false; }
  } }, h('label', { class: 'bal-field' }, h('span', {}, `ยอดคงเหลือที่เห็นใน MiniMax ตอนนี้ (${cur})`), amount, preview), saveBalance);

  const sp = c.spending;
  const thisMonth = sp?.months[0]; const lastMonth = sp?.months[1];
  const monthName = (m) => new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
  const diff = (e) => { if (e.kind !== 'balance' || e.estimate === null) return ''; const d = e.amount - e.estimate; return ` · ระบบประมาณไว้ ${money(e.estimate, c.currency)} (${Math.abs(d) < 0.005 ? 'ตรงกัน' : `${d > 0 ? 'จริงมากกว่า' : 'จริงน้อยกว่า'} ${money(Math.abs(d), c.currency)}`})`; };

  return [h('section', { class: `credit-hero lv-${down ? 'down' : c.level}` }, h('div', { class: 'gauge', style: { '--p': `${pct ?? 0}%` }, role: 'img', 'aria-label': pct === null ? 'ยังไม่ได้ตั้งยอด' : `เหลือ ${Math.round(pct)}%` }, h('b', {}, pct === null ? '?' : `${Math.round(pct)}%`), h('small', {}, pct === null ? 'ตั้งยอดก่อน' : 'คงเหลือ')),
    h('div', { class: 'credit-txt' }, h('h2', {}, down ? c.kindText ?? 'AI หยุดชั่วคราว' : c.remaining === null ? 'AI ทำงานปกติ' : `เหลือประมาณ ${money(c.remaining, c.currency)}`), h('p', {}, down ? `หยุดตั้งแต่ ${fmtDateTime(c.health.since ?? c.health.lastErrorAt)} · ลูกค้าได้คำตอบจากคลังที่ตรงคำถาม หรือถูกส่งต่อเจ้าหน้าที่` : c.daysLeft === null ? 'กรอกยอดที่เห็นใน MiniMax ด้านล่าง เพื่อเริ่มติดตามและเตือนล่วงหน้า' : `ใช้ได้อีกประมาณ ${c.daysLeft > 365 ? 'มากกว่า 1 ปี' : `${num(Math.floor(c.daysLeft))} วัน`} · เฉลี่ย ${money(c.perDay, c.currency)}/วัน`), h('span', { class: 'pill' }, LEVEL[c.level][0])),
    h('div', { class: 'credit-act' }, check, h('a', { class: 'btn', href: c.links.recharge, target: '_blank', rel: 'noopener' }, icon('credit-card-fill'), 'เติมเครดิตที่ MiniMax'))),
  ...(down ? [h('section', { class: 'box' }, h('h2', {}, 'ต้องทำอะไรตอนนี้'), h('ol', { class: 'fix' }, (FIX[c.health.kind] ?? ['กดตรวจอีกครั้ง ถ้ายังไม่หายให้ตรวจ API key']).map(step)), c.health.nextProbeAt && h('p', { class: 'muted' }, `ระบบจะลองเองอีกครั้งราว ${fmtDateTime(c.health.nextProbeAt)} (ต้องเปิด AI Chat Bot อยู่)`))] : []),
  h('section', { class: 'box balance-box' }, h('h2', {}, 'อัปเดตยอดจาก MiniMax'),
    h('ol', { class: 'fix' }, [h('span', {}, 'เปิด ', h('a', { href: c.links.recharge, target: '_blank', rel: 'noopener' }, 'หน้ายอดเงินของ MiniMax'), ' แล้วดูยอดคงเหลือ (Balance)'), 'พิมพ์ตัวเลขนั้นลงช่องด้านล่างแล้วกดบันทึก', 'ระบบเริ่มนับใหม่จากยอดนี้ และบอกว่าที่ประมาณไว้ต่างจากของจริงเท่าไร'].map((t, i) => h('li', {}, h('b', {}, String(i + 1)), typeof t === 'string' ? h('span', {}, t) : t))),
    balanceForm,
    h('p', { class: 'muted fx-line' }, icon('currency-exchange'), c.currency !== 'USD' ? ` แสดงเป็น ${c.currency} ตามที่ตั้งราคาไว้` : FX?.rate ? ` อัตราแลกเปลี่ยน 1 US$ = ${num(FX.rate)} บาท ` : ' ยังไม่ได้ตั้งอัตราแลกเปลี่ยน จึงแสดงเป็น US$ ', c.currency === 'USD' && h('button', { class: 'link-btn', type: 'button', onclick: rateDialog }, FX?.rate ? 'แก้ไข' : 'ตั้งอัตรา'))),
  h('section', { class: 'kpis' }, [['wallet2', '#168447', 'ยอดตั้งต้น + เติม', c.total === null ? '—' : money(c.total, c.currency)], ['graph-down', '#f5821f', 'ใช้ไปตั้งแต่ตั้งยอด', c.spent === null ? '—' : money(c.spent, c.currency)], ['calendar-week', '#6a4fc0', 'เฉลี่ยต่อวัน (7 วัน)', money(c.perDay, c.currency)], ['hourglass-split', '#2f7fb5', 'ใช้ได้อีก (วัน)', c.daysLeft === null ? '—' : c.daysLeft > 365 ? '365+' : num(Math.floor(c.daysLeft))]].map(([ic, col, l, v]) => h('div', { class: 'kpi', style: { '--c': col } }, icon(ic), h('b', { class: 'sm' }, v), h('span', {}, l)))),
  sp && h('section', { class: 'box' }, h('h2', {}, 'สรุปค่าใช้จ่าย AI'),
    h('div', { class: 'spend-sum' }, [['เติมเงินรวมทั้งหมด', sp.topups.thb === null ? usd(sp.topups.usd) : thb(sp.topups.thb), `${num(sp.topups.count)} ครั้ง · ${usd(sp.topups.usd)}`], ['ใช้เดือนนี้ (ประมาณ)', money(thisMonth.cost, c.currency), `${num(thisMonth.questions)} คำถาม`], ['ใช้เดือนก่อน (ประมาณ)', money(lastMonth.cost, c.currency), `${num(lastMonth.questions)} คำถาม`]].map(([l, v, s]) => h('div', {}, h('span', {}, l), h('b', {}, v), h('small', {}, s)))),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'เดือน'), h('th', {}, 'คำถาม'), h('th', {}, 'ค่าใช้ AI (ประมาณ)'), h('th', {}, 'เติมเงิน'))),
      h('tbody', {}, sp.months.map((m) => h('tr', {}, h('td', {}, monthName(m.month)), h('td', {}, num(m.questions)), h('td', {}, money(m.cost, c.currency)), h('td', {}, m.topupUsd ? (m.topupThb === null ? usd(m.topupUsd) : thb(m.topupThb)) : '—')))))),
    h('p', { class: 'muted' }, 'ค่าใช้ AI ประมาณจาก token ที่ใช้จริงคูณราคาต่อ token ส่วนเงินที่เติมคือยอดที่บันทึกไว้ ถ้าไม่ได้ใส่เงินบาทที่จ่ายจริง ระบบแปลงด้วยอัตราแลกเปลี่ยนปัจจุบัน')),
  h('section', { class: 'box' }, h('h2', {}, 'ประวัติยอดเครดิต'), h('p', { class: 'muted' }, 'MiniMax ไม่เปิด API ให้ดูยอดเงิน ระบบจึงประมาณจาก token ที่ใช้จริง ควรกรอกยอดจริงสัปดาห์ละครั้งหรือหลังเติมเงิน'), c.price.source === 'reference' && h('p', { class: 'notice-sm' }, icon('info-circle'), `ใช้ราคาอ้างอิง เข้า ${money(c.price.in, 'USD')} / ออก ${money(c.price.out, 'USD')} ต่อ 1 ล้าน token แก้ได้ที่ตั้งค่า AI`), !c.price.source && h('p', { class: 'notice-sm' }, icon('exclamation-triangle'), 'ไม่รู้ราคาของ model นี้ ใส่ราคาที่ตั้งค่า AI ก่อน'),
    h('div', { class: 'bar-actions', style: { 'margin-top': '12px' } }, h('button', { class: 'btn', type: 'button', disabled: !c.base, title: c.base ? '' : 'กรอกยอดจาก MiniMax ก่อน', onclick: topup }, icon('plus-lg'), 'บันทึกการเติม'), h('a', { class: 'btn', href: c.links.usage, target: '_blank', rel: 'noopener' }, 'ดูการใช้ใน MiniMax')),
    h('div', { class: 'list' }, c.entries.length ? c.entries.map((e) => h('div', { class: 'lrow' }, h('span', { class: 'n' }, e.kind === 'balance' ? `ยอดจริง ${both(e.amount)}` : `เติม +${e.paid_thb !== null ? `${thb(e.paid_thb)} (${usd(e.amount)})` : both(e.amount)}`), h('span', { class: `badge ${e.kind === 'balance' ? 'info' : 'ok'}` }, e.kind === 'balance' ? 'ยอดจริง' : 'เติมเงิน'), h('span', { class: 'm' }, `${fmtDateTime(e.created_at)} · ${e.admin_name ?? '-'}${diff(e)}${e.note ? ` · ${e.note}` : ''}`))) : empty('wallet2', 'ยังไม่มีบันทึกยอด'))),
  h('section', { class: 'box' }, h('h2', {}, 'การเตือน'), h('dl', { class: 'kv' }, h('div', {}, h('dt', {}, 'เตือนเมื่อเหลือไม่เกิน'), h('dd', {}, `${num(c.options.lowPct)}% หรือใช้ได้ไม่ถึง 7 วัน`)), h('div', {}, h('dt', {}, 'อีเมลรับแจ้ง'), h('dd', {}, c.options.email ?? '— ยังไม่ตั้ง —')), h('div', {}, h('dt', {}, 'เพดาน token ต่อเดือน'), h('dd', {}, c.settings.monthlyTokens ? num(c.settings.monthlyTokens) : 'ไม่จำกัด')), h('div', {}, h('dt', {}, 'ทาง LINE'), h('dd', {}, h('a', { href: '/admin/notifications.html' }, 'เลือกผู้รับที่หน้าแจ้งเตือน')))),
    h('div', { class: 'bar-actions', style: { margin: '14px 0 0' } }, h('button', { class: 'btn', type: 'button', onclick: () => formDialog({ title: 'ตั้งการเตือน', values: c.options, fields: [{ name: 'lowPct', label: 'เตือนเมื่อเหลือไม่เกิน (%)', type: 'number', min: 1, required: true }, { name: 'email', label: 'อีเมลรับแจ้ง (ว่าง = ไม่ส่ง)', type: 'email', wide: true }], onSave: act((v) => saveOptions(v)) }) }, icon('bell-fill'), 'แก้ไข'))),
  h('section', { class: 'box' }, h('h2', {}, 'ถ้าเครดิตหมด ระบบทำอะไรให้'), h('ol', { class: 'fix' }, ['หยุดเรียก MiniMax ทันที ไม่ให้ลูกค้ารอ', 'ตอบจากถาม-ตอบในคลังที่หัวข้อตรงกับคำถาม โดยไม่ใช้ AI', 'คำถามอื่นแจ้งลูกค้าครั้งเดียวต่อ 30 นาที แล้วติดป้ายเรียกเจ้าหน้าที่ในหน้าแชต', 'แจ้งผู้ดูแลทางอีเมลและ LINE ที่เลือกไว้', 'ลองใหม่เองทุก 10 นาที เติมแล้วกลับมาทำงานเอง พร้อมแจ้งว่าหายแล้ว'].map(step)))];
});
