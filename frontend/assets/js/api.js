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
let csrf = null;
export const setCsrf = (t) => { csrf = t; };

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = {};
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const run = () => fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal });
  let res;
  try {
    res = await run();
    // แอปกำลังรีสตาร์ต: อ่านข้อมูลซ้ำได้อย่างปลอดภัย คำสั่งที่เปลี่ยนข้อมูลไม่ลองเอง
    if (method === 'GET' && [502, 503, 504].includes(res.status) && !(res.headers.get('content-type') ?? '').includes('json')) { await new Promise((r) => { setTimeout(r, 2500); }); res = await run(); }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, null, path);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new ApiError(res.status, json, path);
  if (json.data?.csrfToken) csrf = json.data.csrfToken;
  return json;
}
export const get = async (path, o) => (await api(path, o)).data;
export const send = async (method, path, body = {}) => (await api(path, { method, body })).data;

/** ใช้ XHR เพราะ fetch ไม่รายงานความคืบหน้าการอัปโหลด */
export function upload(path, formData, onProgress = () => {}) {
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
  const res = await fetch(API_BASE + path, { method: formData ? 'POST' : 'GET', headers: csrf ? { 'X-CSRF-Token': csrf } : {}, body: formData, credentials: 'same-origin' }).catch(() => { throw new ApiError(0, null); });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return URL.createObjectURL(await res.blob());
}
