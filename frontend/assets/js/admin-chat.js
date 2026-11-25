import { get, send } from './api.js';
import { API_BASE } from './config.js';
import { $, confirmDialog, fmtDate, fmtTime, h, icon, num, reduced, toast } from './ui.js';
import { badge, can, empty, failed, initAdmin, skeleton } from './admin.js';

const main = await initAdmin('chat');
main.classList.add('chat-page');
const TITLE = document.title;
const FILTERS = [['all', 'ทั้งหมด'], ['unread', 'ยังไม่อ่าน'], ['attention', 'ต้องการคน'], ['mine', 'ของฉัน'], ['closed', 'ปิดแล้ว']];
const SENDER = { ai: 'ผู้ช่วย AI', admin: 'เจ้าหน้าที่', system: 'ระบบ' };
const S = { filter: 'all', q: '', limit: 0, rev: '', since: 0, list: [], more: false, counts: {}, open: null, detail: null, msgs: new Map(), older: false, state: null, sound: localStorageGet('lst-chat-sound') !== '0', lastUnread: null, timer: null, busy: false };
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* โหมดส่วนตัว */ } }
const dayKey = (v) => fmtDate(v);
const when = (v) => (dayKey(v) === dayKey(Date.now()) ? fmtTime(v) : fmtDate(v).replace(/ \d{4}$/, ''));

// ---------- แถบ AI ทั้งระบบ ----------
const orb = h('span', { class: 'orb', 'aria-hidden': 'true' }, icon('robot'));
const aiSwitch = h('input', { type: 'checkbox', role: 'switch', id: 'aiGlobal', disabled: true, onchange: () => setGlobal(aiSwitch.checked) });
const aiText = h('small', {});
const quota = h('div', { class: 'quota' });
const bar = h('section', { class: 'aibar' }, orb, h('div', { class: 'aitxt' }, h('strong', {}, 'AI Chat Bot'), aiText), quota,
  h('button', { class: 'icon-btn', type: 'button', id: 'snd', title: 'เสียงแจ้งเตือน', 'aria-label': 'เปิด/ปิดเสียงแจ้งเตือน', onclick: () => { S.sound = !S.sound; localStorageSet('lst-chat-sound', S.sound ? '1' : '0'); paintSound(); if (S.sound) chime(); } }),
  h('label', { class: 'sw', htmlFor: 'aiGlobal' }, aiSwitch, h('i', {}), h('span', { class: 'sr' }, 'เปิดหรือปิด AI Chat Bot ทั้งระบบ')));
const paintSound = () => $('#snd').replaceChildren(icon(S.sound ? 'bell-fill' : 'bell-slash'));
function paintAi(on) {
  aiSwitch.checked = on;
  bar.classList.toggle('on', on);
  aiText.textContent = S.state?.aiHealth?.text && on ? `หยุดชั่วคราว: ${S.state.aiHealth.text} ส่งต่อเจ้าหน้าที่แทน` : !S.state?.lineReady ? 'ยังไม่ได้ตั้งค่า LINE Messaging API' : !S.state.aiReady ? 'ยังไม่ได้ตั้งค่า MiniMax' : on ? 'กำลังตอบลูกค้าอัตโนมัติจากคลังความรู้' : 'ปิดอยู่ เจ้าหน้าที่ตอบเองทั้งหมด';
  aiSwitch.disabled = !can('chat.manage') || (!on && !S.state?.aiReady);
}
async function setGlobal(on) {
  aiSwitch.checked = !on;
  if (!(await confirmDialog({ title: on ? 'เปิด AI ตอบอัตโนมัติ?' : 'ปิด AI ทั้งระบบ?', text: on ? 'AI จะตอบทุกแชตที่ไม่ได้ปิดไว้เป็นรายคน โดยใช้เฉพาะคลังความรู้ที่เผยแพร่และตารางอบรมจริง' : 'ข้อความใหม่ทุกแชตจะรอเจ้าหน้าที่ตอบ', confirm: on ? 'เปิด AI' : 'ปิด AI', danger: !on }))) return;
  try { S.state = await send('PUT', '/admin/chat/ai', { enabled: on }); paintAi(S.state.aiEnabled); toast(on ? 'เปิด AI แล้ว' : 'ปิด AI แล้ว'); } catch (e) { toast(e.message, 'error'); }
}
function paintQuota() {
  const q = S.state?.quota;
  quota.replaceChildren(...(q ? [h('span', {}, q.limited ? `โควตา ${num(q.remaining)}/${num(q.limit)}` : `ส่งแล้ว ${num(q.used)}`)] : []));
  quota.classList.toggle('low', Boolean(q?.limited && q.remaining < q.limit * 0.1));
}

