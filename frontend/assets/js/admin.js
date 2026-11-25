import { get, send, waitForCsrf } from './api.js';
import { $, h, icon } from './ui.js';

/** หมวด → [หน้า, ไอคอน, ชื่อ, สิทธิ์, คำค้นอื่น, hash] เรียงตามความถี่ที่ใช้ */
export const GROUPS = [
  ['', [['dashboard', 'grid-1x2-fill', 'ภาพรวม', 'applicants.view', 'หน้าแรก สรุป กราฟ dashboard']]],
  ['รับสมัครและอบรม', [
    ['applications', 'people-fill', 'ผู้สมัคร', 'applicants.view', 'ใบสมัคร ตรวจเอกสาร อนุมัติ export excel'],
    ['attendance', 'qr-code-scan', 'เช็กชื่อ', 'attendance.manage', 'สแกน qr เช็กอิน เช็คอิน เช็กเอาต์ ประกาศผล'],
    ['certificates', 'award-fill', 'ใบประกาศ', 'certificates.manage', 'ใบประกาศนียบัตร certificate pdf ออกใบ'],
    ['catalog', 'ui-checks', 'หลักสูตรและรุ่น', 'catalog.manage', 'ตัวเลือกฟอร์ม มหาวิทยาลัย รุ่นอบรม ระยะเวลาเปิดร้าน ข้อ 1 ข้อ 2 ข้อ 11'],
  ]],
  ['พูดคุยกับผู้สมัคร', [
    ['chat', 'chat-dots-fill', 'แชต', 'chat.reply', 'ข้อความ ตอบลูกค้า แชท เปิดปิด ai'],
    ['notifications', 'bell-fill', 'แจ้งเตือน', 'notifications.manage', 'ส่งข้อความ ส่งกลุ่ม เตือนอบรม template ผู้รับ'],
    ['line', 'line', 'LINE OA', 'notifications.manage', 'rich menu liff เมนูไลน์ ข้อความต้อนรับ'],
  ]],
  ['ผู้ช่วย AI', [
    ['ai-knowledge', 'robot', 'คลังความรู้ AI', 'ai.manage', 'faq ถามตอบ อัปโหลดไฟล์ ทดสอบ'],
    ['ai-knowledge', 'lightning-charge-fill', 'เครดิต AI', 'ai.manage', 'minimax เครดิตหมด เติมเงิน ยอด token', 'credit'],
  ]],
  ['ดูแลระบบ', [
    ['settings', 'gear-fill', 'ตั้งค่าระบบ', 'settings.manage', 'ความพร้อม สำรองข้อมูล backup'],
    ['users', 'person-badge-fill', 'ผู้ใช้และสิทธิ์', 'users.manage', 'เจ้าหน้าที่ รหัสผ่าน admin role'],
    ['retention', 'trash3-fill', 'ลบข้อมูล (PDPA)', 'retention.manage', 'คำขอลบ ระยะเวลาเก็บ'],
    ['audit-logs', 'shield-lock-fill', 'บันทึกการใช้งาน', 'audit.view', 'audit log ประวัติ'],
  ]],
];
/** ทางลัดไปแท็บย่อย พบได้จากการค้นหา */
const SHORTCUTS = [
  ['settings', 'key-fill', 'API key: LINE, MiniMax, อีเมล', 'integrations.manage', 'smtp ไลน์ channel secret token liff', 'api'], ['settings', 'megaphone-fill', 'ช่องทางติดต่อและวิธีชำระเงิน', 'settings.manage', 'โทรศัพท์ ประกาศหน้าเว็บ', 'site'],
  ['settings', 'file-earmark-text-fill', 'กฎหมาย/PDPA', 'settings.manage', 'ประกาศความเป็นส่วนตัว นโยบาย', 'legal'], ['settings', 'clipboard2-check-fill', 'ความพร้อมและสำรองข้อมูล', 'settings.manage', 'ระบบ backup', 'system'],
  ['ai-knowledge', 'graph-up', 'รายงานและค่าใช้จ่าย AI', 'ai.manage', 'คำถามที่ตอบไม่ได้', 'report'], ['ai-knowledge', 'sliders', 'ตั้งค่า AI', 'ai.manage', 'max tokens temperature', 'settings'], ['ai-knowledge', 'chat-square-text', 'ทดสอบถาม AI', 'ai.manage', '', 'test'],
];
export const MENU = GROUPS.flatMap(([, items]) => items);
const href = (m) => `/admin/${m[0]}.html${m[5] ? `#${m[5]}` : ''}`;
const plain = (t) => t.toLowerCase().replace(/\s+/g, '');
const matches = (m, q) => plain(`${m[2]} ${m[4] ?? ''}`).includes(plain(q));
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
    const pages = [...MENU, ...(q ? SHORTCUTS : [])].filter((m) => can(m[3]) && matches(m, q)).map((m) => ({ href: href(m), icon: m[1], label: m[2], note: GROUPS.find(([, l]) => l.includes(m))?.[0] || 'ไปหน้า' }));
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

