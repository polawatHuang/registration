import { get, send } from './api.js';
import { $, h, icon } from './ui.js';

export const MENU = [
  ['dashboard', 'grid-1x2-fill', 'ภาพรวม', 'applicants.view'], ['applications', 'people-fill', 'ผู้สมัคร', 'applicants.view'], ['chat', 'chat-dots-fill', 'แชต', 'chat.reply'], ['notifications', 'bell-fill', 'แจ้งเตือน', 'notifications.manage'], ['catalog', 'ui-checks', 'ตัวเลือกฟอร์ม', 'catalog.manage'],
  ['ai-knowledge', 'robot', 'คลัง AI', 'ai.manage'], ['users', 'person-badge-fill', 'ผู้ใช้', 'users.manage'], ['retention', 'trash3-fill', 'ลบข้อมูล', 'retention.manage'], ['audit-logs', 'shield-lock-fill', 'บันทึก', 'audit.view'], ['settings', 'gear-fill', 'ตั้งค่า', 'settings.manage'],
];
export const STATUS = { submitted: ['warn', 'สมัครสำเร็จ รอตรวจเอกสาร'], under_review: ['info', 'กำลังตรวจสอบเอกสาร'], documents_incomplete: ['bad', 'เอกสารไม่ครบ/ต้องแก้ไข'], documents_approved: ['ok', 'เอกสารผ่านการตรวจสอบ'], approved: ['ok', 'อนุมัติการสมัคร'],
  awaiting_training: ['info', 'รอเข้ารับการอบรม'], attended: ['ok', 'เข้าอบรมแล้ว'], passed: ['ok', 'ผ่านการอบรม'], certified: ['ok', 'ได้รับใบประกาศนียบัตร'], rejected: ['bad', 'ไม่ผ่านการอนุมัติ'], cancelled: ['', 'ยกเลิก'] };
export const badge = (s) => h('span', { class: `badge ${STATUS[s]?.[0] ?? ''}` }, STATUS[s]?.[1] ?? s);
export const skeleton = (n = 4, height = '64px') => Array.from({ length: n }, () => h('div', { class: 'skel', style: { height, 'margin-bottom': '10px' } }));
export const empty = (ic, text) => h('div', { class: 'state' }, icon(ic), text);
export const failed = (err, retry) => h('div', { class: 'state' }, icon('cloud-slash'), h('p', {}, err.message), h('button', { class: 'btn btn-sm', type: 'button', style: { 'margin-top': '10px' }, onclick: retry }, 'ลองใหม่'));
export const can = (p) => me.permissions.includes(p);
export let me;

function palette() {
  const input = h('input', { type: 'search', placeholder: 'ค้นหาผู้สมัคร เลขที่ใบสมัคร หรือไปหน้า…', 'aria-label': 'ค้นหาด่วน', autocomplete: 'off' });
  const ul = h('ul', { role: 'listbox' });
  const d = h('dialog', { class: 'cmd', 'aria-label': 'ค้นหาด่วน' }, input, ul);
  document.body.append(d);
  let items = []; let sel = 0; let timer; let ctrl;
  const paint = () => {
    ul.replaceChildren(...items.map((it, i) => h('li', {}, h('a', { href: it.href, role: 'option', 'aria-selected': String(i === sel) }, icon(it.icon), it.label, it.note && h('small', {}, it.note)))), ...(items.length ? [] : [h('li', {}, empty('search', 'ไม่พบผลลัพธ์'))]));
  };
  const run = () => {
    const q = input.value.trim();
    const pages = MENU.filter((m) => can(m[3]) && m[2].includes(q)).map((m) => ({ href: `/admin/${m[0]}.html`, icon: m[1], label: m[2], note: 'ไปหน้า' }));
    items = pages; sel = 0; paint();
    clearTimeout(timer); ctrl?.abort();
    if (q.length < 2) return;
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try {
        const list = await get(`/admin/applications?pageSize=8&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        items = [...list.map((a) => ({ href: `/admin/applications.html#${a.id}`, icon: 'person-circle', label: a.fullName, note: a.applicationNo })), ...pages]; sel = 0; paint();
      } catch { /* ยกเลิกหรือเครือข่ายขัดข้อง คงรายการเดิม */ }
    }, 220);
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length); paint(); ul.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && items[sel]) { d.close(); location.href = items[sel].href; }
  });
  ul.addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => e.target === d && d.close());
  const open = () => { if (d.open || document.querySelector('dialog[open]')) return; input.value = ''; run(); d.showModal(); input.focus(); };
  addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); } });
  return open;
}

