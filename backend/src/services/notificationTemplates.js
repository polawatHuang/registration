import { env } from '../config/env.js';
import { VARIABLES } from '../config/notificationTypes.js';
import { STATUS_LABELS, TIMELINE_STEP } from '../utils/status.js';

const TONES = { green: ['#168447', '#49378A'], purple: ['#6A4FC0', '#2C1F63'], orange: ['#F5821F', '#B8341F'], grey: ['#6B6780', '#3B3850'] };
const D = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' });
const T = new Intl.DateTimeFormat('th-TH', { timeStyle: 'short', timeZone: 'Asia/Bangkok' });
const https = env.APP_URL.startsWith('https://');

export const unknownVariables = (text) => [...new Set([...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1]).filter((v) => !(v in VARIABLES)))];
export function variablesOf(app) {
  const range = D.format(app.starts_at) === D.format(app.ends_at) ? D.format(app.starts_at) : `${D.format(app.starts_at)} – ${D.format(app.ends_at)}`;
  return { name: app.full_name, application_no: app.application_no, course: app.course_name, university: app.university_name, session: app.session_name, date: range, time: T.format(app.starts_at), location: app.location ?? '', status: STATUS_LABELS[app.status], reason: app.status_reason ?? '' };
}
export const SAMPLE = { full_name: 'ต้นข้าว ใจดี', application_no: 'ET69-SAMPLE23', course_name: 'หลักสูตรตัวอย่าง', university_name: 'มหาวิทยาลัยตัวอย่าง', session_name: 'รุ่นตัวอย่าง', starts_at: new Date('2027-01-15T02:00:00Z'), ends_at: new Date('2027-01-15T09:00:00Z'), location: 'ห้องประชุมตัวอย่าง', status: 'approved', status_reason: 'ตัวอย่างเหตุผล' };

/** ใส่ตัวแปรครั้งเดียวในรอบเดียว: ข้อความที่ผู้สมัครกรอกมี {{...}} ก็ไม่ถูกแทนซ้ำ */
const fill = (text, vars) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => vars[k] ?? '').replace(/[ \t]+\n/g, '\n').trim();
const cut = (t, n) => ([...t].length > n ? `${[...t].slice(0, n - 1).join('')}…` : t);

/** โครงกลาง ใช้ทั้งตัวอย่างบนหน้า Admin และ Flex Message จริง */
export function compose(content, app, { evaluationUrl = null, footer = null } = {}) {
  const vars = variablesOf(app);
  const url = content.button?.path === 'evaluation' ? evaluationUrl : content.button ? `${env.APP_URL}${content.button.path}` : null;
  return {
    tone: TONES[content.tone] ? content.tone : 'green', heading: cut(fill(content.heading, vars), 80), body: cut(fill(content.body, vars), 900),
    rows: [['หลักสูตร', vars.course], ['รุ่น', `${vars.session} · ${vars.university}`], ['วันอบรม', `${vars.date} เวลา ${vars.time} น.`], ['สถานะล่าสุด', vars.status]].map(([k, v]) => [k, cut(v, 120)]),
    step: TIMELINE_STEP[app.status] ?? null, button: url && (/^https:\/\//.test(url) || !https) ? { label: cut(content.button.label, 20), url } : null, footer,
  };
}
export function toFlex(m) {
  const [start, end] = TONES[m.tone];
  const kv = ([k, v]) => ({ type: 'box', layout: 'baseline', spacing: 'sm', contents: [{ type: 'text', text: k, size: 'xs', color: '#716D86', flex: 3 }, { type: 'text', text: v || '-', size: 'sm', color: '#202124', flex: 7, wrap: true }] });
  const body = [{ type: 'text', text: m.body || '-', wrap: true, size: 'md' }];
  if (m.step) body.push({ type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'lg', contents: Array.from({ length: 9 }, (_, i) => ({ type: 'box', layout: 'vertical', height: '6px', cornerRadius: '3px', backgroundColor: i + 1 < m.step ? '#2F9A48' : i + 1 === m.step ? '#F5821F' : '#E7DFF8', contents: [{ type: 'filler' }] })) });
  if (m.rows?.length) body.push({ type: 'separator', margin: 'lg' }, { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: m.rows.map(kv) });
  if (m.footer) body.push({ type: 'text', text: m.footer, size: 'xxs', color: '#8E86A8', wrap: true, margin: 'lg' });
  return { type: 'flex', altText: cut(`${m.heading} ${m.body}`.replace(/\s+/g, ' '), 380), contents: { type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', paddingAll: '20px', background: { type: 'linearGradient', angle: '135deg', startColor: start, endColor: end }, contents: [{ type: 'text', text: 'E-Training', size: 'xs', color: '#FFFFFF', weight: 'bold' }, { type: 'text', text: m.heading || '-', size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true, margin: 'sm' }] },
    body: { type: 'box', layout: 'vertical', contents: body },
    ...(m.button && /^https:\/\//.test(m.button.url) ? { footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: start, height: 'sm', action: { type: 'uri', label: m.button.label, uri: m.button.url } }] } } : {}) } };
}
export const adminFlex = (event, count) => toFlex({ tone: 'purple', heading: event.title, body: event.text.replace('{{count}}', String(count)), rows: [], step: null, button: { label: 'เปิดดู', url: `${env.APP_URL}${event.path}` }, footer: 'ข้อความถึงเจ้าหน้าที่' });
