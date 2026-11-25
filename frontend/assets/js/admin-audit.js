import { api } from './api.js';
import { fmtDateTime, h } from './ui.js';
import { empty, failed, initAdmin, pager, skeleton } from './admin.js';

const main = await initAdmin('audit-logs');
const TYPES = [['', 'ทุกกิจกรรม'], ['auth.', 'เข้า/ออกระบบ'], ['application.', 'ใบสมัคร'], ['document.', 'เอกสาร'], ['line.', 'LINE'], ['session.', 'รุ่นอบรม'], ['university.', 'มหาวิทยาลัย'], ['option.', 'ตัวเลือก'], ['user.', 'ผู้ใช้'], ['settings.', 'ตั้งค่า'], ['integration.', 'API key'], ['email.', 'อีเมล'], ['knowledge.', 'คลังความรู้ AI'], ['legal.', 'กฎหมาย'], ['consent.', 'ความยินยอม'], ['retention.', 'ลบข้อมูล'], ['erasure.', 'คำขอลบ'], ['chat.', 'แชต'], ['notification.', 'แจ้งเตือน']];
let page = 1;
const list = h('div', { class: 'list' }); const foot = h('div', {});
const type = h('select', { class: 'input', 'aria-label': 'ประเภทกิจกรรม', onchange: () => { page = 1; load(); } }, TYPES.map(([v, l]) => h('option', { value: v }, l)));
main.replaceChildren(h('section', { class: 'box' }, h('div', { class: 'filters' }, type), list, foot));
async function load() {
  list.replaceChildren(...skeleton(6)); foot.replaceChildren();
  try {
    const { data, meta } = await api(`/admin/audit-logs?page=${page}&pageSize=25&action=${type.value}`);
    list.replaceChildren(...(data.length ? data.map((l) => h('div', { class: 'lrow cols' }, h('span', { class: 'n' }, l.action), h('span', { class: 'm' }, `${l.admin_name ?? { applicant: 'ผู้สมัคร', system: 'ระบบ' }[l.actor_type] ?? 'ไม่ทราบผู้ใช้'}${l.entity_type ? ` · ${l.entity_type} #${l.entity_id ?? '-'}` : ''} · ${l.ip_address ?? '-'}`), h('span', { class: 'badge' }, fmtDateTime(l.created_at)))) : [empty('shield-check', 'ยังไม่มีบันทึก')]));
    foot.replaceChildren(pager(meta, (p) => { page = p; load(); }));
  } catch (e) { list.replaceChildren(failed(e, load)); }
}
load();
