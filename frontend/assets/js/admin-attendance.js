import { blobUrl, get, send } from './api.js';
import { API_BASE } from './config.js';
import { $, confirmDialog, fmtDateTime, fmtRange, fmtTime, h, icon, num, toast } from './ui.js';
import { celebrate } from './fx.js';
import { badge, can, empty, failed, formDialog, initAdmin, skeleton } from './admin.js';

const main = await initAdmin('attendance');
const RESULT = { ok: ['good', 'check-lg'], already: ['warn', 'clock-history'], not_in: ['warn', 'door-closed'], wrong_session: ['bad', 'shuffle'], wrong_day: ['bad', 'calendar-x'], unauthorized: ['bad', 'person-x'], invalid: ['bad', 'qr-code'], revoked: ['bad', 'arrow-repeat'] };
const RESULT_LABEL = { ok: 'สำเร็จ', already: 'ซ้ำ', not_in: 'ยังไม่เช็กอิน', wrong_session: 'ผิดรุ่น', wrong_day: 'ผิดวัน', unauthorized: 'ไม่มีสิทธิ์', invalid: 'QR ไม่ถูกต้อง', revoked: 'QR ถูกยกเลิก' };
const toIso = (v) => (v ? new Date(`${v}:00+07:00`).toISOString() : null);
const nowLocal = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 16);
let sessions = []; let current = null; let tab = 'scan'; let action = 'in'; let stream = null; let loopId = 0; let data = null; let restart = null;
const base = () => `/admin/attendance/sessions/${current}`;

// ---------- เสียงและการสั่น ----------
let audio;
function feedback(tone) {
  navigator.vibrate?.(tone === 'good' ? 60 : [70, 50, 70]);
  try {
    audio ??= new (window.AudioContext ?? window.webkitAudioContext)();
    for (const [i, f] of (tone === 'good' ? [880, 1320] : tone === 'warn' ? [520, 520] : [240, 180]).entries()) {
      const o = audio.createOscillator(); const g = audio.createGain(); const t = audio.currentTime + i * 0.12;
      o.frequency.value = f; o.type = tone === 'bad' ? 'sawtooth' : 'sine'; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.18);
    }
  } catch { /* เครื่องไม่รองรับเสียง */ }
}

