import fsp from 'node:fs/promises';
import { env } from '../config/env.js';
import { backup, BACKUP_DIR, listBackups, prune, verify } from '../utils/backup.js';
import { getSettings, setSetting } from '../repositories/catalogRepository.js';
import { insertEvent } from '../repositories/notificationRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';

const KEY = 'backup_last_json';
const MB = 1024 * 1024;
export const lastBackup = async () => JSON.parse((await getSettings([KEY]))[KEY] || 'null');
const save = (o) => setSetting(KEY, JSON.stringify(o));

/** สำรอง → อ่านกลับตรวจ → ลบไฟล์เก่า สำเร็จครบทุกขั้นจึงบันทึกว่าสำเร็จ */
export async function runBackup({ adminId = null, ip = null } = {}) {
  const prev = await lastBackup();
  try {
    await fsp.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
    const { bavail, bsize } = await fsp.statfs(BACKUP_DIR);
    if (bavail * bsize < Math.max(50 * MB, 3 * (prev?.bytes ?? 0))) throw Object.assign(new Error('พื้นที่ดิสก์ไม่พอ'), { code: 'ENOSPC' });
    const b = await backup();
    await verify(b.file);
    const pruned = await prune(env.BACKUP_KEEP);
    await save({ ok: true, at: new Date().toISOString(), okAt: new Date().toISOString(), name: b.name, bytes: b.bytes, rows: b.rows });
    if (adminId) await insertAudit({ adminId, action: 'backup.run', entityType: 'backup', ip, metadata: { bytes: b.bytes, rows: b.rows } });
    return { ...b, pruned, keep: env.BACKUP_KEEP };
  } catch (err) {
    if (err.code !== 'BACKUP_RUNNING') {
      await save({ ...prev, ok: false, at: new Date().toISOString(), error: err.code ?? 'ERROR' }).catch(() => {});
      await insertEvent('system.backup_failed', 'system', 0).catch(() => {});
    }
    throw err;
  }
}
/** วันละครั้งหลังชั่วโมงที่กำหนด (เวลาไทย) ล้มเหลวลองใหม่ทุก 1 ชั่วโมง ไม่วนทุก 5 นาที */
export async function autoBackup(now = new Date()) {
  if (!env.BACKUP_AUTO) return { skipped: 'ปิดการสำรองอัตโนมัติ' };
  const bkk = (d) => new Date(new Date(d).getTime() + 7 * 3_600_000).toISOString();
  if (Number(bkk(now).slice(11, 13)) < env.BACKUP_HOUR) return { skipped: 'ยังไม่ถึงเวลา' };
  const last = await lastBackup();
  if (last?.okAt && bkk(last.okAt).slice(0, 10) === bkk(now).slice(0, 10)) return { skipped: 'สำรองแล้ววันนี้' };
  if (last && !last.ok && now - new Date(last.at) < 3_600_000) return { skipped: 'รอลองใหม่' };
  try { const b = await runBackup(); return { name: b.name, rows: b.rows, pruned: b.pruned }; } catch (err) { if (err.code === 'BACKUP_RUNNING') return { skipped: 'กำลังสำรอง' }; throw err; }
}
export async function backupState() { const files = await listBackups(); return { last: await lastBackup(), auto: env.BACKUP_AUTO, hour: env.BACKUP_HOUR, keep: env.BACKUP_KEEP, files: files.length, bytes: files.reduce((t, f) => t + f.bytes, 0) }; }
