import { get, send, upload } from './api.js';
import { $, busy, confirmDialog, fmtDate, fmtDateTime, fmtRange, fmtTime, h, icon, toast } from './ui.js';
import { celebrate, floatingLeaves, parallax } from './fx.js';
import { initShell, lineButton } from './shell.js';
import { prepareFile } from './files.js';
import { nidInput, toDigits } from './thai-id.js';
import { savePass } from './pass.js';

const root = $('#app');
const NODE = ['send-check-fill', 'hourglass-split', 'file-earmark-text-fill', 'patch-check-fill', 'hand-thumbs-up-fill', 'calendar-heart-fill', 'person-check-fill', 'trophy-fill', 'award-fill'];
const TONE = { documents_incomplete: 'bad', rejected: 'bad', cancelled: 'bad', submitted: 'warn', under_review: 'info' };
const DOC = { approved: ['ok', 'ผ่าน'], rejected: ['bad', 'ต้องแก้ไข'], pending: ['warn', 'รอตรวจ'] };
let shell;

function accessForm({ title, hint, endpoint, after }) {
  const nidBox = h('div', { class: 'nid', role: 'group', 'aria-label': 'เลขประจำตัวประชาชน 13 หลัก' });
  const nid = nidInput(nidBox);
  const no = h('input', { class: 'input', id: 'ano', placeholder: 'ETxx-xxxxxxxx', autocapitalize: 'characters', autocomplete: 'off', required: true });
  const mobile = h('input', { class: 'input', id: 'amb', type: 'tel', inputMode: 'tel', autocomplete: 'tel-national', required: true });
  const err = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn btn-green', type: 'submit', style: { 'margin-top': '16px', width: '100%' } }, icon('search'), 'ตรวจสอบ');
  return h('form', { novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!no.value.trim() || nid.value.length !== 13 || toDigits(mobile.value).length !== 10) { err.textContent = 'กรุณากรอกข้อมูลให้ครบทั้ง 3 ช่อง'; return; }
    busy(btn, async () => {
      try { await after(await send('POST', endpoint, { applicationNo: no.value, nationalId: nid.value, mobile: mobile.value })); } catch (x) { err.textContent = x.errors?.[0]?.message ?? x.message; }
    });
  } }, h('h2', {}, title), h('p', { class: 'muted' }, hint),
  h('div', { class: 'field' }, h('label', { htmlFor: 'ano' }, 'เลขที่ใบสมัคร'), no), h('div', { class: 'field' }, h('span', {}, 'เลขประจำตัวประชาชน'), nidBox), h('div', { class: 'field' }, h('label', { htmlFor: 'amb' }, 'หมายเลขมือถือที่ใช้สมัคร'), mobile, err), btn);
}

function entry() {
  root.replaceChildren(h('div', { class: `entry ${shell.session.lineLoginEnabled ? '' : 'one'}` },
    shell.session.lineLoginEnabled && h('section', { class: 'panel' }, h('h2', {}, 'เข้าด้วย LINE'), h('p', { class: 'muted' }, 'เห็นใบสมัครทั้งหมดของคุณทันที'), h('div', { style: { margin: '22px 0' } }, lineButton()),
      h('div', { class: 'notice info' }, icon('shield-check'), 'ระบบจะผูก LINE กับข้อมูลบุคคลหลังเจ้าหน้าที่ตรวจเอกสารผ่านแล้วเท่านั้น')),
    h('section', { class: 'panel' }, accessForm({ title: 'ใช้เลขที่ใบสมัคร', hint: 'กรอกข้อมูลเดียวกับที่ใช้สมัคร', endpoint: '/applications/access', after: load }))));
}

