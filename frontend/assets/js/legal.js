import { get } from './api.js';
import { $, $$, fmtDate, h, icon } from './ui.js';
import { floatingLeaves } from './fx.js';
import { initShell } from './shell.js';

const BASIS = { contract: 'ความจำเป็นเพื่อปฏิบัติตามสัญญาหรือดำเนินการตามคำขอก่อนเข้าทำสัญญา (มาตรา 24 (3))', public_task: 'ความจำเป็นเพื่อปฏิบัติภารกิจเพื่อประโยชน์สาธารณะหรือใช้อำนาจรัฐที่ได้รับมอบ (มาตรา 24 (4))' };
floatingLeaves(8);
initShell('');
try {
  const { fields, approved, version } = await get('/catalog/legal');
  const period = (n) => n && (n % 12 === 0 ? `${n / 12} ปี` : `${n} เดือน`);
  const value = { ...fields, version, retention_applications: period(fields.retention_applications), retention_documents: period(fields.retention_documents), retention_rejected: period(fields.retention_rejected), retention_chats: period(fields.retention_chats), retention_logs: fields.retention_logs && `${fields.retention_logs} วัน`, basis_text: BASIS[fields.basis_main], dpo_contact: fields.dpo_contact ?? (approved && 'ไม่มีการแต่งตั้ง ติดต่อผู้ควบคุมข้อมูลตามช่องทางข้างต้น'), effective_date: fields.effective_date && fmtDate(`${fields.effective_date}T05:00:00Z`) };
  for (const el of $$('[data-legal]')) { el.textContent = value[el.dataset.legal] || 'รอหน่วยงานระบุ'; el.classList.toggle('todo', !value[el.dataset.legal]); }
  if (!approved) $('#legalState').replaceChildren(h('div', { class: 'notice', role: 'note' }, icon('exclamation-triangle-fill'), h('span', {}, 'ฉบับร่าง อยู่ระหว่างการตรวจและอนุมัติ ยังไม่ใช่ฉบับที่มีผลบังคับ')));
} catch {
  $('#legalState').replaceChildren(h('div', { class: 'notice', role: 'alert' }, icon('cloud-slash'), h('span', {}, 'โหลดข้อมูลบางส่วนไม่สำเร็จ กรุณารีเฟรชหน้า')));
}