// ---------- สแกน ----------
let busyScan = false; let last = { token: '', at: 0 }; let hideTimer;
function showResult(r) {
  const [tone, ic] = RESULT[r.result] ?? ['bad', 'x-lg'];
  feedback(tone);
  const card = $('#scan-result');
  if (!card) return;
  const photo = h('div', { class: 'sr-photo' }, icon('person-fill'));
  card.className = `scan-result show ${tone}`;
  card.replaceChildren(h('div', { class: 'sr-icon' }, icon(ic)), h('strong', {}, r.message), ...(r.person ? [photo, h('b', { class: 'sr-name' }, r.person.fullName), h('span', {}, `${r.person.applicationNo}${r.result === 'wrong_session' ? ` · ${r.person.sessionName}` : ''}`)] : []), ...(r.at ? [h('span', { class: 'sr-time' }, `เวลา ${fmtTime(r.at)} น.`)] : []));
  if (r.person && ['ok', 'already', 'not_in'].includes(r.result)) blobUrl(`${base()}/people/${r.person.id}/portrait`).then((u) => { photo.replaceChildren(h('img', { src: u, alt: `ภาพ ${r.person.fullName}`, onload: () => URL.revokeObjectURL(u) })); }).catch(() => {});
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { card.className = 'scan-result'; }, r.result === 'ok' ? 3200 : 4200);
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (r.result === 'ok') bumpCounter();
}
async function submit(token) {
  if (busyScan || !token || (token === last.token && Date.now() - last.at < 5000)) return;
  busyScan = true; last = { token, at: Date.now() };
  try { showResult(await send('POST', `${base()}/scan`, { token, action })); } catch (e) { feedback('bad'); toast(e.message, 'error'); last.at = 0; } finally { busyScan = false; }
}
function bumpCounter() { const s = sessions.find((x) => x.id === current); get(`${base()}/roster`).then((d) => { data = d; if (s) s.attended = d.counts.attended; paintCounter(); }).catch(() => {}); }
function paintCounter() {
  const box = $('#counter');
  if (!box || !data) return;
  const n = action === 'in' ? data.counts.today : data.counts.out; const total = action === 'in' ? data.counts.expected : data.counts.today;
  const ratio = total ? n / total : 0;
  box.style.setProperty('--p', `${Math.round(ratio * 100)}%`);
  box.replaceChildren(h('b', {}, num(n)), h('span', {}, `จาก ${num(total)} คน`), h('small', {}, action === 'in' ? 'เช็กอินวันนี้' : 'เช็กเอาต์วันนี้'));
  if (total && n === total && !box.dataset.done) { box.dataset.done = '1'; celebrate(); toast(action === 'in' ? 'มาครบทุกคนแล้ว' : 'เช็กเอาต์ครบแล้ว'); }
}
function stopCamera() { loopId += 1; stream?.getTracks().forEach((t) => t.stop()); stream = null; }
async function startCamera(video, note) {
  stopCamera();
  const my = loopId;
  if (!navigator.mediaDevices?.getUserMedia) { note.replaceChildren('อุปกรณ์นี้เปิดกล้องผ่านเว็บไม่ได้ ใช้ปุ่ม "ถ่ายรูป QR" หรือเช็กชื่อเองแทน'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    if (my !== loopId) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream; await video.play(); note.replaceChildren('เล็งกล้องไปที่ QR ของผู้เข้าอบรม');
    $('#scanner')?.classList.add('live');
  } catch (e) { note.replaceChildren(e.name === 'NotAllowedError' ? 'ยังไม่ได้อนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องในเบราว์เซอร์แล้วกดลองใหม่' : 'เปิดกล้องไม่ได้ ใช้ปุ่ม "ถ่ายรูป QR" แทน'); return; }
  const detector = 'BarcodeDetector' in window ? await window.BarcodeDetector.getSupportedFormats().then((f) => (f.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null)).catch(() => null) : null;
  const canvas = document.createElement('canvas'); const g = canvas.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (my !== loopId) return;
    if (video.readyState >= 2 && !busyScan && !document.querySelector('dialog[open]')) {
      let text = null;
      try {
        if (detector) text = (await detector.detect(video))[0]?.rawValue ?? null;
        else { const w = 640; const hgt = Math.round((video.videoHeight / video.videoWidth) * w); canvas.width = w; canvas.height = hgt; g.drawImage(video, 0, 0, w, hgt); text = window.jsQR?.(g.getImageData(0, 0, w, hgt).data, w, hgt, { inversionAttempts: 'dontInvert' })?.data ?? null; }
      } catch { /* เฟรมนี้อ่านไม่ได้ */ }
      if (text) submit(text);
    }
    setTimeout(() => requestAnimationFrame(tick), 140);
  };
  tick();
}
async function fromPhoto(file) {
  try {
    const bmp = await createImageBitmap(file); const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = bmp.width * scale; c.height = bmp.height * scale;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, c.width, c.height);
    const r = window.jsQR?.(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    if (r?.data) submit(r.data); else toast('ไม่พบ QR ในภาพ ลองถ่ายให้ชัดขึ้น', 'error');
  } catch { toast('อ่านภาพไม่ได้', 'error'); }
}
function scanTab() {
  const video = h('video', { muted: true, playsInline: true, autoplay: true, 'aria-label': 'ภาพจากกล้อง' });
  const note = h('p', { class: 'scan-note' }, 'กำลังเปิดกล้อง…');
  const pick = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr', id: 'qr-photo', onchange: () => { if (pick.files[0]) fromPhoto(pick.files[0]); pick.value = ''; } });
  const mode = (a, label, ic) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(action === a), onclick: () => { action = a; last = { token: '', at: 0 }; render(); } }, icon(ic), label);
  restart = () => startCamera(video, note);
  setTimeout(restart);
  return h('div', { class: 'scan-grid' },
    h('section', { class: `scanner mode-${action}`, id: 'scanner' }, h('div', { class: 'scan-mode', role: 'radiogroup', 'aria-label': 'ประเภทการเช็กชื่อ' }, mode('in', 'เช็กอิน', 'box-arrow-in-right'), mode('out', 'เช็กเอาต์', 'box-arrow-right')),
      h('div', { class: 'scan-view' }, video, h('div', { class: 'scan-frame', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('em')), h('div', { class: 'scan-result', id: 'scan-result', role: 'status', 'aria-live': 'assertive' })), note,
      h('div', { class: 'scan-tools' }, h('button', { class: 'btn', type: 'button', onclick: () => startCamera(video, note) }, icon('camera-video-fill'), 'เปิดกล้องใหม่'), pick, h('label', { class: 'btn', htmlFor: 'qr-photo' }, icon('camera-fill'), 'ถ่ายรูป QR'), h('button', { class: 'btn', type: 'button', onclick: () => { tab = 'list'; render(); } }, icon('person-check'), 'เช็กชื่อเอง'))),
    h('section', { class: 'box counter-box' }, h('div', { class: 'counter', id: 'counter' }), h('h2', {}, 'ล่าสุด'), h('div', { id: 'recent' }, skeleton(2, '44px'))));
}
async function paintRecent() {
  const box = $('#recent');
  if (!box) return;
  try {
    const list = (await get(`${base()}/scans`)).slice(0, tab === 'scan' ? 6 : 100);
    box.replaceChildren(...(list.length ? list.map((s) => h('div', { class: `sline ${RESULT[s.result]?.[0] ?? 'bad'}` }, icon(s.action === 'in' ? 'box-arrow-in-right' : 'box-arrow-right'), h('div', {}, h('b', {}, s.full_name ?? 'ไม่พบข้อมูล'), h('small', {}, `${fmtDateTime(s.created_at)} · ${s.method === 'qr' ? 'QR' : 'เช็กเอง'} · ${s.admin_name ?? '-'}`)), h('span', { class: `badge ${{ good: 'ok', warn: 'warn', bad: 'bad' }[RESULT[s.result]?.[0]] ?? ''}` }, RESULT_LABEL[s.result] ?? s.result))) : [empty('qr-code', 'ยังไม่มีการสแกน')]));
  } catch (e) { box.replaceChildren(failed(e, paintRecent)); }
}

