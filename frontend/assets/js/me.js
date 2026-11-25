import { API_BASE } from './config.js';
import { get, send } from './api.js';
import { $, busy, confirmDialog, fmtDate, fmtDateTime, fmtRange, fmtTime, h, icon, num, toast } from './ui.js';
import { celebrate, floatingLeaves, parallax, tilt } from './fx.js';
import { initShell, lineButton } from './shell.js';

const root = $('#app');
const VIEWS = { home: ['house-heart-fill', 'หน้าแรก'], status: ['signpost-split-fill', 'สถานะ'], schedule: ['calendar-heart-fill', 'กำหนดการ'], qr: ['qr-code', 'QR'], certificates: ['award-fill', 'ใบประกาศ'], history: ['clock-history', 'ประวัติ'] };
const TONE = { documents_incomplete: 'bad', rejected: 'bad', cancelled: 'bad', submitted: 'warn', under_review: 'info' };
let shell; let list = []; let view = 'home'; let liff = null;

// ---------- LIFF ----------
const params = new URLSearchParams(location.search);
const inLine = / Line\//i.test(navigator.userAgent);
const wantsLiff = inLine || [...params.keys()].some((k) => k.startsWith('liff.'));
async function startLiff(liffId) {
  await new Promise((resolve, reject) => { const s = h('script', { src: 'https://static.line-scdn.net/liff/edge/2/sdk.js', onload: resolve, onerror: () => reject(new Error('โหลด LIFF ไม่สำเร็จ')) }); document.head.append(s); });
  await window.liff.init({ liffId });
  return window.liff;
}
async function liffSignIn() {
  if (!liff?.isLoggedIn()) { if (liff?.isInClient()) liff.login({ redirectUri: location.href }); return; }
  const me = shell.session.line;
  const idToken = liff.getIDToken();
  if (me || !idToken) return;
  try { await send('POST', '/auth/liff/session', { idToken }); } catch (e) {
    // token ของ LIFF หมดอายุได้ขณะหน้าเปิดค้าง: ขอใหม่หนึ่งครั้งต่อแท็บ
    let tried = true;
    try { tried = sessionStorage.getItem('liff-retry') === '1'; sessionStorage.setItem('liff-retry', '1'); } catch { /* ปิด storage */ }
    if (e.status === 401 && !tried) { liff.logout(); liff.login({ redirectUri: location.href }); return; }
    toast(e.message, 'error');
  }
}

