// เครื่องพัฒนาเท่านั้น: MySQL ชั่วคราว + LINE จำลอง + ข้อมูลสาธิต ห้ามใช้ใน production
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDB } from 'mysql-memory-server';

if (process.env.NODE_ENV === 'production') throw new Error('dev-local ใช้ใน production ไม่ได้');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const local = path.join(root, '.local');
await fs.mkdir(local, { recursive: true });
const port = process.env.PORT || '3000';
const db = await createDB({ version: '8.4.x', dbName: 'lst_dev', logLevel: 'ERROR' });

const codes = new Map(); const tokens = new Map();
const line = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  for await (const c of req) body += c;
  const f = new URLSearchParams(body);
  const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/authorize') {
    const code = crypto.randomUUID();
    codes.set(code, { challenge: u.searchParams.get('code_challenge'), nonce: u.searchParams.get('nonce') });
    const back = new URL(`http://localhost:${port}/api/v1/auth/line/callback`);
    back.search = new URLSearchParams({ code, state: u.searchParams.get('state') });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<body style="font-family:sans-serif;text-align:center;padding:80px"><h1>LINE จำลอง (เครื่องพัฒนา)</h1><a id="ok" href="${back.href.replaceAll('&', '&amp;')}">อนุญาต</a></body>`);
  }
  if (u.pathname === '/oauth2/v2.1/token') {
    const c = codes.get(f.get('code')); codes.delete(f.get('code'));
    if (!c || crypto.createHash('sha256').update(f.get('code_verifier')).digest('base64url') !== c.challenge) return json(400, {});
    const t = crypto.randomUUID(); tokens.set(t, c);
    return json(200, { id_token: t });
  }
  const t = tokens.get(f.get('id_token'));
  if (!t || t.nonce !== f.get('nonce')) return json(400, {});
  return json(200, { iss: 'https://access.line.me', sub: 'Udev-local', aud: f.get('client_id'), exp: Math.floor(Date.now() / 1000) + 600, nonce: t.nonce, name: 'ต้นข้าว (ทดสอบ)' });
});
await new Promise((r) => line.listen(0, '127.0.0.1', r));
const lineUrl = `http://127.0.0.1:${line.address().port}`;
const secret = () => crypto.randomBytes(32).toString('base64');
Object.assign(process.env, {
  NODE_ENV: 'development', PORT: port, APP_URL: `http://localhost:${port}`, TRUST_PROXY: '0', DB_HOST: '127.0.0.1', DB_PORT: String(db.port), DB_NAME: db.dbName, DB_USER: db.username, DB_PASSWORD: '',
  DATA_ENCRYPTION_KEY: secret(), DATA_HASH_KEY: secret(), JOBS_SECRET: secret(), STORAGE_PATH: path.join(local, 'storage'), MAX_UPLOAD_MB: '5',
  LINE_LOGIN_CHANNEL_ID: 'dev', LINE_LOGIN_CHANNEL_SECRET: 'dev', LINE_AUTHORIZE_URL: `${lineUrl}/authorize`, LINE_API_URL: lineUrl, LOG_LEVEL: 'warn',
});
const { query } = await import('../src/config/db.js');
const { migrate, seed } = await import('../src/utils/migrator.js');
const { createAdminUser } = await import('../src/services/adminUserService.js');
await migrate();
await seed();
const [role] = await query("SELECT id FROM roles WHERE role_key = 'super_admin'");
const password = crypto.randomBytes(12).toString('base64url');
await createAdminUser({ username: 'dev', displayName: 'ผู้ดูแล (ทดสอบ)', password, roleId: role.id }, { adminId: null, ip: 'dev' });
await fs.writeFile(path.join(local, 'dev-admin.txt'), `username: dev\npassword: ${password}\n`, { mode: 0o600 });
for (const name of ['มหาวิทยาลัยสาธิต ก (ตัวอย่าง)', 'มหาวิทยาลัยสาธิต ข (ตัวอย่าง)']) await query('INSERT INTO universities (name) VALUES (:name)', { name });
for (const label of ['ตัวเลือกตัวอย่าง 1', 'ตัวเลือกตัวอย่าง 2']) await query("INSERT INTO lookup_options (category, label) VALUES ('shop_duration', :label)", { label });
for (const [u, name, day, cap] of [[1, 'รุ่นตัวอย่าง 1', 20, 60], [1, 'รุ่นตัวอย่าง 2', 45, 3], [2, 'รุ่นตัวอย่าง 3', 30, null]]) {
  await query(`INSERT INTO training_sessions (course_id, university_id, session_name, starts_at, ends_at, location, capacity, status)
    VALUES (1, :u, :name, DATE_ADD(DATE(UTC_TIMESTAMP()), INTERVAL :h HOUR), DATE_ADD(DATE(UTC_TIMESTAMP()), INTERVAL :h2 HOUR), 'ห้องประชุมตัวอย่าง', :cap, 'open')`, { u, name, cap, h: day * 24 + 2, h2: day * 24 + 9 });
}
await (await import('./import-knowledge.js')).importKnowledge(() => {});
await query("UPDATE ai_knowledge SET status = 'published'");
await import('../server.js');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPtfDwAEfgG/kk0XNgAAAABJRU5ErkJggg==', 'base64');
const { privacyVersion } = (await (await fetch(`http://localhost:${port}/api/v1/catalog/site-info`)).json()).data;
const names = ['สมชาย', 'สมหญิง', 'มานี', 'ปิติ', 'ชูใจ', 'วีระ', 'ดวงแก้ว'];
for (let i = 0; i < names.length; i += 1) {
  const d = `1${String(crypto.randomInt(1e11)).padStart(11, '0')}`;
  const nationalId = d + ((11 - ([...d].reduce((t, c, k) => t + Number(c) * (13 - k), 0) % 11)) % 10);
  const fd = new FormData();
  const fields = { universityId: i % 3 === 2 ? 2 : 1, sessionId: i % 3 === 2 ? 3 : (i % 3) + 1, fullName: `${names[i]} ตัวอย่าง`, nationalId, address: '1 ถ.ตัวอย่าง กรุงเทพฯ 10110', mobile: `08100000${String(i).padStart(2, '0')}`, email: `demo${i}@example.com`,
    shopName: `ร้านตัวอย่าง ${i + 1}`, shopAddress: '1 ถ.ตัวอย่าง กรุงเทพฯ', shopDurationId: 1, hasTrainedBefore: 'no', receiptName: `${names[i]} ตัวอย่าง`, receiptAddress: '1 ถ.ตัวอย่าง กรุงเทพฯ 10110', acknowledge: 'yes', privacyVersion, idempotencyKey: crypto.randomUUID() };
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const t of ['id_card', 'portrait_photo']) fd.append(t, new Blob([PNG]), `${t}.png`);
  fd.append('payment_slip', new Blob(['%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF']), 'slip.pdf');
  const r = await fetch(`http://localhost:${port}/api/v1/applications`, { method: 'POST', body: fd });
  if (!r.ok) console.error('demo application failed', r.status, await r.text());
}
console.log(`พร้อมใช้งาน http://localhost:${port}  (บัญชีเจ้าหน้าที่อยู่ใน .local/dev-admin.txt)`);
