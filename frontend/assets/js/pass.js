import { fmtRange, fmtTime, h, toast } from './ui.js';
import { tilt } from './fx.js';

/** บัตรผู้สมัครดิจิทัล (ไม่มีเลขบัตรประชาชน) */
export function passCard(a) {
  const item = (k, v, full) => h('div', { class: full ? 'full' : '' }, h('dt', {}, k), h('dd', {}, v));
  const el = h('article', { class: 'pass', 'aria-label': 'บัตรผู้สมัครดิจิทัล' },
    h('div', { class: 'pt' }, h('em', {}, 'E-Training'), h('span', {}, 'บัตรผู้สมัคร')), h('div', { class: 'no' }, a.applicationNo), h('div', { class: 'nm' }, a.fullName),
    h('dl', {}, item('หลักสูตร', a.courseName, true), item('สถานที่จัด', a.universityName), item('รุ่น', a.sessionName), item('วันอบรม', fmtRange(a.startsAt, a.endsAt)), item('เวลาเริ่ม', `${fmtTime(a.startsAt)} น.`), item('สถานะ', a.statusLabel, true)));
  tilt(el);
  return h('div', { class: 'pass-wrap' }, el);
}

function wrap(g, text, x, y, max, lh) {
  let line = '';
  const seg = 'Segmenter' in Intl ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((s) => s.segment) : [...text];
  for (const w of seg) { if (g.measureText(line + w).width > max && line) { g.fillText(line, x, y); y += lh; line = w.trimStart(); } else line += w; }
  g.fillText(line, x, y);
  return y + lh;
}
export async function savePass(a) {
  await Promise.all(['400', '600', '700', 'italic 700'].map((w) => document.fonts.load(`${w} 40px Prompt`, 'กA')));
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1500;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 1080, 1500);
  bg.addColorStop(0, '#168447'); bg.addColorStop(0.5, '#23506b'); bg.addColorStop(1, '#49378a');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1500);
  for (const [x, y, r, col] of [[60, 60, 620, 'rgba(143,209,75,.5)'], [1060, 1420, 700, 'rgba(138,107,224,.75)']]) { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, 'transparent'); g.fillStyle = rg; g.fillRect(0, 0, 1080, 1500); }
  g.fillStyle = '#fff';
  g.font = 'italic 700 76px Prompt'; g.fillText('E-Training', 80, 160);
  g.font = '400 36px Prompt'; g.fillText('บัตรผู้สมัครเข้ารับการอบรม', 80, 222);
  g.font = '700 108px Prompt'; g.fillText(a.applicationNo, 80, 430);
  g.font = '600 58px Prompt'; let y = wrap(g, a.fullName, 80, 530, 920, 76) + 20;
  g.setLineDash([14, 12]); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(80, y - 30); g.lineTo(1000, y - 30); g.stroke(); y += 40;
  for (const [k, v] of [['หลักสูตร', a.courseName], ['สถานที่จัด', a.universityName], ['รุ่น', a.sessionName], ['วันอบรม', `${fmtRange(a.startsAt, a.endsAt)} เวลา ${fmtTime(a.startsAt)} น.`]]) {
    g.font = '400 32px Prompt'; g.globalAlpha = 0.85; g.fillText(k, 80, y); g.globalAlpha = 1; g.font = '600 42px Prompt'; y = wrap(g, v, 80, y + 56, 920, 56) + 28;
  }
  const blob = await new Promise((r) => { c.toBlob(r, 'image/png'); });
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: `${a.applicationNo}.png` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('บันทึกบัตรเป็นรูปแล้ว');
}
