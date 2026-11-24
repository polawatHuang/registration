import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { decryptBuffer, encryptBuffer, sha256 } from '../utils/crypto.js';
import { detectFileType } from '../utils/fileType.js';
import { badRequest } from '../utils/errors.js';

const DIR = path.join(env.storagePath, 'documents');
const filePath = (name) => {
  if (!/^[0-9a-f]{2}\/[0-9a-f-]{36}\.bin$/.test(name)) throw new Error('invalid storage name');
  return path.join(DIR, name);
};

export function inspectDocument(docType, file) {
  const mime = detectFileType(file.buffer, file.originalname);
  const allowed = docType === 'portrait_photo' ? ['image/jpeg', 'image/png'] : ['image/jpeg', 'image/png', 'application/pdf'];
  if (!mime || !allowed.includes(mime)) {
    const message = docType === 'portrait_photo' ? 'ภาพถ่ายหน้าตรงต้องเป็น JPG หรือ PNG' : 'ต้องเป็นไฟล์ JPG, PNG หรือ PDF ที่เปิดได้จริง';
    throw badRequest('INVALID_FILE', message, [{ field: docType, message }]);
  }
  return { docType, mime, buffer: file.buffer, size: file.size, originalName: path.basename(file.originalname).replace(/[\u0000-\u001f"\\]/g, '').slice(-200) || 'document', sha256: sha256(file.buffer) };
}

/** เข้ารหัสก่อนเขียนดิสก์ ชื่อไฟล์สุ่มและใช้เป็น AAD จึงสลับไฟล์กันไม่ได้ */
export async function storeDocument(doc) {
  const uuid = crypto.randomUUID();
  const name = `${uuid.slice(0, 2)}/${uuid}.bin`;
  const target = filePath(name);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, encryptBuffer(doc.buffer, name), { mode: 0o600, flag: 'wx' });
  return name;
}
export const readDocument = async (name) => decryptBuffer(await fs.readFile(filePath(name)), name);
export const removeDocuments = (names) => Promise.all(names.map((n) => fs.rm(filePath(n), { force: true })));
