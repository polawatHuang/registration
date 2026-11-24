import { get, send } from './api.js';
import { confirmDialog, fmtDateTime, fmtRange, h, icon, num, toast } from './ui.js';
import { empty, failed, formDialog, initAdmin, skeleton } from './admin.js';

const main = await initAdmin('catalog');
const ST = { draft: ['', 'ฉบับร่าง'], open: ['ok', 'เปิดรับสมัคร'], closed: ['warn', 'ปิดรับ'], completed: ['info', 'จบแล้ว'], cancelled: ['bad', 'ยกเลิก'] };
let data; let tab = 'universities';
/** datetime-local เป็นเวลาไทยเสมอ ไม่ขึ้นกับเครื่องผู้ใช้ */
const toLocal = (v) => (v ? new Date(new Date(v).getTime() + 7 * 3_600_000).toISOString().slice(0, 16) : '');
const toIso = (v) => (v ? new Date(`${v}:00+07:00`).toISOString() : null);
const save = (method, path, body) => send(method, path, body).then(async () => { toast('บันทึกแล้ว'); await load(); });

function sessionForm(s) {
  formDialog({ title: s ? 'แก้ไขรุ่นอบรม' : 'เพิ่มรุ่นอบรม', values: s ? { courseId: s.course_id, universityId: s.university_id, sessionName: s.session_name, startsAt: toLocal(s.starts_at), endsAt: toLocal(s.ends_at), location: s.location, mapUrl: s.map_url, details: s.details, capacity: s.capacity, opensAt: toLocal(s.registration_opens_at), closesAt: toLocal(s.registration_closes_at), status: s.status } : { status: 'draft' },
    fields: [{ name: 'courseId', label: 'หลักสูตร', type: 'select', wide: true, required: true, options: data.courses.map((c) => [c.id, c.name]) }, { name: 'universityId', label: 'มหาวิทยาลัย', type: 'select', wide: true, required: true, options: data.universities.map((u) => [u.id, u.name]) }, { name: 'sessionName', label: 'ชื่อรุ่น', required: true }, { name: 'capacity', label: 'จำนวนรับ', type: 'number', min: 1, hint: 'เว้นว่าง = ไม่จำกัด' },
      { name: 'startsAt', label: 'เริ่ม (เวลาไทย)', type: 'datetime-local', required: true }, { name: 'endsAt', label: 'สิ้นสุด', type: 'datetime-local', required: true }, { name: 'opensAt', label: 'เปิดรับสมัคร', type: 'datetime-local' }, { name: 'closesAt', label: 'ปิดรับสมัคร', type: 'datetime-local' }, { name: 'location', label: 'สถานที่', wide: true }, { name: 'mapUrl', label: 'ลิงก์แผนที่ (https)', wide: true }, { name: 'details', label: 'รายละเอียด', type: 'textarea', wide: true }, { name: 'status', label: 'สถานะ', type: 'select', options: Object.entries(ST).map(([k, v]) => [k, v[1]]) }],
    onSave: (v) => save(s ? 'PUT' : 'POST', `/admin/catalog/sessions${s ? `/${s.id}` : ''}`, { ...v, startsAt: toIso(v.startsAt), endsAt: toIso(v.endsAt), opensAt: toIso(v.opensAt), closesAt: toIso(v.closesAt) }) });
}
const simple = (kind, key, title) => (x) => formDialog({ title: `${x ? 'แก้ไข' : 'เพิ่ม'}${title}`, values: x ? { [key]: x[key], sortOrder: x.sort_order, isActive: x.is_active } : { isActive: true, sortOrder: 0 },
  fields: [{ name: key, label: 'ชื่อ', required: true, wide: true }, { name: 'sortOrder', label: 'ลำดับ', type: 'number' }, { name: 'isActive', label: 'เปิดใช้งาน', type: 'checkbox' }], onSave: (v) => save(x ? 'PUT' : 'POST', `/admin/catalog/${kind}${x ? `/${x.id}` : ''}`, v) });
