import multer from 'multer';
import { env } from '../config/env.js';

export const DOC_TYPES = ['id_card', 'previous_certificate', 'payment_slip', 'portrait_photo'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 4, fields: 40, fieldSize: 20_000, parts: 50 },
  defParamCharset: 'utf8',
});
export const uploadKnowledge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, fieldSize: 1000 }, defParamCharset: 'utf8' }).single('file');
export const uploadCertImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 6, fieldSize: 20_000 }, defParamCharset: 'utf8' }).single('image');
export const uploadRichMenu = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1, fields: 3, fieldSize: 500 } }).single('image');
export const uploadDocuments = upload.fields(DOC_TYPES.map((name) => ({ name, maxCount: 1 })));
