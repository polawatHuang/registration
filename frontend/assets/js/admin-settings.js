import { get, send } from './api.js';
import { busy, fmtDateTime, h, icon, num, toast } from './ui.js';
import { can, failed, formDialog, initAdmin, skeleton } from './admin.js';

const main = await initAdmin('settings');
const GROUPS = {
  line_login: ['person-badge', '#05a848', 'LINE Login', 'ให้ผู้สมัครเข้าสู่ระบบบนเว็บไซต์'],
  line_messaging: ['line', '#06c755', 'LINE OA (Messaging API + LIFF)', 'รับและตอบแชตลูกค้าในหน้า "แชต"'],
  email: ['envelope-fill', '#f5821f', 'อีเมล (SMTP)', 'ส่งข้อมูลการสมัครให้ผู้สมัครทันทีหลังกรอกแบบฟอร์มเสร็จ'],
  minimax: ['stars', '#6a4fc0', 'MiniMax AI', 'ผู้ให้บริการ AI เดียวของระบบ ใช้ตอบแชตและช่วยร่างคำตอบ'],
};
const SITE = [['announcement', 'ประกาศหน้าเว็บ', 'textarea'], ['payment_instructions', 'วิธีชำระค่าลงทะเบียน', 'textarea'], ['contact_phone', 'โทรศัพท์ติดต่อ'], ['contact_email', 'อีเมลติดต่อ'], ['contact_line_url', 'ลิงก์ LINE (https)']];
const LEGAL = [['controller_name', 'ชื่อผู้ควบคุมข้อมูลส่วนบุคคล (ชื่อเต็มของหน่วยงาน)'], ['controller_address', 'ที่อยู่', 'textarea'], ['controller_contact', 'โทรศัพท์/อีเมลติดต่อ'], ['dpo_contact', 'เจ้าหน้าที่คุ้มครองข้อมูล (DPO) ชื่อและช่องทาง ถ้ามี', 'textarea'],
  ['basis_main', 'ฐานกฎหมายหลักของการรับสมัครและจัดอบรม', 'select', [['', '— เลือก —'], ['contract', 'สัญญา/คำขอก่อนเข้าทำสัญญา (ม.24(3))'], ['public_task', 'ภารกิจเพื่อประโยชน์สาธารณะ/ใช้อำนาจรัฐ (ม.24(4))']]], ['recipients', 'หน่วยงานที่อาจได้รับข้อมูล เช่น มหาวิทยาลัยผู้จัด หน่วยงานกำกับ', 'textarea'],
  ['retention_applications', 'เก็บใบสมัคร/ประวัติอบรมกี่เดือน (นับจากวันอบรมเสร็จ) ตรวจกฎหมายบัญชี/ภาษีที่ต้องเก็บหลักฐานก่อน', 'number'], ['retention_documents', 'เก็บภาพบัตรและเอกสารแนบกี่เดือน (นับจากวันอบรมเสร็จ)', 'number'], ['retention_rejected', 'เก็บใบที่ไม่ผ่าน/ยกเลิก และบัญชี LINE ที่ไม่ใช้ กี่เดือน', 'number'], ['retention_chats', 'เก็บข้อความแชต LINE กี่เดือน', 'number'], ['retention_logs', 'เก็บบันทึกการใช้งานกี่วัน (ไม่น้อยกว่า 90)', 'number'],
  ['refund_policy', 'นโยบายค่าลงทะเบียน การยกเลิก เลื่อนรุ่น และคืนเงิน', 'textarea'], ['copyright_owner', 'เจ้าของลิขสิทธิ์เว็บไซต์'], ['effective_date', 'วันที่มีผลบังคับ', 'date']];
const BASIS = { contract: 'สัญญา (ม.24(3))', public_task: 'ประโยชน์สาธารณะ (ม.24(4))' };
const SOURCE = { admin: 'ตั้งจากหน้านี้', env: 'จากไฟล์ .env', unreadable: 'ถอดรหัสไม่ได้ กรุณาใส่ใหม่' };
let tab = location.hash === '#legal' ? 'legal' : can('integrations.manage') ? 'api' : 'site';

