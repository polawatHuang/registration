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
export const optionSchema = z.object({ label: text(150), isActive, sortOrder });
const date = z.iso.datetime({ offset: true, message: 'วันเวลาไม่ถูกต้อง' }).transform((v) => new Date(v));
const optDate = z.preprocess((v) => v || null, date.nullable());
const httpsUrl = (max) => z.preprocess((v) => clean(v) || null, z.url({ protocol: /^https$/, error: 'ต้องเป็นลิงก์ https' }).max(max).nullable());
export const sessionSchema = z.object({
  courseId: id, universityId: id, sessionName: text(150), startsAt: date, endsAt: date, location: optionalText(255), mapUrl: httpsUrl(500), details: optionalText(5000),
  capacity: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(1).max(100000).nullable()),
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
export const notifySettingsSchema = z.object({ enabled: z.boolean(), daysBefore: z.coerce.number().int().min(0).max(30), hoursBefore: z.coerce.number().int().min(0).max(24), evaluationUrl: httpsUrl(500).optional() });
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
export const askSchema = z.object({ question: text(500, 2) });
export const reviewSchema = z.object({ decision: z.enum(['approved', 'rejected']), reason: optionalText(500) })
  .refine((v) => v.decision === 'approved' || v.reason, { path: ['reason'], message: 'กรุณาระบุเหตุผล' });
export const statusSchema = z.object({ status: z.string().max(30), expectedStatus: z.string().max(30), reason: optionalText(500) });
const page = { page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
export const listSchema = z.object({ ...page, q: filter(z.string().max(100)), status: filter(z.string().max(30)), sessionId: filter(id), universityId: filter(id) });
export const auditSchema = z.object({ ...page, action: filter(z.string().max(80)), adminId: filter(id) });
