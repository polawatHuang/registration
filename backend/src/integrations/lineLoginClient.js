import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const TIMEOUT = 10_000;
const fail = () => new AppError(502, 'LINE_UNAVAILABLE', 'เชื่อมต่อ LINE ไม่สำเร็จ กรุณาลองใหม่');

async function post(path, form) {
  let res;
  try {
    res = await fetch(`${env.LINE_API_URL}${path}`, { method: 'POST', body: new URLSearchParams(form), signal: AbortSignal.timeout(TIMEOUT) });
  } catch { throw fail(); }
  if (!res.ok) throw new AppError(401, 'LINE_REJECTED', 'LINE ไม่ยืนยันการเข้าสู่ระบบ กรุณาลองใหม่');
  return res.json().catch(() => { throw fail(); });
}

export function buildAuthorizeUrl(config, { state, nonce, codeChallenge }) {
  const url = new URL(env.LINE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: config.channelId, redirect_uri: env.lineCallbackUrl, state, nonce,
    scope: 'profile openid', code_challenge: codeChallenge, code_challenge_method: 'S256', bot_prompt: 'normal', ui_locales: 'th',
  });
  return url.toString();
}

const tokenSchema = z.object({ id_token: z.string().min(1) });
export async function exchangeCode(config, code, codeVerifier) {
  const body = await post('/oauth2/v2.1/token', {
    grant_type: 'authorization_code', code, redirect_uri: env.lineCallbackUrl, code_verifier: codeVerifier,
    client_id: config.channelId, client_secret: config.channelSecret,
  });
  const r = tokenSchema.safeParse(body);
  if (!r.success) throw fail();
  return r.data.id_token;
}

const claimsSchema = z.object({
  iss: z.literal('https://access.line.me'), sub: z.string().min(1).max(64), aud: z.string(), exp: z.number(),
  nonce: z.string().optional(), name: z.string().optional(), picture: z.string().optional(),
});
/** ให้ LINE ตรวจลายเซ็น ID Token แล้วเราตรวจ claim ซ้ำอีกชั้น */
/** nonce = null สำหรับ LIFF ซึ่ง SDK เป็นผู้ออกคำขอเอง token มีอายุ 1 ชั่วโมงและผูกกับ channel ของเรา */
export async function verifyIdToken(config, idToken, nonce) {
  const r = claimsSchema.safeParse(await post('/oauth2/v2.1/verify', { id_token: idToken, client_id: config.channelId, ...(nonce === null ? {} : { nonce }) }));
  if (!r.success || r.data.aud !== config.channelId || (nonce !== null && r.data.nonce !== nonce) || r.data.exp * 1000 < Date.now()) {
    throw new AppError(401, 'LINE_INVALID_TOKEN', 'ข้อมูลยืนยันตัวตนจาก LINE ไม่ถูกต้อง');
  }
  return r.data;
}
