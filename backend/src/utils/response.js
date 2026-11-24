export function ok(res, data = {}, { message = 'สำเร็จ', meta = {}, status = 200 } = {}) {
  return res.status(status).json({ success: true, message, data, meta });
}
