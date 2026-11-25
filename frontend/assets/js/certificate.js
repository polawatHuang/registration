import { get } from './api.js';
import { $, fmtDate, h, icon } from './ui.js';
import { celebrate, floatingLeaves, parallax } from './fx.js';
import { initShell } from './shell.js';

const root = $('#app');
const ALLOWED = /^[2-9A-HJ-NP-Z]{16}$/;
const fromPath = location.pathname.match(/\/certificate\/verify\/([^/]+)/)?.[1] ?? new URLSearchParams(location.search).get('code') ?? '';

function form(message) {
  const input = h('input', { class: 'input code-in', maxLength: 24, autocapitalize: 'characters', autocomplete: 'off', placeholder: 'รหัส 16 ตัวใต้ QR หรือในลิงก์', 'aria-label': 'รหัสใบประกาศ' });
  const err = h('p', { class: 'err', role: 'alert' }, message ?? '');
  return h('section', { class: 'panel' }, h('h2', {}, 'ตรวจใบอื่น'), h('form', { class: 'code-form', onsubmit: (e) => { e.preventDefault(); const c = input.value.toUpperCase().replace(/[^2-9A-Z]/g, ''); if (!ALLOWED.test(c)) { err.textContent = 'รหัสไม่ถูกต้อง'; return; } location.href = `/certificate/verify/${c}`; } }, input, h('button', { class: 'btn btn-green', type: 'submit' }, icon('search'), 'ตรวจสอบ')), err);
}
const row = (k, v) => v && h('div', {}, h('dt', {}, k), h('dd', {}, v));
async function load() {
  const code = decodeURIComponent(fromPath).toUpperCase();
  if (!code) { root.replaceChildren(form()); return; }
  if (!ALLOWED.test(code)) { root.replaceChildren(h('section', { class: 'panel verdict bad' }, icon('x-octagon-fill'), h('h2', {}, 'รหัสไม่ถูกต้อง'), h('p', {}, 'ตรวจว่าคัดลอกลิงก์ครบ หรือสแกน QR บนใบประกาศอีกครั้ง')), form()); return; }
  try {
    const c = await get(`/certificates/verify/${code}`);
    const ok = c.status === 'valid';
    root.replaceChildren(h('section', { class: `panel verdict ${ok ? 'ok' : 'bad'}` }, h('div', { class: 'seal' }, icon(ok ? 'patch-check-fill' : 'slash-circle-fill')), h('h2', {}, ok ? 'ใบประกาศถูกต้อง' : 'ใบประกาศถูกเพิกถอน'), h('p', {}, ok ? 'ออกโดยระบบ E-Training และยังมีผลใช้งาน' : `ไม่มีผลใช้งานตั้งแต่ ${fmtDate(c.revokedAt)}`),
      h('dl', { class: 'vkv' }, row('เลขที่ใบประกาศ', c.number), row('ผู้ได้รับ', c.name ?? 'ข้อมูลผู้รับถูกลบตามระยะเวลาเก็บรักษาแล้ว'), row('หลักสูตร', c.course), row('สถาบัน', c.university), row('วันที่ออก', fmtDate(c.issuedAt))), h('small', { class: 'muted' }, 'แสดงนามสกุลบางส่วนเพื่อคุ้มครองข้อมูลส่วนบุคคล เทียบกับชื่อบนใบจริงได้')), form());
    if (ok) celebrate();
  } catch (e) {
    root.replaceChildren(h('section', { class: 'panel verdict bad' }, icon('question-octagon-fill'), h('h2', {}, e.status === 404 ? 'ไม่พบใบประกาศนี้' : 'ตรวจสอบไม่สำเร็จ'), h('p', {}, e.status === 404 ? 'รหัสนี้ไม่มีในระบบ ใบประกาศอาจไม่ใช่ของจริง' : e.message), e.status !== 404 && h('button', { class: 'btn btn-green', type: 'button', onclick: load }, 'ลองใหม่')), form());
  }
}
floatingLeaves(8);
parallax('[data-depth]');
initShell('verify');
load();
