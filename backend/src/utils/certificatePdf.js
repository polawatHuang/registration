import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { ROOT } from '../config/env.js';

const FONT = (f) => path.join(ROOT, 'backend/assets/fonts', f);
export const PAGE = { w: 841.89, h: 595.28 }; // A4 แนวนอน
const D = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' });
export const dateRange = (a, b) => (D.format(a) === D.format(b) ? D.format(a) : `${D.format(a)} – ${D.format(b)}`);

/** ตำแหน่งเป็น % ของหน้า x คือจุดยึดตาม align (ซ้าย/กลาง/ขวา) y คือขอบบนของตัวอักษร */
const t = (x, y, size, color, over = {}) => ({ show: true, x, y, size, color, align: 'center', bold: false, ...over });
export const DEFAULT_LAYOUT = {
  texts: { title: 'ใบประกาศนียบัตร', lead: 'ใบประกาศฉบับนี้ให้ไว้เพื่อแสดงว่า', after: 'ได้ผ่านการอบรม', signer: '', signerTitle: '' },
  fields: {
    title: t(50, 16, 40, '#2c1f63', { bold: true }), lead: t(50, 29, 17, '#5b5870'), name: t(50, 36, 36, '#168447', { bold: true }), after: t(50, 48, 17, '#5b5870'),
    course: t(50, 54, 24, '#2c1f63', { bold: true }), place: t(50, 62.5, 15, '#5b5870'), dates: t(50, 67.5, 15, '#5b5870'), issued: t(12, 79, 12, '#5b5870', { align: 'left' }), number: t(12, 83, 12, '#5b5870', { align: 'left' }),
    signer: t(50, 80, 15, '#2c1f63', { bold: true }), signerTitle: t(50, 84.5, 12, '#5b5870'), qr: { show: true, x: 82, y: 74, size: 78 },
  },
};
export const FIELD_LABELS = { title: 'หัวเรื่อง', lead: 'ข้อความนำ', name: 'ชื่อผู้รับ', after: 'ข้อความก่อนหลักสูตร', course: 'ชื่อหลักสูตร', place: 'สถาบันและรุ่น', dates: 'วันที่อบรม', issued: 'วันที่ออก', number: 'เลขที่ใบประกาศ', signer: 'ชื่อผู้ลงนาม', signerTitle: 'ตำแหน่งผู้ลงนาม', qr: 'QR ตรวจสอบ' };

