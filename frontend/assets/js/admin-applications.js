import { api, get, send } from './api.js';
import { API_BASE } from './config.js';
import { busy, confirmDialog, fmtDateTime, fmtRange, h, icon, toast } from './ui.js';
import { celebrate } from './fx.js';
import { badge, can, empty, failed, initAdmin, pager, skeleton, STATUS } from './admin.js';

const main = await initAdmin('applications');
const init = new URLSearchParams(location.search);
// ตัวกรองที่มาจากการ์ดหน้าภาพรวม: หลายสถานะ, สมัครวันนี้, ผูก LINE แล้ว
const VIEWS = { pending: ['submitted,under_review', 'รอตรวจเอกสาร'], approved: ['approved,awaiting_training,attended,passed,certified', 'อนุมัติแล้ว (รวมขั้นถัดไป)'] };
const group = (init.get('status') ?? '').split(',').filter((x) => STATUS[x]);
const f = { q: '', status: group.length === 1 ? group[0] : '', group: group.length > 1 ? group.join(',') : '', when: init.get('when') === 'today' ? 'today' : '', line: init.get('line') === 'linked' ? 'linked' : '', page: 1 };
const chipText = () => [f.group && (Object.values(VIEWS).find(([v]) => v === f.group)?.[1] ?? 'หลายสถานะ'), f.when && 'สมัครวันนี้', f.line && 'ผูก LINE กับบุคคลแล้ว'].filter(Boolean).join(' · ');
const list = h('div', { class: 'list' });
const foot = h('div', {});
const qs = () => new URLSearchParams(Object.entries({ q: f.q, status: f.status || f.group, when: f.when, line: f.line, page: f.page }).filter(([, v]) => v !== ''));
let timer; let seq = 0; let items = [];
const search = h('input', { class: 'input', type: 'search', placeholder: 'ชื่อ เลขที่ใบสมัคร มือถือ อีเมล ร้าน หรือเลขบัตร', 'aria-label': 'ค้นหาผู้สมัคร', oninput: () => { clearTimeout(timer); timer = setTimeout(() => { f.q = search.value.trim(); f.page = 1; load(); }, 280); } });
const status = h('select', { class: 'input', 'aria-label': 'กรองสถานะ', onchange: () => { f.status = status.value; f.group = ''; f.page = 1; paintChip(); load(); } }, h('option', { value: '' }, 'ทุกสถานะ'), Object.entries(STATUS).map(([k, v]) => h('option', { value: k, selected: k === f.status }, v[1])));
const exportBtn = can('applicants.export') && h('button', { class: 'btn btn-purple', type: 'button', onclick: () => { const p = qs(); p.delete('page'); location.href = `${API_BASE}/admin/applications/export?${p}`; } }, icon('file-earmark-excel-fill'), 'ส่งออก Excel');
const chip = h('div', { class: 'fchip-row' });
function paintChip() {
  const t = chipText();
  chip.replaceChildren(...(t ? [h('span', { class: 'fchip' }, icon('funnel-fill'), ` ${t} `, h('button', { type: 'button', 'aria-label': 'ล้างตัวกรอง', onclick: () => { f.group = ''; f.when = ''; f.line = ''; f.page = 1; history.replaceState(null, '', location.pathname); paintChip(); load(); } }, icon('x-lg')))] : []));
}
paintChip();
main.replaceChildren(h('section', { class: 'box' }, h('div', { class: 'filters' }, search, status, exportBtn), chip, list, foot));