// ---------- รายการแชต ----------
const search = h('input', { class: 'input', type: 'search', placeholder: 'ค้นหาชื่อ LINE ชื่อผู้สมัคร เลขที่ใบสมัคร', 'aria-label': 'ค้นหาแชต' });
let typing;
search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { S.q = search.value.trim(); resetList(); }, 280); });
const chips = h('div', { class: 'tabs', role: 'tablist' });
const listEl = h('div', { class: 'clist', role: 'list' });
const moreEl = h('div', {});
const left = h('aside', { class: 'cleft', 'aria-label': 'รายการแชต' }, h('div', { class: 'cleft-top' }, search, chips), listEl, moreEl);
const avatar = (c, cls = '') => (c.picture ? h('img', { class: `av ${cls}`, src: c.picture, alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' }) : h('span', { class: `av ph ${cls}`, 'aria-hidden': 'true' }, [...c.name][0] ?? '?'));
function paintChips() {
  chips.replaceChildren(...FILTERS.map(([k, l]) => { const n = { all: S.counts.open, unread: S.counts.unread, attention: S.counts.attention, mine: S.counts.mine }[k]; return h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === S.filter), class: k === 'attention' && n ? 'hot' : '', onclick: () => { S.filter = k; resetList(); } }, l, n ? h('b', {}, num(n)) : null); }));
  document.title = S.counts.unread ? `(${S.counts.unread}) ${TITLE}` : TITLE;
}
function paintList() {
  if (!S.list.length) { listEl.replaceChildren(empty(S.q ? 'search' : 'chat-heart', S.q ? 'ไม่พบแชต' : S.filter === 'attention' ? 'ไม่มีแชตที่ต้องการคน เยี่ยมมาก' : 'ยังไม่มีแชตในกลุ่มนี้')); moreEl.replaceChildren(); return; }
  listEl.replaceChildren(...S.list.map((c) => h('button', { class: `citem ${c.id === S.open ? 'sel' : ''} ${c.unread ? 'new' : ''}`, type: 'button', role: 'listitem', onclick: () => openChat(c.id) }, avatar(c),
    h('span', { class: 'cbody' }, h('span', { class: 'cname' }, c.name, c.blocked && icon('slash-circle')), h('span', { class: 'cprev' }, c.lastSender && c.lastSender !== 'user' && h('i', { class: `bi bi-${c.lastSender === 'ai' ? 'robot' : 'reply-fill'}` }), c.preview), c.attention && h('span', { class: 'cattn' }, icon('exclamation-circle-fill'), c.attention)),
    h('span', { class: 'cside' }, h('time', {}, c.lastAt ? when(c.lastAt) : ''), c.unread ? h('b', { class: 'cnt' }, c.unread > 99 ? '99+' : String(c.unread)) : c.aiMode === 'off' ? h('i', { class: 'bi bi-person-fill', title: 'เจ้าหน้าที่ดูแล' }) : null))));
  moreEl.replaceChildren(...(S.more ? [h('button', { class: 'btn btn-sm', type: 'button', style: { width: '100%' }, onclick: loadMore }, 'ดูเพิ่ม')] : []));
}
function resetList() { S.list = []; S.rev = ''; S.more = false; listEl.replaceChildren(...skeleton(5, '72px')); paintChips(); tick(); }
async function loadMore() {
  try { const r = await get(`/admin/chat/poll?${new URLSearchParams({ filter: S.filter, q: S.q, offset: S.list.length })}`); const seen = new Set(S.list.map((c) => c.id)); S.list.push(...r.conversations.filter((c) => !seen.has(c.id))); S.more = r.more; paintList(); } catch (e) { toast(e.message, 'error'); }
}

