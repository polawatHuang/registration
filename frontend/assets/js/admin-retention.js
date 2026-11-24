import { api, get, send } from './api.js';
import { fmtDate, fmtDateTime, h, icon, num, toast } from './ui.js';
import { badge, empty, failed, formDialog, initAdmin, pager, skeleton } from './admin.js';

const main = await initAdmin('retention');
const KIND = {
  withdrawn: ['ถอนความยินยอม', 'ลบภาพบัตรประชาชนของผู้ที่ถอนความยินยอมข้อมูลอ่อนไหว ใบที่ยังอยู่ระหว่างตรวจจะถูกขอภาพใหม่'],
  documents: ['เอกสารครบกำหนด', 'ลบเฉพาะไฟล์แนบ ข้อมูลใบสมัครยังอยู่'],
  rejected: ['ใบที่ไม่ผ่าน/ยกเลิก', 'ลบใบสมัคร เอกสาร และข้อมูลบุคคลที่ไม่มีใบอื่นเหลือ'],
  applications: ['ใบสมัครครบกำหนด', 'ลบใบสมัคร เอกสาร และข้อมูลบุคคลที่ไม่มีใบอื่นเหลือ'],
  line_users: ['บัญชี LINE ที่ไม่ใช้', 'ลบชื่อ รูป และรหัส LINE ของผู้ที่ไม่มีใบสมัคร'],
  logs: ['บันทึกการใช้งาน', 'ลบ Audit Log ที่เกินระยะเวลาเก็บ'],
};
const REASON = { retention: 'ครบกำหนด', request: 'ตามคำขอ', withdrawal: 'ถอนความยินยอม', restore: 'ลบซ้ำหลังกู้คืน' };
let tab = 'due'; let kind = 'withdrawn'; let page = 1; let sum;
const confirmFields = [{ name: 'confirm', label: 'พิมพ์ ลบถาวร เพื่อยืนยัน', required: true, wide: true }, { name: 'password', label: 'รหัสผ่านของคุณ', type: 'password', required: true, wide: true }];

