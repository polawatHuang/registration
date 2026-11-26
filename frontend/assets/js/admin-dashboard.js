import { get } from './api.js';
import { fmtRange, h, icon, loadChart, num, reduced } from './ui.js';
import { barChart, days14, money, setFx } from './ai-report.js';
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
  try { d = await get('/admin/dashboard'); } catch (e) { main.replaceChildren(failed(e, load)); return; }
  setFx(d.ai?.fx);
  // ส่วนเสริมโหลดตามมาเอง ช้าหรือพลาดก็ไม่ขวางหน้าหลัก
  const alerts = h('div', { id: 'alerts' });
  const warn = (cls, href2, ic, text) => alerts.append(h(href2 ? 'a' : 'div', { class: `legal-warn ${cls}`, href: href2 }, icon(ic), h('span', {}, text), href2 && icon('chevron-right')));
  const extra = (allowed, path, show) => { if (allowed) get(path).then(show).catch((e) => { if (e.status !== 401) warn('', null, 'exclamation-triangle-fill', e.message); }); };
  const kpis = h('section', { class: 'kpis' });
  const n = (s) => d.statuses.find((x) => x.status === s)?.n ?? 0;
  const pending = n('submitted') + n('under_review');
  const kpi = (i, ic, c, label, value, href) => {
    const b = h('b', {}, '0');
    countUp(b, value);
    return h(href ? 'a' : 'div', { class: 'kpi', href, style: { '--c': c, '--i': i } }, icon(ic), b, h('span', {}, label), href && h('small', { class: 'kpi-more', 'aria-hidden': 'true' }, 'ดูรายละเอียด ›'));
  };
  const line = h('canvas', { role: 'img', 'aria-label': 'กราฟผู้สมัคร 14 วันล่าสุด' }); const pie = h('canvas', { role: 'img', 'aria-label': 'สัดส่วนสถานะผู้สมัคร' });
  const [cIn, cNote, cAi] = ['เช็กอินรายวัน', 'แจ้งเตือนรายวัน', 'คำถาม AI รายวัน'].map((l) => h('canvas', { role: 'img', 'aria-label': `กราฟ${l}` }));
  main.replaceChildren(...[alerts,
    h('section', { class: 'hero' }, h('h2', {}, `${hour < 12 ? 'สวัสดีตอนเช้า' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น'} คุณ${me.displayName}`), h('p', {}, pending ? `มีใบสมัครรอตรวจ ${num(pending)} ใบ` : 'ตรวจใบสมัครครบแล้ว ยอดเยี่ยม!'), h('img', { src: '/assets/images/leaf.svg', alt: '' })),
    (kpis.append(...[kpi(0, 'people-fill', purple, 'ผู้สมัครทั้งหมด', d.total, '/admin/applications.html'), kpi(1, 'calendar-plus-fill', green, 'สมัครวันนี้', d.today, '/admin/applications.html?when=today'), kpi(2, 'hourglass-split', '#f5821f', 'รอตรวจเอกสาร', pending, '/admin/applications.html?status=submitted,under_review'), kpi(3, 'exclamation-diamond-fill', '#c92a3a', 'รอผู้สมัครแก้', n('documents_incomplete'), '/admin/applications.html?status=documents_incomplete'),
      kpi(4, 'check-circle-fill', '#35a66a', 'อนุมัติแล้ว', n('approved') + n('awaiting_training') + n('attended') + n('passed') + n('certified'), '/admin/applications.html?status=approved,awaiting_training,attended,passed,certified'), kpi(5, 'line', '#05a848', 'เข้าใช้ด้วย LINE', d.line.users, can('chat.reply') ? '/admin/chat.html' : can('notifications.manage') ? '/admin/line.html' : null), kpi(6, 'link-45deg', '#2f7fb5', 'ผูก LINE กับบุคคลแล้ว', d.line.linked, '/admin/applications.html?line=linked'), kpi(7, 'calendar2-check-fill', '#8a6be0', 'รุ่นที่เปิดรับ', d.sessions.length, can('catalog.manage') ? '/admin/catalog.html#sessions' : null), kpi(10, 'person-check-fill', '#2f7fb5', 'ผู้เข้าอบรมแล้ว', d.attendance.total, can('attendance.manage') ? '/admin/attendance.html' : null), kpi(11, 'award-fill', '#c99a00', 'ใบประกาศที่ออก', d.certificates, can('certificates.manage') ? '/admin/certificates.html' : null), ...(d.ai ? [kpi(12, 'robot', '#6a4fc0', 'บทสนทนา AI เดือนนี้', d.ai.conversations, '/admin/ai-knowledge.html#report')] : [])]), kpis),
    h('section', { class: 'grid2' }, h('div', { class: 'box' }, h('h2', {}, 'ผู้สมัคร 14 วันล่าสุด'), h('div', { class: 'chart' }, line)), h('div', { class: 'box' }, h('h2', {}, 'สถานะใบสมัคร'), d.total ? h('div', { class: 'chart' }, pie) : empty('pie-chart', 'ยังไม่มีข้อมูล'))),
    h('section', { class: 'grid2 even' }, h('div', { class: 'box' }, h('h2', {}, 'เช็กอิน 14 วัน'), h('div', { class: 'chart' }, cIn)), h('div', { class: 'box' }, h('h2', {}, 'แจ้งเตือนที่ส่งสำเร็จ 14 วัน'), h('div', { class: 'chart' }, cNote))),
    d.ai && h('section', { class: 'grid2 even' }, h('div', { class: 'box' }, h('h2', {}, `AI เดือนนี้ ${num(d.ai.tokens)} token · ${money(d.ai.cost, d.ai.currency)}`), h('div', { class: 'chart' }, cAi)), h('div', { class: 'box' }, h('h2', {}, 'คำถาม AI ที่พบบ่อย'), d.ai.frequent.length ? d.ai.frequent.map((f) => h('div', { class: 'occ' }, h('div', {}, h('span', {}, f.question), h('strong', {}, num(f.count))), h('div', { class: 'bar' }, h('i', { style: { '--w': `${(f.count / d.ai.frequent[0].count) * 100}%` } })))) : empty('chat', 'ยังไม่มีคำถาม'))),
    h('section', { class: 'box' }, h('h2', {}, 'ที่นั่งรุ่นที่เปิดรับ'), d.sessions.length ? d.sessions.map((s) => h('div', { class: 'occ' }, h('div', {}, h('span', {}, `${s.session_name} · ${s.university_name} · ${fmtRange(s.starts_at, s.starts_at)}`), h('strong', {}, s.capacity === null ? `${num(s.registered)} คน` : `${num(s.registered)}/${num(s.capacity)}`)),
      s.capacity !== null && h('div', { class: `bar ${s.registered >= s.capacity ? 'full' : ''}` }, h('i', { style: { '--w': `${Math.min(100, (s.registered / s.capacity) * 100)}%` } })))) : empty('calendar-x', 'ยังไม่มีรุ่นที่เปิดรับ'))].filter(Boolean));
  extra(can('ai.manage'), '/ai/credit', (c) => { setFx(c.fx); if (c.configured && (c.health.status !== 'ok' || ['low', 'critical', 'empty'].includes(c.level))) warn('ai-warn', '/admin/ai-knowledge.html#credit', 'lightning-charge-fill', c.health.status !== 'ok' ? `AI หยุดตอบ: ${c.kindText ?? 'ขัดข้อง'}` : c.level === 'empty' ? 'เครดิต AI น่าจะหมดแล้ว' : `เครดิต AI ${c.level === 'critical' ? 'ใกล้หมด' : 'เหลือน้อย'} ประมาณ ${money(c.remaining, c.currency)}`); });
  extra(can('settings.manage'), '/admin/system', (y) => { const left = y.items.filter((i) => i.level === 'required' && !i.ok); if (left.length) warn('', '/admin/settings.html#system', 'clipboard2-check-fill', `ยังไม่พร้อมเปิดรับสมัคร เหลือ ${num(left.length)} รายการ: ${left.slice(0, 3).map((i) => i.label).join(', ')}${left.length > 3 ? ' …' : ''}`); });
  extra(!can('settings.manage'), '/catalog/site-info', (x) => { if (!x.legalApproved) warn('', null, 'exclamation-triangle-fill', 'ประกาศความเป็นส่วนตัวยังเป็นฉบับร่าง ต้องเผยแพร่ก่อนเปิดรับสมัครจริง'); });
  extra(can('chat.reply'), '/admin/chat/poll?filter=attention', ({ counts: c }) => { if (c.unread || c.attention) warn('chat', '/admin/chat.html', 'chat-dots-fill', `แชตยังไม่อ่าน ${num(c.unread)} · ต้องการเจ้าหน้าที่ ${num(c.attention)}`); });
  extra(can('retention.manage'), '/admin/retention/summary', (r) => { if (r.due || r.requests.pending) warn('', '/admin/retention.html', 'trash3-fill', `ข้อมูลครบกำหนดลบ ${num(r.due)} รายการ · คำขอลบรอพิจารณา ${num(r.requests.pending)} รายการ${r.requests.urgent ? ` (ใกล้ครบ 90 วัน ${num(r.requests.urgent)})` : ''}`); });
  extra(can('notifications.manage'), '/admin/notifications/state', (t) => kpis.append(kpi(8, 'send-check-fill', '#05a848', 'แจ้งเตือนสำเร็จ 30 วัน', t.stats.sent ?? 0, '/admin/notifications.html'), kpi(9, 'send-x-fill', '#c92a3a', 'แจ้งเตือนล้มเหลว 30 วัน', t.stats.failed ?? 0, '/admin/notifications.html')));
  const Chart = await loadChart().catch(() => null);
  if (!Chart || !line.isConnected) return;
  Chart.defaults.font.family = 'Prompt'; Chart.defaults.animation = reduced() ? false : { duration: 1100, easing: 'easeOutQuart' };
  barChart(cIn, days14(d.attendance.daily, (x) => x.n), { name: 'เช็กอิน', color: '#168447' });
  barChart(cNote, days14(d.notifications, (x) => x.n), { name: 'ส่งสำเร็จ', color: '#05a848' });
  if (d.ai) barChart(cAi, days14(d.ai.daily, (x) => x.n), { name: 'คำถาม' });
  const days = lastDays(d.daily);
  const g = line.getContext('2d').createLinearGradient(0, 0, 0, 240);
  g.addColorStop(0, 'rgba(106,79,192,.45)'); g.addColorStop(1, 'rgba(106,79,192,0)');
  new Chart(line, { type: 'line', data: { labels: days.map((x) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(x.day))), datasets: [{ label: 'ผู้สมัคร', data: days.map((x) => x.n), borderColor: purple, backgroundColor: g, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 3, pointBackgroundColor: green }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0ebf9' } } } } });
  if (d.total) new Chart(pie, { type: 'doughnut', data: { labels: d.statuses.map((s) => s.label), datasets: [{ data: d.statuses.map((s) => s.n), backgroundColor: d.statuses.map((s) => COLORS[s.status]), borderWidth: 3 }] }, options: { maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } } } });
}
load();
