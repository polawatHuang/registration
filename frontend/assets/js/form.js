import { get, upload } from './api.js';
import { $, $$, confirmDialog, fmtRange, h, icon, num, toast } from './ui.js';
import { celebrate, floatingLeaves, parallax } from './fx.js';
import { initShell, lineButton } from './shell.js';
import { prepareFile } from './files.js';
import { nidInput, toDigits, validThaiId } from './thai-id.js';
import { passCard, savePass } from './pass.js';

const DOCS = [
  ['id_card', 13, 'ภาพถ่ายบัตรประจำตัวประชาชน', '(ปิดทับศาสนาและหมู่โลหิตก่อนถ่าย)'], ['previous_certificate', 14, 'ภาพถ่ายประกาศนียบัตรเดิม', '(กรณีเคยผ่านการอบรม)'],
  ['payment_slip', 15, 'สลิปใบโอนเงินค่าลงทะเบียนอบรม', ''], ['portrait_photo', 16, 'ภาพถ่ายหน้าตรง สี ขนาด 3 นิ้ว', '(สำหรับจัดทำประกาศนียบัตร)'],
];
const form = $('#form');
const files = {};
const errors = new Map();
let site; let sessions = []; let dirty = false; let sending = false;
const idempotencyKey = crypto.randomUUID();
const val = (n) => (form.elements[n]?.value ?? '').trim();
const zip = (v) => /(?:^|\D)[1-9]\d{4}(?:\D|$)/.test(v.replace(/[๐-๙]/g, (d) => d.charCodeAt(0) - 0x0e50));
const nid = nidInput($('#nid'), (v) => { dirty = true; if (v.length === 13) check('nationalId'); else setError('nationalId', ''); progress(); });

const RULES = {
  universityId: () => !val('universityId') && 'กรุณาเลือกมหาวิทยาลัย',
  sessionId: () => !val('sessionId') && 'กรุณาเลือกรุ่นและช่วงเวลา',
  fullName: () => !/\S\s+\S/.test(val('fullName')) && 'กรุณากรอกทั้งชื่อและนามสกุล',
  nationalId: () => !(/^[1-8]/.test(nid.value) && validThaiId(nid.value)) && 'เลขประจำตัวประชาชนไม่ถูกต้อง',
  address: () => (val('address').length < 10 ? 'กรุณากรอกที่อยู่' : !zip(val('address')) && 'กรุณาระบุรหัสไปรษณีย์ 5 หลัก'),
  mobile: () => !/^0[689]\d{8}$/.test(toDigits(val('mobile'))) && 'หมายเลขมือถือต้องเป็น 10 หลัก ขึ้นต้นด้วย 06, 08 หรือ 09',
  email: () => !/^\S+@\S+\.\S{2,}$/.test(val('email')) && 'อีเมลไม่ถูกต้อง',
  shopName: () => !val('shopName') && 'กรุณากรอกชื่อร้านค้า',
  shopAddress: () => val('shopAddress').length < 5 && 'กรุณากรอกที่ตั้งร้านค้า',
  shopDurationId: () => !val('shopDurationId') && 'กรุณาเลือก',
  hasTrainedBefore: () => !val('hasTrainedBefore') && 'กรุณาเลือก',
  receiptName: () => !val('receiptName') && 'กรุณากรอกชื่อ',
  receiptAddress: () => (val('receiptAddress').length < 10 ? 'กรุณากรอกที่อยู่' : !zip(val('receiptAddress')) && 'กรุณาระบุรหัสไปรษณีย์ 5 หลัก'),
  taxId: () => val('taxId') && !validThaiId(toDigits(val('taxId'))) && 'เลขผู้เสียภาษีต้องเป็น 13 หลักที่ถูกต้อง',
  id_card: () => !files.id_card && 'กรุณาแนบไฟล์',
  previous_certificate: () => val('hasTrainedBefore') === 'yes' && !files.previous_certificate && 'กรุณาแนบไฟล์',
  payment_slip: () => !files.payment_slip && 'กรุณาแนบไฟล์',
  portrait_photo: () => !files.portrait_photo && 'กรุณาแนบไฟล์',
};
const STEP1 = ['universityId', 'sessionId', 'fullName', 'nationalId', 'address', 'mobile', 'email'];
const holder = (name) => $(`[data-field="${name}"]`);

