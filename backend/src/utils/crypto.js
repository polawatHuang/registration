import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ENC_KEY = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
const HASH_KEY = Buffer.from(env.DATA_HASH_KEY, 'base64');

/** AES-256-GCM: [12 iv][16 tag][ciphertext]; aad ผูก ciphertext กับที่ใช้งาน สลับข้ามช่องไม่ได้ */
export function encryptBuffer(plain, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
export function decryptBuffer(data, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, data.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([d.update(data.subarray(28)), d.final()]);
}
export const encryptText = (text, aad) => `v1:${encryptBuffer(Buffer.from(text, 'utf8'), aad).toString('base64')}`;
export const decryptText = (value, aad) => decryptBuffer(Buffer.from(value.slice(3), 'base64'), aad).toString('utf8');

export const keyedHash = (scope, value) => crypto.createHmac('sha256', HASH_KEY).update(`${scope}\0${value}`).digest('hex');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export function safeEqual(a, b) {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
}

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randomCode(length) {
  return Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
}
