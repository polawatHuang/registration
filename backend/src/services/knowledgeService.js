import path from 'node:path';
import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/knowledgeRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { removeDocuments, storeDocument } from './storageService.js';
import { extractText, normalizeText } from '../utils/knowledgeText.js';
import { sha256 } from '../utils/crypto.js';
import { conflict, notFound } from '../utils/errors.js';

export const CATEGORIES = ['FAQ', 'ข้อมูลหลักสูตร', 'กำหนดการอบรม', 'วิธีสมัคร', 'เอกสารที่ใช้', 'ติดต่อ', 'ระเบียบการอบรม', 'ใบประกาศนียบัตร'];
const view = (k) => ({ id: k.id, sourceType: k.source_type, category: k.category, title: k.title, content: k.content, keywords: k.keywords, status: k.status, priority: k.priority, originalName: k.original_name, updatedAt: k.updated_at });
export const list = () => repo.list();
export async function get(id) { const k = await repo.find(id); if (!k) throw notFound('ไม่พบความรู้'); return view(k); }

async function assertNew(sha) {
  const dup = await repo.findBySha(sha);
  if (dup) throw conflict('DUPLICATE', `มีเนื้อหาเดียวกันแล้วใน "${dup.title}"`);
}
const audit = (action, id, { adminId, ip }, metadata, conn) => insertAudit({ actorType: adminId ? 'admin' : 'system', adminId, action: `knowledge.${action}`, entityType: 'ai_knowledge', entityId: id, ip, metadata }, conn);

export async function create(data, actor) {
  const content = normalizeText(data.content);
  const sha = sha256(content);
  await assertNew(sha);
  return withTransaction(async (conn) => {
    const id = await repo.insert({ originalName: null, storageName: null, size: null, sourceType: 'faq', ...data, content, sha, adminId: actor.adminId }, conn);
    await audit('create', id, actor, { title: data.title, status: data.status }, conn);
    return id;
  });
}
/** ไฟล์ที่อัปโหลดเป็นฉบับร่างเสมอ เจ้าหน้าที่ต้องตรวจข้อความที่อ่านได้ก่อนเผยแพร่ */
export async function upload(file, category, actor) {
  const content = await extractText(file.buffer, file.originalname);
  const sha = sha256(content);
  await assertNew(sha);
  const originalName = path.basename(file.originalname).replace(/[\u0000-\u001f"\\]/g, '').slice(-200);
  const storageName = await storeDocument(file);
  try {
    return await withTransaction(async (conn) => {
      const id = await repo.insert({ sourceType: 'file', category, title: originalName.replace(/\.[^.]+$/, ''), content, keywords: null, status: 'draft', priority: 0, originalName, storageName, size: file.size, sha, adminId: actor.adminId }, conn);
      await audit('upload', id, actor, { originalName }, conn);
      return id;
    });
  } catch (err) { await removeDocuments([storageName]).catch(() => {}); throw err; }
}
export const update = (id, data, actor) => withTransaction(async (conn) => {
  if (!(await repo.find(id, conn))) throw notFound('ไม่พบความรู้');
  await repo.update({ ...data, content: normalizeText(data.content), id, adminId: actor.adminId }, conn);
  await audit('update', id, actor, { title: data.title, status: data.status }, conn);
});
export async function remove(id, actor) {
  const k = await repo.find(id);
  if (!k) throw notFound('ไม่พบความรู้');
  await withTransaction(async (conn) => { await repo.remove(id, actor.adminId, conn); await audit('delete', id, actor, { title: k.title }, conn); });
  if (k.storage_name) await removeDocuments([k.storage_name]).catch(() => {});
}