/** ก้าวถัดไปของผู้สมัคร: ทุกสถานะตอบได้ว่า "ตอนนี้ต้องทำอะไร" */
const NEXT = {
  submitted: ['hourglass-split', 'เมล็ดของคุณลงดินแล้ว', 'เจ้าหน้าที่จะตรวจเอกสารต่อจากนี้ ยังไม่ต้องทำอะไรเพิ่ม'],
  under_review: ['search', 'กำลังตรวจเอกสาร', 'เจ้าหน้าที่กำลังดูเอกสารของคุณ กลับมาดูผลได้ที่หน้านี้'],
  documents_incomplete: ['cloud-arrow-up-fill', 'ต้นกล้าต้องการน้ำอีกนิด', 'ส่งเอกสารที่มีปุ่ม "ส่งใหม่" ให้ครบ แล้วระบบจะส่งตรวจต่อทันที'],
  documents_approved: ['patch-check-fill', 'เอกสารผ่านแล้ว!', 'รอเจ้าหน้าที่อนุมัติการสมัครเป็นขั้นสุดท้าย'],
  approved: ['stars', 'คุณได้รับการอนุมัติ!', 'เตรียมตัวให้พร้อม ดูวัน เวลา และสถานที่ในหน้านี้'],
  awaiting_training: ['calendar-heart-fill', 'ใกล้วันเก็บเกี่ยวแล้ว', 'มาให้ตรงเวลาและนำบัตรประชาชนตัวจริงมาด้วย'],
  attended: ['person-check-fill', 'เข้าอบรมเรียบร้อย', 'รอประกาศผลการอบรม'],
  passed: ['trophy-fill', 'คุณผ่านการอบรม!', 'กำลังจัดทำใบประกาศนียบัตร'],
  certified: ['award-fill', 'ดอกไม้บานแล้ว', 'ยินดีด้วย คุณได้รับใบประกาศนียบัตร'],
};
function nextCard(a) {
  const n = NEXT[a.status];
  return n && h('div', { class: `next ${a.timeline.attention ? 'attn' : ''}` }, icon(n[0]), h('div', {}, h('strong', {}, n[1]), h('span', {}, n[2])));
}
/** ฉลองเมื่อสถานะขยับขึ้นจากครั้งก่อน เก็บแค่เลขขั้นในเครื่อง ไม่มีข้อมูลส่วนบุคคล */
function milestone(list) {
  for (const a of list) {
    const step = a.timeline.current;
    try {
      const key = `lst-step-${a.id}`;
      const seen = Number(localStorage.getItem(key));
      if (step) localStorage.setItem(key, step);
      if (step && seen && step > seen) { celebrate(); toast(`ต้นกล้าของคุณโตขึ้นอีกขั้น: ${a.timeline.steps[step - 1]}`); }
    } catch { /* โหมดส่วนตัวปิด storage */ }
  }
}

function vine(a) {
  const { steps, current, attention } = a.timeline;
  return h('ol', { class: 'vine', 'aria-label': 'ขั้นตอนการสมัคร' }, steps.map((s, i) => {
    const state = current && i + 1 < current ? 'on' : i + 1 === current ? `on now${attention ? ' attn' : ''}` : '';
    return h('li', { class: state, style: { '--i': i }, 'aria-current': i + 1 === current ? 'step' : null }, h('span', { class: 'node' }, current && i + 1 <= current ? icon(NODE[i]) : String(i + 1)), s);
  }));
}