async function load(quiet = false) {
  const my = ++seq;
  if (!quiet) { list.replaceChildren(...skeleton(5)); foot.replaceChildren(); }
  try {
    const { data, meta } = await api(`/admin/applications?${qs()}`);
    if (my !== seq) return;
    items = data;
    list.replaceChildren(...(data.length ? data.map((a) => h('button', { class: 'lrow cols', type: 'button', onclick: () => open(a.id) }, h('span', { class: 'n' }, a.fullName, a.hasLine && h('i', { class: 'bi bi-line', title: 'มี LINE', style: { color: '#05a848', 'margin-left': '8px' } })), h('span', { class: 'm' }, `${a.applicationNo} · ${a.sessionName} · ${fmtDateTime(a.submittedAt)}`), badge(a.status))) : [empty('inbox', f.q || f.status || chipText() ? 'ไม่พบผู้สมัครตามเงื่อนไข' : 'ยังไม่มีผู้สมัคร')]));
    foot.replaceChildren(...(data.length ? [pager(meta, (p) => { f.page = p; load(); })] : []));
  } catch (e) { if (my === seq) list.replaceChildren(failed(e, () => load())); }
}

// ---------- จอคู่ตรวจเอกสาร ----------
const CONSENT = { privacy_notice_ack: 'รับทราบประกาศความเป็นส่วนตัว', terms: 'ตกลงตามเงื่อนไขการใช้งาน', sensitive_id_card: 'ยินยอมข้อมูลอ่อนไหวในภาพบัตร' };
const MAIL = { pending: ['warn', 'รอส่ง'], processing: ['info', 'กำลังส่ง'], sent: ['ok', 'ส่งแล้ว'], failed: ['bad', 'ส่งไม่สำเร็จ'], cancelled: ['', 'ยกเลิก'] };
const REV = { approved: ['ok', 'check-circle-fill'], rejected: ['bad', 'x-circle-fill'], pending: ['wait', 'clock-fill'] };
function makeStage() {
  const el = h('div', { class: 'stage' });
  let s; let drag; let pinch; const pts = new Map();
  const paint = () => { for (const [k, v] of [['--z', s.z], ['--r', `${s.r}deg`], ['--x', `${s.x}px`], ['--y', `${s.y}px`]]) el.style.setProperty(k, v); };
  const reset = () => { s = { z: 1, r: 0, x: 0, y: 0 }; paint(); };
  const zoom = (k) => { s.z = Math.min(6, Math.max(0.5, s.z * k)); paint(); };
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 0.89); }, { passive: false });
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = { x: e.clientX - s.x, y: e.clientY - s.y }; if (pts.size === 2) pinch = dist(); });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const d = dist(); zoom(d / pinch); pinch = d; } else { s.x = e.clientX - drag.x; s.y = e.clientY - drag.y; paint(); }
  });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, (e) => { pts.delete(e.pointerId); const [p] = pts.values(); if (p) drag = { x: p.x - s.x, y: p.y - s.y }; });
  reset();
  return { el, reset, zoom, rotate: () => { s.r += 90; paint(); } };
}
let dialog;
async function open(id) {
  if (dialog) dialog.close();
  const d = dialog = h('dialog', { class: 'review', 'aria-label': 'รายละเอียดใบสมัคร' });
  let a; let cur = 0; let blobUrl; let token = 0;
  const stage = makeStage();
  d.addEventListener('close', () => { d.remove(); if (dialog === d) dialog = null; if (blobUrl) URL.revokeObjectURL(blobUrl); if (location.hash === `#${id}`) history.replaceState(null, '', location.pathname + location.search); load(true); });
  d.append(h('div', { class: 'rv solo' }, h('div', { class: 'info' }, skeleton(6))));
  document.body.append(d);
  d.showModal();
  history.replaceState(null, '', `#${id}`);

  const canReview = () => can('applicants.review') && ['submitted', 'under_review'].includes(a.status);
  async function showDoc() {
    const doc = a.documents[cur];
    const my = ++token;
    stage.reset();
    if (doc.purged) { stage.el.replaceChildren(h('p', {}, 'ไฟล์ถูกลบตามระยะเวลาเก็บหรือการถอนความยินยอมแล้ว')); return; }
    stage.el.replaceChildren(h('span', { class: 'spin' }));
    try {
      const res = await fetch(`${API_BASE}/admin/applications/${id}/documents/${doc.id}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      if (my !== token || !d.open) return;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(blob);
      stage.el.replaceChildren(doc.mime === 'application/pdf' ? h('iframe', { src: blobUrl, title: doc.label }) : h('img', { src: blobUrl, alt: doc.label, draggable: false }));
    } catch { if (my === token) stage.el.replaceChildren(h('p', {}, 'เปิดเอกสารไม่สำเร็จ')); }
  }
  async function refresh(next) { a = next; render(); }
  async function review(decision, btn) {
    const doc = a.documents[cur];
    let reason = null;
    if (decision === 'rejected') { reason = await confirmDialog({ title: `ไม่ผ่าน: ${doc.label}`, confirm: 'บันทึกว่าไม่ผ่าน', danger: true, reason: true }); if (!reason) return; }
    await busy(btn, async () => {
      try {
        a = await send('POST', `/admin/applications/${id}/documents/${doc.id}/review`, { decision, reason });
        const nextPending = a.documents.findIndex((x) => x.reviewStatus === 'pending');
        if (nextPending >= 0) cur = nextPending;
        else toast('ตรวจครบทุกเอกสารแล้ว');
      } catch (e) { toast(e.message, 'error'); a = await get(`/admin/applications/${id}`).catch(() => a); }
    });
    render();
  }
  async function transition(t, btn) {
    let reason = null;
    if (t.needsReason && t.status !== 'documents_incomplete') { reason = await confirmDialog({ title: t.label, confirm: 'ยืนยัน', danger: true, reason: true }); if (!reason) return; } else if (!(await confirmDialog({ title: `เปลี่ยนสถานะเป็น "${t.label}"?`, text: t.status === 'documents_incomplete' ? 'ผู้สมัครจะเห็นเหตุผลของเอกสารที่ไม่ผ่านและส่งใหม่ได้' : '' }))) return;
    await busy(btn, async () => {
      try { a = await send('POST', `/admin/applications/${id}/status`, { status: t.status, expectedStatus: a.status, reason }); toast('บันทึกสถานะแล้ว'); if (t.status === 'approved') celebrate(); } catch (e) { toast(e.message, 'error'); a = await get(`/admin/applications/${id}`).catch(() => a); }
    });
    render();
  }
  const kv = (k, v, wide) => v && h('div', { class: wide ? 'wide' : '' }, h('dt', {}, k), h('dd', {}, v));
  function render() {
    if (!d.open) return;
    const docs = a.documents;
    const idx = items.findIndex((x) => x.id === id);
    const nav = (step, ic, label) => items[idx + step] && idx >= 0 && h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, onclick: () => open(items[idx + step].id) }, icon(ic));
    const nid = h('dd', {}, a.nationalId);
    const viewer = docs.length > 0 && h('section', { class: 'viewer', 'aria-label': 'เอกสาร' },
      h('div', { class: 'dtabs', role: 'tablist' }, docs.map((x, i) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(i === cur), onclick: () => { cur = i; render(); } }, h('i', { class: `bi bi-${REV[x.reviewStatus][1]} ${REV[x.reviewStatus][0]}` }), x.label, x.version > 1 && ` (ครั้งที่ ${x.version})`))),
      stage.el,
      docs[cur].reviewReason && h('div', { class: 'vtools' }, `เหตุผล: ${docs[cur].reviewReason}`),
      h('div', { class: 'vtools' }, [['zoom-in', 'ขยาย', () => stage.zoom(1.3)], ['zoom-out', 'ย่อ', () => stage.zoom(0.77)], ['arrow-clockwise', 'หมุน', stage.rotate], ['fullscreen-exit', 'คืนค่า', stage.reset]].map(([ic, l, fn]) => h('button', { type: 'button', 'aria-label': l, title: l, onclick: fn }, icon(ic))), h('a', { href: `${API_BASE}/admin/applications/${id}/documents/${docs[cur].id}`, target: '_blank', rel: 'noopener', 'aria-label': 'เปิดแท็บใหม่', title: 'เปิดแท็บใหม่' }, icon('box-arrow-up-right'))),
      canReview() && h('div', { class: 'vact' }, h('button', { class: 'btn btn-danger', type: 'button', id: 'rj', onclick: (e) => review('rejected', e.currentTarget) }, icon('x-lg'), 'ไม่ผ่าน', h('kbd', {}, 'R')), h('button', { class: 'btn btn-green', type: 'button', id: 'ap', onclick: (e) => review('approved', e.currentTarget) }, icon('check-lg'), 'ผ่าน', h('kbd', {}, 'A'))));
    d.replaceChildren(h('div', { class: `rv ${viewer ? '' : 'solo'}` },
      h('header', {}, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด', onclick: () => d.close() }, icon('x-lg')), h('div', {}, h('strong', {}, a.fullName), h('small', { class: 'muted' }, a.applicationNo)), nav(-1, 'chevron-up', 'ใบก่อนหน้า'), nav(1, 'chevron-down', 'ใบถัดไป')),
      viewer,
      h('section', { class: 'info' },
        h('div', { class: 'box' }, h('div', { class: 'bar-actions' }, badge(a.status)), a.statusReason && h('p', { class: 'muted' }, a.statusReason),
          a.allowedTransitions.length > 0 && h('div', { class: 'bar-actions', style: { margin: '12px 0 0' } }, a.allowedTransitions.map((t) => h('button', { class: `btn btn-sm ${['rejected', 'cancelled'].includes(t.status) ? '' : t.status === 'documents_incomplete' ? 'btn-purple' : 'btn-green'}`, type: 'button', onclick: (e) => transition(t, e.currentTarget) }, t.label)))),
        h('div', { class: 'box' }, h('h2', {}, 'ข้อมูลผู้สมัคร'), h('dl', { class: 'kv' },
          h('div', {}, h('dt', {}, 'เลขประจำตัวประชาชน'), nid, can('documents.view') && h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => { const b = e.currentTarget; try { const r = await send('POST', `/admin/applications/${id}/reveal-ids`); nid.textContent = r.nationalId; b.remove(); setTimeout(() => { nid.textContent = a.nationalId; }, 30_000); } catch (x) { toast(x.message, 'error'); } } }, icon('eye'), 'แสดง 30 วินาที (บันทึก log)')),
          kv('มือถือ', a.mobile), kv('อีเมล', a.email), kv('LINE ID', a.lineContactId), kv('ที่อยู่', a.address, true))),
        h('div', { class: 'box' }, h('h2', {}, 'การอบรม'), h('dl', { class: 'kv' }, kv('หลักสูตร', a.courseName, true), kv('มหาวิทยาลัย', a.universityName), kv('รุ่น', a.sessionName), kv('วันอบรม', fmtRange(a.startsAt, a.endsAt)), kv('สถานที่', a.location), a.hasTrainedBefore !== undefined && kv('เคยอบรม', a.hasTrainedBefore ? 'เคย' : 'ไม่เคย'))),
        a.shopAddress && h('div', { class: 'box' }, h('h2', {}, 'ร้านค้าและใบเสร็จ'), h('dl', { class: 'kv' }, kv('ร้านค้า', a.shopName), kv('ระยะเวลาเปิดร้าน', a.shopDuration), kv('ที่ตั้ง', a.shopAddress, true), kv('ชื่อในใบเสร็จ', a.receiptName), kv('เลขผู้เสียภาษี', a.taxId), kv('ที่อยู่ใบเสร็จ', a.receiptAddress, true))),
        h('div', { class: 'box' }, h('h2', {}, 'อีเมลยืนยันการสมัคร'), h('div', { class: 'bar-actions', style: { margin: '0' } }, h('span', { class: `badge ${MAIL[a.emailStatus?.status]?.[0] ?? ''}` }, MAIL[a.emailStatus?.status]?.[1] ?? 'ยังไม่มี'), a.emailStatus?.sent_at && h('small', { class: 'muted' }, fmtDateTime(a.emailStatus.sent_at)), a.emailStatus?.error_message && h('small', { class: 'muted' }, a.emailStatus.error_message),
          can('applicants.review') && h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { try { await send('POST', `/admin/applications/${id}/resend-email`); toast('เข้าคิวส่งอีเมลแล้ว'); } catch (x) { toast(x.message, 'error'); } }) }, icon('send'), 'ส่งอีกครั้ง'))),
        (a.hold || can('retention.manage')) && h('div', { class: 'box' }, h('h2', {}, 'การระงับการลบ'), a.hold ? h('p', {}, h('span', { class: 'badge warn' }, 'ระงับอยู่'), ` ${a.hold.reason} · ${fmtDateTime(a.hold.at)}`) : h('p', { class: 'muted' }, 'ใช้เมื่อกฎหมายให้เก็บต่อหรือมีข้อพิพาท'),
          can('retention.manage') && h('button', { class: 'btn btn-sm', type: 'button', style: { 'margin-top': '10px' }, onclick: async () => {
            const reason = a.hold ? null : await confirmDialog({ title: 'ระงับการลบข้อมูลใบนี้', confirm: 'ระงับ', reason: true, placeholder: 'เหตุผล เช่น ข้อพิพาท หรือกฎหมายที่ให้เก็บ' });
            if (!a.hold && !reason) return;
            if (a.hold && !(await confirmDialog({ title: 'ปลดการระงับ?', text: 'ใบนี้จะเข้ารายการลบเมื่อครบกำหนด', confirm: 'ปลด' }))) return;
            try { a = await send('POST', `/admin/applications/${id}/hold`, { reason }); toast('บันทึกแล้ว'); } catch (e) { toast(e.message, 'error'); }
            render();
          } }, a.hold ? 'ปลดการระงับ' : 'ระงับการลบ')),
        h('div', { class: 'box' }, h('h2', {}, 'การรับทราบและความยินยอม'), h('ul', { class: 'hist' }, a.consents.map((c) => h('li', {}, CONSENT[c.purpose] ?? c.purpose, c.withdrawn_at && [' ', h('span', { class: 'badge bad' }, 'ถอนแล้ว ต้องปิดทับ/ขอภาพใหม่')], h('small', {}, `${fmtDateTime(c.accepted_at)} · ฉบับ ${c.notice_version}`))))),
        h('div', { class: 'box' }, h('h2', {}, 'ประวัติสถานะ'), h('ul', { class: 'hist' }, a.history.map((x) => h('li', {}, STATUS[x.to_status]?.[1] ?? x.to_status, h('small', {}, `${fmtDateTime(x.created_at)} · ${x.admin_name ?? (x.actor_type === 'applicant' ? 'ผู้สมัคร' : 'ระบบ')}${x.reason ? ` · ${x.reason}` : ''}`))))))));
    const key = viewer && docs[cur].id;
    if (key && stage.key !== key) { stage.key = key; showDoc(); }
  }
  d.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select') || e.metaKey || e.ctrlKey || document.querySelectorAll('dialog[open]').length > 1) return;
    const k = e.key.toLowerCase();
    if (k === 'a') d.querySelector('#ap')?.click();
    if (k === 'r') d.querySelector('#rj')?.click();
    if (k === 'arrowright' && a && cur < a.documents.length - 1) { cur += 1; render(); }
    if (k === 'arrowleft' && a && cur > 0) { cur -= 1; render(); }
  });
  try {
    const data = await get(`/admin/applications/${id}`);
    cur = Math.max(0, data.documents.findIndex((x) => x.reviewStatus === 'pending'));
    refresh(data);
  } catch (e) { d.replaceChildren(h('div', { class: 'rv solo' }, h('header', {}, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด', onclick: () => d.close() }, icon('x-lg'))), failed(e, () => open(id)))); }
}
const fromHash = () => { const id = Number(location.hash.slice(1)); if (Number.isInteger(id) && id > 0) open(id); };
addEventListener('hashchange', fromHash);
await load();
fromHash();
