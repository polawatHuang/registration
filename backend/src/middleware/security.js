import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { forbidden, tooMany } from '../utils/errors.js';
import { safeEqual } from '../utils/crypto.js';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://profile.line-scdn.net', 'https://sprofile.line-scdn.net'],
      connectSrc: ["'self'"], frameSrc: ["'self'", 'blob:'], objectSrc: ["'none'"], baseUri: ["'self'"],
      formAction: ["'self'"], frameAncestors: ["'self'"],
      ...(env.secureCookies ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  strictTransportSecurity: env.secureCookies ? undefined : false,
  referrerPolicy: { policy: 'same-origin' },
});

const limiter = (limit, minutes) => rateLimit({
  windowMs: minutes * 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  skip: () => env.isTest && process.env.ENABLE_RATE_LIMIT !== '1',
  handler: (_req, _res, next) => next(tooMany()),
});
export const apiLimiter = limiter(300, 5);
/** หน้าแชตถามข้อมูลใหม่ทุกไม่กี่วินาที และเจ้าหน้าที่หลายคนอาจใช้ IP เดียวกัน */
export const chatLimiter = limiter(3000, 5);
export const webhookLimiter = limiter(6000, 5);
export const submitLimiter = limiter(15, 60);
export const authLimiter = limiter(30, 15);

/** กัน cross-site write: ถ้าเบราว์เซอร์ส่ง Origin มา ต้องเป็นเว็บเราเท่านั้น */
export function checkOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== new URL(env.APP_URL).origin) return next(forbidden('คำขอมาจากเว็บไซต์อื่น'));
  if (!origin && req.get('sec-fetch-site') === 'cross-site') return next(forbidden('คำขอมาจากเว็บไซต์อื่น'));
  return next();
}

export function verifyCsrf(req, expected) {
  const token = req.get('x-csrf-token');
  if (!token || !safeEqual(token, expected)) throw forbidden('เซสชันไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่');
}
export const isWrite = (req) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
