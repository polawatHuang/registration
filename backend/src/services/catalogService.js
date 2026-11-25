import { withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import * as repo from '../repositories/catalogRepository.js';
import { getLegal } from './legalService.js';
import { getConfig, lineLoginConfig } from './integrationService.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { conflict, notFound } from '../utils/errors.js';

export const SETTING_KEYS = ['announcement', 'payment_instructions', 'contact_phone', 'contact_email', 'contact_line_url'];

export const publicUniversities = async () => (await repo.listUniversities(true)).map(({ id, name }) => ({ id, name }));
export const publicOptions = async () => (await repo.listOptions('shop_duration', true)).map(({ id, label }) => ({ id, label }));
export const publicSessions = async (universityId) => (await repo.listOpenSessions(universityId)).map((s) => ({
  id: s.id, name: s.session_name, courseName: s.course_name, startsAt: s.starts_at, endsAt: s.ends_at, location: s.location,
  seatsLeft: s.capacity === null ? null : Math.max(0, s.capacity - s.registered), capacity: s.capacity,
}));
export const publicSchedule = async () => (await repo.listOpenSessions()).map((s) => ({ id: s.id, name: s.session_name, courseName: s.course_name, universityName: s.university_name, startsAt: s.starts_at, endsAt: s.ends_at, location: s.location, mapUrl: s.map_url, seatsLeft: s.capacity === null ? null : Math.max(0, s.capacity - s.registered) }));
export async function siteInfo() {
  const [s, legal, login, config] = await Promise.all([repo.getSettings(SETTING_KEYS), getLegal(), lineLoginConfig(), getConfig()]);
  return { ...Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k] || null])), privacyVersion: legal.version, legalApproved: legal.approved, copyrightOwner: legal.fields.copyright_owner, maxUploadMb: env.MAX_UPLOAD_MB, lineLoginEnabled: Boolean(login), liffId: login ? config.line_liff_id ?? null : null };
}

async function audited(action, entityType, actor, fn, metadata) {
  try {
    return await withTransaction(async (conn) => {
      const id = await fn(conn);
      await insertAudit({ adminId: actor.adminId, action, entityType, entityId: id, ip: actor.ip, metadata }, conn);
      return id;
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('DUPLICATE', 'มีรายการชื่อนี้อยู่แล้ว');
    if (err.code === 'ER_ROW_IS_REFERENCED_2') throw conflict('IN_USE', 'มีข้อมูลใช้งานรายการนี้อยู่ ลบไม่ได้ ให้ปิดใช้งานแทน');
    if (err.code === 'ER_NO_REFERENCED_ROW_2') throw notFound('ไม่พบหลักสูตรหรือมหาวิทยาลัยที่เลือก');
    throw err;
  }
}
const mustChange = (n, id) => { if (!n) throw notFound(); return id; };

export const createUniversity = (d, a) => audited('university.create', 'university', a, (c) => repo.insertUniversity(d, c), d);
export const updateUniversity = (id, d, a) => audited('university.update', 'university', a, async (c) => mustChange(await repo.updateUniversity({ ...d, id }, c), id), d);
export const createCourse = (d, a) => audited('course.create', 'course', a, (c) => repo.insertCourse(d, c), d);
export const updateCourse = (id, d, a) => audited('course.update', 'course', a, async (c) => mustChange(await repo.updateCourse({ ...d, id }, c), id), d);
export const createOption = (d, a) => audited('option.create', 'lookup_option', a, (c) => repo.insertOption({ ...d, category: 'shop_duration' }, c), d);
export const updateOption = (id, d, a) => audited('option.update', 'lookup_option', a, async (c) => mustChange(await repo.updateOption({ ...d, id }, c), id), d);
export const createSession = (d, a) => audited('session.create', 'training_session', a, (c) => repo.insertSession(d, c), { name: d.sessionName });
export const updateSession = (id, d, a) => audited('session.update', 'training_session', a, async (c) => mustChange(await repo.updateSession({ ...d, id }, c), id), { name: d.sessionName, status: d.status });
const remove = (action, entity, fn) => (id, a) => audited(action, entity, a, async (c) => mustChange(await fn(id, c), id));
export const deleteUniversity = remove('university.delete', 'university', repo.deleteUniversity);
export const deleteCourse = remove('course.delete', 'course', repo.deleteCourse);
export const deleteOption = remove('option.delete', 'lookup_option', repo.deleteOption);
export const deleteSession = remove('session.delete', 'training_session', repo.deleteSession);
export const siteSettings = () => repo.getSettings(SETTING_KEYS);
export const saveSettings = (values, a) => audited('settings.update', 'system_settings', a, async (c) => {
  for (const [k, v] of Object.entries(values)) await repo.setSetting(k, v, c);
  return null;
}, { keys: Object.keys(values) });
export async function adminCatalog() {
  const [universities, courses, sessions, options] = await Promise.all([
    repo.listUniversities(false), repo.listCourses(), repo.listSessions(), repo.listOptions('shop_duration', false)]);
  return { universities, courses, sessions, options };
}