// ---------- ห้องแชต ----------
const thread = h('div', { class: 'cthread', role: 'log', 'aria-live': 'polite', 'aria-label': 'ข้อความ' });
const head = h('header', { class: 'chead' });
const input = h('textarea', { class: 'input', rows: 1, maxLength: 4900, placeholder: 'พิมพ์ข้อความ…', 'aria-label': 'ข้อความตอบกลับ' });
const sendBtn = h('button', { class: 'csend', type: 'submit', 'aria-label': 'ส่ง' }, icon('send-fill'));
const draftBtn = h('button', { class: 'cdraft', type: 'button', title: 'ให้ AI ช่วยร่าง (ไม่ส่งเอง)', 'aria-label': 'ให้ AI ช่วยร่างคำตอบ', onclick: suggest }, icon('stars'));
const hint = h('div', { class: 'chint' });
const composer = h('form', { class: 'ccomp', onsubmit: (e) => { e.preventDefault(); submit(); } }, hint, h('div', { class: 'crow' }, draftBtn, input, sendBtn));
const side = h('aside', { class: 'cinfo', 'aria-label': 'ข้อมูลผู้ติดต่อ' });
const right = h('section', { class: 'cright' });
const blank = h('div', { class: 'cblank' }, h('img', { src: '/assets/images/scene-field.svg', alt: '' }), h('h2', {}, 'รวมทุกแชตจาก LINE OA ไว้ที่เดียว'), h('p', { class: 'muted' }, 'เลือกแชตทางซ้ายเพื่อเริ่มตอบ'));
right.append(blank);
const drafts = new Map();
input.addEventListener('input', () => { if (S.open) drafts.set(S.open, input.value); grow(); });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); submit(); } });
function grow() { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 150)}px`; sendBtn.disabled = !input.value.trim(); }

function bubble(m) {
  const out = m.direction === 'out';
  const media = m.media && `${API_BASE}/admin/chat/${S.open}/messages/${m.id}/media`;
  const body = m.type === 'unsent' ? h('em', { class: 'muted' }, 'ผู้ใช้ยกเลิกข้อความนี้')
    : m.media?.startsWith('image/') ? h('a', { href: media, target: '_blank', rel: 'noopener' }, h('img', { class: 'cimg', src: media, alt: 'รูปจากผู้ใช้', loading: 'lazy' }))
      : m.media ? h('a', { class: 'cfile', href: media, target: '_blank', rel: 'noopener' }, icon('file-earmark-pdf-fill'), m.text) : h('span', {}, m.text ?? '');
  return h('div', { class: `cmsg ${m.sender} ${m.status}`, 'data-id': m.id },
    out && h('div', { class: 'cwho' }, m.sender === 'ai' && icon('robot'), m.sender === 'admin' ? (m.adminName ?? SENDER.admin) : SENDER[m.sender]),
    h('div', { class: 'cbub' }, body, m.ai?.sources?.length > 0 && h('div', { class: 'csrc' }, icon('journal-check'), m.ai.sources.join(' · '))),
    h('div', { class: 'cmeta' }, h('time', {}, fmtTime(m.at)), out && m.status === 'pending' && h('span', { class: 'spin' }), out && m.status === 'sent' && icon('check2'), out && m.via === 'push' && h('span', { title: 'ใช้โควตาข้อความ' }, 'push'),
      m.status === 'failed' && h('span', { class: 'cerr' }, m.error, m.id > 0 && h('button', { type: 'button', onclick: (e) => resend(m.id, e.currentTarget) }, 'ส่งอีกครั้ง'))));
}
const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
function paintThread(stick) {
  const items = [...S.msgs.values()].sort((a, b) => (a.id < 0) - (b.id < 0) || a.id - b.id);
  const nodes = []; let day = '';
  if (S.older) nodes.push(h('button', { class: 'btn btn-sm colder', type: 'button', onclick: loadOlder }, 'ข้อความก่อนหน้า'));
  for (const m of items) { if (dayKey(m.at) !== day) { day = dayKey(m.at); nodes.push(h('div', { class: 'cday' }, day)); } nodes.push(bubble(m)); }
  if (!items.length) nodes.push(empty('chat-dots', 'ยังไม่มีข้อความ'));
  thread.replaceChildren(...nodes);
  if (stick) thread.scrollTop = thread.scrollHeight;
}
function paintHead() {
  const c = S.detail;
  if (!c) return;
  const ai = c.aiMode === 'auto';
  const sw = h('input', { type: 'checkbox', role: 'switch', checked: ai, id: 'aiOne', onchange: () => patch({ aiMode: sw.checked ? 'auto' : 'off' }, sw.checked ? 'เปิด AI สำหรับแชตนี้' : 'ปิด AI สำหรับแชตนี้') });
  head.replaceChildren(h('button', { class: 'icon-btn cback', type: 'button', 'aria-label': 'กลับ', onclick: closeChat }, icon('chevron-left')), avatar(c, 'sm'),
    h('div', { class: 'cttl' }, h('strong', {}, c.name), h('small', {}, c.blocked ? 'บล็อก LINE OA อยู่' : c.assignedName ? `ดูแลโดย ${c.assignedName}` : 'ยังไม่มีผู้ดูแล')),
    h('label', { class: `aione ${ai && S.aiOn ? 'on' : ''}`, htmlFor: 'aiOne', title: S.aiOn ? '' : 'AI ทั้งระบบปิดอยู่' }, icon('robot'), h('span', { class: 'sw sm' }, sw, h('i', {})), h('span', { class: 'sr' }, 'เปิดหรือปิด AI สำหรับแชตนี้')),
    h('button', { class: 'icon-btn cinfo-btn', type: 'button', 'aria-label': 'ข้อมูลผู้ติดต่อ', onclick: () => main.classList.toggle('show-info') }, icon('person-vcard')));
  hint.replaceChildren(...(c.blocked ? [icon('slash-circle'), 'ผู้ใช้บล็อก LINE OA ส่งข้อความไม่ได้'] : c.attention ? [icon('exclamation-circle-fill'), c.attention, h('button', { type: 'button', onclick: () => patch({ attention: false }) }, 'รับทราบ')] : S.aiOn && ai ? [icon('robot'), 'AI ดูแลอยู่ เมื่อคุณตอบ AI ของแชตนี้จะหยุดทันที'] : []));
  hint.className = `chint ${c.attention || c.blocked ? 'warn' : ''}`;
  input.disabled = c.blocked; draftBtn.disabled = !S.state?.aiReady;
  side.replaceChildren(h('button', { class: 'icon-btn cinfo-x', type: 'button', 'aria-label': 'ปิด', onclick: () => main.classList.remove('show-info') }, icon('x-lg')), avatar(c, 'lg'), h('h2', {}, c.name),
    h('div', { class: 'bar-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => patch({ assign: !c.assignedTo }) }, icon('person-check'), c.assignedTo ? 'ปล่อยแชต' : 'รับเคส'),
      h('button', { class: `btn btn-sm ${c.status === 'open' ? 'btn-green' : ''}`, type: 'button', onclick: () => patch({ status: c.status === 'open' ? 'closed' : 'open' }, c.status === 'open' ? 'ปิดเคสแล้ว AI กลับมาดูแล' : 'เปิดเคสอีกครั้ง') }, icon(c.status === 'open' ? 'check2-circle' : 'arrow-counterclockwise'), c.status === 'open' ? 'ปิดเคส' : 'เปิดเคส')),
    h('h3', {}, 'ใบสมัครที่ผูก LINE'), ...(c.applications.length ? c.applications.map((a) => h(can('applicants.view') ? 'a' : 'div', { class: 'capp', href: can('applicants.view') ? `/admin/applications.html#${a.id}` : null }, h('strong', {}, a.name), h('small', {}, `${a.no} · ${a.session} · ${fmtDate(a.startsAt)}`), badge(a.status))) : [h('p', { class: 'muted' }, 'ยังไม่มี ผู้ใช้อาจยังไม่ได้สมัครหรือยังไม่เข้าสู่ระบบด้วย LINE')]));
}
function applyMessages(list) {
  let added = false;
  for (const m of list) { if (!S.msgs.has(m.id)) added = true; S.msgs.set(m.id, m); }
  return added;
}
async function openChat(id) {
  if (S.open === id) { main.classList.add('in-chat'); return; }
  Object.assign(S, { open: id, detail: null, msgs: new Map(), older: false, since: Date.now() - 5000 });
  main.classList.add('in-chat'); main.classList.remove('show-info');
  history.replaceState(null, '', `#${id}`);
  right.replaceChildren(head, thread, composer, side);
  head.replaceChildren(); hint.replaceChildren(); thread.replaceChildren(...skeleton(4, '52px'));
  input.value = drafts.get(id) ?? ''; grow(); paintList();
  try {
    const [d, m] = await Promise.all([get(`/admin/chat/${id}`), get(`/admin/chat/${id}/messages`)]);
    if (S.open !== id) return;
    S.detail = d; applyMessages(m.items); S.older = m.more;
    paintHead(); paintThread(true); readNow();
    if (matchMedia('(hover: hover)').matches) input.focus();
  } catch (e) { if (S.open === id) { thread.replaceChildren(failed(e, () => { S.open = null; openChat(id); })); } }
}
function closeChat() { S.open = null; S.detail = null; main.classList.remove('in-chat', 'show-info'); history.replaceState(null, '', location.pathname); right.replaceChildren(blank); paintList(); }
async function loadOlder() {
  const id = S.open; const first = Math.min(...[...S.msgs.keys()].filter((k) => k > 0));
  try { const m = await get(`/admin/chat/${id}/messages?before=${first}`); if (S.open !== id) return; const height = thread.scrollHeight; applyMessages(m.items); S.older = m.more; paintThread(false); thread.scrollTop = thread.scrollHeight - height; } catch (e) { toast(e.message, 'error'); }
}
const lastId = () => Math.max(0, ...S.msgs.keys());
async function readNow() {
  if (document.hidden || !S.open || !S.detail?.unread) return;
  const id = S.open;
  try { await send('POST', `/admin/chat/${id}/update`, { readUpTo: lastId() }); if (S.open === id) S.detail.unread = 0; } catch { /* ลองใหม่รอบถัดไป */ }
}
async function patch(body, message) {
  const id = S.open;
  try { const d = await send('POST', `/admin/chat/${id}/update`, body); if (S.open === id) { S.detail = d; } if (message) toast(message); S.rev = ''; tick(); } catch (e) { toast(e.message, 'error'); }
  if (S.open === id) paintHead();
}
async function submit() {
  const text = input.value.trim(); const id = S.open;
  if (!text || !id || !S.detail || S.detail.blocked) return;
  const temp = -Date.now();
  S.msgs.set(temp, { id: temp, direction: 'out', sender: 'admin', type: 'text', text, status: 'pending', adminName: 'คุณ', at: new Date().toISOString() });
  input.value = ''; drafts.delete(id); grow(); paintThread(true);
  const clientId = crypto.randomUUID();
  try {
    const r = await send('POST', `/admin/chat/${id}/messages`, { text, clientId });
    if (r.status === 'failed') toast(r.error ?? 'ส่งไม่สำเร็จ', 'error');
  } catch (e) {
    toast(e.message, 'error');
    if (S.open === id && !input.value) { input.value = text; grow(); }
  }
  if (S.open === id) S.msgs.delete(temp);
  S.rev = ''; await tick(); if (S.open === id) paintThread(true);
}
async function resend(messageId, btn) {
  if (!(await confirmDialog({ title: 'ส่งข้อความนี้อีกครั้ง?', text: 'ถ้าไม่แน่ใจว่าถึงผู้รับแล้วหรือไม่ โปรดตรวจใน LINE ก่อน', confirm: 'ส่งอีกครั้ง' }))) return;
  btn.disabled = true;
  try { const r = await send('POST', `/admin/chat/${S.open}/messages/${messageId}/retry`); if (r.status !== 'sent') toast(r.error ?? 'ส่งไม่สำเร็จ', 'error'); } catch (e) { toast(e.message, 'error'); }
  S.rev = ''; tick();
}
async function suggest() {
  const id = S.open;
  draftBtn.disabled = true; draftBtn.classList.add('think');
  try {
    const r = await send('POST', `/admin/chat/${id}/suggest`);
    if (S.open !== id) return;
    if (r.text) { input.value = r.text; drafts.set(id, r.text); grow(); input.focus(); toast('AI ร่างให้แล้ว ตรวจก่อนส่ง'); } else toast(r.mode === 'error' ? 'MiniMax ขัดข้อง' : 'คลังความรู้ไม่มีข้อมูลเรื่องนี้', 'error');
  } catch (e) { toast(e.message, 'error'); } finally { draftBtn.disabled = !S.state?.aiReady; draftBtn.classList.remove('think'); }
}

