export const toDigits = (s) => s.replace(/[๐-๙]/g, (d) => d.charCodeAt(0) - 0x0e50).replace(/\D/g, '');
export function validThaiId(id) {
  if (!/^\d{13}$/.test(id)) return false;
  const sum = [...id.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}
/** ช่องกรอก 13 หลัก: พิมพ์ต่อเนื่อง วางทีเดียว ลูกศร/ลบ คืน { value, focus } */
export function nidInput(root, onChange = () => {}) {
  const boxes = Array.from({ length: 13 }, (_, i) => {
    const el = document.createElement('input');
    Object.assign(el, { type: 'text', inputMode: 'numeric', maxLength: 13, autocomplete: 'off' });
    el.setAttribute('aria-label', `เลขประจำตัวประชาชนหลักที่ ${i + 1}`);
    el.style.setProperty('--i', i);
    return el;
  });
  root.append(...boxes);
  const value = () => boxes.map((b) => b.value).join('');
  const paint = () => {
    const v = value();
    const full = v.length === 13;
    const good = full && /^[1-8]/.test(v) && validThaiId(v);
    root.classList.toggle('valid', good);
    root.classList.toggle('invalid', full && !good);
    onChange(v);
  };
  const fill = (from, text) => {
    const d = toDigits(text).slice(0, 13 - from);
    [...d].forEach((c, k) => { boxes[from + k].value = c; });
    boxes[Math.min(12, from + d.length)].focus();
    paint();
  };
  boxes.forEach((b, i) => {
    b.addEventListener('focus', () => b.select());
    b.addEventListener('input', () => { const t = b.value; b.value = ''; if (toDigits(t)) fill(i, t); else paint(); });
    b.addEventListener('paste', (e) => { e.preventDefault(); const t = toDigits(e.clipboardData.getData('text')); fill(t.length === 13 ? 0 : i, t); });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !b.value && i) { boxes[i - 1].value = ''; boxes[i - 1].focus(); paint(); e.preventDefault(); }
      if (e.key === 'ArrowLeft' && i) boxes[i - 1].focus();
      if (e.key === 'ArrowRight' && i < 12) boxes[i + 1].focus();
    });
  });
  return { get value() { return value(); }, focus: () => (boxes.find((b) => !b.value) ?? boxes[0]).focus() };
}
