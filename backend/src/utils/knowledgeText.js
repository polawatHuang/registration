import { badRequest } from './errors.js';

export const MAX_CHARS = 300_000;
const KINDS = { pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-', docx: (b) => b.readUInt32LE(0) === 0x04034b50, txt: null, md: null, csv: null };
const bad = (message) => badRequest('INVALID_FILE', message, [{ field: 'file', message }]);

/** รวมขนาดหลังคลายจาก central directory กัน zip bomb ใน .docx */
function unzippedSize(buf) {
  let total = 0;
  for (let i = buf.indexOf('PK\x01\x02', 0, 'latin1'); i >= 0 && i + 46 < buf.length; i = buf.indexOf('PK\x01\x02', i + 46, 'latin1')) total += buf.readUInt32LE(i + 24);
  return total;
}
export const normalizeText = (t) => t.normalize('NFC').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
  // PDF ภาษาไทยมักแยก "ำ" เป็นนิคหิต+า
  .replace(/\u0e4d([\u0e48-\u0e4b]?)\u0e32/g, '$1\u0e33').trim();

export async function extractText(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (!(ext in KINDS)) throw bad('รองรับ PDF, DOCX, TXT, MD และ CSV');
  if (buffer.length < 8 || (KINDS[ext] && !KINDS[ext](buffer))) throw bad('เนื้อไฟล์ไม่ตรงกับนามสกุล');
  let text;
  try {
    if (ext === 'pdf') {
      const { extractText: pdf, getDocumentProxy } = await import('unpdf');
      text = (await pdf(await getDocumentProxy(new Uint8Array(buffer)), { mergePages: true })).text;
    } else if (ext === 'docx') {
      if (unzippedSize(buffer) > 50_000_000) throw bad('ไฟล์มีขนาดหลังคลายใหญ่เกินไป');
      const { default: mammoth } = await import('mammoth');
      text = (await mammoth.extractRawText({ buffer })).value;
    } else text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (err) {
    if (err.status) throw err;
    throw bad(ext === 'pdf' || ext === 'docx' ? 'อ่านไฟล์ไม่สำเร็จ ไฟล์อาจเสียหายหรือมีรหัสผ่าน' : 'ไฟล์ต้องเข้ารหัสแบบ UTF-8');
  }
  text = normalizeText(text);
  if (text.length < 20) throw bad('ไม่พบข้อความในไฟล์ หากเป็น PDF สแกน ให้แปลงเป็นข้อความก่อน');
  if (text.length > MAX_CHARS) throw bad(`ข้อความยาวเกิน ${MAX_CHARS.toLocaleString()} ตัวอักษร กรุณาแบ่งไฟล์`);
  return text;
}

export function chunkText(text, size = 900) {
  const parts = text.split(/\n(?=#{1,4} )|\n\n+/).flatMap((p) => { const out = []; for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size)); return out; });
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length > size) { chunks.push(cur.trim()); cur = ''; }
    cur += `${p}\n\n`;
  }
  // เศษท้ายสั้นๆ ที่ไม่มีบริบทจะชนะการค้นหาเพราะสั้น จึงรวมกับก้อนก่อนหน้า
  if (cur.trim()) { if (cur.length < 250 && chunks.length) chunks[chunks.length - 1] += `\n\n${cur.trim()}`; else chunks.push(cur.trim()); }
  return chunks;
}

const seg = new Intl.Segmenter('th', { granularity: 'word' });
const STOP = new Set(['ที่', 'และ', 'หรือ', 'ของ', 'ใน', 'ได้', 'ให้', 'เป็น', 'มี', 'การ', 'ความ', 'กับ', 'จะ', 'ต้อง', 'ไหม', 'ไม่', 'อะไร', 'บ้าง', 'ใช้', 'ทำ', 'อย่างไร', 'ยังไง', 'ขอ', 'อยาก', 'ทราบ', 'ถาม', 'ครับ', 'ค่ะ', 'คะ', 'นะ', 'ว่า', 'นี้', 'นั้น', 'อยู่', 'ไป', 'มา', 'ก็', 'แล้ว', 'จาก', 'คือ', 'the', 'a', 'is', 'of', 'to', 'and', 'in']);
export function tokenize(text) {
  return [...seg.segment(text.toLowerCase())].filter((s) => s.isWordLike && !STOP.has(s.segment)).map((s) => s.segment);
}
/** BM25 ในหน่วยความจำ: ภาษาไทยไม่มีช่องว่าง และ FULLTEXT ngram มีเฉพาะ MySQL (MariaDB ไม่มี) */
export function buildIndex(chunks) {
  // หัวข้อและคำค้นบอกเรื่องของเนื้อหาชัดกว่าตัวเนื้อความ จึงให้คะแนนแยก ไม่ถูกหารด้วยความยาว
  const docs = chunks.map((c) => {
    const tf = new Map();
    const words = tokenize(c.text);
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { c, tf, title: new Set(tokenize(c.title)), keys: new Set(tokenize(c.keywords ?? '')), len: words.length };
  });
  const df = new Map();
  for (const d of docs) for (const w of new Set([...d.tf.keys(), ...d.title, ...d.keys])) df.set(w, (df.get(w) ?? 0) + 1);
  const avg = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1);
  const idf = (w) => Math.log(1 + (docs.length - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
  return (question, limit = 6) => {
    const words = [...new Set(tokenize(question))];
    return docs.map((d) => {
      let score = 0;
      for (const w of words) { const f = d.tf.get(w); if (f) score += idf(w) * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / avg)))); if (d.title.has(w)) score += idf(w) * 1.5; if (d.keys.has(w)) score += idf(w) * 2.5; }
      return { ...d.c, score: score ? score * (1 + Math.max(-5, Math.min(5, d.c.priority ?? 0)) * 0.05) : 0 };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  };
}
