/** จำแนกสาเหตุจากรหัสทางการของ MiniMax (base_resp.status_code หรือรหัสท้ายข้อความ) */
const CODES = { credit: [1008, 2067], quota: [2056, 2062], auth: [1004, 2049, 2057], model: [2022, 2069, 2061, 2068], rate: [1002, 1039, 1045, 2045, 2046], params: [2013], content: [1026, 1027] };
export const BLOCKING = ['credit', 'quota', 'auth', 'model'];
export const KIND_TEXT = {
  credit: 'เครดิต MiniMax หมด', quota: 'ใช้ครบโควตาแพ็กเกจ MiniMax รอบนี้', auth: 'API key MiniMax ใช้ไม่ได้', model: 'MiniMax ไม่รองรับ model ที่ตั้งไว้',
  rate: 'เรียก MiniMax ถี่เกินไป', params: 'MiniMax ไม่รับพารามิเตอร์', content: 'MiniMax ปฏิเสธเนื้อหา', server: 'MiniMax ขัดข้อง', network: 'เชื่อมต่อ MiniMax ไม่ได้',
};
export function codeOf(body) {
  const direct = Number(body?.base_resp?.status_code ?? body?.error?.code);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const m = String(body?.error?.message ?? body?.message ?? '').match(/\((\d{4})\)|\b(1008|2056|2067|2049|1004|2022|2069)\b/);
  return m ? Number(m[1] ?? m[2]) : null;
}
export function classify(status, body) {
  const code = codeOf(body);
  const kind = Object.keys(CODES).find((k) => CODES[k].includes(code));
  if (kind) return { kind, code };
  const text = String(body?.base_resp?.status_msg ?? body?.error?.message ?? '').toLowerCase();
  if (status === 402 || /insufficient.{0,12}(balance|credit|fund)/.test(text)) return { kind: 'credit', code };
  if (status === 401 || status === 403) return { kind: 'auth', code };
  if (status === 404) return { kind: 'model', code };
  if (status === 429) return { kind: 'rate', code };
  if (status === 400) return { kind: 'params', code };
  return { kind: status ? 'server' : 'network', code };
}
