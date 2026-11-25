import { env } from '../config/env.js';
import { MINIMAX_URLS, getConfig } from '../services/integrationService.js';
import { AppError } from '../utils/errors.js';

const fail = (message) => new AppError(502, 'AI_UNAVAILABLE', message);
export const isConfigured = async () => { const c = await getConfig(); return Boolean(c.minimax_api_key && c.minimax_model); };

/** ผู้ให้บริการ AI เดียวของระบบ คืนข้อความคำตอบ (ตัดส่วน <think> ของ reasoning model ออก) */
export async function chat(messages, { maxTokens = 2000, temperature = 0.1 } = {}) {
  const c = await getConfig();
  if (!c.minimax_api_key || !c.minimax_model) throw fail('ยังไม่ได้ตั้งค่า MiniMax');
  const base = (!env.isProd && env.MINIMAX_TEST_URL) || (MINIMAX_URLS.includes(c.minimax_base_url) ? c.minimax_base_url : MINIMAX_URLS[0]);
  let body;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000), headers: { authorization: `Bearer ${c.minimax_api_key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: c.minimax_model, messages, max_tokens: maxTokens, temperature }),
    });
    if (!res.ok) throw new Error(String(res.status));
    body = await res.json();
  } catch { throw fail('MiniMax ไม่ตอบสนอง กรุณาลองใหม่'); }
  if (body?.base_resp?.status_code) throw fail(`MiniMax ตอบรหัส ${Number(body.base_resp.status_code)}`);
  const choice = body?.choices?.[0];
  // คำตอบที่ถูกตัดกลางคันอาจให้ข้อมูลผิด จึงไม่ใช้
  if (typeof choice?.message?.content !== 'string' || choice.finish_reason === 'length') throw fail('MiniMax ตอบไม่สมบูรณ์');
  return { text: choice.message.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), model: c.minimax_model, tokens: body.usage?.total_tokens ?? null, tokensIn: body.usage?.prompt_tokens ?? null, tokensOut: body.usage?.completion_tokens ?? null };
}