function setError(name, message, ok = false) {
  const el = holder(name);
  if (!el) return;
  let e = $('.err', el);
  if (!e) el.append(e = h('div', { class: 'err', id: `err-${name}`, role: 'alert' }));
  if (e.textContent !== (message || '')) e.textContent = message || '';
  el.classList.toggle('bad', Boolean(message));
  if (!el.classList.contains('doc')) el.classList.toggle('ok', ok && !message);
  const input = form.elements[name];
  if (input instanceof HTMLElement) { input.setAttribute('aria-invalid', String(Boolean(message))); input.setAttribute('aria-describedby', `err-${name}`); }
  if (message) errors.set(name, message); else errors.delete(name);
}
function check(name) {
  const m = RULES[name]?.() || '';
  setError(name, m, true);
  return !m;
}
function progress() {
  const names = Object.keys(RULES).filter((n) => n !== 'taxId' && (n !== 'previous_certificate' || val('hasTrainedBefore') === 'yes'));
  const p = names.filter((n) => !RULES[n]()).length / names.length;
  const s = $('#sprout');
  s.style.setProperty('--p', p);
  $('span', s).textContent = `${Math.round(p * 100)}%`;
  for (const c of $$('[data-card]')) c.classList.toggle('done', $$('[data-field]', c).every((f) => !RULES[f.dataset.field]?.()));
}
function focusFirst(names) {
  const first = names.find((n) => errors.has(n));
  if (!first) return;
  holder(first).scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (first === 'nationalId') nid.focus(); else $('input,select,textarea', holder(first))?.focus({ preventScroll: true });
}
function showStep(n) {
  document.querySelector('.toasts')?.replaceChildren();
  const swap = () => { $('#step1').hidden = n !== 1; $('#step2').hidden = n !== 2; $('#shopArt').hidden = n !== 2; scrollTo({ top: 0, behavior: 'instant' }); };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap); else swap();
}
function validate(names) {
  const bad = names.filter((n) => !check(n));
  if (bad.length) { toast(`กรุณาตรวจสอบข้อมูล ${bad.length} รายการ`, 'error'); focusFirst(bad); }
  return !bad.length;
}

// ---------- เอกสาร ----------
function docCard([type, no, title, note]) {
  const pic = h('div', { class: 'pic' }, h('img', { src: `/assets/images/doc-${type}.svg`, alt: '' }));
  const name = h('div', { class: 'name' });
  const input = h('input', { type: 'file', id: `f-${type}`, accept: type === 'portrait_photo' ? '.jpg,.jpeg,.png' : '.jpg,.jpeg,.png,.pdf', onchange: () => input.files[0] && take(input.files[0]) });
  const btn = h('label', { class: 'btn btn-purple btn-sm', htmlFor: `f-${type}` }, icon('upload'), 'อัปโหลดไฟล์');
  const card = h('div', { class: 'doc', 'data-field': type }, h('b', {}, String(no)), pic,
    h('div', { class: 't' }, title, ' ', h('span', { class: 'req' }, '*'), note && h('small', {}, note)), name, input, btn);
  let url;
  async function take(file) {
    dirty = true;
    const r = await prepareFile(file, type, site?.maxUploadMb ?? 5);
    input.value = '';
    if (r.error) { setError(type, r.error); return; }
    files[type] = r.file;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(r.file);
    pic.replaceChildren(r.file.type === 'application/pdf' ? h('i', { class: 'bi bi-file-earmark-pdf-fill pdf' }) : h('img', { src: url, alt: `ตัวอย่าง${title}` }));
    pic.className = 'pic file';
    requestAnimationFrame(() => pic.classList.add('scan'));
    name.textContent = `${r.file.name} · ${(r.file.size / 1048576).toFixed(1)} MB`;
    btn.replaceChildren(icon('arrow-repeat'), 'เปลี่ยนไฟล์');
    card.classList.add('ok');
    setError(type, '');
    progress();
  }
  for (const ev of ['dragover', 'dragleave', 'drop']) card.addEventListener(ev, (e) => {
    e.preventDefault();
    card.classList.toggle('drag', ev === 'dragover');
    if (ev === 'drop' && e.dataTransfer.files[0]) take(e.dataTransfer.files[0]);
  });
  return card;
}
$('#docs').append(...DOCS.map(docCard));
for (const ev of ['dragover', 'drop']) addEventListener(ev, (e) => e.preventDefault()); // วางไฟล์พลาดแล้วหน้าไม่หาย
const syncCert = () => holder('previous_certificate').classList.toggle('off', val('hasTrainedBefore') === 'no');