function docLine(a, d) {
  const [tone, label] = DOC[d.status];
  const input = h('input', { type: 'file', class: 'sr', id: `r-${a.id}-${d.type}`, accept: d.type === 'portrait_photo' ? '.jpg,.jpeg,.png' : '.jpg,.jpeg,.png,.pdf' });
  const btn = h('label', { class: 'btn btn-purple btn-sm', htmlFor: input.id }, icon('upload'), 'ส่งใหม่');
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    const r = await prepareFile(input.files[0], d.type, shell.site?.maxUploadMb ?? 5);
    input.value = '';
    if (r.error) { toast(r.error, 'error'); return; }
    const fd = new FormData();
    fd.append(d.type, r.file, r.file.name);
    btn.replaceChildren(h('span', { class: 'spin' }), 'กำลังส่ง');
    try {
      const updated = await upload(`/applications/me/${a.id}/documents`, fd);
      toast(updated.status === 'under_review' ? 'ส่งเอกสารครบแล้ว รอเจ้าหน้าที่ตรวจ' : 'ส่งเอกสารแล้ว');
      if (updated.status === 'under_review') celebrate();
    } catch (e) { toast(e.message, 'error'); }
    load();
  });
  return h('div', { class: 'docline' }, h('div', { class: 'g' }, d.label, d.status === 'rejected' && h('small', {}, d.reason)), h('span', { class: `badge ${tone}` }, label), d.canReplace && [input, btn]);
}

function appPanel(a) {
  const days = Math.ceil((new Date(a.startsAt) - Date.now()) / 86_400_000);
  return h('section', { class: 'panel' },
    h('div', { class: 'app-head' }, h('div', {}, h('div', { class: 'no' }, a.applicationNo), h('div', {}, `${a.fullName} · สมัครเมื่อ ${fmtDateTime(a.submittedAt)}`)), h('span', { class: `badge ${TONE[a.status] ?? 'ok'}` }, a.statusLabel)),
    a.statusReason && h('div', { class: 'notice', role: 'alert' }, icon('exclamation-circle-fill'), h('span', {}, a.statusReason)),
    nextCard(a),
    h('div', { class: `app-grid ${a.timeline.attention ? 'attn' : ''}` },
      a.timeline.stopped ? h('div', { class: 'state' }, icon('x-octagon'), 'ใบสมัครนี้สิ้นสุดแล้ว') : vine(a),
      h('div', {},
        h('div', { class: 'sched' }, !a.timeline.stopped && days > 0 && h('div', { class: 'count' }, h('b', {}, String(days)), 'วัน ก่อนเริ่มอบรม'),
          h('div', {}, icon('mortarboard-fill'), h('span', {}, a.courseName)), h('div', {}, icon('bank2'), h('span', {}, `${a.universityName} · ${a.sessionName}`)),
          h('div', {}, icon('calendar-event-fill'), h('span', {}, `${fmtRange(a.startsAt, a.endsAt)} เวลา ${fmtTime(a.startsAt)}–${fmtTime(a.endsAt)} น.`)),
          a.location && h('div', {}, icon('geo-alt-fill'), h('span', {}, a.location, a.mapUrl && [' ', h('a', { href: a.mapUrl, target: '_blank', rel: 'noopener' }, 'เปิดแผนที่')])),
          a.details && h('div', {}, icon('info-circle-fill'), h('span', { style: { 'white-space': 'pre-line' } }, a.details))),
        h('h3', {}, 'เอกสาร'), a.documents.map((d) => docLine(a, d)),
        a.erasure && h('div', { class: 'withdraw' }, h('span', {}, a.erasure.status === 'pending' ? `คำขอลบข้อมูล ${a.erasure.code} อยู่ระหว่างพิจารณา ภายใน ${fmtDate(a.erasure.dueAt)}` : `คำขอลบข้อมูล ${a.erasure.code} ไม่สามารถดำเนินการได้: ${a.erasure.reason ?? ''}`),
          a.erasure.status === 'pending' && h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await send('POST', `/applications/me/${a.id}/erasure-request/cancel`); toast('ยกเลิกคำขอแล้ว'); } catch (e) { toast(e.message, 'error'); } load(); } }, 'ยกเลิกคำขอ')),
        a.canWithdrawSensitive && h('div', { class: 'withdraw' }, h('span', {}, 'คุณให้ความยินยอมเก็บข้อมูลอ่อนไหวในภาพบัตรไว้'), h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
          if (!(await confirmDialog({ title: 'ถอนความยินยอม?', text: 'เจ้าหน้าที่จะได้รับแจ้งและอาจขอภาพบัตรที่ปิดทับข้อมูลแล้ว ไม่กระทบสิ่งที่ทำไปก่อนถอน', confirm: 'ถอนความยินยอม' }))) return;
          try { await send('POST', `/applications/me/${a.id}/withdraw-consent`); toast('ถอนความยินยอมแล้ว'); } catch (e) { toast(e.message, 'error'); }
          load();
        } }, 'ถอนความยินยอม')),
        h('button', { class: 'btn btn-sm', type: 'button', style: { 'margin-top': '14px' }, onclick: () => savePass(a).catch(() => toast('บันทึกรูปไม่สำเร็จ', 'error')) }, icon('download'), 'บันทึกบัตรผู้สมัคร'),
        a.erasure?.status !== 'pending' && h('button', { class: 'btn btn-sm', type: 'button', style: { margin: '14px 0 0 8px' }, onclick: async () => {
          const note = await confirmDialog({ title: 'ขอลบข้อมูลของฉัน?', text: 'หากอนุมัติ ใบสมัครและเอกสารจะถูกลบถาวร คุณจะเสียสิทธิ์ในรุ่นนี้และเข้าหน้านี้ไม่ได้อีก ผลจะแจ้งทางอีเมล', confirm: 'ส่งคำขอ', danger: true, reason: true, placeholder: 'เหตุผลที่ขอลบ' });
          if (!note) return;
          try { await send('POST', `/applications/me/${a.id}/erasure-request`, { note }); toast('ส่งคำขอแล้ว'); } catch (e) { toast(e.message, 'error'); }
          load();
        } }, icon('trash3'), 'ขอลบข้อมูล'))));
}