// ---------- ชิ้นส่วน ----------
const active = () => list.filter((a) => !['rejected', 'cancelled'].includes(a.status));
const upcoming = () => active().filter((a) => new Date(a.endsAt) > Date.now()).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
const go = (v) => { view = v; history.replaceState(null, '', `?view=${v}`); render(); scrollTo({ top: 0, behavior: 'smooth' }); };
const blank = (ic, title, text, action) => h('section', { class: 'panel state' }, icon(ic), h('h2', {}, title), h('p', {}, text), action);
const applyBtn = () => h('a', { class: 'btn btn-green', href: '/', style: { 'margin-top': '14px' } }, icon('pencil-square'), 'สมัครอบรม');
const when = (a) => `${fmtRange(a.startsAt, a.endsAt)} เวลา ${fmtTime(a.startsAt)}–${fmtTime(a.endsAt)} น.`;
const pdf = (a, dl) => `${API_BASE}/applications/me/${a.id}/certificate.pdf${dl ? '?download=1' : ''}`;
/** ใน LINE ต้องเปิดเบราว์เซอร์ภายนอกจึงบันทึกไฟล์ได้ แต่ session อยู่ใน LINE จึงใช้ดาวน์โหลดตรงแทน */
async function savePdf(btn, a) {
  await busy(btn, async () => {
    try {
      const res = await fetch(pdf(a, true), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('ดาวน์โหลดไม่สำเร็จ');
      const file = new File([await res.blob()], `${a.certificate.number}.pdf`, { type: 'application/pdf' });
      if (inLine && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'ใบประกาศนียบัตร' }); return; }
      const url = URL.createObjectURL(file); h('a', { href: url, download: file.name }).click(); setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'error'); }
  });
}
/** ไฟล์ปฏิทินสร้างในเครื่อง ไม่ส่งข้อมูลไปที่อื่น */
function ics(a) {
  const t = (d) => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, ''); const esc = (s) => String(s ?? '').replace(/[\;,]/g, '\\$&').replace(/\n/g, '\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//E-Training//TH', 'BEGIN:VEVENT', `UID:${a.applicationNo}@${location.hostname}`, `DTSTAMP:${t(Date.now())}`, `DTSTART:${t(a.startsAt)}`, `DTEND:${t(a.endsAt)}`, `SUMMARY:${esc(a.courseName)}`, `LOCATION:${esc(a.location ?? a.universityName)}`, 'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:E-Training', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar' })); h('a', { href: url, download: 'e-training.ics' }).click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- หน้า ----------
function home() {
  const next = upcoming()[0]; const line = shell.session.line; const certs = list.filter((a) => a.certificate).length;
  const bkk = (d) => Math.floor((new Date(d).getTime() + 7 * 3_600_000) / 86_400_000);
  const days = next && bkk(next.startsAt) - bkk(Date.now());
  const tile = (v, ic, label, sub, c) => h('button', { class: 'tile', type: 'button', style: { '--c': c }, onclick: () => go(v) }, icon(ic), h('b', {}, label), h('small', {}, sub));
  const card = h('section', { class: 'me-hero' }, h('div', { class: 'me-top' }, line?.pictureUrl ? h('img', { src: line.pictureUrl, alt: '', referrerPolicy: 'no-referrer' }) : h('span', { class: 'ph' }, icon('person-fill')), h('div', {}, h('strong', {}, line?.displayName ?? list[0]?.fullName ?? 'ผู้สมัคร'), h('span', {}, line ? (line.accountLinked ? 'ยืนยันตัวตนแล้ว' : 'เข้าสู่ระบบด้วย LINE') : 'เข้าด้วยเลขที่ใบสมัคร')), line?.accountLinked && h('i', { class: 'bi bi-patch-check-fill', title: 'ยืนยันตัวตนแล้ว' })),
    next ? h('div', { class: 'me-next' }, h('div', {}, h('small', {}, days > 0 ? 'อบรมครั้งต่อไป' : new Date(next.startsAt) > Date.now() ? 'อบรมวันนี้' : 'กำลังอบรม'), h('b', {}, next.courseName), h('span', {}, `${next.sessionName} · ${next.universityName}`), h('span', {}, when(next))), days > 0 && h('div', { class: 'me-days' }, h('b', {}, num(days)), 'วัน')) : h('p', { class: 'me-none' }, list.length ? 'ยังไม่มีอบรมที่กำลังจะมาถึง' : 'เริ่มปลูกเมล็ดแรกของคุณ'),
    next && h('div', { class: 'me-bar', style: { '--p': `${((next.timeline.current ?? 0) / 9) * 100}%` } }, h('i')), next && h('p', { class: 'me-status' }, icon('flower1'), next.statusLabel));
  return [card, h('div', { class: 'tiles' }, tile('qr', 'qr-code', 'QR ประจำตัว', list.some((a) => a.qrReady) ? 'พร้อมใช้' : 'หลังได้รับอนุมัติ', '#49378a'), tile('status', 'signpost-split-fill', 'สถานะ', next ? `ขั้น ${next.timeline.current ?? '-'}/9` : 'ดูใบสมัคร', '#168447'), tile('schedule', 'calendar-heart-fill', 'กำหนดการ', 'วัน เวลา แผนที่', '#f5821f'), tile('certificates', 'award-fill', 'ใบประกาศ', certs ? `${num(certs)} ใบ` : 'ยังไม่มี', '#2f7fb5'), tile('history', 'clock-history', 'ประวัติอบรม', `${num(active().filter((a) => new Date(a.endsAt) < Date.now()).length)} ครั้ง`, '#8a6be0'),
    h('a', { class: 'tile', href: '/', style: { '--c': '#35a66a' } }, icon('pencil-square'), h('b', {}, 'สมัครรุ่นใหม่'), h('small', {}, 'เปิดรับอยู่'))),
  ...(list.length ? [] : [linkCard()])];
}
function linkCard() { return blank('link-45deg', 'ยังไม่มีใบสมัครในบัญชีนี้', shell.session.line ? 'ถ้าสมัครไว้แล้ว เชื่อมใบสมัครด้วยเลขที่ใบสมัคร' : 'เข้าสู่ระบบเพื่อดูใบสมัคร', h('div', { class: 'actions' }, h('a', { class: 'btn btn-purple', href: '/tracking.html' }, 'เชื่อมใบสมัครเดิม'), h('a', { class: 'btn btn-green', href: '/' }, 'สมัครอบรม'))); }
function status() {
  if (!list.length) return [linkCard()];
  return list.map((a) => h('section', { class: 'panel' }, h('div', { class: 'app-head' }, h('div', {}, h('div', { class: 'no' }, a.applicationNo), h('div', {}, a.fullName)), h('span', { class: `badge ${TONE[a.status] ?? 'ok'}` }, a.statusLabel)),
    a.statusReason && h('div', { class: 'notice', role: 'alert' }, icon('exclamation-circle-fill'), h('span', {}, a.statusReason)),
    h('dl', { class: 'vkv' }, [['หลักสูตร', a.courseName], ['รุ่น', `${a.sessionName} · ${a.universityName}`], ['วันที่สมัคร', fmtDateTime(a.submittedAt)], ['เลขบัตรประชาชน', a.nationalId], ['เอกสาร', `ผ่าน ${num(a.documents.filter((d) => d.status === 'approved').length)}/${num(a.documents.length)} รายการ`], ['มือถือ', a.mobile]].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
    h('ol', { class: 'mini-steps', 'aria-label': 'ขั้นตอน' }, a.timeline.steps.map((s, i) => h('li', { class: a.timeline.current && i + 1 < a.timeline.current ? 'on' : i + 1 === a.timeline.current ? 'now' : '', 'aria-current': i + 1 === a.timeline.current ? 'step' : null }, h('i', {}, a.timeline.current && i + 1 < a.timeline.current ? icon('check-lg') : String(i + 1)), s))),
    h('a', { class: 'btn btn-green', href: '/tracking.html' }, 'ดูรายละเอียดและจัดการเอกสาร')));
}
async function schedule() {
  const open = await get('/catalog/schedule').catch(() => []);
  const mine = upcoming();
  return [...(mine.length ? mine.map((a) => h('section', { class: 'panel' }, h('div', { class: 'sched' }, h('div', {}, icon('mortarboard-fill'), h('span', {}, h('b', {}, a.courseName))), h('div', {}, icon('bank2'), h('span', {}, `${a.universityName} · ${a.sessionName}`)), h('div', {}, icon('calendar-event-fill'), h('span', {}, when(a))), a.location && h('div', {}, icon('geo-alt-fill'), h('span', {}, a.location)), a.details && h('div', {}, icon('info-circle-fill'), h('span', { style: { 'white-space': 'pre-line' } }, a.details))),
    h('div', { class: 'actions', style: { 'justify-content': 'flex-start' } }, a.mapUrl && h('a', { class: 'btn btn-purple btn-sm', href: a.mapUrl, target: '_blank', rel: 'noopener' }, icon('map-fill'), 'เปิดแผนที่'), !inLine && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ics(a) }, icon('calendar-plus'), 'ใส่ปฏิทิน'), a.qrReady && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go('qr') }, icon('qr-code'), 'QR')))) : [blank('calendar-x', 'ยังไม่มีกำหนดอบรมของคุณ', 'ดูรุ่นที่เปิดรับด้านล่าง')]),
  h('section', { class: 'panel' }, h('h2', {}, 'รุ่นที่เปิดรับสมัคร'), open.length ? open.map((s) => h('a', { class: 'openrow', href: '/' }, h('span', { class: 'cal' }, h('b', {}, new Intl.DateTimeFormat('th-TH', { day: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(s.startsAt))), new Intl.DateTimeFormat('th-TH', { month: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(s.startsAt))), h('span', {}, h('b', {}, s.name), h('small', {}, `${s.universityName} · ${fmtTime(s.startsAt)} น.`)), h('span', { class: `badge ${s.seatsLeft === 0 ? 'bad' : 'ok'}` }, s.seatsLeft === null ? 'เปิดรับ' : s.seatsLeft ? `เหลือ ${num(s.seatsLeft)}` : 'เต็ม'))) : h('p', { class: 'muted' }, 'ยังไม่มีรุ่นที่เปิดรับในขณะนี้'))];
}
let wake = null;
async function qr() {
  const ready = list.filter((a) => a.qrReady);
  if (!ready.length) return [blank('qr-code', 'ยังไม่มี QR', list.length ? 'QR จะพร้อมใช้หลังการสมัครได้รับอนุมัติ และใช้ได้ถึงวันสุดท้ายของรุ่น' : 'สมัครหรือเชื่อมใบสมัครก่อน', list.length ? null : applyBtn())];
  const cards = await Promise.all(ready.map(async (a) => {
    let d;
    try { d = await get(`/applications/me/${a.id}/qr`); } catch (e) { return blank('qr-code', 'เปิด QR ไม่ได้', e.message); }
    const img = h('img', { src: `${API_BASE}/applications/me/${a.id}/qr.svg?t=${Date.now()}`, alt: `QR ของ ${a.applicationNo}`, width: 260, height: 260 });
    const today = d.records.find((r) => r.day === new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10));
    const card = h('section', { class: 'qrcard' }, h('header', {}, h('em', {}, 'E-Training'), h('span', {}, 'QR ประจำตัวผู้เข้าอบรม')), h('div', { class: 'qrbox' }, img), h('strong', {}, d.fullName), h('span', { class: 'qrno' }, d.applicationNo), h('p', {}, `${d.sessionName} · ${d.universityName}`), h('p', {}, when(d)),
      today && h('p', { class: 'qr-in' }, icon('check-circle-fill'), `เช็กอินวันนี้ ${fmtTime(today.checkInAt)} น.${today.checkOutAt ? ` · เช็กเอาต์ ${fmtTime(today.checkOutAt)} น.` : ''}`), h('small', {}, `ใช้ได้ถึง ${fmtDateTime(d.expiresAt)} · ห้ามส่งต่อให้ผู้อื่น`));
    tilt(card);
    return h('div', { class: 'qrwrap' }, card, h('div', { class: 'actions' }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => fullQr(img.src, d) }, icon('arrows-fullscreen'), 'ขยายเต็มจอ'), h('button', { class: 'btn', type: 'button', onclick: async () => { if (!(await confirmDialog({ title: 'ออก QR ใหม่?', text: 'QR เดิมและภาพที่บันทึกไว้จะใช้ไม่ได้ทันที', confirm: 'ออกใหม่' }))) return; try { await send('POST', `/applications/me/${a.id}/qr/renew`); toast('ออก QR ใหม่แล้ว'); render(); } catch (e) { toast(e.message, 'error'); } } }, icon('arrow-repeat'), 'ออก QR ใหม่')));
  }));
  return cards;
}
/** เต็มจอพื้นขาว และกันจอดับระหว่างรอสแกน */
async function fullQr(src, d) {
  const dlg = h('dialog', { class: 'qrfull', onclose: () => { dlg.remove(); wake?.release?.().catch(() => {}); wake = null; }, onclick: () => dlg.close(), 'aria-label': 'QR เต็มจอ' }, h('img', { src, alt: '' }), h('strong', {}, d.fullName), h('span', {}, d.applicationNo), h('small', {}, 'แตะเพื่อปิด'));
  document.body.append(dlg); dlg.showModal();
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* ไม่รองรับ */ }
}
function certificates() {
  const certs = list.filter((a) => a.certificate);
  if (!certs.length) return [blank('award', 'ยังไม่มีใบประกาศ', 'เมื่อผ่านการอบรม ใบประกาศจะแสดงที่นี่ และแจ้งทาง LINE')];
  try { const seen = localStorage.getItem('lst-certs'); if (seen !== String(certs.length)) { celebrate(); localStorage.setItem('lst-certs', certs.length); } } catch { /* ปิด storage */ }
  return certs.map((a) => {
    const card = h('article', { class: 'certcard' }, h('img', { src: '/assets/images/cert-bg.svg', alt: '' }), h('div', {}, h('small', {}, 'ใบประกาศนียบัตร'), h('strong', {}, a.fullName), h('span', {}, a.courseName)));
    tilt(card);
    return h('section', { class: 'panel' }, card, h('dl', { class: 'vkv' }, [['เลขที่', a.certificate.number], ['วันที่ออก', fmtDate(a.certificate.issuedAt)], ['รุ่น', `${a.sessionName} · ${a.universityName}`]].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-green', href: pdf(a), target: inLine ? null : '_blank', rel: 'noopener' }, icon('eye-fill'), 'ดูใบประกาศ'), h('button', { class: 'btn btn-purple', type: 'button', onclick: (e) => savePdf(e.currentTarget, a) }, icon('download'), 'ดาวน์โหลด PDF'), h('a', { class: 'btn', href: a.certificate.verifyPath }, icon('patch-check'), 'หน้าตรวจสอบ')));
  });
}
async function historyView() {
  const done = active().filter((a) => ['attended', 'passed', 'certified'].includes(a.status) || new Date(a.endsAt) < Date.now());
  if (!done.length) return [blank('clock-history', 'ยังไม่มีประวัติอบรม', 'หลังเข้าอบรม ประวัติจะแสดงที่นี่')];
  const rec = await Promise.all(done.map((a) => get(`/applications/me/${a.id}/attendance`).catch(() => [])));
  return [h('section', { class: 'panel' }, h('ol', { class: 'hist-line' }, done.map((a, i) => h('li', {}, h('b', {}, a.courseName), h('span', {}, `${a.sessionName} · ${a.universityName}`), h('span', {}, fmtRange(a.startsAt, a.endsAt)), h('span', { class: `badge ${TONE[a.status] ?? 'ok'}` }, a.statusLabel), ...rec[i].map((r) => h('small', {}, icon('check2-circle'), ` ${fmtDate(r.day)} เข้า ${fmtTime(r.checkInAt)} น.${r.checkOutAt ? ` ออก ${fmtTime(r.checkOutAt)} น.` : ''}`)), a.certificate && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go('certificates') }, icon('award-fill'), a.certificate.number)))))];
}

