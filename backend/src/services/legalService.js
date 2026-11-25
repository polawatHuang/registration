import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/catalogRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { sha256 } from '../utils/crypto.js';
import { badRequest } from '../utils/errors.js';

/** เพิ่มเลขนี้ทุกครั้งที่แก้ข้อความใน privacy.html หรือ policy.html เพื่อให้ผู้สมัครต้องอ่านใหม่ */
const TEMPLATE = 'T3';
export const LEGAL_FIELDS = {
  controller_name: { required: true }, controller_address: { required: true }, controller_contact: { required: true }, dpo_contact: {},
  basis_main: { required: true }, recipients: { required: true },
  retention_applications: { required: true }, retention_documents: { required: true }, retention_rejected: { required: true }, retention_logs: { required: true }, retention_chats: { required: true },
  refund_policy: { required: true }, copyright_owner: { required: true }, effective_date: { required: true }, approved: {},
};
const KEYS = Object.keys(LEGAL_FIELDS);
const dbKey = (k) => `legal_${k}`;

export async function getLegal() {
  const s = await repo.getSettings(KEYS.map(dbKey));
  const fields = Object.fromEntries(KEYS.filter((k) => k !== 'approved').map((k) => [k, s[dbKey(k)] || null]));
  const missing = KEYS.filter((k) => LEGAL_FIELDS[k].required && !fields[k]);
  const approved = s.legal_approved === '1' && !missing.length;
  const hash = sha256(JSON.stringify([TEMPLATE, fields])).slice(0, 8);
  return { fields, missing, approved, version: `${approved ? '' : 'draft-'}${fields.effective_date ?? 'undated'}-${hash}` };
}

export async function saveLegal({ approved, ...values }, { adminId, ip }) {
  const missing = KEYS.filter((k) => LEGAL_FIELDS[k].required && !values[k]);
  if (approved && missing.length) throw badRequest('LEGAL_INCOMPLETE', 'กรอกข้อมูลที่จำเป็นให้ครบก่อนเผยแพร่', missing.map((field) => ({ field, message: 'จำเป็นต้องระบุ' })));
  if (values.retention_documents && values.retention_applications && values.retention_documents > values.retention_applications) throw badRequest('VALIDATION_ERROR', 'ระยะเวลาเก็บเอกสารต้องไม่เกินระยะเวลาเก็บใบสมัคร', [{ field: 'retention_documents', message: 'ต้องไม่เกินระยะเวลาเก็บใบสมัคร' }]);
  await withTransaction(async (conn) => {
    for (const [k, v] of Object.entries(values)) await repo.setSetting(dbKey(k), v, conn);
    await repo.setSetting('legal_approved', approved ? '1' : '', conn);
    await insertAudit({ adminId, action: approved ? 'legal.publish' : 'legal.update', entityType: 'legal', ip }, conn);
  });
  const legal = await getLegal();
  if (legal.approved) await repo.insertLegalVersion(legal.version, JSON.stringify(legal.fields), adminId);
  return legal;
}