async function load() {
  try {
    shell.session = await get('/auth/session');
    if (!shell.session.authenticated) { entry(); return; }
    const list = await get('/applications/me/status');
    const claim = shell.session.line && h('details', { class: 'panel' }, h('summary', { style: { cursor: 'pointer', 'font-weight': '600' } }, 'เพิ่มใบสมัครที่สมัครไว้ก่อนหน้าเข้าบัญชี LINE นี้'),
      accessForm({ title: '', hint: 'ยืนยันด้วยข้อมูลที่ใช้สมัคร', endpoint: '/line/link-account', after: async () => { toast('เพิ่มใบสมัครแล้ว'); await load(); } }));
    milestone(list);
    root.replaceChildren(...(shell.session.line ? [h('p', { class: 'hello' }, `สวัสดีคุณ ${shell.session.line.displayName ?? ''} `, shell.session.line.accountLinked && h('span', { class: 'badge ok' }, icon('shield-fill-check'), 'ยืนยันตัวตนแล้ว'))] : []), ...(list.length ? list.map(appPanel) : [h('section', { class: 'panel state' }, icon('flower1'), h('h2', {}, 'ยังไม่มีใบสมัคร'), h('p', {}, 'เริ่มปลูกเมล็ดแรกของคุณ'), h('a', { class: 'btn btn-green', href: '/', style: { 'margin-top': '14px' } }, 'สมัครอบรม'))]),
      ...(claim ? [claim] : []),
      ...(!shell.session.line ? [h('div', { class: 'actions' }, shell.session.lineLoginEnabled && lineButton('เชื่อมใบสมัครนี้กับ LINE'), h('button', { class: 'btn', type: 'button', onclick: async () => { await send('POST', '/auth/logout').catch(() => {}); load(); } }, 'ดูใบสมัครอื่น'))] : []));
  } catch (e) {
    root.replaceChildren(h('section', { class: 'panel state' }, icon('cloud-slash'), h('p', {}, e.message), h('button', { class: 'btn btn-green', type: 'button', style: { 'margin-top': '14px' }, onclick: load }, 'ลองใหม่')));
  }
}
floatingLeaves(10);
parallax('[data-depth]');
shell = await initShell('track');
load();
