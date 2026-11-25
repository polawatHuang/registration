import { get, send, upload } from './api.js';
import { confirmDialog, fmtDateTime, h, icon, num, toast } from './ui.js';
import { empty, failed, formDialog, initAdmin, skeleton } from './admin.js';
import { creditView, historyView, reportView, settingsView } from './ai-report.js';

const main = await initAdmin('ai-knowledge');
let data; let tab = ['test', 'credit', 'report', 'history', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'list'; let category = '';
const thread = h('div', { class: 'thread', role: 'log', 'aria-live': 'polite' });

async function edit(id, preset = {}) {
  let k = { category: category || data.categories[0], status: 'draft', priority: 0, ...preset };
  if (id) { try { k = await get(`/ai/knowledge/${id}`); } catch (e) { toast(e.message, 'error'); return; } }
  formDialog({ title: id ? 'ตรวจและแก้ไขความรู้' : 'เพิ่มคำถาม-คำตอบ', values: k,
    fields: [{ name: 'title', label: 'หัวข้อ / คำถาม', required: true, wide: true }, { name: 'content', label: k.sourceType === 'file' ? 'ข้อความที่อ่านได้จากไฟล์ (ตรวจให้ถูกต้องก่อนเผยแพร่)' : 'คำตอบ', type: 'textarea', required: true, wide: true }, { name: 'category', label: 'หมวด', type: 'select', options: data.categories.map((c) => [c, c]) }, { name: 'status', label: 'สถานะ', type: 'select', options: [['draft', 'ฉบับร่าง (AI ยังไม่ใช้)'], ['published', 'เผยแพร่ (AI ใช้ตอบ)']] }, { name: 'keywords', label: 'คำค้นเพิ่มเติม', hint: 'คำที่คนมักใช้ถาม คั่นด้วยเว้นวรรค' }, { name: 'priority', label: 'ความสำคัญ (-5 ถึง 5)', type: 'number', min: -5 }],
    onSave: async (v) => { await send(id ? 'PUT' : 'POST', `/ai/knowledge${id ? `/${id}` : ''}`, v); toast('บันทึกแล้ว'); load(); } });
}
async function take(files) {
  let done = 0;
  for (const f of files) {
    const fd = new FormData();
    fd.append('category', category || 'FAQ');
    fd.append('file', f, f.name);
    try { await upload('/ai/documents', fd); done += 1; } catch (e) { toast(`${f.name}: ${e.message}`, 'error'); }
  }
  if (done) toast(`อ่าน ${num(done)} ไฟล์แล้ว กรุณาตรวจและเผยแพร่`);
  load();
}
function listView() {
  const input = h('input', { type: 'file', class: 'sr', id: 'kfile', multiple: true, accept: '.pdf,.docx,.txt,.md,.csv', onchange: () => take([...input.files]) });
  const drop = h('label', { class: 'kdrop', htmlFor: 'kfile' }, icon('cloud-arrow-up-fill'), h('strong', {}, 'วางไฟล์หรือแตะเพื่อเลือก'), h('span', {}, 'PDF, DOCX, TXT, MD, CSV (UTF-8) ไม่เกิน 10 MB · PDF สแกนต้องแปลงเป็นข้อความก่อน'));
  for (const ev of ['dragover', 'dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.toggle('on', ev === 'dragover'); if (ev === 'drop') take([...e.dataTransfer.files]); });
  const items = data.items.filter((k) => !category || k.category === category);
  const pub = data.items.filter((k) => k.status === 'published').length;
  return [h('section', { class: 'hero' }, h('h2', {}, 'คลังความรู้ของ Training Assistant'), h('p', {}, `เผยแพร่ ${num(pub)} รายการ · ฉบับร่างรอตรวจ ${num(data.items.length - pub)} รายการ`), h('img', { src: '/assets/images/leaf.svg', alt: '' })), input, drop,
    h('section', { class: 'box' }, h('div', { class: 'filters' }, h('select', { class: 'input', 'aria-label': 'หมวด', onchange: (e) => { category = e.target.value; render(); } }, h('option', { value: '' }, 'ทุกหมวด'), data.categories.map((c) => h('option', { value: c, selected: c === category }, c))), h('button', { class: 'btn btn-green', type: 'button', onclick: () => edit() }, icon('plus-lg'), 'เพิ่มคำถาม-คำตอบ')),
      h('div', { class: 'list' }, items.length ? items.map((k) => h('div', { class: 'krow' }, h('button', { class: 'lrow cols', type: 'button', onclick: () => edit(k.id) }, h('span', { class: 'n' }, icon(k.source_type === 'file' ? 'file-earmark-text' : 'chat-square-text'), ' ', k.title), h('span', { class: 'm' }, `${k.category} · ${num(k.chars)} ตัวอักษร · ${fmtDateTime(k.updated_at)}${k.updated_by_name ? ` โดย ${k.updated_by_name}` : ''}`), h('span', { class: `badge ${k.status === 'published' ? 'ok' : 'warn'}` }, k.status === 'published' ? 'เผยแพร่' : 'ฉบับร่าง')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `ลบ ${k.title}`, onclick: async () => { if (!(await confirmDialog({ title: 'ลบความรู้นี้?', text: `"${k.title}" AI จะไม่ใช้ตอบอีก และไฟล์ต้นฉบับจะถูกลบ`, confirm: 'ลบ', danger: true }))) return; try { await send('DELETE', `/ai/knowledge/${k.id}`); toast('ลบแล้ว'); load(); } catch (e) { toast(e.message, 'error'); } } }, icon('trash3')))) : empty('journal-x', 'ยังไม่มีความรู้ในหมวดนี้')))];
}
const MODE = { answer: ['ok', 'ตอบจากคลังความรู้'], fallback: ['warn', 'ไม่พบข้อมูล จึงไม่เดา'], personal: ['info', 'คำถามส่วนบุคคล'], search: ['info', 'ยังไม่ได้ตั้งค่า MiniMax แสดงผลค้นหาแทน'], error: ['bad', 'MiniMax ขัดข้อง'], limit: ['bad', 'ใช้ token ครบเพดานเดือนนี้'], offline: ['bad', 'AI หยุดชั่วคราว'], faq: ['ok', 'ตอบจากคลังโดยตรง (AI หยุด)'] };
function testView() {
  const q = h('input', { class: 'input', placeholder: 'ลองถามแบบลูกค้า เช่น ต้องใช้เอกสารอะไรบ้าง', maxLength: 500, 'aria-label': 'คำถาม', required: true });
  const btn = h('button', { class: 'btn btn-green', type: 'submit', 'aria-label': 'ถาม' }, icon('send-fill'));
  if (!thread.children.length) thread.append(empty('robot', 'ถามเพื่อทดสอบก่อนใช้จริง คำตอบจะแสดงแหล่งที่มา'));
  return [h('section', { class: 'box' }, thread, h('form', { class: 'ask', onsubmit: async (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text || btn.disabled) return;
    thread.querySelector('.state')?.remove();
    const wait = h('div', { class: 'msg bot' }, h('span', { class: 'spin' }));
    thread.append(h('div', { class: 'msg me' }, text), wait);
    q.value = ''; btn.disabled = true;
    try {
      const r = await send('POST', '/ai/chat', { question: text });
      wait.replaceChildren(...[h('span', { class: `badge ${MODE[r.mode][0]}` }, MODE[r.mode][1]), r.answer && h('p', {}, r.answer), r.error && h('small', {}, r.error), r.sources.length > 0 && h('details', { open: r.mode === 'search' }, h('summary', {}, `แหล่งข้อมูล ${num(r.sources.length)}`), r.sources.map((s) => h('div', { class: 'src' }, h('strong', {}, `${s.title} (${s.category})`), h('small', {}, s.excerpt))))].filter(Boolean));
    } catch (x) { wait.replaceChildren(h('span', { class: 'badge bad' }, 'ผิดพลาด'), h('p', {}, x.message)); }
    btn.disabled = false;
    wait.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    q.focus();
  } }, q, btn))];
}
function render() {
  main.replaceChildren(h('div', { class: 'tabs', role: 'tablist' }, [['list', 'คลังความรู้'], ['test', 'ทดสอบถาม AI'], ['credit', 'เครดิต AI'], ['report', 'รายงานและค่าใช้จ่าย'], ['history', 'ประวัติการถาม'], ['settings', 'ตั้งค่า AI']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; history.replaceState(null, '', `#${k}`); render(); } }, l))), ...({ list: listView, test: testView, credit: creditView, report: () => reportView((question) => edit(null, { title: question, keywords: question.slice(0, 200) })), history: historyView, settings: settingsView })[tab]());
}
async function load() {
  if (!data) main.replaceChildren(...skeleton());
  try { data = await get('/ai/knowledge'); render(); } catch (e) { main.replaceChildren(failed(e, load)); }
}
load();
addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t && t !== tab && data) { tab = t; render(); } });
