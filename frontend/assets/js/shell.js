import { get, send } from './api.js';
import { API_BASE } from './config.js';
import { $, confirmDialog, h, icon, toast } from './ui.js';

const loginUrl = () => `${API_BASE}/auth/line/start?returnTo=${location.pathname.startsWith('/tracking') ? '/tracking.html' : '/'}`;
export const lineButton = (label = 'เข้าสู่ระบบด้วย LINE', cls = '') => h('a', { class: `btn btn-line ${cls}`, href: loginUrl() }, icon('line'), label);

const LINE_ERRORS = { LOGIN_CANCELLED: 'ยกเลิกการเข้าสู่ระบบด้วย LINE', LOGIN_EXPIRED: 'การเข้าสู่ระบบหมดอายุ กรุณาลองใหม่อีกครั้ง', LINE_LOGIN_DISABLED: 'ระบบยังไม่ได้เปิดใช้ LINE Login', FORBIDDEN: 'บัญชี LINE นี้ถูกระงับการใช้งาน' };

function userMenu(session) {
  const { line } = session;
  const menu = h('div', { class: 'menu', hidden: true },
    h('a', { href: '/tracking.html' }, icon('clipboard2-check'), 'ใบสมัครของฉัน'),
    h('button', { type: 'button', onclick: async () => { await send('POST', '/auth/logout').catch(() => {}); location.reload(); } }, icon('box-arrow-right'), 'ออกจากระบบ'),
    h('button', { type: 'button', onclick: async () => {
      if (!(await confirmDialog({ title: 'ยกเลิกเชื่อมบัญชี LINE?', text: 'คุณจะไม่เห็นใบสมัครผ่าน LINE นี้อีก จนกว่าจะเชื่อมใหม่ด้วยเลขที่ใบสมัคร', confirm: 'ยกเลิกการเชื่อม', danger: true }))) return;
      try { await send('POST', '/line/unlink-account'); location.reload(); } catch (e) { toast(e.message, 'error'); }
    } }, icon('person-dash'), 'ยกเลิกเชื่อมบัญชี LINE'));
  const btn = h('button', { class: 'line-user', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); } },
    line.pictureUrl ? h('img', { src: line.pictureUrl, alt: '', referrerPolicy: 'no-referrer' }) : h('b', { class: 'ph' }, icon('person-fill')), h('span', {}, line.displayName || 'ผู้ใช้ LINE'), icon('chevron-down'));
  document.addEventListener('click', () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
  return [btn, menu];
}

/** แถบบน + ส่วนท้าย + สถานะ LINE ใช้ร่วมกันทุกหน้า คืน { session, site } */
export async function initShell(active) {
  const slot = h('div', {});
  const link = (href, ic, label, key) => h('a', { href, 'aria-current': active === key ? 'page' : null, 'aria-label': label }, icon(ic), h('span', {}, label));
  $('#topbar').append(h('a', { class: 'mini', href: '/' }, 'E-Training', h('img', { src: '/assets/images/leaf.svg', alt: '' })), h('nav', { class: 'topnav', 'aria-label': 'เมนูหลัก' }, link('/', 'pencil-square', 'สมัครอบรม', 'apply'), link('/tracking.html', 'search-heart', 'ติดตามสถานะ', 'track')), slot);
  const params = new URLSearchParams(location.search);
  if (params.has('line')) {
    const r = params.get('line');
    if (r === 'ok') toast('เข้าสู่ระบบด้วย LINE สำเร็จ');
    else toast(LINE_ERRORS[r] ?? 'เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่', 'error');
    history.replaceState(null, '', location.pathname);
  }
  const [session, site] = await Promise.all([get('/auth/session').catch(() => ({ authenticated: false, lineLoginEnabled: false })), get('/catalog/site-info').catch(() => null)]);
  if (session.line) slot.append(...userMenu(session));
  else if (session.lineLoginEnabled) slot.append(lineButton(innerWidth < 560 ? 'LINE' : 'เข้าสู่ระบบด้วย LINE', 'btn-sm'));
  if (site?.announcement) $('#announce')?.append(h('div', { class: 'announce', role: 'note' }, icon('megaphone-fill'), h('span', {}, site.announcement)));
  const year = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Bangkok' }).format()) + 543;
  $('#foot').append(...[h('nav', { 'aria-label': 'ติดต่อ' },
    site?.contact_phone && h('a', { href: `tel:${site.contact_phone.replace(/[^\d+]/g, '')}` }, icon('telephone-fill'), ` ${site.contact_phone}`),
    site?.contact_email && h('a', { href: `mailto:${site.contact_email}` }, icon('envelope-fill'), ` ${site.contact_email}`),
    site?.contact_line_url && h('a', { href: site.contact_line_url, rel: 'noopener', target: '_blank' }, icon('line'), ' LINE ติดต่อเจ้าหน้าที่')),
  h('nav', { 'aria-label': 'ข้อกฎหมาย' }, h('a', { href: '/privacy.html' }, 'ประกาศความเป็นส่วนตัว'), h('a', { href: '/policy.html' }, 'เงื่อนไขการใช้งานและนโยบายเว็บไซต์'), h('a', { href: '/policy.html#cookies' }, 'คุกกี้'), h('a', { href: '/policy.html#copyright' }, 'ลิขสิทธิ์')),
  h('p', { class: 'copy-line' }, `© ${year} ${site?.copyrightOwner ?? 'E-Training'} สงวนลิขสิทธิ์ตามพระราชบัญญัติลิขสิทธิ์ พ.ศ. 2537`)]);
  return { session, site };
}
