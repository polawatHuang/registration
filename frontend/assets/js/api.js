import { API_BASE } from './config.js';

export class ApiError extends Error {
  constructor(status, body, path = '') {
    // คำตอบที่ไม่ใช่ของแอป (502/504 ระหว่างรีสตาร์ต หรือ firewall ของ hosting) บอกรหัสเพื่อหาสาเหตุได้
    super(body?.message || (status ? `ระบบตอบผิดรูปแบบ (HTTP ${status}${path ? ` ${path.split('?')[0]}` : ''}) กรุณาลองใหม่` : 'เชื่อมต่อระบบไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่'));
    this.status = status;
    this.code = body?.meta?.code;
    this.errors = body?.meta?.errors ?? [];
  }
}
let csrf = null; let csrfReady = null;
export const setCsrf = (t) => { csrf = t; };
/** หน้าแสดงผลก่อนตรวจ session เสร็จได้ แต่คำสั่งที่เปลี่ยนข้อมูลต้องรอ token */
export const waitForCsrf = (promise) => { csrfReady = promise.catch(() => {}).finally(() => { csrfReady = null; }); };
const READ_LIMIT = 6500; // ไม่ให้ผู้ใช้จ้องหน้าโหลดเกิน 7 วินาที ครบแล้วบอกและให้ลองใหม่
const notFromApp = (res) => [404, 502, 503, 504].includes(res.status) && !(res.headers.get('content-type') ?? '').includes('json');

export async function api(path, { method = 'GET', body, signal } = {}) {
  if (method !== 'GET' && !csrf && csrfReady) await csrfReady;
  const headers = {};
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const limit = new AbortController(); let late = false;
  const timer = method === 'GET' ? setTimeout(() => { late = true; limit.abort(); }, READ_LIMIT) : null;
  if (signal?.aborted) limit.abort();
  signal?.addEventListener('abort', () => limit.abort(), { once: true });
  // no-store: ไม่ใช้คำตอบเก่าที่เบราว์เซอร์จำไว้ เช่น 404 ตอนแอปยังไม่พร้อม
  const run = () => fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal: limit.signal });
  let res; let json;
  try {
    res = await run();
    // แอปกำลังรีสตาร์ต: อ่านซ้ำได้อย่างปลอดภัยหนึ่งครั้ง คำสั่งที่เปลี่ยนข้อมูลไม่ลองเอง
    if (method === 'GET' && notFromApp(res)) { await new Promise((r) => { setTimeout(r, 900); }); res = await run(); }
    json = await res.json().catch((e) => { if (e.name === 'AbortError') throw e; return null; });
  } catch (err) {
    if (err.name === 'AbortError' && !late) throw err;
    throw late ? Object.assign(new ApiError(0, { message: 'ระบบตอบช้ากว่าปกติ กรุณากดลองใหม่' }, path), { slow: true }) : new ApiError(0, null, path);
  } finally { clearTimeout(timer); }
  if (!res.ok || !json) throw new ApiError(res.status, json, path);
  if (json.data?.csrfToken) csrf = json.data.csrfToken;
  return json;
}
export const get = async (path, o) => (await api(path, o)).data;
export const send = async (method, path, body = {}) => (await api(path, { method, body })).data;

/** ใช้ XHR เพราะ fetch ไม่รายงานความคืบหน้าการอัปโหลด */
export async function upload(path, formData, onProgress = () => {}) {
  if (!csrf && csrfReady) await csrfReady;
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', API_BASE + path);
    if (csrf) x.setRequestHeader('X-CSRF-Token', csrf);
    x.responseType = 'json';
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onerror = () => reject(new ApiError(0, null));
    x.onload = () => {
      if (x.status < 200 || x.status >= 300 || !x.response) return reject(new ApiError(x.status, x.response));
      if (x.response.data?.csrfToken) csrf = x.response.data.csrfToken;
      return resolve(x.response.data);
    };
    x.send(formData);
  });
}
/** ไฟล์ที่ต้องใช้สิทธิ์ (PDF/ภาพ) คืน object URL ผู้เรียกต้อง revoke เมื่อเลิกใช้ */
export async function blobUrl(path, formData) {
  if (formData && !csrf && csrfReady) await csrfReady;
  const res = await fetch(API_BASE + path, { method: formData ? 'POST' : 'GET', headers: csrf ? { 'X-CSRF-Token': csrf } : {}, body: formData, credentials: 'same-origin' }).catch(() => { throw new ApiError(0, null); });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return URL.createObjectURL(await res.blob());
}
