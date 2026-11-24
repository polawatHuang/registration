import { AppError, notFound } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export const apiNotFound = (_req, _res, next) => next(notFound('ไม่พบ API ที่เรียก'));

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err.name === 'MulterError') {
    const big = err.code === 'LIMIT_FILE_SIZE';
    return new AppError(big ? 413 : 400, err.code, big ? `ไฟล์ต้องมีขนาดไม่เกิน ${env.MAX_UPLOAD_MB} MB` : 'รูปแบบการอัปโหลดไม่ถูกต้อง',
      err.field ? [{ field: err.field, message: big ? 'ไฟล์ใหญ่เกินไป' : 'ไฟล์ไม่ถูกต้อง' }] : undefined);
  }
  if (err.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'รูปแบบข้อมูลไม่ถูกต้อง');
  if (err.type === 'entity.too.large') return new AppError(413, 'TOO_LARGE', 'ข้อมูลมีขนาดใหญ่เกินไป');
  return null;
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const known = normalize(err);
  if (!known) (req.log ?? logger).error({ err: { message: err.message, code: err.code, stack: err.stack } }, 'unhandled error');
  if (res.headersSent) return res.destroy();
  const e = known ?? new AppError(500, 'INTERNAL_ERROR', 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง');
  return res.status(e.status).json({
    success: false, message: e.message, data: {}, meta: { code: e.code, ...(e.details ? { errors: e.details } : {}), requestId: req.id },
  });
}