// ---------- อัปเดตสด ----------
let audio;
function chime() {
  try {
    audio ??= new AudioContext();
    for (const [f, t] of [[660, 0], [880, 0.11]]) { const o = audio.createOscillator(); const g = audio.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.28); o.connect(g).connect(audio.destination); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.3); }
  } catch { /* เบราว์เซอร์ยังไม่อนุญาตเสียง */ }
}
let failures = 0; let pending = null;
function tick() {
  // รวมคำขอที่ซ้อนกัน: ถ้ากำลังถามอยู่ ให้ถามอีกครั้งต่อท้าย
  if (S.busy) { pending ??= new Promise((r) => { S.after = r; }); return pending; }
  clearTimeout(S.timer);
  S.busy = true;
  return run().finally(() => { S.busy = false; const r = S.after; S.after = null; pending = null; if (r) tick().then(r); else { clearTimeout(S.timer); S.timer = setTimeout(tick, document.hidden ? 15_000 : Math.min(30_000, 3000 * 2 ** failures)); } });
}
async function run() {
  const ask = { filter: S.filter, q: S.q, rev: S.rev, ...(S.open ? { open: S.open, after: lastId(), since: S.since } : {}) };
  let r;
  try { r = await get(`/admin/chat/poll?${new URLSearchParams(ask)}`); failures = 0; main.classList.remove('offline'); } catch (e) {
    if (e.status === 401) { location.replace('/admin/login.html?next=chat'); return; }
    failures = Math.min(4, failures + 1); main.classList.add('offline');
    if (!S.list.length && !S.rev) listEl.replaceChildren(failed(e, tick));
    return;
  }
  if (ask.filter !== S.filter || ask.q !== S.q) { S.rev = ''; return; }
  S.rev = r.rev;
  if (S.aiOn !== r.aiEnabled) { S.aiOn = r.aiEnabled; if (S.state) paintAi(r.aiEnabled); if (S.detail) paintHead(); }
  if (r.conversations) {
    const rest = S.list.slice(r.conversations.length).filter((c) => !r.conversations.some((x) => x.id === c.id));
    S.list = [...r.conversations, ...(r.more ? rest : [])]; if (r.more !== null && !rest.length) S.more = r.more;
    S.counts = r.counts; paintChips(); paintList();
    if (S.lastUnread !== null && r.counts.unread + r.counts.attention > S.lastUnread && S.sound) chime();
    S.lastUnread = r.counts.unread + r.counts.attention;
  }
  if (S.open && ask.open === S.open) {
    if (r.open) { S.detail = r.open; paintHead(); }
    if (r.messages.length) { const stick = nearBottom(); const added = applyMessages(r.messages); paintThread(stick || (added && r.messages.at(-1).direction === 'out')); if (added && !stick && r.messages.at(-1).direction === 'in') toast('มีข้อความใหม่ด้านล่าง'); }
    S.since = r.now;
    readNow();
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
addEventListener('hashchange', () => { const id = Number(location.hash.slice(1)); if (id) openChat(id); });

main.replaceChildren(bar, h('div', { class: 'cgrid' }, left, right));
paintSound(); paintChips(); listEl.replaceChildren(...skeleton(5, '72px'));
if (reduced()) orb.classList.add('still');
async function loadState() {
  try { S.state = await get('/admin/chat/state'); S.aiOn = S.state.aiEnabled; paintAi(S.aiOn); paintQuota(); if (S.detail) paintHead(); if (!S.state.lineReady) toast('ตั้งค่า LINE Messaging API ที่หน้า "ตั้งค่า" ก่อน', 'error'); } catch (e) { toast(e.message, 'error'); }
}
await loadState();
setInterval(() => !document.hidden && loadState(), 120_000);
await tick();
const fromHash = Number(location.hash.slice(1));
if (Number.isInteger(fromHash) && fromHash > 0) openChat(fromHash);
