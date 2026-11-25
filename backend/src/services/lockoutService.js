import * as attempts from '../repositories/attemptRepository.js';
import { keyedHash } from '../utils/crypto.js';
import { tooMany } from '../utils/errors.js';

const WINDOW = 15;
/** เก็บจำนวนครั้งที่ผิดใน DB เพราะ Passenger อาจรันหลายโปรเซสหรือ restart ได้ทุกเมื่อ
 *  บันทึกก่อนตรวจ เพื่อให้คำขอที่ยิงพร้อมกันนับครบทุกครั้ง */
export async function guardAttempt(scope, keys, limits) {
  const hashed = keys.map((k) => keyedHash(`attempt:${scope}`, k));
  const ids = await Promise.all(hashed.map((h) => attempts.addAttempt(scope, h)));
  const counts = await Promise.all(hashed.map((h) => attempts.countAttempts(scope, h, WINDOW)));
  if (counts.some((c, i) => c > limits[i])) throw tooMany(`ลองผิดหลายครั้งเกินไป กรุณารอ ${WINDOW} นาที`);
  // สำเร็จ: ล้างของบัญชีนี้ และถอนเฉพาะครั้งนี้ออกจากยอดของ IP (ไม่ล้างทั้ง IP กันใช้บัญชีตัวเองรีเซ็ตยอดที่เดารหัสคนอื่น)
  return async () => { await attempts.removeAttempts(ids); await attempts.clearAttempts(scope, hashed[0]); };
}
