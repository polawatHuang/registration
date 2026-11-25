import { withTransaction } from '../config/db.js';
import { logger } from '../config/logger.js';
import * as repo from '../repositories/aiRepository.js';
import { getSettings, setSetting } from '../repositories/catalogRepository.js';
import { insertAudit } from '../repositories/auditRepository.js';
import { decryptText, encryptText } from '../utils/crypto.js';

const KEYS = { maxTokens: 'ai_max_tokens', temperature: 'ai_temperature', fallback: 'ai_fallback', perHour: 'ai_per_hour', monthlyTokens: 'ai_monthly_tokens', priceIn: 'ai_price_in', priceOut: 'ai_price_out', currency: 'ai_currency' };
const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
export async function aiSettings() {
  const s = await getSettings(Object.values(KEYS));
  return { maxTokens: num(s.ai_max_tokens, 2000), temperature: num(s.ai_temperature, 0.1), fallback: s.ai_fallback || null, perHour: num(s.ai_per_hour, 20), monthlyTokens: num(s.ai_monthly_tokens, null), priceIn: num(s.ai_price_in, null), priceOut: num(s.ai_price_out, null), currency: s.ai_currency || 'USD' };
}
export async function saveAiSettings(d, { adminId, ip }) {
  await withTransaction(async (conn) => {
    for (const [k, key] of Object.entries(KEYS)) await setSetting(key, d[k] === null || d[k] === undefined ? '' : String(d[k]), conn);
    await insertAudit({ adminId, action: 'ai.settings', entityType: 'ai', ip, metadata: d }, conn);
  });
  return aiSettings();
}
export async function overBudget() {
  const { monthlyTokens } = await aiSettings();
  return monthlyTokens !== null && (await repo.monthTokens()) >= monthlyTokens;
}
/** บันทึกไม่สำเร็จต้องไม่ทำให้ลูกค้าไม่ได้คำตอบ */
export async function record(r, { channel, conversationId = null, ms }) {
  try {
    await repo.insert({ conversationId, channel, mode: r.mode, intent: (r.sources?.[0]?.category ?? (r.mode === 'personal' ? 'สถานะส่วนตัว' : null))?.slice(0, 60) ?? null, question: encryptText(r.question || '-', 'ai_question'), sources: JSON.stringify((r.sources ?? []).slice(0, 5).map((x) => x.title.slice(0, 80))).slice(0, 1000), model: r.model ?? null, tokensIn: r.tokensIn ?? null, tokensOut: r.tokensOut ?? null, tokensTotal: r.tokens ?? 0, ms: Math.round(ms) });
  } catch (err) { logger.error({ err: { message: err.message, code: err.code } }, 'ai interaction not recorded'); }
}
const dec = (v) => { try { return decryptText(v, 'ai_question'); } catch { return null; } };
/** รวมคำถามที่ต่างกันแค่เว้นวรรค เครื่องหมาย หรือคำลงท้าย */
export const normalize = (t) => t.toLowerCase().replace(/(นะคะ|นะครับ|ค่ะ|คะ|ครับผม|ครับ|จ้า|จ้ะ|หน่อย)/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
function group(rows, limit) {
  const map = new Map();
  for (const r of rows) {
    const q = dec(r.question_enc);
    if (!q) continue;
    const k = normalize(q) || q;
    const g = map.get(k) ?? { question: q, count: 0, ids: [], lastAt: r.created_at, conversationId: r.conversation_id, modes: {} };
    g.count += 1; g.ids.push(r.id); g.modes[r.mode] = (g.modes[r.mode] ?? 0) + 1;
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
/** ประมาณการ: บาง model ไม่แยก token เข้า/ออก ส่วนนั้นคิดด้วยราคาขาเข้า */
const cost = (s, r) => (s.priceIn === null && s.priceOut === null ? null : ((Number(r.tin) + Number(r.unsplit)) * (s.priceIn ?? 0) + Number(r.tout) * (s.priceOut ?? 0)) / 1e6);
export async function report(days = 30) {
  const [settings, month, daily, modes, open, all] = [await aiSettings(), await repo.monthSums(), await repo.daily(days), await repo.modes(days), await repo.recent({ days, unanswered: true, limit: 2000 }), await repo.recent({ days, line: true, limit: 3000 })];
  return {
    settings, month: { tokens: Number(month.total), cost: cost(settings, month), interactions: Number(month.n), conversations: Number(month.conversations), avgMs: Math.round(Number(month.avg_ms)) },
    daily: daily.map((d) => ({ day: d.day, n: Number(d.n), tokens: Number(d.tokens), cost: cost(settings, d), unanswered: Number(d.unanswered) })), modes: Object.fromEntries(modes.map((m) => [m.mode, Number(m.n)])),
    unanswered: group(open, 100), frequent: group(all, 10),
  };
}
export const history = async () => (await repo.recent({ days: 30, limit: 200 })).map((r) => ({ id: r.id, conversationId: r.conversation_id, channel: r.channel, mode: r.mode, intent: r.intent, question: dec(r.question_enc), sources: r.sources_json ? JSON.parse(r.sources_json) : [], tokens: r.tokens_total, ms: r.response_ms, at: r.created_at }));
export async function resolve(ids, { adminId, ip }) {
  await withTransaction(async (conn) => { const n = await repo.resolve(ids, adminId, conn); await insertAudit({ adminId, action: 'ai.resolve', entityType: 'ai', ip, metadata: { n } }, conn); });
}
export async function summary() { const [settings, m, d, all] = [await aiSettings(), await repo.monthSums(), await repo.daily(14), await repo.recent({ days: 30, line: true, limit: 3000 })]; return { conversations: Number(m.conversations), tokens: Number(m.total), cost: cost(settings, m), currency: settings.currency, daily: d.map((x) => ({ day: x.day, n: Number(x.n), tokens: Number(x.tokens), cost: cost(settings, x) })), frequent: group(all, 6).map(({ question, count }) => ({ question, count })) }; }