async function dueView() {
  const box = h('section', { class: 'box' });
  const cards = h('div', { class: 'kpis' }, Object.entries(KIND).map(([k, [label]], i) => h('button', { class: 'kpi', type: 'button', 'aria-pressed': String(k === kind), style: { '--c': k === kind ? '#6a4fc0' : '#35a66a', '--i': i, border: '0', 'text-align': 'left' }, onclick: () => { kind = k; page = 1; load(); } }, h('b', {}, sum.counts[k] === null ? '–' : num(sum.counts[k])), h('span', {}, label))));
  box.append(h('h2', {}, KIND[kind][0]), h('p', { class: 'muted', style: { 'margin-bottom': '12px' } }, KIND[kind][1]));
  if (sum.counts[kind] === null) { box.append(h('a', { class: 'legal-warn', href: '/admin/settings.html#legal' }, icon('exclamation-triangle-fill'), h('span', {}, 'ต้องกำหนดระยะเวลาเก็บและเผยแพร่ประกาศก่อน ระบบจึงจะคำนวณวันครบกำหนดได้'), icon('chevron-right'))); return [cards, box]; }
  const run = (ids, title) => formDialog({ title, submit: 'ลบถาวร', fields: confirmFields, onSave: async (v) => {
    const r = await send('POST', '/admin/retention/purge', { kind, ids, ...v });
    toast(`ลบแล้ว ${num(r.purged)} รายการ${r.skipped ? ` ข้าม ${num(r.skipped)} รายการที่ไม่เข้าเงื่อนไขแล้ว` : ''}`);
    page = 1; load();
  } });
  if (kind === 'logs') {
    box.append(sum.counts.logs ? h('button', { class: 'btn btn-danger', type: 'button', onclick: () => run([], `ลบบันทึก ${num(sum.counts.logs)} รายการ? กู้คืนไม่ได้`) }, icon('trash3-fill'), `ลบบันทึก ${num(sum.counts.logs)} รายการ`) : empty('check2-circle', 'ไม่มีรายการครบกำหนด'));
    return [cards, box];
  }
  const { data, meta } = await api(`/admin/retention/due/${kind}?page=${page}`);
  if (!data.length) { box.append(empty('check2-circle', 'ไม่มีรายการครบกำหนด')); return [cards, box]; }
  const checks = [];
  const btn = h('button', { class: 'btn btn-danger', type: 'button', disabled: true, onclick: () => { const ids = checks.filter((c) => c.checked).map((c) => Number(c.value)); run(ids, `${KIND[kind][0]}: ลบ ${num(ids.length)} รายการ? กู้คืนไม่ได้`); } }, icon('trash3-fill'), 'ลบรายการที่เลือก');
  const sync = () => { btn.disabled = !checks.some((c) => c.checked); };
  const all = h('input', { type: 'checkbox', onchange: () => { for (const c of checks) c.checked = all.checked; sync(); } });
  box.append(h('div', { class: 'bar-actions' }, h('label', { class: 'chk' }, all, 'เลือกทั้งหน้า'), btn),
    h('div', { class: 'list' }, data.map((a) => { const c = h('input', { type: 'checkbox', value: a.id, onchange: sync }); checks.push(c); return h('label', { class: 'lrow chkrow' }, c, h('span', { class: 'n' }, a.label), h('span', { class: 'm' }, a.sessionName ? `${a.sessionName} · ${a.universityName} · อบรมเสร็จ ${fmtDate(a.endsAt)}` : `ใช้งานล่าสุด ${a.detail ? fmtDate(a.detail) : '-'}`), a.status && badge(a.status)); })), pager(meta, (p) => { page = p; load(); }));
  return [cards, box];
}
const REQ = { pending: ['warn', 'รอพิจารณา'], approved: ['ok', 'ลบแล้ว'], rejected: ['bad', 'ปฏิเสธ'], cancelled: ['', 'ผู้สมัครยกเลิก'] };
async function requestsView() {
  const { data, meta } = await api(`/admin/retention/requests?page=${page}`);
  const decide = (r, decision) => formDialog({ title: decision === 'approved' ? `ลบข้อมูลของ ${r.application_no}? กู้คืนไม่ได้` : 'ปฏิเสธคำขอ', submit: decision === 'approved' ? 'ลบถาวร' : 'ปฏิเสธ', fields: decision === 'approved' ? confirmFields : [{ name: 'reason', label: 'เหตุผลตามกฎหมาย (ส่งให้ผู้สมัคร)', type: 'textarea', required: true, wide: true }, confirmFields[1]], onSave: async (v) => { await send('POST', `/admin/retention/requests/${r.id}/decide`, { decision, ...v }); toast('บันทึกแล้ว'); load(); } });
  const note = async (r, action) => { try { await send('POST', `/admin/retention/requests/${r.id}/notice`, { action }); toast('บันทึกแล้ว'); } catch (e) { toast(e.message, 'error'); } load(); };
  return [h('section', { class: 'box' }, h('p', { class: 'muted', style: { 'margin-bottom': '12px' } }, 'ต้องดำเนินการโดยไม่ชักช้า ไม่เกิน 90 วันนับแต่ได้รับคำขอ และแจ้งผลหรือเหตุผลให้เจ้าของข้อมูลทราบ'), data.length ? h('div', { class: 'list' }, data.map((r) => {
    const days = Math.ceil((new Date(r.due_at) - Date.now()) / 86_400_000);
    const undelivered = ['approved', 'rejected'].includes(r.status) && r.email_status !== 'sent' && !r.notified_at;
    return h('div', { class: 'lrow' }, h('span', { class: 'n' }, `${r.request_code}${r.application_no ? ` · ${r.application_no} ${r.full_name}` : ''}`), h('span', { class: `badge ${REQ[r.status][0]}` }, REQ[r.status][1]),
      h('span', { class: 'm' }, `รับคำขอ ${fmtDateTime(r.created_at)}`, r.status === 'pending' && h('b', { class: days < 14 ? 'due-soon' : '' }, ` · เหลือ ${num(days)} วัน`), r.note && ` · "${r.note}"`, r.decided_at && ` · ตัดสิน ${fmtDateTime(r.decided_at)}${r.admin_name ? ` โดย ${r.admin_name}` : ''}`, r.decision_reason && ` · เหตุผล: ${r.decision_reason}`, r.hold_at && ' · ระงับการลบอยู่'),
      undelivered && h('span', { class: 'm' }, h('span', { class: 'badge bad' }, 'ยังแจ้งผลไม่สำเร็จ'), ` ${r.email_error ?? 'รอส่งอีเมล'}`),
      (r.status === 'pending' || undelivered) && h('span', { class: 'm bar-actions', style: { margin: '6px 0 0' } }, r.status === 'pending' ? [h('button', { class: 'btn btn-sm btn-danger', type: 'button', disabled: Boolean(r.hold_at), onclick: () => decide(r, 'approved') }, 'อนุมัติและลบ'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => decide(r, 'rejected') }, 'ปฏิเสธ'), h('a', { class: 'btn btn-sm', href: `/admin/applications.html#${r.application_id}` }, 'ดูใบสมัคร')] : [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => note(r, 'retry') }, 'ส่งอีเมลอีกครั้ง'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => note(r, 'done') }, 'แจ้งทางอื่นแล้ว')]));
  })) : empty('inbox', 'ยังไม่มีคำขอ'), data.length > 0 && pager(meta, (p) => { page = p; load(); }))];
}
async function logView() {
  const { data, meta } = await api(`/admin/retention/log?page=${page}`);
  return [h('section', { class: 'box' }, h('p', { class: 'muted', style: { 'margin-bottom': '12px' } }, 'หลักฐานการลบ ไม่มีชื่อหรือเลขใบสมัคร'), data.length ? h('div', { class: 'list' }, data.map((l) => h('div', { class: 'lrow cols' }, h('span', { class: 'n' }, `${KIND[l.kind][0]}${l.item_count > 1 ? ` (${num(l.item_count)})` : ''}`), h('span', { class: 'm' }, `${REASON[l.reason]}${l.session_name ? ` · ${l.session_name}` : ''} · ${l.admin_name ?? 'ระบบ'}`), h('span', { class: 'badge' }, fmtDateTime(l.created_at))))) : empty('journal', 'ยังไม่มีการลบ'), data.length > 0 && pager(meta, (p) => { page = p; load(); }))];
}
async function load() {
  if (!sum) main.replaceChildren(...skeleton());
  try {
    sum = await get('/admin/retention/summary');
    const body = await { due: dueView, requests: requestsView, log: logView }[tab]();
    main.replaceChildren(h('div', { class: 'tabs', role: 'tablist' }, [['due', `ครบกำหนด${sum.due ? ` (${num(sum.due)})` : ''}`], ['requests', `คำขอลบ${sum.requests.pending ? ` (${num(sum.requests.pending)})` : ''}`], ['log', 'ประวัติการลบ']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; page = 1; load(); } }, l))),
      ...(sum.filesPending ? [h('p', { class: 'testout bad' }, icon('hourglass-split'), `มีไฟล์รอลบ ${num(sum.filesPending)} ไฟล์ งานตั้งเวลาจะลบซ้ำให้`)] : []), ...body);
  } catch (e) { main.replaceChildren(failed(e, load)); }
}
load();
