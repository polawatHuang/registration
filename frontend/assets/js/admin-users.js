import { get, send } from './api.js';
import { fmtDateTime, h, icon, toast } from './ui.js';
import { failed, formDialog, initAdmin, me, skeleton } from './admin.js';

const main = await initAdmin('users');
async function load() {
  main.replaceChildren(...skeleton());
  let d;
  try { d = await get('/admin/users'); } catch (e) { main.replaceChildren(failed(e, load)); return; }
  const roles = d.roles.map((r) => [r.id, r.name]);
  const edit = (u) => formDialog({ title: u ? `แก้ไข ${u.username}` : 'เพิ่มผู้ใช้', values: u ? { displayName: u.display_name, roleId: u.role_id, status: u.status } : { roleId: d.roles.at(-1).id },
    fields: [...(u ? [] : [{ name: 'username', label: 'ชื่อผู้ใช้', required: true }]), { name: 'displayName', label: 'ชื่อที่แสดง', required: true }, { name: 'roleId', label: 'บทบาท', type: 'select', options: roles }, ...(u ? [{ name: 'status', label: 'สถานะ', type: 'select', options: [['active', 'ใช้งาน'], ['disabled', 'ปิดใช้งาน']] }] : []), { name: 'password', label: u ? 'รหัสผ่านใหม่' : 'รหัสผ่าน', type: 'password', required: !u, hint: u ? 'เว้นว่าง = ไม่เปลี่ยน' : 'อย่างน้อย 12 ตัวอักษร' }],
    onSave: async (v) => { await send(u ? 'PUT' : 'POST', `/admin/users${u ? `/${u.id}` : ''}`, v); toast('บันทึกแล้ว'); load(); } });
  main.replaceChildren(h('section', { class: 'box' }, h('div', { class: 'bar-actions' }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => edit() }, icon('person-plus-fill'), 'เพิ่มผู้ใช้')),
    h('div', { class: 'list' }, d.users.map((u) => h('button', { class: 'lrow cols', type: 'button', onclick: () => edit(u) }, h('span', { class: 'n' }, `${u.display_name}${u.id === me.id ? ' (คุณ)' : ''}`), h('span', { class: 'm' }, `${u.username} · ${u.role_name} · ${u.last_login_at ? `เข้าใช้ล่าสุด ${fmtDateTime(u.last_login_at)}` : 'ยังไม่เคยเข้าใช้'}`), h('span', { class: `badge ${u.status === 'active' ? 'ok' : 'bad'}` }, u.status === 'active' ? 'ใช้งาน' : 'ปิด'))))));
}
load();
