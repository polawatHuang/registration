import { api, blobUrl, get, send, upload } from './api.js';
import { API_BASE } from './config.js';
import { busy, confirmDialog, fmtDate, fmtDateTime, fmtRange, h, icon, num, toast } from './ui.js';
import { celebrate } from './fx.js';
import { can, empty, failed, formDialog, initAdmin, pager, skeleton } from './admin.js';

const main = await initAdmin('certificates');
let tab = 'issue'; let sessions = []; let sessionId = null; const picked = new Set();
const list = { page: 1, q: '', status: '' };
const PAGE_W = 841.89;

async function copy(text) { try { await navigator.clipboard.writeText(text); toast('คัดลอกลิงก์แล้ว'); } catch { toast('คัดลอกไม่สำเร็จ', 'error'); } }
/** เปิด PDF ในหน้าต่างของเว็บ ไม่ถูกบล็อก popup */
function pdfDialog(url, title) {
  const d = h('dialog', { class: 'pdfd', onclose: () => { d.remove(); URL.revokeObjectURL(url); }, 'aria-label': title }, h('header', {}, h('strong', {}, title), h('a', { class: 'btn btn-sm', href: url, download: `${title}.pdf` }, icon('download'), 'ดาวน์โหลด'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด', onclick: () => d.close() }, icon('x-lg'))), h('iframe', { src: url, title }));
  document.body.append(d); d.showModal();
}
const openPdf = (btn, path, title, fd) => busy(btn, async () => { try { pdfDialog(await blobUrl(path, fd), title); } catch (e) { toast(e.message, 'error'); } });

// ---------- ออกใบ ----------
async function issueTab(box) {
  sessions = sessions.length ? sessions : await get('/admin/attendance/sessions');
  if (!sessions.length) { box.replaceChildren(empty('calendar-x', 'ยังไม่มีรุ่นอบรม')); return; }
  sessionId ??= sessions[0].id;
  const rows = await get(`/admin/certificates/candidates/${sessionId}`);
  const todo = rows.filter((r) => r.status === 'passed');
  for (const id of [...picked]) if (!todo.some((r) => r.id === id)) picked.delete(id);
  const sel = h('select', { class: 'input', 'aria-label': 'เลือกรุ่น', onchange: () => { sessionId = Number(sel.value); picked.clear(); load(); } }, sessions.map((x) => h('option', { value: x.id, selected: x.id === sessionId }, `${x.name} · ${x.universityName} · ${fmtRange(x.startsAt, x.endsAt)}`)));
  const btn = h('button', { class: 'btn btn-green', type: 'button', disabled: !picked.size, onclick: async () => {
    if (!(await confirmDialog({ title: `ออกใบประกาศ ${num(picked.size)} ใบ?`, text: 'ระบบจะออกเลขที่ และแจ้งผู้รับพร้อมลิงก์ใบประกาศ', confirm: 'ออกใบประกาศ' }))) return;
    try { const r = await send('POST', '/admin/certificates/issue', { ids: [...picked].slice(0, 300) }); picked.clear(); if (r.issued) celebrate(); toast(`ออกใบประกาศแล้ว ${num(r.issued)} ใบ${r.skipped.length ? ` · ข้าม ${num(r.skipped.length)}` : ''}`, r.issued ? 'ok' : 'error'); load(); } catch (e) { toast(e.message, 'error'); }
  } }, icon('award-fill'), `ออกใบที่เลือก (${num(picked.size)})`);
  const one = picked.size === 1 ? todo.find((r) => picked.has(r.id)) : null;
  box.replaceChildren(sel, h('div', { class: 'bar-actions', style: { margin: '14px 0' } }, btn, one && h('button', { class: 'btn', type: 'button', onclick: () => formDialog({ title: 'ออกใบโดยแก้ชื่อบนใบ', values: { name: one.full_name }, fields: [{ name: 'name', label: 'ชื่อบนใบประกาศ', required: true, wide: true, hint: 'ตรวจกับบัตรประชาชน การแก้ถูกบันทึกใน Audit Logs' }], onSave: async (v) => { await send('POST', '/admin/certificates/issue', { ids: [one.id], name: v.name }); picked.clear(); toast('ออกใบประกาศแล้ว'); load(); } }) }, icon('pencil-fill'), 'แก้ชื่อแล้วออก'), todo.length ? h('button', { class: 'btn', type: 'button', onclick: () => { const all = picked.size === Math.min(todo.length, 300); picked.clear(); if (!all) todo.slice(0, 300).forEach((r) => picked.add(r.id)); load(); } }, picked.size === Math.min(todo.length, 300) ? 'ไม่เลือกเลย' : `เลือกทั้งหมด (${num(todo.length)})`) : h('span', { class: 'muted' }, 'ไม่มีผู้รอออกใบ ประกาศผลผ่านได้ที่หน้า "เช็กชื่อ"')),
    h('div', { class: 'list' }, rows.length ? rows.map((r) => (r.status === 'passed'
      ? h('label', { class: 'lrow chkrow' }, h('input', { type: 'checkbox', checked: picked.has(r.id), onchange: (e) => { if (e.target.checked) picked.add(r.id); else picked.delete(r.id); load(); } }), h('span', { class: 'n' }, r.full_name), h('span', { class: 'badge warn' }, 'รอออกใบ'), h('span', { class: 'm' }, r.application_no))
      : h('div', { class: 'krow' }, h('div', { class: 'lrow cols' }, h('span', { class: 'n' }, r.full_name), h('span', { class: 'm' }, r.certificate_no ? `${r.certificate_no} · ${fmtDateTime(r.issued_at)}` : r.application_no), h('span', { class: 'badge ok' }, 'ออกแล้ว')), r.certificate_id && h('button', { class: 'icon-btn', type: 'button', 'aria-label': `ดูใบประกาศ ${r.full_name}`, onclick: (e) => openPdf(e.currentTarget, `/admin/certificates/${r.certificate_id}/pdf`, r.certificate_no) }, icon('file-earmark-pdf'))))) : empty('award', 'รุ่นนี้ยังไม่มีผู้ผ่านการอบรม')));
}

// ---------- ใบที่ออกแล้ว ----------
async function issuedTab(box) {
  const res = await api(`/admin/certificates?page=${list.page}&q=${encodeURIComponent(list.q)}&status=${list.status}`);
  let timer;
  const search = h('input', { class: 'input', type: 'search', value: list.q, placeholder: 'ค้นหาชื่อหรือเลขที่ใบประกาศ', 'aria-label': 'ค้นหา', oninput: () => { clearTimeout(timer); timer = setTimeout(() => { list.q = search.value.trim(); list.page = 1; load(); }, 350); } });
  const st = h('select', { class: 'input', 'aria-label': 'สถานะ', onchange: () => { list.status = st.value; list.page = 1; load(); } }, [['', 'ทุกสถานะ'], ['valid', 'ใช้งานได้'], ['revoked', 'เพิกถอน']].map(([v, l]) => h('option', { value: v, selected: v === list.status }, l)));
  box.replaceChildren(h('div', { class: 'filters' }, search, st), h('div', { class: 'list' }, res.data.length ? res.data.map((c) => h('div', { class: 'krow' }, h('div', { class: 'lrow cols' }, h('span', { class: 'n' }, c.name ?? 'ข้อมูลผู้รับถูกลบแล้ว'), h('span', { class: 'm' }, `${c.number} · ${c.session} · ออก ${fmtDate(c.issuedAt)} โดย ${c.issuedBy ?? '-'}${c.reason ? ` · เพิกถอนเพราะ ${c.reason}` : ''}`), h('span', { class: `badge ${c.status === 'valid' ? 'ok' : 'bad'}` }, c.status === 'valid' ? 'ใช้งานได้' : 'เพิกถอน')),
    c.name && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ดู PDF', title: 'ดู PDF', onclick: (e) => openPdf(e.currentTarget, `/admin/certificates/${c.id}/pdf`, c.number) }, icon('file-earmark-pdf')), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'คัดลอกลิงก์ตรวจสอบ', title: 'คัดลอกลิงก์ตรวจสอบ', onclick: () => copy(c.url) }, icon('link-45deg')),
    c.status === 'valid' && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'เพิกถอน', title: 'เพิกถอน', onclick: async () => { const reason = await confirmDialog({ title: `เพิกถอน ${c.number}?`, text: 'ลิงก์ตรวจสอบจะแสดงว่าถูกเพิกถอน และออกใบใหม่ให้บุคคลนี้ได้', confirm: 'เพิกถอน', danger: true, reason: true, placeholder: 'เหตุผล (ไม่แสดงต่อสาธารณะ)' }); if (!reason) return; try { await send('POST', `/admin/certificates/${c.id}/revoke`, { reason }); toast('เพิกถอนแล้ว'); load(); } catch (e) { toast(e.message, 'error'); } } }, icon('slash-circle')))) : empty('award', 'ยังไม่มีใบประกาศ')), pager({ ...res.meta }, (p) => { list.page = p; load(); }));
  if (list.q) { search.focus(); search.setSelectionRange(list.q.length, list.q.length); }
}

// ---------- แบบใบประกาศ ----------
const SAMPLE = { name: 'นายต้นข้าว ใจดี', course: 'หลักสูตรผู้ควบคุมการขายวัตถุอันตรายทางการเกษตร', place: 'มหาวิทยาลัยตัวอย่าง · รุ่นตัวอย่าง', dates: 'อบรมวันที่ 15 มกราคม 2570 – 16 มกราคม 2570', issued: 'ออกให้ ณ วันที่ 20 มกราคม 2570', number: 'เลขที่ ET-2570-000001' };
const TEXT_KEYS = ['title', 'lead', 'after', 'signer', 'signerTitle'];
async function editor(t, d) {
  const layout = structuredClone(t?.layout ?? d.defaults);
  let image = null; let imgUrl = null; let removeImage = false; let sel = 'name';
  if (t?.hasImage) imgUrl = await blobUrl(`/admin/certificates/templates/${t.id}/image`).catch(() => null);
  let courses = [];
  if (can('catalog.manage')) courses = (await get('/admin/catalog')).courses;
  else if (t?.courseId) courses = [{ id: t.courseId, name: t.courseName }];
  const name = h('input', { class: 'input', value: t?.name ?? '', placeholder: 'ชื่อแบบ เช่น ใบประกาศปี 2569', maxLength: 100, 'aria-label': 'ชื่อแบบ' });
  const course = h('select', { class: 'input', 'aria-label': 'ใช้กับหลักสูตร' }, h('option', { value: '' }, 'ทุกหลักสูตร'), courses.map((c) => h('option', { value: c.id, selected: c.id === t?.courseId }, c.name)));
  const canvas = h('div', { class: 'cert-canvas', role: 'application', 'aria-label': 'ตัวอย่างใบประกาศ ลากเพื่อย้ายตำแหน่ง' });
  const side = h('div', { class: 'cert-side' });
  const textOf = (k) => (TEXT_KEYS.includes(k) ? layout.texts[k] : SAMPLE[k]) || `(${d.labels[k]})`;
  const paint = () => {
    canvas.style.setProperty('--bg', `url("${imgUrl ?? '/assets/images/cert-bg.svg'}")`);
    canvas.replaceChildren(...Object.entries(layout.fields).filter(([, f]) => f.show).map(([k, f]) => {
      const el = k === 'qr' ? h('div', { class: 'cf qr', style: { left: `${f.x}%`, top: `${f.y}%`, width: `${(f.size / PAGE_W) * 100}%` } }, icon('qr-code')) : h('div', { class: `cf al-${f.align} ${f.bold ? 'b' : ''} ${TEXT_KEYS.includes(k) && !layout.texts[k] ? 'ghost' : ''}`, style: { left: `${f.x}%`, top: `${f.y}%`, color: f.color, 'font-size': `${(f.size / PAGE_W) * 100}cqw` } }, textOf(k));
      if (k === sel) el.classList.add('sel');
      el.tabIndex = 0; el.setAttribute('aria-label', d.labels[k]);
      const move = (dx, dy) => { f.x = Math.round(Math.max(0, Math.min(100, f.x + dx)) * 10) / 10; f.y = Math.round(Math.max(0, Math.min(98, f.y + dy)) * 10) / 10; el.style.left = `${f.x}%`; el.style.top = `${f.y}%`; };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); el.setPointerCapture(e.pointerId); const r = canvas.getBoundingClientRect(); let [px, py] = [e.clientX, e.clientY];
        for (const x of canvas.children) x.classList.toggle('sel', x === el); sel = k; props();
        const mv = (m) => { move(((m.clientX - px) / r.width) * 100, ((m.clientY - py) / r.height) * 100); px = m.clientX; py = m.clientY; };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', () => { el.removeEventListener('pointermove', mv); props(); }, { once: true });
      });
      el.addEventListener('keydown', (e) => { const s = e.shiftKey ? 2 : 0.5; const m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key]; if (m) { e.preventDefault(); sel = k; move(...m); props(); } });
      return el;
    }));
  };
  const fld = (label, el) => h('label', { class: 'fld' }, h('span', {}, label), el);
  const numIn = (f, key, min, max) => h('input', { class: 'input', type: 'number', min, max, step: 0.5, value: f[key], onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { f[key] = Math.max(min, Math.min(max, v)); paint(); } } });
  function props() {
    const f = layout.fields[sel];
    side.replaceChildren(h('div', { class: 'checks' }, Object.keys(layout.fields).map((k) => h('button', { class: `btn btn-sm ${k === sel ? 'btn-purple' : ''}`, type: 'button', onclick: () => { sel = k; layout.fields[k].show = true; paint(); props(); } }, layout.fields[k].show ? '' : icon('eye-slash'), d.labels[k]))),
      h('h3', {}, d.labels[sel]), TEXT_KEYS.includes(sel) ? fld('ข้อความ', h('input', { class: 'input', maxLength: 200, value: layout.texts[sel], oninput: (e) => { layout.texts[sel] = e.target.value; paint(); } })) : h('p', { class: 'muted' }, 'ระบบใส่ข้อมูลจริงให้ตอนออกใบ'),
      h('div', { class: 'fgrid two' }, fld('ขนาด', numIn(f, 'size', sel === 'qr' ? 40 : 8, sel === 'qr' ? 200 : 120)), ...(sel === 'qr' ? [] : [fld('สี', h('input', { class: 'input', type: 'color', value: f.color, oninput: (e) => { f.color = e.target.value; paint(); } }))]), fld('ซ้าย-ขวา %', numIn(f, 'x', 0, 100)), fld('บน-ล่าง %', numIn(f, 'y', 0, 100))),
      ...(sel === 'qr' ? [] : [fld('จัดแนว', h('select', { class: 'input', onchange: (e) => { f.align = e.target.value; paint(); } }, [['left', 'ชิดซ้าย'], ['center', 'กลาง'], ['right', 'ชิดขวา']].map(([v, l]) => h('option', { value: v, selected: v === f.align }, l)))), h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.bold, onchange: (e) => { f.bold = e.target.checked; paint(); } }), 'ตัวหนา')]),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.show, onchange: (e) => { f.show = e.target.checked; paint(); } }), 'แสดงในใบ'));
  }
  const file = h('input', { type: 'file', accept: '.jpg,.jpeg,.png', class: 'sr', id: 'cert-img', onchange: () => { const x = file.files[0]; if (!x) return; if (x.size > 8 * 1024 * 1024) { toast('ภาพต้องไม่เกิน 8 MB', 'error'); return; } image = x; removeImage = false; imgUrl = URL.createObjectURL(x); paint(); } });
  const form = () => { const fd = new FormData(); fd.append('layout', JSON.stringify(layout)); if (image) fd.append('image', image, image.name); return fd; };
  const dlg = h('dialog', { class: 'cert-dialog', 'aria-label': 'ออกแบบใบประกาศ', onclose: () => dlg.remove() }, h('header', {}, h('strong', {}, t ? 'แก้แบบใบประกาศ' : 'แบบใบประกาศใหม่'), h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => openPdf(e.currentTarget, `/admin/certificates/templates${t && !removeImage ? `/${t.id}` : ''}/preview`, 'ตัวอย่างใบประกาศ', form()) }, icon('eye-fill'), 'ดู PDF'),
    h('button', { class: 'btn btn-green btn-sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { const fd = form(); fd.append('name', name.value); fd.append('courseId', course.value); fd.append('removeImage', String(removeImage)); try { await upload(`/admin/certificates/templates${t ? `/${t.id}` : ''}`, fd); toast('บันทึกแบบแล้ว'); dlg.close(); load(); } catch (x) { toast(x.errors?.[0]?.message ?? x.message, 'error'); } }) }, icon('check-lg'), 'บันทึก'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด', onclick: () => dlg.close() }, icon('x-lg'))),
  h('div', { class: 'cert-body' }, h('div', { class: 'cert-stage' }, canvas, h('p', { class: 'muted' }, 'ลากข้อความเพื่อย้าย หรือใช้ปุ่มลูกศร ชื่อที่ยาวจะย่อให้พอดีเอง')), h('div', { class: 'cert-panel' }, name, course, h('div', { class: 'bar-actions' }, file, h('label', { class: 'btn btn-sm', htmlFor: 'cert-img' }, icon('image'), 'ภาพพื้นหลัง A4 แนวนอน'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { image = null; removeImage = true; imgUrl = null; paint(); } }, 'ใช้ลายของระบบ')), t?.used ? h('p', { class: 'notice-sm' }, icon('info-circle'), `แบบนี้ออกไปแล้ว ${num(t.used)} ใบ การบันทึกจะสร้างแบบใหม่ ใบเดิมไม่เปลี่ยน`) : null, side)));
  document.body.append(dlg); paint(); props(); dlg.showModal();
}
async function templateTab(box) {
  const d = await get('/admin/certificates/templates');
  box.replaceChildren(h('div', { class: 'bar-actions' }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => editor(null, d).catch((e) => toast(e.message, 'error')) }, icon('plus-lg'), 'สร้างแบบใหม่'), h('button', { class: 'btn', type: 'button', onclick: () => formDialog({ title: 'ตัวอักษรนำหน้าเลขที่', values: { prefix: d.prefix }, fields: [{ name: 'prefix', label: 'เช่น ET → ET-2569-000001', required: true, wide: true, hint: 'A-Z 0-9 เปลี่ยนแล้วเลขจะเริ่มนับใหม่ในชุดใหม่' }], onSave: async (v) => { await send('PUT', '/admin/certificates/prefix', v); toast('บันทึกแล้ว'); load(); } }) }, icon('hash'), `เลขที่ขึ้นต้น ${d.prefix}`)),
    ...(d.items.length ? [] : [h('p', { class: 'muted' }, 'ยังไม่มีแบบ ระบบจะใช้ลายมาตรฐานด้านล่าง สร้างแบบเพื่อใส่ภาพพื้นหลังทางการ ชื่อผู้ลงนาม และจัดตำแหน่ง')]),
    h('div', { class: 'tplgrid' }, (d.items.length ? d.items : [{ name: 'ลายมาตรฐานของระบบ', layout: d.defaults }]).map((t) => h('article', { class: 'tpl' }, h('div', { class: 'tpl-img' }, h('img', { src: '/assets/images/cert-bg.svg', alt: '' }), t.hasImage && h('span', { class: 'badge info' }, 'ภาพของหน่วยงาน')), h('strong', {}, t.name), h('small', { class: 'muted' }, t.id ? `${t.courseName ?? 'ทุกหลักสูตร'} · ใช้ออกแล้ว ${num(t.used)} ใบ` : 'ใช้เมื่อยังไม่มีแบบอื่น'),
      h('div', { class: 'bar-actions' }, t.id && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editor(t, d).catch((e) => toast(e.message, 'error')) }, icon('pencil-fill'), 'แก้'), h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => { const fd = new FormData(); fd.append('layout', JSON.stringify(t.layout)); openPdf(e.currentTarget, `/admin/certificates/templates${t.id ? `/${t.id}` : ''}/preview`, t.name, fd); } }, icon('eye-fill'), 'ดู PDF'), t.id && h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (!(await confirmDialog({ title: `เลิกใช้ "${t.name}"?`, text: 'ใบที่ออกไปแล้วไม่เปลี่ยน', confirm: 'เลิกใช้', danger: true }))) return; try { await send('DELETE', `/admin/certificates/templates/${t.id}`); load(); } catch (e) { toast(e.message, 'error'); } } }, icon('archive'), 'เลิกใช้'))))));
  box.querySelectorAll('.tpl-img img').forEach((img, i) => { const t = d.items[i]; if (t?.hasImage) blobUrl(`/admin/certificates/templates/${t.id}/image`).then((u) => { img.src = u; img.onload = () => URL.revokeObjectURL(u); }).catch(() => {}); });
}

const TABS = { issue: ['ออกใบ', issueTab], issued: ['ใบที่ออกแล้ว', issuedTab], templates: ['แบบใบประกาศ', templateTab] };
let box;
async function load() {
  if (!box?.isConnected || box.dataset.tab !== tab) {
    box = h('section', { class: 'box', 'data-tab': tab }, skeleton());
    main.replaceChildren(h('div', { class: 'tabs', role: 'tablist' }, Object.entries(TABS).map(([k, [l]]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; load(); } }, l))), box);
  }
  const mine = box;
  try { await TABS[tab][1](mine); } catch (e) { mine.replaceChildren(failed(e, load)); }
}
load();
