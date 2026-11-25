import { api, get, send } from './api.js';
import { busy, confirmDialog, fmtDateTime, h, icon, num, toast } from './ui.js';
import { celebrate, countUp } from './fx.js';
import { can, empty, failed, formDialog, initAdmin, pager, skeleton, STATUS } from './admin.js';

const main = await initAdmin('notifications');
const TONE = { green: ['#168447', '#49378a', 'เขียว'], purple: ['#6a4fc0', '#2c1f63', 'ม่วง'], orange: ['#f5821f', '#b8341f', 'ส้ม'], grey: ['#6b6780', '#3b3850', 'เทา'] };
const QS = { pending: ['warn', 'รอส่ง'], processing: ['info', 'กำลังส่ง'], sent: ['ok', 'ส่งแล้ว'], failed: ['bad', 'ล้มเหลว'], cancelled: ['', 'ยกเลิก'] };
let tab = 'home'; let state; let tpl; let sel = null;
const TABS = { home: 'ภาพรวม', templates: 'ข้อความ', campaign: 'ส่งกลุ่ม', admins: 'แจ้งเจ้าหน้าที่', history: 'ประวัติ' };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function bubble(m) {
  const [a, b] = TONE[m.tone];
  return h('div', { class: 'flexb', style: { '--a': a, '--b': b } }, h('header', {}, h('small', {}, 'E-Training'), h('strong', {}, m.heading)),
    h('section', {}, m.body, m.step && h('div', { class: 'st' }, Array.from({ length: 9 }, (_, i) => h('i', { class: i + 1 < m.step ? 'd' : i + 1 === m.step ? 'n' : '' }))), m.rows?.length > 0 && h('dl', {}, m.rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])), m.footer && h('div', { class: 'ft' }, m.footer)),
    m.button && h('div', { class: 'fb' }, m.button.label));
}
const phone = () => { const screen = h('div', { class: 'pscreen' }); return { el: h('div', { class: 'phone', 'aria-label': 'ตัวอย่างใน LINE' }, screen), show: (m) => screen.replaceChildren(bubble(m)) }; };

/** ช่องแก้ข้อความพร้อมตัวอย่างสด ใช้ร่วมกันทั้ง template และส่งกลุ่ม */
function editor(v, { key = null, titled = false, toggle = false } = {}) {
  const f = { title: h('input', { class: 'input', value: v.title ?? '', maxLength: 100 }), heading: h('input', { class: 'input', value: v.heading ?? '', maxLength: 80 }), body: h('textarea', { class: 'input', rows: 5, maxLength: 900, value: v.body ?? '' }), button: h('input', { class: 'input', value: v.button?.label ?? '', maxLength: 20, placeholder: 'เว้นว่าง = ไม่มีปุ่ม' }), tone: h('select', { class: 'input' }, Object.entries(TONE).map(([k, t]) => h('option', { value: k, selected: k === v.tone }, t[2]))), active: h('input', { type: 'checkbox', checked: v.active ?? true }) };
  const errs = {};
  const fld = (label, name) => h('label', { class: 'fld' }, h('span', {}, label), f[name], errs[name] = h('span', { class: 'e', role: 'alert' }));
  const p = phone(); let last = f.body;
  for (const n of ['heading', 'body']) f[n].addEventListener('focus', () => { last = f[n]; });
  const value = () => ({ ...(key ? { key } : {}), ...(titled ? { title: f.title.value } : {}), heading: f.heading.value, body: f.body.value, buttonLabel: f.button.value, tone: f.tone.value, active: f.active.checked });
  const fail = (e) => { for (const x of Object.values(errs)) x.textContent = ''; for (const x of e.errors ?? []) if (errs[x.field]) errs[x.field].textContent = x.message; if (errs.body && e.code === 'UNKNOWN_VARIABLE') errs.body.textContent = e.message; };
  let seq = 0;
  const refresh = debounce(async () => { const n = ++seq; try { const m = await send('POST', '/admin/notifications/preview', value()); if (n === seq) { fail({}); p.show(m); } } catch (e) { if (n === seq) fail(e); } }, 250);
  for (const x of Object.values(f)) x.addEventListener('input', refresh);
  refresh();
  const el = h('div', { class: 'fgrid' }, titled && fld('ชื่อข้อความ', 'title'), fld('หัวข้อ', 'heading'), fld('เนื้อความ', 'body'),
    h('div', {}, h('small', { class: 'muted' }, 'แตะเพื่อแทรกข้อมูลผู้สมัคร'), h('div', { class: 'vars' }, Object.entries(tpl.variables).map(([k, l]) => h('button', { type: 'button', onclick: () => { const i = last.selectionStart ?? last.value.length; last.setRangeText(`{{${k}}}`, i, last.selectionEnd ?? i, 'end'); last.focus(); refresh(); } }, l)))),
    h('div', { class: 'fgrid two' }, fld('ข้อความบนปุ่ม', 'button'), fld('สี', 'tone')), toggle && h('label', { class: 'chk' }, f.active, 'เปิดใช้ข้อความนี้'));
  return { el, phone: p.el, value, fail };
}
const testBtn = (ed) => h('button', { class: 'btn', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { try { await send('POST', '/admin/notifications/test', ed.value()); toast('ส่งทดสอบไปที่ LINE ของคุณแล้ว'); } catch (x) { ed.fail(x); toast(x.message, 'error'); } }) }, icon('phone'), 'ส่งทดสอบถึงฉัน');