// ---------- ตัวเลือก ----------
const fillSelect = (sel, first, items) => sel.replaceChildren(h('option', { value: '' }, first), ...items);
async function loadUniversities() {
  const sel = form.elements.universityId;
  try {
    const list = await get('/catalog/universities');
    fillSelect(sel, list.length ? 'กรุณาเลือกมหาวิทยาลัย' : 'ยังไม่เปิดรับสมัคร', list.map((u) => h('option', { value: u.id }, u.name)));
    sel.disabled = !list.length;
  } catch (e) {
    fillSelect(sel, 'โหลดไม่สำเร็จ กรุณารีเฟรชหน้า', []);
    toast(e.message, 'error');
  }
}
let loadSeq = 0;
async function loadSessions() {
  const sel = form.elements.sessionId;
  const keep = val('sessionId');
  const seq = ++loadSeq;
  sel.disabled = true;
  $('#seat').replaceChildren();
  if (!val('universityId')) { fillSelect(sel, 'กรุณาเลือกรุ่นและช่วงเวลา', []); progress(); return; }
  fillSelect(sel, 'กำลังโหลด…', []);
  try {
    const list = await get(`/catalog/sessions?universityId=${val('universityId')}`);
    if (seq !== loadSeq) return;
    sessions = list;
    fillSelect(sel, list.length ? 'กรุณาเลือกรุ่นและช่วงเวลา' : 'ยังไม่มีรุ่นที่เปิดรับสมัคร',
      list.map((s) => h('option', { value: s.id, disabled: s.seatsLeft === 0 }, `${s.name} · ${fmtRange(s.startsAt, s.endsAt)}${s.seatsLeft === 0 ? ' (เต็ม)' : ''}`)));
    sel.disabled = !list.length;
    if (list.some((s) => String(s.id) === keep && s.seatsLeft !== 0)) { sel.value = keep; showSeat(); }
  } catch (e) {
    if (seq !== loadSeq) return;
    fillSelect(sel, 'โหลดไม่สำเร็จ กรุณาเลือกมหาวิทยาลัยใหม่', []);
    toast(e.message, 'error');
  }
  progress();
}
function showSeat() {
  const s = sessions.find((x) => String(x.id) === val('sessionId'));
  if (!s || s.capacity === null) { $('#seat').replaceChildren(); return; }
  const bar = h('i', { style: { '--w': '0%' } });
  $('#seat').replaceChildren(h('div', { class: 'seat' }, bar, `เหลือ ${num(s.seatsLeft)} จาก ${num(s.capacity)} ที่นั่ง`));
  requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty('--w', `${(1 - s.seatsLeft / s.capacity) * 100}%`)));
}

