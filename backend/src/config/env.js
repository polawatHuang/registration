import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const key32 = z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'ต้องเป็น base64 ขนาด 32 ไบต์');
const opt = z.string().trim().optional().transform((v) => v || undefined);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3000'),
  APP_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(8),
  DATA_ENCRYPTION_KEY: key32,
  DATA_HASH_KEY: key32,
  JOBS_SECRET: z.string().min(24),
  STORAGE_PATH: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(20).default(5),
  LINE_LOGIN_CHANNEL_ID: opt,
  LINE_LOGIN_CHANNEL_SECRET: opt,
  LINE_CHANNEL_ID: opt,
  LINE_CHANNEL_SECRET: opt,
  LINE_CHANNEL_ACCESS_TOKEN: opt,
  LINE_LIFF_ID: opt,
  MINIMAX_API_KEY: opt,
  MINIMAX_BASE_URL: opt,
  MINIMAX_MODEL: opt,
  MINIMAX_TEST_URL: opt,
  SMTP_HOST: opt,
  SMTP_PORT: opt,
  SMTP_USER: opt,
  SMTP_PASSWORD: opt,
  SMTP_FROM_NAME: opt,
  SMTP_FROM_EMAIL: opt,
  SMTP_ALLOW_INSECURE: opt,
  LINE_AUTHORIZE_URL: z.url().default('https://access.line.me/oauth2/v2.1/authorize'),
  LINE_API_URL: z.url().default('https://api.line.me'),
  LINE_DATA_URL: z.url().default('https://api-data.line.me'),
  TIMEZONE: z.string().default('Asia/Bangkok'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`ค่าใน .env ไม่ถูกต้อง:\n${detail}`);
}
const e = parsed.data;
if (e.DATA_ENCRYPTION_KEY === e.DATA_HASH_KEY) throw new Error('DATA_ENCRYPTION_KEY และ DATA_HASH_KEY ต้องไม่ซ้ำกัน');
if (e.NODE_ENV === 'production') {
  if (!e.APP_URL.startsWith('https://')) throw new Error('production ต้องใช้ APP_URL แบบ https');
  if (process.env.LINE_AUTHORIZE_URL || process.env.LINE_API_URL || process.env.LINE_DATA_URL || process.env.MINIMAX_TEST_URL || process.env.SMTP_ALLOW_INSECURE) throw new Error('ห้ามใช้ค่าทดสอบ (LINE_*_URL, MINIMAX_TEST_URL, SMTP_ALLOW_INSECURE) ใน production');
}

const storagePath = path.resolve(ROOT, e.STORAGE_PATH);
const frontendPath = path.join(ROOT, 'frontend');
if (storagePath === frontendPath || storagePath.startsWith(frontendPath + path.sep)) {
  throw new Error('STORAGE_PATH ต้องอยู่นอก frontend/');
}

export const env = Object.freeze({
  ...e,
  isProd: e.NODE_ENV === 'production',
  isTest: e.NODE_ENV === 'test',
  storagePath,
  frontendPath,
  secureCookies: e.APP_URL.startsWith('https://'),
  maxUploadBytes: Math.floor(e.MAX_UPLOAD_MB * 1024 * 1024),
  lineCallbackUrl: `${e.APP_URL}/api/v1/auth/line/callback`,
  lineWebhookUrl: `${e.APP_URL}/api/v1/line/webhook`,
});