const uniForm = simple('universities', 'name', 'มหาวิทยาลัย');
const optForm = simple('options', 'label', 'ตัวเลือกระยะเวลาเปิดร้าน');
const addBtn = (label, fn, disabled) => h('div', { class: 'bar-actions' }, h('button', { class: 'btn btn-green', type: 'button', disabled, onclick: () => fn() }, icon('plus-lg'), label));
const active = (x) => h('span', { class: `badge ${x.is_active ? 'ok' : ''}` }, x.is_active ? 'เปิดใช้' : 'ปิด');
const rows = (list, render) => h('div', { class: 'list' }, list.length ? list.map(render) : empty('inbox', 'ยังไม่มีรายการ'));

const del = (kind, x, name) => h('button', { class: 'icon-btn', type: 'button', 'aria-label': `ลบ ${name}`, title: 'ลบ', onclick: async () => {
  if (!(await confirmDialog({ title: `ลบ "${name}"?`, text: 'ลบแล้วกู้คืนไม่ได้ ถ้ามีข้อมูลใช้งานอยู่ระบบจะไม่ให้ลบ ให้ปิดใช้งานแทน', confirm: 'ลบ', danger: true }))) return;
  try { await send('DELETE', `/admin/catalog/${kind}/${x.id}`); toast('ลบแล้ว'); await load(); } catch (e) { toast(e.message, 'error'); }
} }, icon('trash3'));
const row = (kind, x, name, btn) => h('div', { class: 'krow' }, btn, del(kind, x, name));
const note = (text) => h('p', { class: 'muted', style: { 'margin-bottom': '12px' } }, text);

const TABS = {
  universities: ['ข้อ 1 มหาวิทยาลัย', () => [note('รายชื่อที่ผู้สมัครเลือกในข้อ 1 เรียงตามลำดับที่ตั้ง รายการที่ปิดจะไม่แสดงในฟอร์ม'), addBtn('เพิ่มมหาวิทยาลัย', uniForm), rows(data.universities, (u) => row('universities', u, u.name, h('button', { class: 'lrow cols', type: 'button', onclick: () => uniForm(u) }, h('span', { class: 'n' }, u.name), h('span', { class: 'm' }, `ลำดับ ${u.sort_order} · ${num(data.sessions.filter((s) => s.university_id === u.id && s.status === 'open').length)} รุ่นที่เปิดรับ`), active(u))))]],
  sessions: ['ข้อ 2 รุ่นและช่วงเวลา', () => [note('แสดงในข้อ 2 ตามมหาวิทยาลัยที่เลือก เมื่อสถานะเป็น "เปิดรับสมัคร" อยู่ในช่วงรับสมัคร และยังไม่ถึงวันเริ่มอบรม'), addBtn('เพิ่มรุ่น', sessionForm, !data.universities.length), !data.universities.length && note('เพิ่มมหาวิทยาลัยในข้อ 1 ก่อน จึงจะสร้างรุ่นได้'), rows(data.sessions, (s) => row('sessions', s, s.session_name, h('button', { class: 'lrow cols', type: 'button', onclick: () => sessionForm(s) }, h('span', { class: 'n' }, `${s.session_name} · ${s.university_name}`), h('span', { class: 'm' }, `${fmtRange(s.starts_at, s.ends_at)} · ${num(s.registered)}${s.capacity === null ? '' : `/${num(s.capacity)}`} คน${s.registration_closes_at ? ` · ปิดรับ ${fmtDateTime(s.registration_closes_at)}` : ''}`), h('span', { class: `badge ${ST[s.status][0]}` }, ST[s.status][1]))))]],
  options: ['ข้อ 11 ระยะเวลาเปิดร้าน', () => [note('ตัวเลือกที่ผู้สมัครเลือกในข้อ 11'), addBtn('เพิ่มตัวเลือก', optForm), rows(data.options, (o) => row('options', o, o.label, h('button', { class: 'lrow', type: 'button', onclick: () => optForm(o) }, h('span', { class: 'n' }, o.label), active(o))))]],
};
function render() {
  main.replaceChildren(h('div', { class: 'tabs', role: 'tablist' }, Object.entries(TABS).map(([k, [label]]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; render(); } }, label))), h('section', { class: 'box' }, TABS[tab][1]()));
}
async function load() {
  if (!data) main.replaceChildren(...skeleton());
  try { data = await get('/admin/catalog'); render(); } catch (e) { main.replaceChildren(failed(e, load)); }
}
load();