// ---------- เหตุการณ์ ----------
form.addEventListener('input', (e) => { dirty = true; if (errors.has(e.target.name)) check(e.target.name); progress(); });
form.addEventListener('focusout', (e) => { const n = e.target.name; if (RULES[n] && e.target.value) check(n); });
form.addEventListener('change', (e) => {
  if (e.target.name === 'universityId') loadSessions();
  if (e.target.name === 'sessionId') showSeat();
  if (e.target.name === 'hasTrainedBefore') { check('hasTrainedBefore'); setError('previous_certificate', ''); syncCert(); }
  if (RULES[e.target.name]) check(e.target.name);
  progress();
});
$('#next').addEventListener('click', () => validate(STEP1) && showStep(2));
$('#back').addEventListener('click', () => showStep(1));
$('#same').addEventListener('click', () => {
  form.elements.receiptName.value = val('fullName'); form.elements.receiptAddress.value = val('address');
  check('receiptName'); check('receiptAddress'); progress();
});
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a.btn-line');
  if (!a || !dirty) return;
  e.preventDefault();
  if (await confirmDialog({ title: 'ออกไปเข้าสู่ระบบ LINE?', text: 'ข้อมูลที่กรอกไว้จะหายไป เพื่อความปลอดภัยระบบไม่เก็บข้อมูลส่วนบุคคลไว้ในเครื่อง คุณส่งใบสมัครก่อนแล้วค่อยเชื่อม LINE ภายหลังได้', confirm: 'ไปที่ LINE' })) { dirty = false; location.href = a.href; }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sending) return;
  if (!$('#step1').hidden) { if (validate(STEP1)) showStep(2); return; }
  if (!STEP1.every((n) => !RULES[n]())) { showStep(1); validate(STEP1); return; }
  if (!validate(Object.keys(RULES).filter((n) => !STEP1.includes(n)))) return;
  if (!$('#acknowledge').checked) { toast('กรุณารับทราบประกาศความเป็นส่วนตัวและตกลงตามเงื่อนไข', 'error'); $('#acknowledge').focus(); return; }
  const fd = new FormData();
  for (const n of ['universityId', 'sessionId', 'fullName', 'address', 'mobile', 'lineContactId', 'email', 'shopName', 'shopAddress', 'shopDurationId', 'hasTrainedBefore', 'receiptName', 'receiptAddress', 'taxId']) fd.append(n, val(n));
  fd.append('nationalId', nid.value);
  fd.append('acknowledge', 'yes');
  fd.append('sensitiveConsent', $('#sensitiveConsent').checked ? 'yes' : 'no');
  fd.append('privacyVersion', site?.privacyVersion ?? '');
  fd.append('idempotencyKey', idempotencyKey);
  for (const [k, f] of Object.entries(files)) if (k !== 'previous_certificate' || val('hasTrainedBefore') === 'yes') fd.append(k, f, f.name);
  const btn = $('#submit');
  sending = true; btn.disabled = true;
  try {
    const data = await upload('/applications', fd, (p) => { $('.bar', btn).style.width = `${p * 100}%`; $('.txt', btn).textContent = p < 1 ? `กำลังส่ง ${Math.round(p * 100)}%` : 'กำลังบันทึก…'; });
    dirty = false;
    showDone(data);
  } catch (err) {
    toast(err.message, 'error');
    for (const x of err.errors) setError(x.field, x.message);
    if (['SESSION_FULL', 'SESSION_CLOSED'].includes(err.code)) { await loadSessions(); setError('sessionId', err.message); }
    const bad = [...errors.keys()];
    if (bad.some((n) => STEP1.includes(n))) showStep(1);
    if (bad.length) setTimeout(() => focusFirst(bad), 350);
  } finally {
    sending = false; btn.disabled = false; $('.bar', btn).style.width = '0'; $('.txt', btn).textContent = 'ส่งข้อมูลลงทะเบียน';
  }
});

