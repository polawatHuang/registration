import { lineLoginConfig } from './integrationService.js';
import { withTransaction } from '../config/db.js';
import * as repo from '../repositories/lineRepository.js';
import * as line from '../integrations/lineLoginClient.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { randomToken, safeEqual, sha256 } from '../utils/crypto.js';
import { AppError, badRequest, forbidden } from '../utils/errors.js';
import crypto from 'node:crypto';

const RETURN_PATHS = new Set(['/', '/tracking.html']);

async function ensureEnabled() {
  const config = await lineLoginConfig();
  if (!config) throw new AppError(503, 'LINE_LOGIN_DISABLED', 'ระบบยังไม่ได้ตั้งค่า LINE Login');
  return config;
}

export async function startLogin(returnTo) {
  const config = await ensureEnabled();
  const [state, browser, nonce, codeVerifier] = [randomToken(), randomToken(), randomToken(), randomToken()];
  await repo.insertState({
    stateHash: sha256(state), browserHash: sha256(browser), nonce, codeVerifier, returnTo: RETURN_PATHS.has(returnTo) ? returnTo : '/tracking.html',
  });
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { url: line.buildAuthorizeUrl(config, { state, nonce, codeChallenge }), browser };
}

export async function finishLogin({ code, state, browser, ip }) {
  const config = await ensureEnabled();
  if (!code || !state || !browser) throw badRequest('LOGIN_EXPIRED', 'การเข้าสู่ระบบหมดอายุ กรุณาลองใหม่');
  const saved = await withTransaction(async (conn) => {
    const row = await repo.lockState(sha256(state), conn);
    if (row) await repo.deleteState(row.state_hash, conn); // ใช้ได้ครั้งเดียว
    return row;
  });
  if (!saved || !saved.is_valid || !safeEqual(saved.browser_hash, sha256(browser))) {
    throw badRequest('LOGIN_EXPIRED', 'การเข้าสู่ระบบหมดอายุ กรุณาลองใหม่');
  }
  const claims = await line.verifyIdToken(config, await line.exchangeCode(config, code, saved.code_verifier), saved.nonce);
  const user = await repo.upsertLineUser({
    lineUserId: claims.sub, displayName: claims.name?.slice(0, 255) ?? null,
    pictureUrl: claims.picture?.startsWith('https://') ? claims.picture.slice(0, 1000) : null,
  });
  if (user.status !== 'active') throw forbidden('บัญชี LINE นี้ถูกระงับการใช้งาน');
  await insertAudit({ actorType: 'applicant', action: 'line.login', entityType: 'line_user', entityId: user.id, ip });
  return { lineUserId: user.id, returnTo: saved.return_to };
}

export async function unlink(lineUserId, ip) {
  await withTransaction(async (conn) => {
    await repo.unlinkAll(lineUserId, conn);
    await insertAudit({ actorType: 'applicant', action: 'line.unlink', entityType: 'line_user', entityId: lineUserId, ip }, conn);
  });
}

/** เรียกเมื่อเจ้าหน้าที่ตรวจเอกสารผ่านแล้วเท่านั้น จึงถือว่ารู้ว่าเจ้าของใบสมัครเป็นใคร */
export async function linkVerifiedApplicant({ lineUserId, applicantId, method }, conn) {
  const [byLine, byApplicant] = [await repo.activeLinkOfLine(lineUserId, conn), await repo.activeLinkOfApplicant(applicantId, conn)];
  if (byLine || byApplicant) return Boolean(byLine && byLine.applicant_id === applicantId);
  await repo.insertLink({ lineUserId, applicantId, method }, conn);
  await insertAudit({ actorType: 'system', action: 'line.link', entityType: 'applicant', entityId: applicantId, metadata: { lineUserId, method } }, conn);
  return true;
}
