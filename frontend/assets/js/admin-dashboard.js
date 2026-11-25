import { get } from './api.js';
import { fmtRange, h, icon, num, reduced } from './ui.js';
import { countUp } from './fx.js';
import { can, empty, failed, initAdmin, me, skeleton } from './admin.js';

const main = await initAdmin('dashboard');
const purple = '#6a4fc0'; const green = '#168447';
const hour = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Bangkok' }).format());
const COLORS = { submitted: '#f4b942', under_review: '#8a6be0', documents_incomplete: '#e0525f', documents_approved: '#8fd14b', approved: '#168447', awaiting_training: '#35a66a', attended: '#2f7fb5', passed: '#1f5f99', certified: '#49378a', rejected: '#8c8799', cancelled: '#c6c1d1' };

function lastDays(daily) {
  const map = new Map(daily.map((d) => [d.day, d.n]));
  return Array.from({ length: 14 }, (_, i) => { const day = new Date(Date.now() + 7 * 3_600_000 - (13 - i) * 86_400_000).toISOString().slice(0, 10); return { day, n: map.get(day) ?? 0 }; });
}
async function load() {
  main.replaceChildren(...skeleton(3, '130px'));
  let d;
  let site; let ret = null; let chat = null;
  try { [d, site] = await Promise.all([get('/admin/dashboard'), get('/catalog/site-info')]); if (can('retention.manage')) ret = await get('/admin/retention/summary'); if (can('chat.reply')) chat = (await get('/admin/chat/poll?filter=attention')).counts; } catch (e) { main.replaceChildren(failed(e, load)); return; }
  const n = (s) => d.statuses.find((x) => x.status === s)?.n ?? 0;
  const pending = n('submitted') + n('under_review');
  const kpi = (i, ic, c, label, value, href) => {
    const b = h('b', {}, '0');
    countUp(b, value);
    return h(href ? 'a' : 'div', { class: 'kpi', href, style: { '--c': c, '--i': i } }, icon(ic), b, h('span', {}, label));
  };
  const line = h('canvas', { role: 'img', 'aria-label': 'กราฟผู้สมัคร 14 วันล่าสุด' }); const pie = h('canvas', { role: 'img', 'aria-label': 'สัดส่วนสถานะผู้สมัคร' });
  main.replaceChildren(...(site.legalApproved ? [] : [h('a', { class: 'legal-warn', href: '/admin/settings.html#legal' }, icon('exclamation-triangle-fill'), h('span', {}, 'ประกาศความเป็นส่วนตัวยังเป็นฉบับร่าง ต้องเผยแพร่ก่อนเปิดรับสมัครจริง'), icon('chevron-right'))]),
    ...(chat && (chat.unread || chat.attention) ? [h('a', { class: 'legal-warn chat', href: '/admin/chat.html' }, icon('chat-dots-fill'), h('span', {}, `แชตยังไม่อ่าน ${num(chat.unread)} · ต้องการเจ้าหน้าที่ ${num(chat.attention)}`), icon('chevron-right'))] : []),
    ...(ret && (ret.due || ret.requests.pending) ? [h('a', { class: 'legal-warn', href: '/admin/retention.html' }, icon('trash3-fill'), h('span', {}, `ข้อมูลครบกำหนดลบ ${num(ret.due)} รายการ · คำขอลบรอพิจารณา ${num(ret.requests.pending)} รายการ${ret.requests.urgent ? ` (ใกล้ครบ 90 วัน ${num(ret.requests.urgent)})` : ''}`), icon('chevron-right'))] : []),
    h('section', { class: 'hero' }, h('h2', {}, `${hour < 12 ? 'สวัสดีตอนเช้า' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น'} คุณ${me.displayName}`), h('p', {}, pending ? `มีใบสมัครรอตรวจ ${num(pending)} ใบ` : 'ตรวจใบสมัครครบแล้ว ยอดเยี่ยม!'), h('img', { src: '/assets/images/leaf.svg', alt: '' })),
    h('section', { class: 'kpis' }, kpi(0, 'people-fill', purple, 'ผู้สมัครทั้งหมด', d.total, '/admin/applications.html'), kpi(1, 'calendar-plus-fill', green, 'สมัครวันนี้', d.today), kpi(2, 'hourglass-split', '#f5821f', 'รอตรวจเอกสาร', pending, '/admin/applications.html?status=submitted'), kpi(3, 'exclamation-diamond-fill', '#c92a3a', 'รอผู้สมัครแก้', n('documents_incomplete'), '/admin/applications.html?status=documents_incomplete'),
      kpi(4, 'check-circle-fill', '#35a66a', 'อนุมัติแล้ว', n('approved') + n('awaiting_training') + n('attended') + n('passed') + n('certified')), kpi(5, 'line', '#05a848', 'เข้าใช้ด้วย LINE', d.line.users), kpi(6, 'link-45deg', '#2f7fb5', 'ผูก LINE กับบุคคลแล้ว', d.line.linked), kpi(7, 'calendar2-check-fill', '#8a6be0', 'รุ่นที่เปิดรับ', d.sessions.length)),
    h('section', { class: 'grid2' }, h('div', { class: 'box' }, h('h2', {}, 'ผู้สมัคร 14 วันล่าสุด'), h('div', { class: 'chart' }, line)), h('div', { class: 'box' }, h('h2', {}, 'สถานะใบสมัคร'), d.total ? h('div', { class: 'chart' }, pie) : empty('pie-chart', 'ยังไม่มีข้อมูล'))),
    h('section', { class: 'box' }, h('h2', {}, 'ที่นั่งรุ่นที่เปิดรับ'), d.sessions.length ? d.sessions.map((s) => h('div', { class: 'occ' }, h('div', {}, h('span', {}, `${s.session_name} · ${s.university_name} · ${fmtRange(s.starts_at, s.starts_at)}`), h('strong', {}, s.capacity === null ? `${num(s.registered)} คน` : `${num(s.registered)}/${num(s.capacity)}`)),
      s.capacity !== null && h('div', { class: `bar ${s.registered >= s.capacity ? 'full' : ''}` }, h('i', { style: { '--w': `${Math.min(100, (s.registered / s.capacity) * 100)}%` } })))) : empty('calendar-x', 'ยังไม่มีรุ่นที่เปิดรับ')));
  const { Chart } = window;
  Chart.defaults.font.family = 'Prompt'; Chart.defaults.animation = reduced() ? false : { duration: 1100, easing: 'easeOutQuart' };
  const days = lastDays(d.daily);
  const g = line.getContext('2d').createLinearGradient(0, 0, 0, 240);
  g.addColorStop(0, 'rgba(106,79,192,.45)'); g.addColorStop(1, 'rgba(106,79,192,0)');
  new Chart(line, { type: 'line', data: { labels: days.map((x) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(x.day))), datasets: [{ label: 'ผู้สมัคร', data: days.map((x) => x.n), borderColor: purple, backgroundColor: g, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 3, pointBackgroundColor: green }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0ebf9' } } } } });
  if (d.total) new Chart(pie, { type: 'doughnut', data: { labels: d.statuses.map((s) => s.label), datasets: [{ data: d.statuses.map((s) => s.n), backgroundColor: d.statuses.map((s) => COLORS[s.status]), borderWidth: 3 }] }, options: { maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } } } });
}
load();
