import { api, get, send, upload } from './api.js';
import { busy, confirmDialog, fmtDateTime, h, icon, num, toast } from './ui.js';
import { celebrate } from './fx.js';
import { empty, failed, formDialog, initAdmin, pager, skeleton } from './admin.js';

const main = await initAdmin('line');
let d; const list = { page: 1, q: '', filter: 'all' };
const THEMES = { garden: ['สวนเขียวม่วง', ['#0f7a3c', '#49378a'], '#ffffff', ['#8fd14b', '#f5b13d', '#6ad0ff', '#ffffff', '#ffd35c', '#c9b6ff']], light: ['ขาวสะอาด', ['#ffffff', '#eee6fb'], '#2c1f63', ['#168447', '#49378a', '#f5821f', '#2f7fb5', '#c99a00', '#8a6be0']], leaf: ['เขียวใบไม้', ['#168447', '#8fd14b'], '#ffffff', ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff']] };
const prefs = { theme: 'garden', bar: 'เมนูบริการ' };

/** อ่านรหัสตัวอักษรของไอคอนจาก CSS จึงไม่ต้องจำเลขเอง */
function glyph(name) { const el = h('i', { class: `bi bi-${name}`, style: { position: 'absolute', visibility: 'hidden' } }); document.body.append(el); const c = getComputedStyle(el, '::before').content.replace(/["']/g, ''); el.remove(); return c; }
async function draw(canvas) {
  const { width: W, height: H } = d.size; canvas.width = W; canvas.height = H;
  await Promise.all([document.fonts.load('600 100px Prompt', 'กA'), document.fonts.load('100px "bootstrap-icons"'), document.fonts.load('italic 700 60px Prompt', 'E')]);
  const g = canvas.getContext('2d'); const [, [a, b], ink, tints] = THEMES[prefs.theme];
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, a); bg.addColorStop(1, b); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const light = prefs.theme === 'light';
  for (const [x, y, r, c] of [[120, 60, 760, light ? 'rgba(143,209,75,.25)' : 'rgba(143,209,75,.45)'], [W - 100, H - 60, 900, light ? 'rgba(138,107,224,.25)' : 'rgba(138,107,224,.6)'], [W / 2, H + 100, 700, 'rgba(245,177,61,.18)']]) { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c); rg.addColorStop(1, 'transparent'); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
  const cw = W / 3; const ch = H / 2; const pad = 34;
  d.buttons.forEach((btn, i) => {
    const x = (i % 3) * cw + pad; const y = Math.floor(i / 3) * ch + pad; const w = cw - pad * 2; const hh = ch - pad * 2;
    g.beginPath(); g.roundRect(x, y, w, hh, 72); g.fillStyle = light ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.13)'; g.fill(); g.lineWidth = 4; g.strokeStyle = light ? 'rgba(73,55,138,.16)' : 'rgba(255,255,255,.3)'; g.stroke();
    const cx = x + w / 2; const cy = y + hh * 0.4;
    g.beginPath(); g.arc(cx, cy, 158, 0, Math.PI * 2); g.fillStyle = light || prefs.theme === 'leaf' ? (prefs.theme === 'leaf' ? 'rgba(255,255,255,.22)' : tints[i]) : 'rgba(255,255,255,.16)'; g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '170px "bootstrap-icons"'; g.fillStyle = light ? '#ffffff' : tints[i]; g.fillText(glyph(btn.icon), cx, cy + 4);
    let size = 88; g.font = `600 ${size}px Prompt`; while (g.measureText(btn.label).width > w - 60 && size > 50) { size -= 4; g.font = `600 ${size}px Prompt`; }
    g.fillStyle = ink; g.fillText(btn.label, cx, y + hh * 0.8);
  });
}
const toJpeg = (canvas) => new Promise((resolve) => { const go = (q) => canvas.toBlob((b) => (b.size > 1_000_000 && q > 0.5 ? go(q - 0.1) : resolve(b)), 'image/jpeg', q); go(0.92); });

const check = (ok, label, hint) => h('div', { class: `ckrow ${ok ? 'ok' : 'bad'}` }, icon(ok ? 'check-circle-fill' : 'x-circle-fill'), h('div', {}, h('b', {}, label), hint && h('small', {}, hint)));
function menuBox() {
  const canvas = h('canvas', { role: 'img', 'aria-label': 'ตัวอย่าง Rich Menu' });
  const bar = h('input', { class: 'input', maxLength: 14, value: d.menu?.chatBarText ?? prefs.bar, 'aria-label': 'ข้อความบนแถบเมนู' });
  const barView = h('span', {}, bar.value);
  bar.oninput = () => { barView.textContent = bar.value; };
  const paint = () => draw(canvas).catch(() => toast('วาดภาพไม่สำเร็จ', 'error'));
  const themes = h('div', { class: 'checks' }, Object.entries(THEMES).map(([k, [l]]) => h('button', { class: `btn btn-sm ${k === prefs.theme ? 'btn-purple' : ''}`, type: 'button', onclick: (e) => { prefs.theme = k; for (const x of e.currentTarget.parentNode.children) x.classList.toggle('btn-purple', x === e.currentTarget); paint(); } }, l)));
  setTimeout(paint);
  return h('section', { class: 'box' }, h('h2', {}, 'Rich Menu'), h('div', { class: 'rm-grid' }, h('div', { class: 'phone' }, h('div', { class: 'pscreen rm-screen' }, h('div', { class: 'rm-chat' }, h('span', {}, 'สวัสดีครับ 🌱')), canvas, h('div', { class: 'rm-bar' }, barView, icon('caret-down-fill')))),
    h('div', {}, h('p', {}, d.menu ? h('span', { class: 'badge ok' }, `เผยแพร่แล้ว ${fmtDateTime(d.menu.at)}`) : h('span', { class: 'badge warn' }, 'ยังไม่เผยแพร่')), h('label', { class: 'fld' }, h('span', {}, 'ธีม'), themes), h('label', { class: 'fld' }, h('span', {}, 'ข้อความบนแถบเมนู (ไม่เกิน 14 ตัว)'), bar),
      h('dl', { class: 'kv' }, d.buttons.map((b) => h('div', {}, h('dt', {}, b.label), h('dd', {}, b.key === 'contact' ? 'ตอบช่องทางติดต่อและเปิดแป้นพิมพ์' : b.path ? 'เปิดหน้าสมัคร' : d.liffId ? 'เปิดใน LINE (LIFF)' : 'เปิดเว็บ')))),
      h('div', { class: 'bar-actions', style: { margin: '16px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', disabled: !d.ready, onclick: (e) => busy(e.currentTarget, async () => { if (!(await confirmDialog({ title: 'เผยแพร่ Rich Menu?', text: 'ผู้ติดตาม LINE OA ทุกคนจะเห็นเมนูนี้ทันที', confirm: 'เผยแพร่' }))) return; try { const fd = new FormData(); fd.append('chatBarText', bar.value); fd.append('image', await toJpeg(canvas), 'menu.jpg'); d = await upload('/admin/line/rich-menu', fd); toast('เผยแพร่เมนูแล้ว'); celebrate(); render(); } catch (x) { toast(x.errors?.[0]?.message ?? x.message, 'error'); } }) }, icon('send-fill'), 'เผยแพร่'),
        d.menu && h('button', { class: 'btn', type: 'button', onclick: async () => { if (!(await confirmDialog({ title: 'ปิด Rich Menu?', text: 'ผู้ติดตามจะไม่เห็นเมนูจนกว่าจะเผยแพร่ใหม่', confirm: 'ปิดเมนู', danger: true }))) return; try { d = await send('DELETE', '/admin/line/rich-menu'); toast('ปิดเมนูแล้ว'); render(); } catch (x) { toast(x.message, 'error'); } } }, 'ปิดเมนู')))));
}
async function usersBox(box) {
  try {
    const r = await api(`/admin/line/users?page=${list.page}&q=${encodeURIComponent(list.q)}&filter=${list.filter}`);
    let timer;
    const search = h('input', { class: 'input', type: 'search', value: list.q, placeholder: 'ค้นหาชื่อ LINE', 'aria-label': 'ค้นหา', oninput: () => { clearTimeout(timer); timer = setTimeout(() => { list.q = search.value.trim(); list.page = 1; usersBox(box); }, 350); } });
    box.replaceChildren(h('h2', {}, 'ผู้ใช้ LINE'), search, h('div', { class: 'tabs', style: { margin: '12px 0' } }, [['all', 'ทั้งหมด'], ['linked', 'เชื่อมแล้ว'], ['unlinked', 'ยังไม่เชื่อม'], ['blocked', 'บล็อก']].map(([k, l]) => h('button', { type: 'button', 'aria-selected': String(k === list.filter), onclick: () => { list.filter = k; list.page = 1; usersBox(box); } }, l))),
      h('div', { class: 'list' }, r.data.length ? r.data.map((u) => h('div', { class: 'urow' }, u.picture_url ? h('img', { class: 'av', src: u.picture_url, alt: '', referrerPolicy: 'no-referrer' }) : h('span', { class: 'av ph' }, (u.display_name ?? '?').slice(0, 1)), h('div', {}, h('b', {}, u.display_name ?? 'ผู้ใช้ LINE'), h('small', {}, `${u.full_name ? `เชื่อมกับ ${u.full_name}` : u.applications ? `มีใบสมัคร ${num(u.applications)} ใบ รอตรวจตัวตน` : 'ยังไม่เชื่อมใบสมัคร'}${u.last_interaction_at ? ` · ล่าสุด ${fmtDateTime(u.last_interaction_at)}` : ''}`)), h('span', { class: `badge ${u.friend_status === 'blocked' ? 'bad' : u.full_name ? 'ok' : ''}` }, u.friend_status === 'blocked' ? 'บล็อก' : u.full_name ? 'เชื่อมแล้ว' : u.friend_status === 'friend' ? 'เพื่อน' : 'ไม่ทราบ'))) : empty('line', 'ยังไม่มีผู้ใช้')), pager(r.meta, (p) => { list.page = p; usersBox(box); }));
    if (list.q) { search.focus(); search.setSelectionRange(list.q.length, list.q.length); }
  } catch (e) { box.replaceChildren(failed(e, () => usersBox(box))); }
}
function render() {
  const kpi = (ic, c, l, v) => h('div', { class: 'kpi', style: { '--c': c } }, icon(ic), h('b', {}, num(v)), h('span', {}, l));
  const ubox = h('section', { class: 'box' }, skeleton(3, '54px'));
  main.replaceChildren(h('section', { class: 'kpis' }, kpi('line', '#05a848', 'ผู้ใช้ LINE ทั้งหมด', d.counts.users), kpi('person-hearts', '#35a66a', 'เป็นเพื่อน', d.counts.friends), kpi('link-45deg', '#2f7fb5', 'เชื่อมบัญชีแล้ว', d.counts.linked), kpi('slash-circle', '#c92a3a', 'บล็อก', d.counts.blocked)),
    h('section', { class: 'box' }, h('h2', {}, 'ความพร้อม'), h('div', { class: 'ckgrid' }, check(d.ready, 'Messaging API', d.ready ? 'ตั้งค่าแล้ว' : 'ใส่ Channel secret และ access token ที่หน้าตั้งค่า'), check(Boolean(d.loginChannel), 'LINE Login', d.loginChannel ? 'ตั้งค่าแล้ว' : 'จำเป็นสำหรับ LIFF'), check(Boolean(d.liffId) && !d.liffMismatch, 'LIFF', d.liffMismatch ? 'LIFF ID ต้องขึ้นต้นด้วย LINE Login Channel ID เดียวกัน' : d.liffId ?? 'ยังไม่ตั้ง เมนูจะเปิดเว็บแทน'), check(d.https, 'https', d.https ? 'พร้อม' : 'LINE รับเฉพาะลิงก์ https')),
      h('p', { class: 'muted', style: { 'margin-top': '12px' } }, 'สร้าง LIFF app ใน LINE Login channel: Size = Full, Scope = openid และ profile, Endpoint URL = ', h('code', {}, d.liffEndpoint))),
    menuBox(),
    h('section', { class: 'box' }, h('h2', {}, 'ข้อความต้อนรับเพื่อนใหม่'), h('p', { style: { 'white-space': 'pre-line' } }, h('b', {}, d.welcome.title || 'ยินดีต้อนรับคุณ…'), '\n', d.welcome.text || 'จากเมล็ดแรก สู่ใบประกาศของคุณ'), h('div', { class: 'bar-actions', style: { margin: '14px 0 0' } }, h('button', { class: 'btn btn-green', type: 'button', onclick: () => formDialog({ title: 'ข้อความต้อนรับ', values: d.welcome, fields: [{ name: 'title', label: 'หัวข้อ (ว่าง = ทักด้วยชื่อ LINE)', wide: true }, { name: 'text', label: 'ข้อความรอง', type: 'textarea', wide: true }], onSave: async (v) => { d = await send('PUT', '/admin/line/welcome', v); toast('บันทึกแล้ว'); render(); } }) }, icon('pencil-fill'), 'แก้ไข'))), ubox);
  usersBox(ubox);
}
async function load() { main.replaceChildren(...skeleton(3, '120px')); try { d = await get('/admin/line/state'); render(); } catch (e) { main.replaceChildren(failed(e, load)); } }
load();