// ---------- รายชื่อ ----------
let filter = 'all'; let q = ''; const picked = new Set();
const FILTERS = { all: 'ทั้งหมด', present: 'มาแล้ว', absent: 'ยังไม่มา', ready: 'ครบเกณฑ์ รอประกาศผล', failing: 'ยังไม่ครบเกณฑ์' };
const hm = (m) => `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
function manualForm(p, act) {
  formDialog({ title: `${act === 'in' ? 'เช็กอิน' : 'เช็กเอาต์'}เอง: ${p.fullName}`, values: { at: nowLocal() }, fields: [{ name: 'at', label: 'เวลา (เวลาไทย)', type: 'datetime-local', required: true, wide: true }, { name: 'note', label: 'เหตุผล', required: true, wide: true, placeholder: 'เช่น โทรศัพท์แบตหมด ตรวจบัตรตัวจริงแล้ว' }],
    onSave: async (v) => { const r = await send('POST', `${base()}/people/${p.id}`, { action: act, note: v.note, at: toIso(v.at) }); if (r.result !== 'ok') throw Object.assign(new Error(r.message), { errors: [] }); toast(r.message); await loadRoster(); } });
}
async function personDialog(p) {
  const body = h('div', {}, skeleton(2, '60px'));
  const d = h('dialog', { onclose: () => d.remove(), 'aria-label': p.fullName }, h('div', { class: 'dialog-form' }, h('h3', {}, p.fullName), h('p', { class: 'muted' }, `${p.applicationNo} · ${p.mobile}`), body, h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'ปิด'))));
  document.body.append(d); d.showModal();
  const undo = async (r, what) => { const reason = await confirmDialog({ title: what === 'in' ? 'ลบบันทึกวันนี้?' : 'ลบเวลาเช็กเอาต์?', text: 'การแก้ไขถูกบันทึกใน Audit Logs', confirm: 'ยืนยัน', danger: true, reason: true, placeholder: 'เหตุผล' }); if (!reason) return; try { await send('POST', `/admin/attendance/records/${r.id}/undo`, { what, reason }); toast('แก้บันทึกแล้ว'); d.close(); await loadRoster(); } catch (e) { toast(e.message, 'error'); } };
  try {
    const x = await get(`${base()}/people/${p.id}`);
    const photo = h('div', { class: 'sr-photo' }, icon('person-fill'));
    blobUrl(`${base()}/people/${p.id}/portrait`).then((u) => photo.replaceChildren(h('img', { src: u, alt: '', onload: () => URL.revokeObjectURL(u) }))).catch(() => {});
    body.replaceChildren(photo, h('p', { style: { 'text-align': 'center', margin: '8px 0' } }, badge(x.status)), ...(p.missing.length && x.status === 'attended' ? [h('p', { class: 'testout bad' }, icon('exclamation-circle'), `ยังขาด: ${p.missing.join(', ')}`)] : []),
      ...(x.records.length ? x.records.map((r) => h('div', { class: 'recrow' }, h('div', {}, h('b', {}, fmtRange(r.day, r.day)), h('small', {}, `เข้า ${fmtTime(r.check_in_at)} (${r.check_in_method === 'qr' ? 'QR' : 'เช็กเอง'} โดย ${r.in_by ?? '-'})`), h('small', {}, r.check_out_at ? `ออก ${fmtTime(r.check_out_at)} (${r.check_out_method === 'qr' ? 'QR' : 'เช็กเอง'} โดย ${r.out_by ?? '-'})` : 'ยังไม่เช็กเอาต์'), r.note && h('small', {}, `หมายเหตุ: ${r.note}`)),
        can('attendance.result') && !['passed', 'certified'].includes(x.status) && h('div', { class: 'recact' }, r.check_out_at && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => undo(r, 'out') }, 'ลบเวลาออก'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => undo(r, 'in') }, 'ลบทั้งวัน')))) : [empty('calendar-x', 'ยังไม่มีบันทึก')]),
      h('div', { class: 'bar-actions', style: { margin: '14px 0 0' } }, h('button', { class: 'btn btn-green btn-sm', type: 'button', onclick: () => { d.close(); manualForm(p, 'in'); } }, 'เช็กอินเอง'), h('button', { class: 'btn btn-purple btn-sm', type: 'button', onclick: () => { d.close(); manualForm(p, 'out'); } }, 'เช็กเอาต์เอง')));
  } catch (e) { body.replaceChildren(failed(e, () => { d.close(); personDialog(p); })); }
}
async function announce(ids, override) {
  if (!ids.length) return;
  let reason = null;
  if (override) { reason = await confirmDialog({ title: `ให้ผ่าน ${num(ids.length)} คนโดยไม่ครบเกณฑ์?`, text: 'ระบุเหตุผลเพื่อเก็บใน Audit Logs ผู้สมัครไม่เห็นข้อความนี้', confirm: 'ยืนยันให้ผ่าน', danger: true, reason: true, placeholder: 'เหตุผล' }); if (!reason) return; } else if (!(await confirmDialog({ title: `ประกาศผลผ่าน ${num(ids.length)} คน?`, text: 'ผู้ผ่านจะได้รับแจ้งเตือน และแก้บันทึกเข้าอบรมไม่ได้อีก', confirm: 'ประกาศผล' }))) return;
  try {
    const r = await send('POST', `${base()}/announce`, { ids, override, reason });
    picked.clear();
    if (r.passed) celebrate();
    toast(`ประกาศผลผ่าน ${num(r.passed)} คน${r.skipped.length ? ` · ข้าม ${num(r.skipped.length)} คน` : ''}`, r.passed ? 'ok' : 'error');
    await loadRoster();
  } catch (e) { toast(e.message, 'error'); }
}
function listTab() {
  const list = h('div', { class: 'list', id: 'roster' }, skeleton());
  let timer;
  const search = h('input', { class: 'input', type: 'search', placeholder: 'ค้นหาชื่อ เลขที่ใบสมัคร หรือมือถือ', value: q, 'aria-label': 'ค้นหา', oninput: () => { q = search.value.trim(); clearTimeout(timer); timer = setTimeout(loadRoster, 250); } });
  setTimeout(loadRoster);
  return h('section', { class: 'box' }, h('div', { class: 'kpis', id: 'rkpi' }), search, h('div', { class: 'tabs', style: { margin: '12px 0' } }, Object.entries(FILTERS).map(([k, l]) => h('button', { type: 'button', 'aria-selected': String(k === filter), onclick: () => { filter = k; picked.clear(); render(); } }, l))), h('div', { class: 'bar-actions', id: 'ractions' }), list);
}
async function loadRoster() {
  const box = $('#roster');
  try {
    const d = await get(`${base()}/roster?filter=${filter}&q=${encodeURIComponent(q)}`);
    if (!q) data = d;
    if (!box?.isConnected) return;
    const s = d.session; const c = d.counts;
    const kpi = (ic, col, label, v) => h('div', { class: 'kpi', style: { '--c': col } }, icon(ic), h('b', {}, num(v)), h('span', {}, label));
    $('#rkpi').replaceChildren(kpi('people-fill', '#6a4fc0', 'มีสิทธิ์เข้าอบรม', c.expected), kpi('person-check-fill', '#168447', 'มาแล้ว', c.attended), kpi('person-dash-fill', '#f5821f', 'ยังไม่มา', c.expected - c.attended), kpi('trophy-fill', '#2f7fb5', 'ประกาศผ่านแล้ว', c.passed));
    const rules = [`อย่างน้อย ${num(s.minDays)} วัน`, s.requireCheckout && 'ต้องเช็กเอาต์', s.minMinutes && `รวม ${hm(s.minMinutes)}`].filter(Boolean).join(' · ');
    const chosen = d.items.filter((p) => picked.has(p.id));
    $('#ractions').replaceChildren(h('span', { class: 'muted' }, `เกณฑ์ผ่าน: ${rules}`), h('a', { class: 'btn btn-sm', href: `${API_BASE}${base()}/export?filter=${filter}` }, icon('file-earmark-excel'), 'Excel'),
      ...(can('attendance.result') ? [h('button', { class: 'btn btn-green btn-sm', type: 'button', disabled: !c.ready, onclick: async () => { const all = await get(`${base()}/roster?filter=ready`); announce(all.items.slice(0, 300).map((p) => p.id), false); } }, icon('megaphone-fill'), `ประกาศผ่านผู้ที่ครบเกณฑ์ (${num(c.ready)})`), ...(chosen.length ? [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => announce(chosen.map((p) => p.id), chosen.some((p) => !p.met)) }, `ประกาศผ่านที่เลือก (${num(chosen.length)})`)] : [])] : []));
    box.replaceChildren(...(d.items.length ? d.items.map((p) => h('div', { class: 'krow' }, can('attendance.result') && p.status === 'attended' && h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: picked.has(p.id), 'aria-label': `เลือก ${p.fullName}`, onchange: (e) => { if (e.target.checked) picked.add(p.id); else picked.delete(p.id); loadRoster(); } })),
      h('button', { class: 'lrow cols', type: 'button', onclick: () => personDialog(p) }, h('span', { class: 'n' }, p.fullName), h('span', { class: 'm' }, p.todayIn ? `วันนี้ เข้า ${fmtTime(p.todayIn)}${p.todayOut ? ` ออก ${fmtTime(p.todayOut)}` : ''}` : p.days ? `มา ${num(p.days)} วัน` : 'ยังไม่มา', p.minutes ? ` · รวม ${hm(p.minutes)}` : '', p.days && !p.met ? ` · ขาด ${p.missing.join(', ')}` : ''), badge(p.status)),
      !p.todayIn && ['approved', 'awaiting_training', 'attended'].includes(p.status) && h('button', { class: 'icon-btn', type: 'button', 'aria-label': `เช็กอิน ${p.fullName}`, title: 'เช็กอินเอง', onclick: () => manualForm(p, 'in') }, icon('box-arrow-in-right')))) : [empty('people', 'ไม่พบรายชื่อ')]));
  } catch (e) { box?.replaceChildren(failed(e, loadRoster)); }
}

// ---------- โครงหน้า ----------
function render() {
  stopCamera();
  const s = sessions.find((x) => x.id === current);
  const select = h('select', { class: 'input', 'aria-label': 'เลือกรุ่นอบรม', onchange: () => { current = Number(select.value); picked.clear(); data = null; history.replaceState(null, '', `?session=${current}`); render(); } }, sessions.map((x) => h('option', { value: x.id, selected: x.id === current }, `${x.name} · ${x.universityName} · ${fmtRange(x.startsAt, x.endsAt)}`)));
  main.replaceChildren(h('section', { class: 'att-hero' }, h('div', {}, h('h2', {}, s.name), h('p', {}, `${s.universityName} · ${fmtRange(s.startsAt, s.endsAt)} · ${fmtTime(s.startsAt)}–${fmtTime(s.endsAt)} น.`)), select),
    h('div', { class: 'tabs', role: 'tablist' }, [['scan', 'สแกน QR'], ['list', 'รายชื่อและผล'], ['log', 'ประวัติสแกน']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; render(); } }, l))),
    tab === 'scan' ? scanTab() : tab === 'list' ? listTab() : h('section', { class: 'box' }, h('div', { id: 'recent' }, skeleton())));
  if (tab === 'scan') bumpCounter();
  if (tab !== 'list') paintRecent();
}
async function load() {
  main.replaceChildren(...skeleton());
  try {
    sessions = await get('/admin/attendance/sessions');
    if (!sessions.length) { main.replaceChildren(empty('calendar-x', 'ยังไม่มีรุ่นที่เปิดใช้งาน เพิ่มได้ที่ "ตัวเลือกฟอร์ม"')); return; }
    const want = Number(new URLSearchParams(location.search).get('session'));
    current = sessions.some((s) => s.id === want) ? want : sessions[0].id;
    render();
  } catch (e) { main.replaceChildren(failed(e, load)); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); else if (tab === 'scan' && current) restart?.(); });
addEventListener('pagehide', stopCamera);
setInterval(() => { if (tab === 'scan' && current && !document.hidden) { bumpCounter(); paintRecent(); } }, 15_000);
load();
