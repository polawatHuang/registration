import { env } from '../config/env.js';
import { MINIMAX_URLS, getConfig } from '../services/integrationService.js';
import { canonicalModel, modelOptions } from '../config/minimaxModels.js';
import { classify, KIND_TEXT } from '../config/minimaxErrors.js';
import { reportFail, reportOk } from '../services/aiHealthService.js';
import { AppError } from '../utils/errors.js';

const fail = (message) => new AppError(502, 'AI_UNAVAILABLE', message);
export const isConfigured = async () => { const c = await getConfig(); return Boolean(c.minimax_api_key && c.minimax_model); };

async function request(messages, opt) {
  const c = await getConfig();
  if (!c.minimax_api_key || !c.minimax_model) throw fail('ยังไม่ได้ตั้งค่า MiniMax');
  const model = canonicalModel(c.minimax_model); // ค่าที่บันทึกไว้ก่อนหน้าอาจขาดคำนำหน้า
  const base = (!env.isProd && env.MINIMAX_TEST_URL) || (MINIMAX_URLS.includes(c.minimax_base_url) ? c.minimax_base_url : MINIMAX_URLS[0]);
  const deadline = AbortSignal.timeout(45_000); // รวมทุกครั้งที่ลอง
  const call = async (options) => {
    try {
      const res = await fetch(`${base}/chat/completions`, { method: 'POST', redirect: 'error', signal: deadline, headers: { authorization: `Bearer ${c.minimax_api_key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, ...options }) });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch { return { status: 0, body: null }; }
  };
  const bad = (r) => r.status !== 200 || r.body?.base_resp?.status_code || !r.body;
  let r = await call(modelOptions(model, opt));
  // MiniMax เปลี่ยนพารามิเตอร์ที่รับ: ลองแบบพื้นฐานอีกครั้งเดียว ดีกว่าให้ AI หยุดทั้งระบบ
  if (bad(r) && classify(r.status, r.body).kind === 'params') r = await call({ max_tokens: opt.maxTokens });
  if (bad(r)) {
    const { kind, code } = classify(r.status, r.body);
    await reportFail(kind, code);
    throw Object.assign(fail(`${KIND_TEXT[kind]}${code ? ` (${code})` : ''}`), { kind, vendorCode: code });
  }
  await reportOk();
  return { model, body: r.body };
}
/** ตรวจว่าใช้งานได้จริง: คำตอบถูกตัดก็ถือว่าผ่าน เพราะวัดแค่สิทธิ์และเครดิต */
export async function ping() {
  try { const { model } = await request([{ role: 'user', content: 'ping' }], { maxTokens: 64, temperature: 0.1, effort: 'low' }); return { ok: true, model }; } catch (err) { return { ok: false, kind: err.kind ?? null, code: err.vendorCode ?? null, message: err.message }; }
}
/** ผู้ให้บริการ AI เดียวของระบบ คืนข้อความคำตอบ (ตัดส่วน <think> ของ reasoning model ออก) */
export async function chat(messages, { maxTokens = 4000, temperature = 0.1, effort = 'low' } = {}) {
  const { model, body } = await request(messages, { maxTokens, temperature, effort });
  const usage = { model, tokens: body.usage?.total_tokens ?? null, tokensIn: body.usage?.prompt_tokens ?? null, tokensOut: body.usage?.completion_tokens ?? null };
  const choice = body.choices?.[0];
  // คำตอบที่ถูกตัดกลางคันอาจให้ข้อมูลผิด จึงไม่ใช้
  const raw = choice?.message?.content;
  const text = typeof raw === 'string' ? raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
  // คำตอบที่ใช้ไม่ได้ก็เสียค่า token แล้ว จึงแนบยอดไปบันทึกด้วย
  if (!text || choice.finish_reason === 'length' || /<\/?think>/.test(text)) throw Object.assign(fail(choice?.finish_reason === 'length' ? 'MiniMax ใช้ token ครบก่อนตอบจบ เพิ่ม Max tokens ในตั้งค่า AI' : 'MiniMax ตอบไม่สมบูรณ์'), { usage });
  return { text, ...usage };
}