const copyRow = (label, url) => h('div', { class: 'copy' }, h('div', {}, h('small', { class: 'muted' }, label), h('code', {}, url)), h('button', { class: 'icon-btn', type: 'button', 'aria-label': `คัดลอก ${label}`, onclick: async () => { try { await navigator.clipboard.writeText(url); toast('คัดลอกแล้ว'); } catch { toast('คัดลอกไม่สำเร็จ', 'error'); } } }, icon('copy')));

function edit(key, d, done) {
  const fields = d.fields.filter((f) => f.group === key);
  formDialog({ title: `ตั้งค่า ${GROUPS[key][2]}`, values: Object.fromEntries(fields.filter((f) => !f.secret).map((f) => [f.key, f.value])),
    fields: [...fields.flatMap((f) => [
      { name: f.key, label: f.label, wide: true, ...(f.options ? { type: 'select', options: f.options } : f.secret ? { type: 'password', hint: f.isSet ? `ปัจจุบัน ${f.value} · เว้นว่าง = ไม่เปลี่ยน` : '' } : {}) },
      ...(f.isSet && f.source !== 'env' && f.secret ? [{ name: `clear:${f.key}`, label: `ลบ ${f.label} ที่บันทึกไว้`, type: 'checkbox' }] : []),
    ]), { name: 'password', label: 'ยืนยันรหัสผ่านของคุณ', type: 'password', required: true, wide: true }],
    onSave: async ({ password, ...v }) => {
      const values = {};
      for (const f of fields) {
        if (v[`clear:${f.key}`]) values[f.key] = null;
        else if (f.secret ? v[f.key] : v[f.key] !== f.value) values[f.key] = v[f.key] || null;
      }
      await send('PUT', '/admin/integrations', { password, values });
      toast('บันทึกแล้ว');
      done();
    } });
}
function card(key, d, reload) {
  const [ic, color, title, desc] = GROUPS[key];
  const fields = d.fields.filter((f) => f.group === key);
  const n = fields.filter((f) => f.isSet).length;
  const out = h('p', { class: 'testout', role: 'status' });
  return h('section', { class: 'box intg', style: { '--c': color } },
    h('header', {}, h('i', { class: `bi bi-${ic}` }), h('div', {}, h('h2', {}, title), h('p', { class: 'muted' }, desc)), h('span', { class: `badge ${n === fields.length ? 'ok' : n ? 'warn' : ''}` }, n === fields.length ? 'ครบแล้ว' : `${n}/${fields.length}`)),
    h('dl', { class: 'kv' }, fields.map((f) => h('div', {}, h('dt', {}, f.label), h('dd', { class: f.secret ? 'mono' : '' }, f.isSet ? (f.options?.find((o) => o[0] === f.value)?.[1] ?? f.value) : '— ยังไม่ตั้ง —'), f.source && h('small', { class: 'muted' }, SOURCE[f.source], f.updatedAt && ` · ${fmtDateTime(f.updatedAt)}`)))),
    key === 'line_login' && copyRow('Callback URL (ใส่ใน LINE Developers > LINE Login)', d.callbackUrl),
    key === 'line_messaging' && copyRow('Webhook URL (ใส่ใน LINE Developers > Messaging API แล้วเปิด Use webhook)', d.webhookUrl),
    h('div', { class: 'bar-actions', style: { margin: '14px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => edit(key, d, reload) }, icon('pencil-fill'), 'แก้ไข'),
      h('button', { class: 'btn', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        try { const r = await send('POST', `/admin/integrations/test/${key}`); out.className = `testout ${r.ok ? 'ok' : 'bad'}`; out.replaceChildren(icon(r.ok ? 'check-circle-fill' : 'x-circle-fill'), r.message); } catch (x) { out.className = 'testout bad'; out.replaceChildren(icon('x-circle-fill'), x.message); }
      }) }, icon('plug-fill'), 'ทดสอบ')), out, key === 'minimax' && h('small', { class: 'muted' }, 'การทดสอบใช้ token จำนวนเล็กน้อย'));
}
async function load() {
  main.replaceChildren(...skeleton(3, '150px'));
  try {
    const body = [];
    if (tab === 'api') {
      const d = await get('/admin/integrations');
      body.push(h('div', { class: 'grid3' }, Object.keys(GROUPS).map((k) => card(k, d, load))), h('p', { class: 'muted' }, icon('shield-lock-fill'), ' key ถูกเข้ารหัสก่อนบันทึก หน้านี้แสดงเพียง 4 ตัวท้าย และทุกการแก้ไขถูกบันทึกใน Audit Logs'));
    } else if (tab === 'legal') {
      const d = await get('/admin/legal');
      const v = d.fields;
      body.push(h('section', { class: 'box' }, h('div', { class: 'bar-actions' }, h('span', { class: `badge ${d.approved ? 'ok' : 'bad'}` }, d.approved ? 'เผยแพร่แล้ว' : `ฉบับร่าง${d.missing.length ? ` ขาด ${num(d.missing.length)} รายการ` : ' รออนุมัติ'}`), h('small', { class: 'muted' }, `ฉบับ ${d.version}`)),
        !d.approved && h('p', { class: 'testout bad' }, icon('exclamation-triangle-fill'), 'ก่อนเปิดรับสมัครจริง ต้องกรอกให้ครบและให้ฝ่ายกฎหมาย/DPO ตรวจ มิฉะนั้นอาจไม่เป็นไปตาม PDPA มาตรา 23'),
        h('dl', { class: 'kv' }, LEGAL.map(([k, l]) => h('div', { class: 'wide' }, h('dt', {}, l), h('dd', { style: { 'white-space': 'pre-line' } }, (k === 'basis_main' ? BASIS[v[k]] : v[k]) || '— ยังไม่ระบุ —')))),
        h('div', { class: 'bar-actions', style: { margin: '16px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => formDialog({ title: 'ข้อมูลสำหรับประกาศและเงื่อนไข', values: { ...v, approved: d.approved }, fields: [...LEGAL.map(([name, label, type, options]) => ({ name, label, type, options, wide: true, required: name !== 'dpo_contact' })), { name: 'approved', label: 'ผู้มีอำนาจตรวจและอนุมัติข้อความแล้ว ให้เผยแพร่', type: 'checkbox' }], onSave: async (x) => { await send('PUT', '/admin/legal', x); toast('บันทึกแล้ว'); load(); } }) }, icon('pencil-fill'), 'แก้ไข'), h('a', { class: 'btn', href: '/privacy.html', target: '_blank', rel: 'noopener' }, 'ดูประกาศ'), h('a', { class: 'btn', href: '/policy.html', target: '_blank', rel: 'noopener' }, 'ดูเงื่อนไข'))));
    } else {
      const v = await get('/admin/settings');
      body.push(h('section', { class: 'box' }, h('dl', { class: 'kv' }, SITE.map(([k, l]) => h('div', { class: 'wide' }, h('dt', {}, l), h('dd', { style: { 'white-space': 'pre-line' } }, v[k] || '— ยังไม่ระบุ —')))),
        h('div', { class: 'bar-actions', style: { margin: '16px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => formDialog({ title: 'ตั้งค่าเว็บไซต์', values: v, fields: SITE.map(([name, label, type]) => ({ name, label, type, wide: true })), onSave: async (x) => { await send('PUT', '/admin/settings', x); toast('บันทึกแล้ว'); load(); } }) }, icon('pencil-fill'), 'แก้ไข'))));
    }
    const tabs = [...(can('integrations.manage') ? [['api', 'API key']] : []), ['site', 'เว็บไซต์'], ['legal', 'กฎหมาย/PDPA']];
    main.replaceChildren(h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; load(); } }, l))), ...body);
  } catch (e) { main.replaceChildren(failed(e, load)); }
}
load();