// ---------- ภาพรวม ----------
async function homeView() {
  state = await get('/admin/notifications/state');
  const s = state.settings; const q = state.quota;
  const sw = h('input', { type: 'checkbox', role: 'switch', id: 'nsw', checked: s.enabled, disabled: !state.lineReady && !s.enabled, onchange: async () => {
    const on = sw.checked; sw.checked = !on;
    if (!(await confirmDialog({ title: on ? 'เปิดแจ้งเตือนผ่าน LINE?' : 'ปิดแจ้งเตือนทั้งหมด?', text: on ? 'ผู้สมัครที่เชื่อม LINE จะได้รับข้อความตั้งแต่เหตุการณ์ถัดไป เหตุการณ์ก่อนหน้านี้ไม่ถูกส่งย้อนหลัง ทุกข้อความใช้โควตา LINE' : 'รายการที่รอส่งจะถูกยกเลิก และเหตุการณ์ระหว่างปิดจะไม่ถูกส่งย้อนหลัง', confirm: on ? 'เปิด' : 'ปิด', danger: !on }))) return;
    try { await send('PUT', '/admin/notifications/settings', { ...s, enabled: on }); if (on) celebrate(); render(); } catch (e) { toast(e.message, 'error'); }
  } });
  const kpi = (i, ic, c, label, value) => { const b = h('b', {}, '0'); countUp(b, value); return h('div', { class: 'kpi', style: { '--c': c, '--i': i } }, icon(ic), b, h('span', {}, label)); };
  return [h('section', { class: `nhero ${s.enabled ? 'on' : ''}` }, icon('bell-fill'), h('div', {}, h('h2', {}, s.enabled ? 'กำลังแจ้งเตือนอัตโนมัติ' : 'ปิดแจ้งเตือนอยู่'), h('p', {}, !state.lineReady ? 'ตั้งค่า LINE Messaging API ที่หน้า "ตั้งค่า" ก่อน' : q ? (q.limited ? `โควตาเหลือ ${num(q.remaining)} จาก ${num(q.limit)} ข้อความเดือนนี้` : `ส่งแล้ว ${num(q.used)} ข้อความเดือนนี้`) : 'อ่านโควตาไม่ได้')), h('label', { class: 'sw', htmlFor: 'nsw' }, sw, h('i', {}), h('span', { class: 'sr' }, 'เปิดหรือปิดแจ้งเตือน'))),
    h('section', { class: 'kpis' }, kpi(0, 'send-check-fill', '#168447', 'ส่งสำเร็จ 30 วัน', state.stats.sent ?? 0), kpi(1, 'hourglass-split', '#f5821f', 'รอส่ง', (state.stats.pending ?? 0) + (state.stats.processing ?? 0)), kpi(2, 'send-x-fill', '#c92a3a', 'ล้มเหลว', state.stats.failed ?? 0), kpi(3, 'slash-circle', '#6b6780', 'ไม่ส่ง/ยกเลิก', state.stats.cancelled ?? 0)),
    h('section', { class: 'box' }, h('h2', {}, 'เตือนตามกำหนดการ'), h('dl', { class: 'kv' }, h('div', {}, h('dt', {}, 'ผู้ที่ไม่ได้เชื่อม LINE'), h('dd', {}, s.emailFallback ? 'แจ้งทางอีเมลแทน' : 'ไม่แจ้ง')), h('div', {}, h('dt', {}, 'เตือนก่อนวันอบรม'), h('dd', {}, s.daysBefore ? `${num(s.daysBefore)} วัน เวลา 09:00 น.` : 'ไม่เตือน')), h('div', {}, h('dt', {}, 'เตือนก่อนเริ่มอบรม'), h('dd', {}, s.hoursBefore ? `${num(s.hoursBefore)} ชั่วโมง` : 'ไม่เตือน')), h('div', { class: 'wide' }, h('dt', {}, 'ลิงก์แบบประเมิน (ส่งให้ผู้ที่บันทึกว่าเข้าอบรมแล้ว)'), h('dd', {}, s.evaluationUrl ?? '— ยังไม่ระบุ ระบบจะไม่ส่งแบบประเมิน —'))),
      h('div', { class: 'bar-actions', style: { margin: '14px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => formDialog({ title: 'ตั้งเวลาเตือน', values: s, fields: [{ name: 'daysBefore', label: 'ก่อนวันอบรม (วัน, 0 = ไม่เตือน)', type: 'number', min: 0 }, { name: 'hoursBefore', label: 'ก่อนเริ่ม (ชั่วโมง, 0 = ไม่เตือน)', type: 'number', min: 0 }, { name: 'evaluationUrl', label: 'ลิงก์แบบประเมิน (https)', wide: true }, { name: 'emailFallback', label: 'ผู้ที่ไม่ได้เชื่อม LINE (หรือบล็อก) ให้แจ้งทางอีเมลแทน', type: 'checkbox' }], onSave: async (v) => { await send('PUT', '/admin/notifications/settings', { ...v, enabled: s.enabled }); toast('บันทึกแล้ว'); render(); } }) }, icon('pencil-fill'), 'แก้ไข')))];
}
// ---------- ข้อความ ----------
async function templatesView() {
  tpl = await get('/admin/notifications/templates');
  const items = tpl.items;
  const cur = sel === 'new' ? { tone: 'purple', custom: true } : items.find((t) => t.key === sel) ?? items[0];
  sel = sel === 'new' ? 'new' : cur.key;
  const ed = editor(cur, { key: sel === 'new' ? null : cur.key, titled: cur.custom, toggle: sel !== 'new' });
  const save = (e) => busy(e.currentTarget, async () => { try { if (sel === 'new') sel = (await send('POST', '/admin/notifications/templates', ed.value())).key; else await send('PUT', `/admin/notifications/templates/${cur.key}`, ed.value()); toast('บันทึกแล้ว'); render(); } catch (x) { ed.fail(x); toast(x.message, 'error'); } });
  return [h('div', { class: 'tgrid' }, h('aside', { class: 'tlist' }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => { sel = 'new'; render(); } }, icon('plus-lg'), 'สร้างข้อความ'),
    items.map((t) => h('button', { class: `titem ${t.active ? '' : 'off'}`, type: 'button', 'aria-current': String(t.key === sel), onclick: () => { sel = t.key; render(); } }, h('i', { class: 'dot', style: { background: TONE[t.tone][0] } }), h('span', {}, t.title, h('small', {}, t.custom ? ' · สร้างเอง' : t.edited ? ' · แก้ไขแล้ว' : '')), h('small', {}, t.active ? '' : 'ปิด')))),
  h('section', { class: 'box' }, h('h2', {}, sel === 'new' ? 'ข้อความใหม่' : cur.title), h('div', { class: 'tedit' }, h('div', {}, ed.el, h('div', { class: 'bar-actions', style: { margin: '16px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', onclick: save }, 'บันทึก'), testBtn(ed), cur.custom && sel !== 'new' && h('button', { class: 'btn', type: 'button', onclick: async () => { if (!(await confirmDialog({ title: `ลบ "${cur.title}"?`, confirm: 'ลบ', danger: true }))) return; try { await send('DELETE', `/admin/notifications/templates/${cur.key}`); sel = null; render(); } catch (e) { toast(e.message, 'error'); } } }, 'ลบ'))), ed.phone)))];
}
// ---------- ส่งกลุ่ม ----------
async function campaignView() {
  tpl = await get('/admin/notifications/templates');
  const [list, cat] = await Promise.all([get('/admin/notifications/campaigns'), can('catalog.manage') ? get('/admin/catalog') : null]);
  const customs = tpl.items.filter((t) => t.custom);
  const ed = editor({ tone: 'purple', heading: 'ประกาศถึงผู้อบรม', body: 'เรียนคุณ{{name}}\n', button: { label: 'ดูรายละเอียด' } }, { titled: true });
  const session = h('select', { class: 'input', 'aria-label': 'รุ่น' }, h('option', { value: '' }, 'ทุกรุ่น'), (cat?.sessions ?? []).map((s) => h('option', { value: s.id }, `${s.session_name} · ${s.university_name}`)));
  const uni = h('select', { class: 'input', 'aria-label': 'มหาวิทยาลัย' }, h('option', { value: '' }, 'ทุกมหาวิทยาลัย'), (cat?.universities ?? []).map((u) => h('option', { value: u.id }, u.name)));
  const boxes = Object.entries(STATUS).filter(([k]) => !['rejected', 'cancelled'].includes(k)).map(([k, v]) => h('label', {}, h('input', { type: 'checkbox', value: k, checked: ['approved', 'awaiting_training'].includes(k) }), v[1]));
  const when = h('input', { class: 'input', type: 'datetime-local', 'aria-label': 'ตั้งเวลา' });
  const est = h('div', { class: 'est', role: 'status' }); let cur = null; let seq = 0; let clientKey = crypto.randomUUID();
  const filter = () => ({ ...(session.value ? { sessionId: Number(session.value) } : {}), ...(uni.value ? { universityId: Number(uni.value) } : {}), statuses: boxes.map((b) => b.firstChild).filter((c) => c.checked).map((c) => c.value) });
  const btn = h('button', { class: 'btn btn-green', type: 'button', disabled: true }, icon('send-fill'), 'ตรวจและส่ง');
  const refresh = debounce(async () => { const n = ++seq; btn.disabled = true; try { const e = await send('POST', '/admin/notifications/campaigns/estimate', filter()); if (n !== seq) return; cur = e; est.className = `est ${e.enough ? '' : 'bad'}`; est.replaceChildren(h('b', {}, num(e.count)), h('span', {}, 'คน จะได้รับข้อความ'), h('small', { class: 'muted' }, e.quota?.limited ? `โควตาเหลือ ${num(e.quota.remaining)}${e.enough ? '' : ' ไม่พอ'}` : 'ไม่จำกัดโควตา'), h('small', { class: 'muted' }, 'เฉพาะผู้ที่เชื่อม LINE ไม่บล็อก และไม่คัดค้านข่าวกลุ่ม')); btn.disabled = !e.count || !e.enough; } catch (x) { if (n === seq) { est.className = 'est bad'; est.replaceChildren(h('span', {}, x.errors?.[0]?.message ?? x.message)); } } }, 250);
  for (const x of [session, uni, ...boxes]) x.addEventListener('change', refresh);
  refresh();
  btn.addEventListener('click', async () => {
    const at = when.value ? new Date(`${when.value}:00+07:00`) : null;
    if (!(await confirmDialog({ title: `ส่งถึง ${num(cur.count)} คน?`, text: at ? `กำหนดส่ง ${fmtDateTime(at)} ยกเลิกได้ก่อนถึงเวลา` : 'ส่งทันที เรียกคืนไม่ได้ และใช้โควตา LINE ตามจำนวนผู้รับ', confirm: at ? 'ตั้งเวลาส่ง' : 'ส่งเลย' }))) return;
    await busy(btn, async () => { try { const r = await send('POST', '/admin/notifications/campaigns', { ...ed.value(), filter: filter(), scheduledAt: at ? at.toISOString() : null, expectedCount: cur.count, clientKey }); clientKey = crypto.randomUUID(); toast(`เข้าคิวส่ง ${num(r.count)} คนแล้ว`); celebrate(); render(); } catch (e) { ed.fail(e); toast(e.message, 'error'); refresh(); } });
  });
  return [h('section', { class: 'box' }, h('div', { class: 'tedit' }, h('div', { class: 'fgrid' }, h('h2', {}, '1. เลือกผู้รับ'), h('div', { class: 'fgrid two' }, session, uni), h('div', { class: 'checks' }, boxes), est, h('h2', {}, '2. ข้อความ'), customs.length > 0 && h('select', { class: 'input', 'aria-label': 'เริ่มจากข้อความที่สร้างไว้', onchange: (e) => { const t = customs.find((x) => x.key === e.target.value); if (t) { const inputs = ed.el.querySelectorAll('.input'); inputs[0].value = t.title; inputs[1].value = t.heading; inputs[2].value = t.body; inputs[3].value = t.button?.label ?? ''; inputs[4].value = t.tone; inputs[2].dispatchEvent(new Event('input')); } } }, h('option', { value: '' }, 'เริ่มจากข้อความที่สร้างไว้…'), customs.map((t) => h('option', { value: t.key }, t.title))), ed.el, h('label', { class: 'fld' }, h('span', {}, 'ตั้งเวลาส่ง (เวลาไทย เว้นว่าง = ส่งทันที)'), when), h('div', { class: 'bar-actions' }, btn, testBtn(ed))), ed.phone)),
    h('section', { class: 'box' }, h('h2', {}, 'ที่ส่งไปแล้ว'), list.length ? h('div', { class: 'list' }, list.map((c) => h('div', { class: 'lrow cols' }, h('span', { class: 'n' }, c.title), h('span', { class: 'm' }, `${fmtDateTime(c.scheduled_at)} · สำเร็จ ${num(c.sent ?? 0)}/${num(c.recipient_count)}${Number(c.failed) ? ` · ล้มเหลว ${num(c.failed)}` : ''}${Number(c.pending) ? ` · รอส่ง ${num(c.pending)}` : ''} · ${c.admin_name ?? '-'}`), c.status === 'active' && Number(c.pending) ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (!(await confirmDialog({ title: 'ยกเลิกรายการที่ยังไม่ส่ง?', confirm: 'ยกเลิกการส่ง', danger: true }))) return; try { const r = await send('POST', `/admin/notifications/campaigns/${c.id}/cancel`); toast(`ยกเลิก ${num(r.cancelled)} รายการ`); render(); } catch (e) { toast(e.message, 'error'); } } }, 'ยกเลิก') : h('span', { class: `badge ${c.status === 'active' ? 'ok' : ''}` }, c.status === 'active' ? 'ส่งแล้ว' : 'ยกเลิก')))) : empty('megaphone', 'ยังไม่เคยส่งกลุ่ม'))];
}
// ---------- แจ้งเจ้าหน้าที่ ----------
async function adminsView() {
  const [d, st] = await Promise.all([get('/admin/notifications/recipients'), get('/admin/notifications/state')]);
  return [h('section', { class: 'box' }, h('h2', {}, 'LINE ของฉัน'), h('p', { class: 'muted' }, st.linked ? 'เชื่อมแล้ว พร้อมรับแจ้งเตือนและข้อความทดสอบ' : 'เชื่อมเพื่อรับแจ้งเตือน โดยส่งรหัสให้ LINE OA ในแชต'), h('div', { class: 'bar-actions', style: { margin: '12px 0 0' } }, h('button', { class: 'btn btn-line', type: 'button', onclick: link }, icon('line'), st.linked ? 'เปลี่ยนบัญชี LINE' : 'เชื่อม LINE'), st.linked && h('button', { class: 'btn', type: 'button', onclick: async () => { if (!(await confirmDialog({ title: 'ยกเลิกเชื่อม LINE?', confirm: 'ยกเลิกเชื่อม', danger: true }))) return; await send('POST', '/admin/notifications/unlink').catch((e) => toast(e.message, 'error')); render(); } }, 'ยกเลิกเชื่อม'))),
    h('section', { class: 'box' }, h('h2', {}, 'ใครได้รับเรื่องอะไร'), h('p', { class: 'muted', style: { 'margin-bottom': '12px' } }, 'ข้อความถึงเจ้าหน้าที่ใช้โควตา LINE ระบบจึงรวมเหตุการณ์ใกล้กันเป็นข้อความเดียว เลือกเฉพาะที่จำเป็น'), h('div', { class: 'list' }, d.admins.map((a) => {
      const boxes = d.events.filter((e) => a.allowed.includes(e.key)).map((e) => h('label', {}, h('input', { type: 'checkbox', value: e.key, checked: a.events.includes(e.key), onchange: async () => { try { await send('PUT', `/admin/notifications/recipients/${a.id}`, { events: boxes.map((b) => b.firstChild).filter((c) => c.checked).map((c) => c.value) }); toast('บันทึกแล้ว'); } catch (x) { toast(x.message, 'error'); render(); } } }), e.title));
      return h('div', { class: 'lrow' }, h('span', { class: 'n' }, `${a.name} · ${a.role}`), h('span', { class: `badge ${a.linked ? 'ok' : 'warn'}` }, a.linked ? `LINE: ${a.lineName ?? 'เชื่อมแล้ว'}` : 'ยังไม่เชื่อม LINE'), h('div', { class: 'm checks', style: { 'margin-top': '8px' } }, boxes.length ? boxes : 'ไม่มีเหตุการณ์ที่เกี่ยวกับสิทธิ์ของผู้ใช้นี้'));
    })))];
}
async function link() {
  let r;
  try { r = await send('POST', '/admin/notifications/link-code'); } catch (e) { toast(e.message, 'error'); return; }
  const d = h('dialog', { onclose: () => { d.remove(); render(); } }, h('div', { class: 'dialog-form' }, h('h3', {}, 'ส่งรหัสนี้ให้ LINE OA ในแชต'), h('div', { class: 'code' }, r.code), h('p', { class: 'muted' }, `ใช้ได้ครั้งเดียวใน ${r.minutes} นาที อย่าให้ผู้อื่นเห็น เพราะคนที่ส่งรหัสจะได้รับแจ้งเตือนแทนคุณ`), h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(r.code); toast('คัดลอกแล้ว'); } catch { toast('คัดลอกไม่สำเร็จ', 'error'); } } }, icon('copy'), 'คัดลอก'), h('button', { class: 'btn btn-green', type: 'button', onclick: () => d.close() }, 'ส่งแล้ว'))));
  document.body.append(d); d.showModal();
}
// ---------- ประวัติ ----------
const hf = { status: '', type: '', page: 1 };
async function historyView() {
  if (!tpl) tpl = await get('/admin/notifications/templates');
  const { data, meta } = await api(`/admin/notifications/queue?${new URLSearchParams(hf)}`);
  const label = (q) => q.campaign_title ?? (q.notification_type.startsWith('admin_') ? `เจ้าหน้าที่: ${q.admin_name ?? '-'}` : tpl.items.find((t) => t.key === q.notification_type)?.title ?? q.notification_type);
  const pick = (name, opts) => h('select', { class: 'input', 'aria-label': name, onchange: (e) => { hf[name] = e.target.value; hf.page = 1; render(); } }, opts.map(([v, l]) => h('option', { value: v, selected: hf[name] === v }, l)));
  const act = async (q, action) => { try { await send('POST', `/admin/notifications/queue/${q.id}`, { action }); toast(action === 'retry' ? 'เข้าคิวส่งใหม่แล้ว' : 'ยกเลิกแล้ว'); } catch (e) { toast(e.message, 'error'); } render(); };
  const logs = async (q) => { try { const l = await get(`/admin/notifications/queue/${q.id}/logs`); const d = h('dialog', { onclose: () => d.remove() }, h('div', { class: 'dialog-form' }, h('h3', {}, 'ผลตอบจาก LINE'), l.length ? h('ul', { class: 'hist' }, l.map((x) => h('li', {}, h('span', { class: `badge ${x.status === 'sent' ? 'ok' : 'bad'}` }, `รหัส ${x.error_code}`), h('small', {}, fmtDateTime(x.created_at)), h('small', {}, x.response_payload)))) : h('p', { class: 'muted' }, 'ยังไม่ได้เรียก LINE'), h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'ปิด')))); document.body.append(d); d.showModal(); } catch (e) { toast(e.message, 'error'); } };
  return [h('section', { class: 'box' }, h('div', { class: 'filters' }, pick('status', [['', 'ทุกสถานะ'], ...Object.entries(QS).map(([k, v]) => [k, v[1]])]), pick('type', [['', 'ทุกประเภท'], ['applicant', 'ถึงผู้สมัคร'], ['campaign', 'ส่งกลุ่ม'], ['admin', 'ถึงเจ้าหน้าที่']])),
    data.length ? h('div', { class: 'list' }, data.map((q) => h('div', { class: 'lrow' }, h('span', { class: 'n' }, `${label(q)}${q.application_no ? ` · ${q.full_name}` : ''}${q.item_count > 1 ? ` (${num(q.item_count)})` : ''}`), h('span', { class: `badge ${QS[q.status][0]}` }, QS[q.status][1]), h('span', { class: 'm' }, `${q.application_no ? `${q.application_no} · ` : ''}${q.sent_at ? `ส่ง ${fmtDateTime(q.sent_at)}` : `กำหนด ${fmtDateTime(q.scheduled_at)}`}${q.retry_count > 1 ? ` · ลอง ${num(q.retry_count)} ครั้ง` : ''}${q.error_message ? ` · ${q.error_message}` : ''}`),
      h('span', { class: 'm bar-actions', style: { margin: '4px 0 0' } }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => logs(q) }, 'ดูผล'), q.status === 'failed' && h('button', { class: 'btn btn-sm btn-green', type: 'button', onclick: () => act(q, 'retry') }, 'ส่งอีกครั้ง'), q.status === 'pending' && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => act(q, 'cancel') }, 'ยกเลิก'))))) : empty('bell-slash', 'ยังไม่มีรายการ'), data.length > 0 && pager(meta, (p) => { hf.page = p; render(); }))];
}
const VIEW = { home: homeView, templates: templatesView, campaign: campaignView, admins: adminsView, history: historyView };
let seq = 0;
async function render() {
  const n = ++seq;
  const bar = h('div', { class: 'tabs', role: 'tablist' }, Object.entries(TABS).map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; main.replaceChildren(bar, ...skeleton(3, '110px')); render(); } }, l)));
  if (!main.children.length) main.replaceChildren(bar, ...skeleton(3, '110px'));
  try { const body = await VIEW[tab](); if (n === seq) main.replaceChildren(bar, ...body); } catch (e) { if (n === seq) main.replaceChildren(bar, failed(e, render)); }
}
render();
