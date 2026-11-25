import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { query, queryOne } from '../config/db.js';
import { getConfig } from './integrationService.js';
import { getLegal } from './legalService.js';
import { backupState } from './backupService.js';
import { settings as notifySettings } from './notificationService.js';
import { aiEnabled } from './chatService.js';
import { getSettings } from '../repositories/catalogRepository.js';
import { migrationStatus } from '../utils/migrator.js';

const n = async (sql) => Number((await queryOne(sql)).n);
async function storageWritable() {
  const f = path.join(env.storagePath, `.check-${crypto.randomUUID()}`);
  try { await fsp.mkdir(env.storagePath, { recursive: true, mode: 0o700 }); await fsp.writeFile(f, '1', { mode: 0o600 }); await fsp.rm(f); return true; } catch { return false; }
}
/** level: required = ต้องผ่านก่อนเปิดรับสมัคร, recommended = เปิดทีหลังได้ ไม่มีค่าลับในผลลัพธ์ */
export async function readiness() {
  const [c, legal, backup, notify, ai, site, mig, writable, jobs] = await Promise.all([getConfig(), getLegal(), backupState(), notifySettings(), aiEnabled(), getSettings(['contact_phone', 'contact_email', 'payment_instructions', 'line_rich_menu_json']), migrationStatus(), storageWritable(),
    query("SELECT job_name, last_finished_at, TIMESTAMPDIFF(MINUTE, last_finished_at, UTC_TIMESTAMP()) AS m FROM job_locks")]);
  const [uni, opt, open, knowledge, superAdmins] = await Promise.all([n('SELECT COUNT(*) AS n FROM universities WHERE is_active = 1'), n("SELECT COUNT(*) AS n FROM lookup_options WHERE category = 'shop_duration' AND is_active = 1"),
    n("SELECT COUNT(*) AS n FROM training_sessions WHERE status = 'open' AND starts_at > UTC_TIMESTAMP()"), n("SELECT COUNT(*) AS n FROM ai_knowledge WHERE status = 'published' AND deleted_at IS NULL"), n("SELECT COUNT(*) AS n FROM admin_users u JOIN roles r ON r.id = u.role_id WHERE r.role_key = 'super_admin' AND u.status = 'active'")]);
  const jobAge = jobs.length ? Math.min(...jobs.map((j) => j.m ?? 1e9)) : null;
  const backupFresh = Boolean(backup.last?.okAt && Date.now() - new Date(backup.last.okAt) < 36 * 3_600_000);
  const pending = mig.migrations.filter((m) => !m.applied).length;
  const smtp = Boolean(c.smtp_host && c.smtp_port && c.smtp_from_email);
  const item = (level, key, ok, label, hint, href) => ({ level, key, ok: Boolean(ok), label, hint, href });
  const items = [
    item('required', 'https', env.APP_URL.startsWith('https://'), 'ใช้ https', env.APP_URL, null),
    item('required', 'migrations', !pending && !mig.missing.length, 'ฐานข้อมูลเป็นรุ่นล่าสุด', pending ? `ค้าง ${pending} ไฟล์ รัน db:migrate` : mig.version, null),
    item('required', 'storage', writable, 'โฟลเดอร์เก็บเอกสารเขียนได้', writable ? 'พร้อม' : 'ตรวจสิทธิ์โฟลเดอร์ STORAGE_PATH', null),
    item('required', 'jobs', jobAge !== null && jobAge <= 15, 'งานตั้งเวลาทำงาน', jobAge === null || jobAge > 1e8 ? 'ยังไม่เคยรัน' : `ล่าสุด ${jobAge} นาทีที่แล้ว`, null),
    item('required', 'universities', uni, 'มหาวิทยาลัย', `${uni} แห่ง`, '/admin/catalog.html'),
    item('required', 'options', opt, 'ตัวเลือกระยะเวลาเปิดร้าน (ข้อ 11)', `${opt} รายการ`, '/admin/catalog.html'),
    item('required', 'sessions', open, 'รุ่นที่เปิดรับสมัคร', `${open} รุ่น`, '/admin/catalog.html'),
    item('required', 'contact', site.contact_phone || site.contact_email, 'ช่องทางติดต่อ', 'โทรศัพท์หรืออีเมล', '/admin/settings.html#site'),
    item('required', 'payment', site.payment_instructions, 'วิธีชำระค่าลงทะเบียน', 'ผู้สมัครต้องแนบสลิป', '/admin/settings.html#site'),
    item('required', 'legal', legal.approved, 'เผยแพร่ประกาศ PDPA', legal.approved ? legal.version : legal.missing.length ? `ขาด ${legal.missing.length} รายการ` : 'รออนุมัติ', '/admin/settings.html#legal'),
    item('required', 'smtp', smtp, 'อีเมล (SMTP)', smtp ? 'ตั้งค่าแล้ว กดทดสอบที่หน้าตั้งค่า' : 'ใช้ส่งยืนยันการสมัคร', '/admin/settings.html#api'),
    item('recommended', 'backup', backupFresh, 'สำรองฐานข้อมูลอัตโนมัติ', backup.last?.okAt ? (backup.last.ok ? 'สำเร็จ' : `ครั้งล่าสุดล้มเหลว (${backup.last.error})`) : backup.auto ? `จะสำรองครั้งแรกหลัง ${String(backup.hour).padStart(2, '0')}:00 น.` : 'ปิดอยู่', '/admin/settings.html#system'),
    item('recommended', 'admins', superAdmins >= 2, 'มี Super Admin อย่างน้อย 2 คน', `${superAdmins} คน`, '/admin/users.html'),
    item('recommended', 'lineLogin', c.line_login_channel_id && c.line_login_channel_secret, 'LINE Login', 'ผู้สมัครเข้าสู่ระบบด้วย LINE', '/admin/settings.html#api'),
    item('recommended', 'lineMessaging', c.line_channel_secret && c.line_channel_access_token, 'LINE Messaging API', 'แชตและแจ้งเตือน', '/admin/settings.html#api'),
    item('recommended', 'liff', c.line_liff_id && c.line_login_channel_id && c.line_liff_id.startsWith(`${c.line_login_channel_id}-`), 'LIFF', c.line_liff_id ? 'ต้องอยู่ใน LINE Login channel เดียวกัน' : 'เปิดในแอป LINE', '/admin/line.html'),
    item('recommended', 'richMenu', site.line_rich_menu_json, 'Rich Menu', 'เผยแพร่จากหน้า LINE OA', '/admin/line.html'),
    item('recommended', 'notify', notify.enabled, 'เปิดระบบแจ้งเตือน', notify.enabled ? 'เปิดอยู่' : 'ปิดอยู่', '/admin/notifications.html'),
    item('recommended', 'minimax', c.minimax_api_key && c.minimax_model, 'MiniMax AI', 'ตอบแชตอัตโนมัติ', '/admin/settings.html#api'),
    item('recommended', 'knowledge', knowledge, 'คลังความรู้ AI ที่เผยแพร่', `${knowledge} รายการ`, '/admin/ai-knowledge.html'),
    item('recommended', 'aiOn', ai, 'เปิด AI Chat Bot', ai ? 'เปิดอยู่' : 'ปิดอยู่', '/admin/chat.html'),
  ];
  const by = (level) => items.filter((i) => i.level === level);
  return { ready: by('required').every((i) => i.ok), required: { ok: by('required').filter((i) => i.ok).length, total: by('required').length }, recommended: { ok: by('recommended').filter((i) => i.ok).length, total: by('recommended').length }, items,
    backup, jobs: jobs.map((j) => ({ name: j.job_name, at: j.last_finished_at })), node: process.version, database: mig.version };
}
