import { z } from 'zod';
import { CATEGORIES } from '../services/knowledgeService.js';
import { isValidThaiId, toAsciiDigits } from './thai.js';

const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').trim() : v);
export const text = (max, min = 1) => z.preprocess(clean, z.string().min(min, 'กรุณากรอกข้อมูล').max(max, `ยาวได้ไม่เกิน ${max} ตัวอักษร`));
export const optionalText = (max) => z.preprocess((v) => clean(v) || null, z.string().max(max, `ยาวได้ไม่เกิน ${max} ตัวอักษร`).nullable());
const filter = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const digits = (v) => (typeof v === 'string' ? toAsciiDigits(v).replace(/[\s-]/g, '') : v);
export const id = z.coerce.number().int().positive('กรุณาเลือก').max(4294967295);

export const nationalId = z.preprocess(digits, z.string().refine((v) => /^[1-8]/.test(v) && isValidThaiId(v), 'เลขประจำตัวประชาชนไม่ถูกต้อง'));
export const mobile = z.preprocess(digits, z.string().regex(/^0[689]\d{8}$/, 'หมายเลขมือถือต้องเป็น 10 หลัก ขึ้นต้นด้วย 06, 08 หรือ 09'));
const addressWithZip = text(500, 10).refine((v) => /(?:^|\D)[1-9]\d{4}(?:\D|$)/.test(toAsciiDigits(v)), 'กรุณาระบุรหัสไปรษณีย์ 5 หลัก');

