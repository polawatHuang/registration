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
const asked = location.hash.slice(1);
let tab = ['system', 'site', 'legal', ...(can('integrations.manage') ? ['api'] : [])].includes(asked) ? asked : can('integrations.manage') ? 'api' : 'system';
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);
const JOB = { purgeFiles: 'ลบไฟล์ค้าง', chat: 'แชต', notifications: 'แจ้งเตือน', emails: 'อีเมล', backup: 'สำรองข้อมูล', cleanup: 'ล้าง session' };
function systemView(d) {
  const pct = Math.round((d.required.ok / d.required.total) * 100);
  const row = (i) => h(i.href && !i.ok ? 'a' : 'div', { class: `ckrow ${i.ok ? 'ok' : i.level === 'required' ? 'bad' : 'wait'}`, href: i.href && !i.ok ? i.href : null }, icon(i.ok ? 'check-circle-fill' : i.level === 'required' ? 'x-circle-fill' : 'dash-circle-fill'), h('div', {}, h('b', {}, i.label), h('small', {}, i.hint)), i.href && !i.ok && icon('chevron-right'));
  const group = (level) => d.items.filter((i) => i.level === level).sort((a, b) => a.ok - b.ok).map(row);
  const b = d.backup;
  return [h('section', { class: `ready-hero ${d.ready ? 'on' : ''}` }, h('div', { class: 'counter', style: { '--p': `${pct}%` } }, h('b', {}, `${pct}%`), h('small', {}, 'พร้อม')), h('div', {}, h('h2', {}, d.ready ? 'พร้อมเปิดรับสมัคร' : `เหลืออีก ${num(d.required.total - d.required.ok)} รายการก่อนเปิดรับสมัคร`), h('p', {}, `จำเป็น ${num(d.required.ok)}/${num(d.required.total)} · แนะนำ ${num(d.recommended.ok)}/${num(d.recommended.total)}`))),
    h('section', { class: 'box' }, h('h2', {}, 'ต้องมีก่อนเปิดรับสมัคร'), h('div', { class: 'ckgrid two' }, group('required'))), h('section', { class: 'box' }, h('h2', {}, 'แนะนำ เปิดทีหลังได้'), h('div', { class: 'ckgrid two' }, group('recommended'))),
    h('section', { class: 'box' }, h('h2', {}, 'สำรองฐานข้อมูล'), h('dl', { class: 'kv' }, h('div', {}, h('dt', {}, 'อัตโนมัติ'), h('dd', {}, b.auto ? `ทุกวันหลัง ${String(b.hour).padStart(2, '0')}:00 น.` : 'ปิด')), h('div', {}, h('dt', {}, 'สำเร็จล่าสุด'), h('dd', {}, b.last?.okAt ? `${fmtDateTime(b.last.okAt)} · ${num(b.last.rows)} แถว · ${size(b.last.bytes)}` : '— ยังไม่มี —')), h('div', {}, h('dt', {}, 'ไฟล์ที่เก็บไว้'), h('dd', {}, `${num(b.files)} จาก ${num(b.keep)} · รวม ${size(b.bytes)}`)), h('div', {}, h('dt', {}, 'ครั้งล่าสุด'), h('dd', {}, b.last ? (b.last.ok ? 'สำเร็จ' : `ล้มเหลว (${b.last.error}) ${fmtDateTime(b.last.at)}`) : '—'))),
      h('p', { class: 'notice-sm', style: { 'margin-top': '14px' } }, icon('shield-lock-fill'), 'ไฟล์เข้ารหัสอยู่ในเครื่องเดียวกับเว็บ ต้องดาวน์โหลดไฟล์ใน storage และกุญแจใน .env ไปเก็บคนละที่ด้วย'),
      can('integrations.manage') && h('div', { class: 'bar-actions', style: { margin: '14px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { try { const r = await send('POST', '/admin/system/backup'); toast(`สำรองแล้ว ${num(r.rows)} แถว`); load(); } catch (x) { toast(x.message, 'error'); } }) }, icon('database-fill-down'), 'สำรองตอนนี้'))),
    h('section', { class: 'box' }, h('h2', {}, 'งานตั้งเวลา'), h('dl', { class: 'kv' }, d.jobs.map((j) => h('div', {}, h('dt', {}, JOB[j.name] ?? j.name), h('dd', {}, j.at ? fmtDateTime(j.at) : 'ยังไม่เคยเสร็จ')))), h('small', { class: 'muted' }, `Node ${d.node} · ฐานข้อมูล ${d.database}`))];
}

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
    } else if (tab === 'system') {
      body.push(...systemView(await get('/admin/system')));
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
    const tabs = [['system', 'ระบบ'], ...(can('integrations.manage') ? [['api', 'API key']] : []), ['site', 'เว็บไซต์'], ['legal', 'กฎหมาย/PDPA']];
    main.replaceChildren(h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; history.replaceState(null, '', `#${k}`); load(); } }, l))), ...body);
  } catch (e) { main.replaceChildren(failed(e, load)); }
}
load();
addEventListener('hashchange', () => { const t = location.hash.slice(1); if (['system', 'site', 'legal', ...(can('integrations.manage') ? ['api'] : [])].includes(t) && t !== tab) { tab = t; load(); } });
