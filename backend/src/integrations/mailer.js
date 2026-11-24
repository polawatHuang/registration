import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export function createTransport(c) {
  const port = Number(c.smtp_port);
  const insecure = !env.isProd && env.SMTP_ALLOW_INSECURE === '1';
  return nodemailer.createTransport({
    host: c.smtp_host, port, secure: port === 465, requireTLS: port !== 465 && !insecure, ignoreTLS: insecure,
    auth: c.smtp_user ? { user: c.smtp_user, pass: c.smtp_password ?? '' } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, disableFileAccess: true, disableUrlAccess: true,
  });
}
/** ข้อความที่อ่านเข้าใจและไม่มีรหัสผ่าน/ที่อยู่อีเมลติดมา */
export function explainMailError(err) {
  if (err.code === 'EAUTH') return 'ชื่อผู้ใช้หรือรหัสผ่าน SMTP ไม่ถูกต้อง';
  if (['ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ESOCKET', 'ECONNREFUSED'].includes(err.code)) return `เชื่อมต่อ SMTP ไม่ได้ (${err.code})`;
  if (err.code === 'ETLS') return 'เซิร์ฟเวอร์ SMTP ไม่รองรับการเข้ารหัส TLS';
  return `ส่งอีเมลไม่สำเร็จ (${err.responseCode ?? err.code ?? 'ไม่ทราบสาเหตุ'})`;
}