export const applicationSchema = z.object({
  universityId: id, sessionId: id,
  fullName: text(200, 4).refine((v) => /\S\s+\S/.test(v), 'กรุณากรอกทั้งชื่อและนามสกุล'),
  nationalId, address: addressWithZip, mobile, lineContactId: optionalText(100),
  email: z.preprocess((v) => clean(v)?.toLowerCase?.(), z.email('อีเมลไม่ถูกต้อง').max(200)),
  shopName: text(200), shopAddress: text(500, 5), shopDurationId: id,
  hasTrainedBefore: z.enum(['yes', 'no'], 'กรุณาเลือก').transform((v) => v === 'yes'),
  receiptName: text(200), receiptAddress: addressWithZip,
  taxId: z.preprocess((v) => digits(v) || null, z.string().refine(isValidThaiId, 'เลขผู้เสียภาษีไม่ถูกต้อง').nullable()),
  acknowledge: z.literal('yes', 'กรุณารับทราบประกาศความเป็นส่วนตัวและตกลงตามเงื่อนไข'),
  // มาตรา 19 และ 26: ความยินยอมข้อมูลอ่อนไหวแยกต่างหาก ไม่บังคับ
  sensitiveConsent: z.enum(['yes', 'no']).default('no').transform((v) => v === 'yes'),
  privacyVersion: text(30),
  idempotencyKey: z.uuid('คำขอไม่ถูกต้อง'),
});
export const accessSchema = z.object({
  applicationNo: z.preprocess((v) => clean(v)?.toUpperCase?.(), z.string().regex(/^ET\d{2}-[2-9A-HJ-NP-Z]{8}$/, 'เลขที่ใบสมัครไม่ถูกต้อง')),
  nationalId, mobile,
});
export const loginSchema = z.object({ username: text(60), password: z.string().min(1, 'กรุณากรอกรหัสผ่าน').max(200) });
export const userCreateSchema = z.object({
  username: z.preprocess(clean, z.string().regex(/^[a-zA-Z0-9._-]{3,60}$/, 'ใช้ a-z 0-9 . _ - ความยาว 3-60 ตัว')), displayName: text(150), password: z.string().max(200), roleId: id,
});
export const userUpdateSchema = z.object({ displayName: text(150), roleId: id, status: z.enum(['active', 'disabled']), password: z.string().max(200).optional().transform((v) => v || undefined) });
const isActive = z.boolean().default(true).transform((v) => (v ? 1 : 0));
const sortOrder = z.coerce.number().int().min(-9999).max(9999).default(0);
export const universitySchema = z.object({ name: text(200), isActive, sortOrder });
export const courseSchema = z.object({ code: z.preprocess((v) => clean(v)?.toUpperCase?.(), z.string().regex(/^[A-Z0-9-]{2,50}$/, 'ใช้ A-Z 0-9 และ - ความยาว 2-50 ตัว')), name: text(255), isActive });
export const optionSchema = z.object({ label: text(150), isActive, sortOrder });
const date = z.iso.datetime({ offset: true, message: 'วันเวลาไม่ถูกต้อง' }).transform((v) => new Date(v));
const optDate = z.preprocess((v) => v || null, date.nullable());
const httpsUrl = (max) => z.preprocess((v) => clean(v) || null, z.url({ protocol: /^https$/, error: 'ต้องเป็นลิงก์ https' }).max(max).nullable());
export const sessionSchema = z.object({
  courseId: id, universityId: id, sessionName: text(150), startsAt: date, endsAt: date, location: optionalText(255), mapUrl: httpsUrl(500), details: optionalText(5000),
  capacity: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(1).max(100000).nullable()),
  requireCheckout: z.boolean().default(false).transform((v) => (v ? 1 : 0)), minDays: z.preprocess((v) => (v === '' || v === undefined ? 1 : v), z.coerce.number().int().min(1).max(60)), minMinutes: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(1).max(60000).nullable()),
  opensAt: optDate, closesAt: optDate, status: z.enum(['draft', 'open', 'closed', 'completed', 'cancelled']),
}).refine((s) => s.endsAt > s.startsAt, { path: ['endsAt'], message: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม' })
  .refine((s) => !s.opensAt || !s.closesAt || s.closesAt > s.opensAt, { path: ['closesAt'], message: 'วันปิดรับต้องหลังวันเปิดรับ' });
export const settingsSchema = z.object({
  announcement: optionalText(500), payment_instructions: optionalText(1000), contact_phone: optionalText(50), contact_email: optionalText(200), contact_line_url: httpsUrl(300),
}).strict();
const optInt = (min, max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int('ต้องเป็นจำนวนเต็ม').min(min, `ต้องไม่น้อยกว่า ${min}`).max(max, `ต้องไม่เกิน ${max}`).nullable());
export const purgeSchema = z.object({ kind: z.enum(['withdrawn', 'documents', 'rejected', 'applications', 'line_users', 'logs', 'chats']), ids: z.array(id).max(200, 'เลือกได้ครั้งละไม่เกิน 200').default([]), password: z.string().min(1).max(200), confirm: z.string().max(50) });
export const dueKind = z.enum(['withdrawn', 'documents', 'rejected', 'applications', 'line_users', 'logs', 'chats']);
export const decideSchema = z.object({ decision: z.enum(['approved', 'rejected']), reason: optionalText(500), password: z.string().min(1, 'กรุณายืนยันรหัสผ่าน').max(200), confirm: z.string().max(50).default('') });
export const noticeSchema = z.object({ action: z.enum(['retry', 'done']) });
export const holdSchema = z.object({ reason: optionalText(500) });
export const erasureSchema = z.object({ note: optionalText(500) });
export const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export const templateKey = z.string().regex(/^[a-z0-9_]{3,50}$/);
export const templateSchema = z.object({ key: filter(templateKey), title: optionalText(100).optional(), heading: text(80), body: text(900), buttonLabel: optionalText(20).optional(), tone: z.enum(['green', 'purple', 'orange', 'grey']), active: z.boolean().default(true) });
export const notifySettingsSchema = z.object({ enabled: z.boolean(), daysBefore: z.coerce.number().int().min(0).max(30), hoursBefore: z.coerce.number().int().min(0).max(24), evaluationUrl: httpsUrl(500).optional(), emailFallback: z.boolean().default(false), checkin: z.boolean().default(false) });
export const notifyListSchema = z.object({ status: filter(z.enum(['pending', 'processing', 'sent', 'failed', 'cancelled'])), type: filter(z.enum(['applicant', 'admin', 'campaign'])), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export const notifyActSchema = z.object({ action: z.enum(['retry', 'cancel']) });
export const recipientSchema = z.object({ events: z.array(z.string().max(40)).max(20) });
const STATUSES = ['submitted', 'under_review', 'documents_incomplete', 'documents_approved', 'approved', 'awaiting_training', 'attended', 'passed', 'certified'];
export const campaignFilterSchema = z.object({ sessionId: filter(id), universityId: filter(id), statuses: z.array(z.enum(STATUSES)).min(1, 'เลือกสถานะอย่างน้อย 1').max(9) });
export const campaignSchema = templateSchema.extend({ title: text(100), filter: campaignFilterSchema, scheduledAt: optDate.optional(), expectedCount: z.number().int().min(1), clientKey: z.uuid() });
export const chatAiSchema = z.object({ enabled: z.boolean() });
export const chatPollSchema = z.object({ filter: z.enum(['all', 'unread', 'attention', 'mine', 'closed']).default('all'), q: filter(z.string().max(100)), open: filter(id), after: z.coerce.number().int().min(0).default(0), since: z.coerce.number().int().min(0).default(0), rev: z.string().max(80).default(''), offset: z.coerce.number().int().min(0).max(100000).default(0) });
export const chatBeforeSchema = z.object({ before: filter(id) });
export const chatSendSchema = z.object({ text: text(4900), clientId: z.uuid() });
export const chatUpdateSchema = z.object({ aiMode: z.enum(['auto', 'off']).optional(), status: z.enum(['open', 'closed']).optional(), assign: z.boolean().optional(), attention: z.literal(false).optional(), readUpTo: z.number().int().min(0).optional() }).strict();
export const legalSchema = z.object({
  controller_name: optionalText(200), controller_address: optionalText(500), controller_contact: optionalText(300), dpo_contact: optionalText(500),
  basis_main: z.preprocess((v) => v || null, z.enum(['contract', 'public_task']).nullable()), recipients: optionalText(1000),
  retention_applications: optInt(1, 1200), retention_documents: optInt(1, 1200), retention_rejected: optInt(1, 1200), retention_logs: optInt(90, 3650), retention_chats: optInt(1, 120),
  refund_policy: optionalText(2000), copyright_owner: optionalText(200), effective_date: z.preprocess((v) => v || null, z.iso.date('วันที่ไม่ถูกต้อง').nullable()), approved: z.boolean().default(false),
}).strict();
export const integrationsSchema = z.object({
  password: z.string().min(1, 'กรุณายืนยันรหัสผ่าน').max(200),
  values: z.record(z.string().max(60), z.preprocess(clean, z.string().max(2000)).nullable()),
});
export const testTarget = z.enum(['line_messaging', 'line_login', 'minimax', 'email']);
export const knowledgeCategory = z.string().refine((v) => CATEGORIES.includes(v), 'หมวดไม่ถูกต้อง');
export const knowledgeSchema = z.object({ title: text(300), content: text(300_000, 5), category: knowledgeCategory, keywords: optionalText(500), status: z.enum(['draft', 'published']), priority: z.coerce.number().int().min(-5).max(5).default(0) });
const optNum = (min, max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable());
export const aiSettingsSchema = z.object({ maxTokens: z.coerce.number().int().min(200, 'ต้องไม่น้อยกว่า 200').max(16000), temperature: z.coerce.number().min(0).max(1, 'อยู่ระหว่าง 0 ถึง 1'), fallback: optionalText(500), perHour: z.coerce.number().int().min(1).max(500), monthlyTokens: optInt(1000, 2_000_000_000), priceIn: optNum(0, 100000), priceOut: optNum(0, 100000), currency: z.enum(['USD', 'THB', 'CNY']) });
export const aiResolveSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(2000) });
export const askSchema = z.object({ question: text(500, 2) });
export const liffSchema = z.object({ idToken: z.string().min(20).max(4000) });
export const richMenuSchema = z.object({ chatBarText: text(14) });
export const welcomeSchema = z.object({ title: optionalText(60), text: optionalText(300) });
export const lineUsersSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), q: filter(z.string().max(100)), filter: filter(z.enum(['all', 'linked', 'unlinked', 'blocked'])) });
const pct = z.coerce.number().min(0).max(100);
const certField = z.object({ show: z.boolean(), x: pct, y: pct, size: z.coerce.number().min(8).max(120), color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'สีไม่ถูกต้อง'), align: z.enum(['left', 'center', 'right']), bold: z.boolean() }).strict();
const certText = z.preprocess((v) => clean(v) || '', z.string().max(200));
export const certLayoutSchema = z.object({
  texts: z.object({ title: certText, lead: certText, after: certText, signer: certText, signerTitle: certText }).strict(),
  fields: z.object({ title: certField, lead: certField, name: certField, after: certField, course: certField, place: certField, dates: certField, issued: certField, number: certField, signer: certField, signerTitle: certField,
    qr: z.object({ show: z.boolean(), x: pct, y: pct, size: z.coerce.number().min(40).max(200) }).strict() }).strict(),
}).strict();
const fromJson = (schema) => z.preprocess((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }, schema);
export const certTemplateSchema = z.object({ name: text(100), courseId: z.preprocess((v) => v || null, id.nullable()), layout: fromJson(certLayoutSchema), removeImage: z.preprocess((v) => v === 'true' || v === true, z.boolean()).default(false) });
export const certPreviewSchema = z.object({ layout: fromJson(certLayoutSchema) });
export const certPrefixSchema = z.object({ prefix: z.preprocess(clean, z.string().regex(/^[A-Z0-9]{1,12}$/, 'ใช้ A-Z 0-9 ไม่เกิน 12 ตัว')) });
export const idsSchema = z.object({ ids: z.array(id).min(1, 'เลือกอย่างน้อย 1 รายการ').max(300, 'เลือกได้ครั้งละไม่เกิน 300') });
/** แก้ชื่อบนใบได้ทีละคน เช่นสะกดผิดตอนสมัคร */
export const issueSchema = idsSchema.extend({ name: optionalText(200).optional() }).refine((v) => !v.name || v.ids.length === 1, { path: ['name'], message: 'แก้ชื่อได้ครั้งละ 1 คน' });
export const revokeSchema = z.object({ reason: text(500, 3) });
export const verifyCode = z.string().regex(/^[2-9A-HJ-NP-Z]{16}$/, 'รหัสใบประกาศไม่ถูกต้อง');
export const certListSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), q: filter(z.string().max(100)), status: filter(z.enum(['valid', 'revoked'])) });
const markAction = z.enum(['in', 'out']);
export const scanSchema = z.object({ token: z.string().max(200), action: markAction });
export const manualSchema = z.object({ action: markAction, at: optDate.optional(), note: text(500, 3) });
export const rosterSchema = z.object({ q: filter(z.string().max(100)), filter: filter(z.enum(['all', 'present', 'absent', 'ready', 'failing'])), day: filter(z.iso.date()) });
export const undoSchema = z.object({ what: z.enum(['in', 'out']), reason: text(500, 3) });
export const announceSchema = idsSchema.extend({ override: z.boolean().default(false), reason: optionalText(500).optional() });
export const reviewSchema = z.object({ decision: z.enum(['approved', 'rejected']), reason: optionalText(500) })
  .refine((v) => v.decision === 'approved' || v.reason, { path: ['reason'], message: 'กรุณาระบุเหตุผล' });
export const statusSchema = z.object({ status: z.string().max(30), expectedStatus: z.string().max(30), reason: optionalText(500) });
const page = { page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
export const listSchema = z.object({ ...page, q: filter(z.string().max(100)), status: filter(z.string().max(30)), sessionId: filter(id), universityId: filter(id) });
export const auditSchema = z.object({ ...page, action: filter(z.string().max(80)), adminId: filter(id) });