let shell;
function showDone(a) {
  form.hidden = true; $('#sprout').hidden = true; $('#shopArt').hidden = true;
  const save = h('button', { class: 'btn btn-purple', type: 'button', onclick: () => savePass(a).catch(() => toast('บันทึกรูปไม่สำเร็จ กรุณาจับภาพหน้าจอแทน', 'error')) }, icon('download'), 'บันทึกบัตรเป็นรูป');
  $('#done').hidden = false;
  $('#done').append(h('h2', {}, 'ลงทะเบียนสำเร็จ!'), h('p', { class: 'muted' }, 'โปรดเก็บเลขที่ใบสมัครไว้ใช้ติดตามสถานะ'), ...(a.emailEnabled ? [h('p', { class: 'mailed' }, icon('envelope-check-fill'), ` กำลังส่งข้อมูลการสมัครไปที่ ${a.email}`)] : []), passCard(a),
    h('div', { class: 'actions' }, save, h('a', { class: 'btn btn-green', href: '/tracking.html' }, icon('search-heart'), 'ติดตามสถานะ'),
      shell.session.lineLoginEnabled && !shell.session.line && lineButton('เชื่อม LINE รับข่าวสาร')));
  scrollTo({ top: 0, behavior: 'smooth' });
  celebrate();
}

floatingLeaves();
parallax('[data-depth]');
shell = await initShell('apply');
site = shell.site;
if (shell.session.lineLoginEnabled && !shell.session.line) {
  $('#lineCta').append(h('div', { class: 'line-cta' }, h('span', { class: 'ic' }, icon('line')), h('div', {}, h('strong', {}, 'ติดตามใบสมัครง่ายขึ้นด้วย LINE'), h('small', {}, 'เข้าสู่ระบบก่อนสมัคร แล้วดูสถานะได้ทันทีโดยไม่ต้องจำเลขที่')), lineButton()));
}
if (shell.session.line) {
  $('#lineCta').append(h('div', { class: 'line-cta' }, h('span', { class: 'ic' }, icon('emoji-smile-fill')), h('div', {}, h('strong', {}, `สวัสดีคุณ ${shell.session.line.displayName ?? ''}`), h('small', {}, 'ใบสมัครนี้จะอยู่ในบัญชี LINE ของคุณ ติดตามสถานะได้ทันทีหลังส่ง'))));
}
if (site?.payment_instructions) { $('#pay').hidden = false; $('#pay span').textContent = site.payment_instructions; }
await Promise.all([loadUniversities(), get('/catalog/options').then((o) => fillSelect(form.elements.shopDurationId, o.length ? 'กรุณาเลือก' : 'ยังไม่มีตัวเลือก', o.map((x) => h('option', { value: x.id }, x.label)))).catch((e) => toast(e.message, 'error'))]);
syncCert();
progress();

/** รุ่นที่เปิดรับ: ให้คนเห็นก่อนกรอก และให้ Google รู้จักกำหนดการจริงจากฐานข้อมูล โหลดหลังฟอร์มพร้อม */
get('/catalog/schedule').then((list) => {
  if (!list.length) return;
  $('#openBox').hidden = false;
  $('#openList').replaceChildren(...list.slice(0, 12).map((x) => h('button', { class: 'openrow', type: 'button', onclick: () => $('#universityId').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'center' }) }, h('span', { class: 'cal' }, h('b', {}, new Intl.DateTimeFormat('th-TH', { day: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(x.startsAt))), new Intl.DateTimeFormat('th-TH', { month: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(x.startsAt))), h('span', {}, h('b', {}, `${x.name} · ${x.universityName}`), h('small', {}, x.courseName)), h('span', { class: `badge ${x.seatsLeft === 0 ? 'bad' : 'ok'}` }, x.seatsLeft === null ? 'เปิดรับ' : x.seatsLeft ? `เหลือ ${x.seatsLeft} ที่` : 'เต็ม'))));
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': list.slice(0, 12).map((x) => ({ '@type': 'EducationEvent', name: `${x.courseName} ${x.name}`, startDate: x.startsAt, endDate: x.endsAt, eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', inLanguage: 'th', url: `${location.origin}/`, location: { '@type': 'Place', name: x.location || x.universityName, address: { '@type': 'PostalAddress', addressCountry: 'TH' } }, organizer: { '@type': 'Organization', name: x.universityName }, offers: { '@type': 'Offer', url: `${location.origin}/`, availability: x.seatsLeft === 0 ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' } })) }).replace(/</g, '\\u003c');
  document.head.append(ld);
}).catch(() => {});