function ornament(doc) {
  const { w, h } = PAGE;
  doc.rect(0, 0, w, h).fill('#fffdf7');
  const band = doc.linearGradient(0, 0, w, h).stop(0, '#168447').stop(0.5, '#2f7fb5').stop(1, '#49378a');
  // คลื่นมุมบนซ้ายและล่างขวา
  doc.path(`M0 0 H300 C230 46 150 26 92 84 C40 136 52 190 0 226 Z`).fill(doc.linearGradient(0, 0, 300, 226).stop(0, '#0f7a3c').stop(1, '#8fd14b'));
  doc.path(`M0 0 H230 C170 34 112 22 70 66 C32 106 38 150 0 176 Z`).fillOpacity(0.35).fill('#ffffff').fillOpacity(1);
  doc.path(`M${w} ${h} H${w - 300} C${w - 230} ${h - 46} ${w - 150} ${h - 26} ${w - 92} ${h - 84} C${w - 40} ${h - 136} ${w - 52} ${h - 190} ${w} ${h - 226} Z`).fill(doc.linearGradient(w - 300, h - 226, w, h).stop(0, '#8a6be0').stop(1, '#2c1f63'));
  doc.path(`M${w} ${h} H${w - 230} C${w - 170} ${h - 34} ${w - 112} ${h - 22} ${w - 70} ${h - 66} C${w - 32} ${h - 106} ${w - 38} ${h - 150} ${w} ${h - 176} Z`).fillOpacity(0.18).fill('#ffffff').fillOpacity(1);
  doc.roundedRect(22, 22, w - 44, h - 44, 14).lineWidth(2.4).stroke(band);
  doc.roundedRect(29, 29, w - 58, h - 58, 10).lineWidth(0.8).strokeOpacity(0.5).stroke('#c9a24a').strokeOpacity(1);
  // ใบไม้กลางบน
  const leaf = (cx, cy, dir, len, color) => doc.path(`M${cx} ${cy} C${cx + dir * len * 0.3} ${cy - len * 0.7} ${cx + dir * len} ${cy - len * 0.6} ${cx + dir * len * 1.1} ${cy - len * 0.05} C${cx + dir * len * 0.7} ${cy + len * 0.2} ${cx + dir * len * 0.3} ${cy + len * 0.2} ${cx} ${cy} Z`).fill(color);
  leaf(w / 2, 74, -1, 34, '#35a66a'); leaf(w / 2, 74, 1, 34, '#8fd14b'); leaf(w / 2, 66, 1, 18, '#168447');
  doc.moveTo(w / 2 - 150, 80).lineTo(w / 2 - 50, 80).moveTo(w / 2 + 50, 80).lineTo(w / 2 + 150, 80).lineWidth(1).stroke('#c9a24a');
}
function drawText(doc, text, f, scale = 1) {
  if (!f?.show || !text) return;
  const max = PAGE.w * 0.86;
  doc.font(f.bold ? 'bold' : 'regular');
  let size = f.size * scale;
  while (size > 8 && doc.fontSize(size).widthOfString(text) > max) size -= 0.5; // ชื่อยาวย่อให้พอดี ไม่ตกบรรทัด
  const width = doc.fontSize(size).widthOfString(text);
  const anchor = (PAGE.w * f.x) / 100;
  const x = f.align === 'left' ? anchor : f.align === 'right' ? anchor - width : anchor - width / 2;
  doc.fillColor(f.color).text(text, Math.max(8, Math.min(PAGE.w - width - 8, x)), (PAGE.h * f.y) / 100, { lineBreak: false });
}
/** วาดโมดูล QR เป็นเวกเตอร์ คมทุกขนาดและไม่ต้องสร้างไฟล์ภาพ */
function drawQr(doc, text, f) {
  if (!f?.show) return;
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const quiet = 3; const unit = f.size / (modules.size + quiet * 2);
  const ox = (PAGE.w * f.x) / 100; const oy = (PAGE.h * f.y) / 100;
  doc.rect(ox, oy, f.size, f.size).fill('#ffffff');
  for (let r = 0; r < modules.size; r += 1) for (let c = 0; c < modules.size; c += 1) if (modules.get(r, c)) doc.rect(ox + (c + quiet) * unit, oy + (r + quiet) * unit, unit + 0.05, unit + 0.05);
  doc.fill('#111111');
}

export function renderCertificate({ layout, background, cert, verifyUrl, watermark = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `${layout.texts.title || 'Certificate'} ${cert.number}`, Author: 'E-Training', Subject: cert.course } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.registerFont('regular', FONT('Prompt_400Regular.ttf')); doc.registerFont('bold', FONT('Prompt_600SemiBold.ttf'));
    if (background) doc.image(background, 0, 0, { cover: [PAGE.w, PAGE.h], align: 'center', valign: 'center' }); else ornament(doc);
    const f = layout.fields; const x = layout.texts;
    const values = { title: x.title, lead: x.lead, name: cert.name, after: x.after, course: cert.course, place: `${cert.university} · ${cert.session}`, dates: `อบรมวันที่ ${dateRange(cert.startsAt, cert.endsAt)}`, issued: `ออกให้ ณ วันที่ ${D.format(cert.issuedAt)}`, number: `เลขที่ ${cert.number}`, signer: x.signer, signerTitle: x.signerTitle };
    if (f.signer?.show && x.signer) { const lx = (PAGE.w * f.signer.x) / 100; const ly = (PAGE.h * f.signer.y) / 100 - 6; doc.moveTo(lx - 90, ly).lineTo(lx + 90, ly).lineWidth(0.8).stroke('#8e86a8'); }
    for (const [k, v] of Object.entries(values)) drawText(doc, v, f[k]);
    drawQr(doc, verifyUrl, f.qr);
    if (watermark) doc.save().rotate(-24, { origin: [PAGE.w / 2, PAGE.h / 2] }).font('bold').fontSize(110).fillColor('#c92a3a').fillOpacity(0.16).text(watermark, 0, PAGE.h / 2 - 70, { width: PAGE.w, align: 'center', lineBreak: false }).restore();
    doc.end();
  });
}
