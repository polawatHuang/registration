/** สร้าง element โดยข้อมูลเป็น text เสมอ (ไม่ใช้ innerHTML) จึงไม่มีช่อง XSS */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
    else if (k in el && !k.startsWith('aria') && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}
export const icon = (name) => h('i', { class: `bi bi-${name}`, 'aria-hidden': 'true' });
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function toast(message, type = 'ok') {
  let box = $('.toasts');
  if (!box) document.body.append(box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast ${type}` }, icon(type === 'error' ? 'exclamation-triangle-fill' : 'check-circle-fill'), message);
  box.append(t);
  setTimeout(() => t.remove(), type === 'error' ? 7000 : 4000);
}
const opt = (o) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', ...o });
const D = opt({ day: 'numeric', month: 'short', year: 'numeric' });
const DT = opt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const T = opt({ hour: '2-digit', minute: '2-digit' });
export const fmtDate = (v) => D.format(new Date(v));
export const fmtDateTime = (v) => DT.format(new Date(v));
export const fmtTime = (v) => T.format(new Date(v));
export const fmtRange = (a, b) => (fmtDate(a) === fmtDate(b) ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
export const num = (n) => Number(n).toLocaleString('th-TH');
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function busy(btn, fn) {
  const old = [...btn.childNodes];
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spin', 'aria-hidden': 'true' }), 'กำลังดำเนินการ…');
  try { return await fn(); } finally { btn.disabled = false; btn.replaceChildren(...old); }
}
export function confirmDialog({ title, text, confirm = 'ยืนยัน', danger = false, reason = false, placeholder = 'ระบุเหตุผล (ผู้สมัครจะเห็นข้อความนี้)' }) {
  return new Promise((resolve) => {
    const input = reason && h('textarea', { rows: 3, maxLength: 500, required: true, class: 'input', placeholder, 'aria-label': 'เหตุผล' });
    const d = h('dialog', { onclose: () => { d.remove(); resolve(d.returnValue === 'ok' ? (reason ? input.value.trim() : true) : null); } },
      h('form', { method: 'dialog', class: 'dialog-form', onsubmit: (e) => { if (reason && e.submitter?.value === 'ok' && !input.value.trim()) { e.preventDefault(); input.focus(); } } },
        h('h3', {}, title), text && h('p', { class: 'muted' }, text), input,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', value: '', formNoValidate: true }, 'ยกเลิก'), h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-green'}`, value: 'ok' }, confirm))));
    document.body.append(d);
    d.showModal();
  });
}