const ME_KEY = 'lst-admin-me';
const remember = (m) => { try { if (m) { const { csrfToken: _t, ...safe } = m; sessionStorage.setItem(ME_KEY, JSON.stringify(safe)); } else sessionStorage.removeItem(ME_KEY); } catch { /* โหมดส่วนตัว */ } };
const recall = () => { try { return JSON.parse(sessionStorage.getItem(ME_KEY)); } catch { return null; } };
let current;
const isHere = (m) => m[0] === current && (m[5] ? location.hash === `#${m[5]}` : !GROUPS.some(([, l]) => l.some((x) => x[0] === m[0] && x[5] && location.hash === `#${x[5]}`)));
/** เรียกเมื่อแท็บในหน้าเปลี่ยน hash ให้เมนูตามทัน */
export const markNav = () => document.querySelectorAll('[data-nav]').forEach((a) => { const m = MENU[Number(a.dataset.nav)]; if (isHere(m)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
function link(m, cls = '') {
  const a = h('a', { class: cls, href: href(m), 'data-nav': String(MENU.indexOf(m)), 'aria-current': isHere(m) ? 'page' : null }, icon(m[1]), h('span', {}, m[2]));
  // เริ่มโหลดหน้าถัดไปตั้งแต่แตะ/ชี้ ก่อนคลิกจริง
  const warm = () => { if (m[0] === current || a.dataset.warm) return; a.dataset.warm = '1'; document.head.append(h('link', { rel: 'prefetch', href: `/admin/${m[0]}.html` })); fetch('/api/v1/warm.js', { cache: 'no-store' }).catch(() => {}); };
  a.addEventListener('pointerenter', warm); a.addEventListener('touchstart', warm, { passive: true }); a.addEventListener('focus', warm);
  return a;
}
const groupsFor = () => GROUPS.map(([name, items]) => [name, items.filter((m) => can(m[3]))]).filter(([, items]) => items.length);
const OPEN_KEY = 'lst-nav-closed';
const closedGroups = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) ?? []); } catch { return new Set(); } };
function sideNav() {
  const closed = closedGroups();
  return h('nav', { class: 'full', 'aria-label': 'เมนูเจ้าหน้าที่' }, groupsFor().map(([name, items]) => {
    if (!name) return items.map((m) => link(m));
    const d = h('details', { open: !closed.has(name) || items.some(isHere) }, h('summary', {}, name, icon('chevron-down')), items.map((m) => link(m)));
    d.addEventListener('toggle', () => { const c = closedGroups(); if (d.open) c.delete(name); else c.add(name); try { localStorage.setItem(OPEN_KEY, JSON.stringify([...c])); } catch { /* ปิด storage */ } });
    return d;
  }));
}
/** มือถือ: เมนูทั้งหมดแยกหมวด พิมพ์ค้นได้ */
function openSheet() {
  const body = h('div', { class: 'ms-body' });
  const input = h('input', { class: 'input', type: 'search', placeholder: 'ค้นหาเมนู เช่น รุ่น, เครดิต, รหัสผ่าน', 'aria-label': 'ค้นหาเมนู', autocomplete: 'off' });
  const paint = () => {
    const q = input.value.trim();
    const list = q ? [['ผลการค้นหา', [...MENU, ...SHORTCUTS].filter((m) => can(m[3]) && matches(m, q))]] : groupsFor();
    body.replaceChildren(...list.map(([name, items]) => h('section', {}, name && h('h3', {}, name), items.length ? h('div', { class: 'ms-grid' }, items.map((m) => link(m, 'ms-item'))) : empty('search', 'ไม่พบเมนู'))));
  };
  input.addEventListener('input', paint);
  const d = h('dialog', { class: 'msheet', 'aria-label': 'เมนูทั้งหมด', onclose: () => d.remove(), onclick: (e) => { if (e.target === d || e.target.closest('a')) d.close(); } },
    h('div', { class: 'ms-in' }, h('header', {}, h('div', {}, h('strong', {}, me.displayName), h('small', {}, me.role)), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิดเมนู', onclick: () => d.close() }, icon('x-lg'))), input, body));
  paint();
  document.body.append(d); d.showModal(); d.querySelector('.icon-btn').focus();
}
function quickNav() {
  const order = ['dashboard', 'applications', 'attendance', 'chat', 'certificates', 'notifications', 'catalog', 'settings'];
  const quick = order.map((p) => MENU.find((m) => m[0] === p && !m[5])).filter((m) => can(m[3])).slice(0, 4);
  const here = MENU.find(isHere);
  const more = h('button', { type: 'button', class: 'more', 'aria-haspopup': 'dialog', 'aria-current': here && !quick.includes(here) ? 'page' : null, onclick: openSheet }, icon('grid-3x3-gap-fill'), h('span', {}, 'เมนูทั้งหมด'));
  return h('nav', { class: 'quick', 'aria-label': 'เมนูด่วน' }, quick.map((m) => link(m)), more);
}

/** โครงหน้า Admin: แสดงทันทีจากข้อมูลครั้งก่อน แล้วตรวจ session เบื้องหลัง (สิทธิ์จริงตรวจที่เซิร์ฟเวอร์ทุกคำขอ) */
export async function initAdmin(page) {
  current = page;
  document.body.classList.add('admin');
  const toLogin = () => { remember(null); location.replace(`/admin/login.html?next=${page}`); };
  const fetched = get('/admin/auth/me');
  waitForCsrf(fetched);
  me = recall();
  if (me) {
    fetched.then((fresh) => { const changed = JSON.stringify([fresh.id, [...fresh.permissions].sort(), fresh.displayName, fresh.role]) !== JSON.stringify([me.id, [...me.permissions].sort(), me.displayName, me.role]); remember(fresh); me = fresh; if (changed) location.reload(); }).catch((err) => { if (err.status === 401) toLogin(); });
  } else {
    const wait = h('div', { class: 'boot' }, h('div', { class: 'boot-side' }), h('main', { class: 'page' }, skeleton(4, '90px')));
    document.body.append(wait);
    for (;;) {
      try { me = await fetched.catch((e) => { if (wait.dataset.retry) return get('/admin/auth/me'); throw e; }); remember(me); break; } catch (err) {
        if (err.status === 401) { toLogin(); return new Promise(() => {}); }
        await new Promise((r) => { wait.lastChild.replaceChildren(failed(err, () => { wait.dataset.retry = '1'; wait.lastChild.replaceChildren(...skeleton(4, '90px')); r(); })); });
      }
    }
    wait.remove();
  }
  const item = MENU.find((m) => m[0] === page);
  const logout = async () => { remember(null); await send('POST', '/admin/auth/logout').catch(() => {}); location.replace('/admin/login.html'); };
  const main = h('main', { class: 'page' });
  document.body.append(
    h('aside', { class: 'side' }, h('a', { class: 'logo', href: '/admin/dashboard.html' }, 'E-Training', h('img', { src: '/assets/images/leaf.svg', alt: '' })), sideNav(), quickNav(),
      h('div', { class: 'who' }, me.displayName, h('small', {}, me.role))),
    h('header', { class: 'top' }, h('h1', {}, item[2]), h('button', { class: 'kbtn', type: 'button', id: 'kbtn', 'aria-label': 'ค้นหาด่วน' }, icon('search'), h('span', {}, 'ค้นหาเมนูหรือผู้สมัคร'), h('kbd', {}, navigator.platform.startsWith('Mac') ? '⌘K' : 'Ctrl K')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ออกจากระบบ', title: 'ออกจากระบบ', onclick: logout }, icon('box-arrow-right'))), main);
  $('.side .full [aria-current]')?.scrollIntoView({ block: 'nearest' });
  addEventListener('hashchange', markNav);
  $('#kbtn').addEventListener('click', palette());
  if (!can(item[3])) { main.append(empty('lock-fill', 'คุณไม่มีสิทธิ์เข้าหน้านี้')); return new Promise(() => {}); }
  main.append(...skeleton(3, '110px'));
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
      : f.type === 'textarea' ? h('textarea', { ...common, rows: 3, value: v }) : h('input', { ...common, type: f.type ?? 'text', value: v, min: f.min, step: f.step, placeholder: f.placeholder, autocomplete: f.type === 'password' ? 'new-password' : 'off' });
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