/** โครงหน้า Admin: ตรวจ session, เมนูตามสิทธิ์ คืน element สำหรับเนื้อหา */
export async function initAdmin(page) {
  try { me = await get('/admin/auth/me'); } catch (err) {
    if (err.status === 401) { location.replace(`/admin/login.html?next=${page}`); return new Promise(() => {}); }
    document.body.append(failed(err, () => location.reload()));
    throw err;
  }
  const item = MENU.find((m) => m[0] === page);
  document.body.classList.add('admin');
  const logout = async () => { await send('POST', '/admin/auth/logout').catch(() => {}); location.replace('/admin/login.html'); };
  const main = h('main', { class: 'page' });
  document.body.append(
    h('aside', { class: 'side' }, h('div', { class: 'logo' }, 'E-Training', h('img', { src: '/assets/images/leaf.svg', alt: '' })),
      h('nav', { 'aria-label': 'เมนูเจ้าหน้าที่' }, MENU.filter((m) => can(m[3])).map((m) => h('a', { href: `/admin/${m[0]}.html`, 'aria-current': m[0] === page ? 'page' : null }, icon(m[1]), m[2]))),
      h('div', { class: 'who' }, me.displayName, h('small', {}, me.role))),
    h('header', { class: 'top' }, h('h1', {}, item[2]), h('button', { class: 'kbtn', type: 'button', id: 'kbtn', 'aria-label': 'ค้นหาด่วน' }, icon('search'), h('span', {}, 'ค้นหา'), h('kbd', {}, navigator.platform.startsWith('Mac') ? '⌘K' : 'Ctrl K')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ออกจากระบบ', title: 'ออกจากระบบ', onclick: logout }, icon('box-arrow-right'))), main);
  $('.side [aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  $('#kbtn').addEventListener('click', palette());
  if (!can(item[3])) { main.append(empty('lock-fill', 'คุณไม่มีสิทธิ์เข้าหน้านี้')); return new Promise(() => {}); }
  return main;
}

/** ฟอร์มใน dialog จาก field spec; onSave โยน ApiError เพื่อแสดงข้อผิดพลาดรายช่อง */
export function formDialog({ title, fields, values = {}, onSave, submit }) {
  const inputs = {}; const errs = {};
  const body = fields.map((f) => {
    const v = values[f.name] ?? f.default ?? '';
    if (f.type === 'checkbox') { inputs[f.name] = h('input', { type: 'checkbox', checked: Boolean(v) }); return h('label', { class: 'chk wide' }, inputs[f.name], f.label); }
    const common = { class: 'input', name: f.name, required: f.required };
    inputs[f.name] = f.type === 'select' ? h('select', common, f.options.map(([ov, ol]) => h('option', { value: ov, selected: String(ov) === String(v) }, ol)))
      : f.type === 'textarea' ? h('textarea', { ...common, rows: 3, value: v }) : h('input', { ...common, type: f.type ?? 'text', value: v, min: f.min, autocomplete: f.type === 'password' ? 'new-password' : 'off' });
    errs[f.name] = h('span', { class: 'e', role: 'alert' });
    return h('label', { class: `fld ${f.wide ? 'wide' : ''}` }, h('span', {}, f.label, f.required && h('b', { class: 'e' }, ' *')), inputs[f.name], f.hint && h('small', { class: 'muted' }, f.hint), errs[f.name]);
  });
  const save = h('button', { class: `btn ${submit ? 'btn-danger' : 'btn-green'}`, type: 'submit' }, submit ?? 'บันทึก');
  const note = h('span', { class: 'fld' }, h('span', { class: 'e', role: 'alert' }));
  const d = h('dialog', { onclose: () => d.remove(), 'aria-label': title }, h('form', { class: 'dialog-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    for (const x of Object.values(errs)) x.textContent = '';
    note.firstChild.textContent = '';
    save.disabled = true;
    try {
      await onSave(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.type === 'checkbox' ? i.checked : i.value])));
      d.close();
    } catch (err) {
      for (const x of err.errors ?? []) if (errs[x.field]) errs[x.field].textContent = x.message;
      note.firstChild.textContent = err.message;
    } finally { save.disabled = false; }
  } }, h('h3', {}, title), h('div', { class: 'fgrid two' }, body), note, h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'ยกเลิก'), save)));
  document.body.append(d);
  d.showModal();
}
export function pager(meta, go) {
  const last = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  const b = (label, p, dis) => h('button', { class: 'btn btn-sm', type: 'button', disabled: dis, onclick: () => go(p) }, label);
  return h('div', { class: 'pages' }, b('ก่อนหน้า', meta.page - 1, meta.page <= 1), `${meta.page} / ${last} · ${meta.total.toLocaleString('th-TH')} รายการ`, b('ถัดไป', meta.page + 1, meta.page >= last));
}
