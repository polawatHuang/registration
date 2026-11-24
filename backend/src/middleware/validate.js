import { badRequest } from '../utils/errors.js';

export function parse(schema, value) {
  const r = schema.safeParse(value ?? {});
  if (r.success) return r.data;
  throw badRequest('VALIDATION_ERROR', 'กรุณาตรวจสอบข้อมูลที่กรอก',
    r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
}