const RENDER = { home, status, schedule, qr, certificates, history: historyView };
async function render() {
  const mine = view;
  const nav = h('nav', { class: 'me-nav', 'aria-label': 'เมนูพื้นที่ของฉัน' }, Object.entries(VIEWS).map(([k, [ic, l]]) => h('button', { type: 'button', 'aria-current': k === view ? 'page' : null, onclick: () => go(k) }, icon(ic), l)));
  const body = h('div', { class: 'me-body' }, h('div', { class: 'skel', style: { height: '220px' } }));
  root.replaceChildren(nav, body);
  nav.querySelector('[aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const out = await RENDER[mine]();
  if (mine === view) body.replaceChildren(...out.filter(Boolean));
}
function entry() {
  root.replaceChildren(h('section', { class: 'panel state' }, icon('person-hearts'), h('h2', {}, 'พื้นที่ของฉัน'), h('p', {}, 'ดูสถานะ QR เข้าอบรม กำหนดการ และใบประกาศในที่เดียว'), h('div', { class: 'actions' }, shell.session.lineLoginEnabled && lineButton(), h('a', { class: 'btn btn-purple', href: '/tracking.html' }, icon('search'), 'ใช้เลขที่ใบสมัคร'))));
}
async function load() {
  try {
    if (!shell.session.authenticated) { entry(); return; }
    list = await get('/applications/me/status');
    await render();
  } catch (e) { if (e.status === 401) entry(); else root.replaceChildren(h('section', { class: 'panel state' }, icon('cloud-slash'), h('p', {}, e.message), h('button', { class: 'btn btn-green', type: 'button', onclick: load }, 'ลองใหม่'))); }
}

floatingLeaves(8);
parallax('[data-depth]');
// จำหน้าที่ตั้งใจเปิดไว้ข้ามการล็อกอิน (ไม่มีข้อมูลส่วนบุคคล)
let remembered = null;
try { remembered = sessionStorage.getItem('me-view'); sessionStorage.removeItem('me-view'); } catch { /* ปิด storage */ }
const asked = params.get('view');
view = VIEWS[asked] ? asked : VIEWS[remembered] ? remembered : 'home';
shell = await initShell('me');
if (shell.site?.liffId && wantsLiff) {
  try {
    liff = await startLiff(shell.site.liffId);
    const after = new URLSearchParams(location.search).get('view'); // liff.init คืน query จริงจาก liff.state
    if (VIEWS[after]) view = after;
    await liffSignIn();
    shell.session = await get('/auth/session');
  } catch (e) { console.warn('LIFF', e?.message); }
}
if (!shell.session.authenticated) { try { sessionStorage.setItem('me-view', view); } catch { /* ปิด storage */ } }
await load();
