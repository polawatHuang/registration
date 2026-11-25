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
const channelSecret = crypto.randomBytes(16).toString('hex');
const inbox = [];
async function customer(userId, message, extra = {}) {
  const raw = JSON.stringify({ destination: 'dev', events: [{ type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: crypto.randomUUID(), source: { type: 'user', userId }, replyToken: `${userId}.${crypto.randomUUID()}`, message: { id: String(Date.now()) + crypto.randomInt(1000), ...message }, ...extra }] });
  return fetch(`http://localhost:${port}/api/v1/line/webhook`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-line-signature': crypto.createHmac('sha256', channelSecret).update(raw).digest('base64') } });
}
const PEOPLE = { Udemo1: 'คุณข้าวหอม', Udemo2: 'คุณใบเตย', Udemo3: 'คุณตะวัน', 'Udev-local': 'ต้นข้าว (ผู้ที่ล็อกอินเว็บด้วย LINE จำลอง)' };
const escape = (v) => String(v).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const line = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  for await (const c of req) body += c;
  const f = new URLSearchParams(body);
  const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/v2/bot/message/reply' || u.pathname === '/v2/bot/message/push') { const b = JSON.parse(body); inbox.push({ to: b.to ?? b.replyToken.split('.')[0], text: b.messages.map((m) => m.text ?? m.altText).join('\n'), by: b.messages[0].sender?.name ?? 'LINE OA' }); return json(200, {}); }
  if (u.pathname.startsWith('/v2/bot/profile/')) return json(200, { displayName: PEOPLE[u.pathname.split('/').pop()] ?? 'ลูกค้าทดสอบ' });
  if (u.pathname === '/v2/bot/info') return json(200, { displayName: 'OA จำลอง' });
  if (u.pathname === '/v2/bot/message/quota') return json(200, { type: 'limited', value: 500 });
  if (u.pathname === '/v2/bot/message/quota/consumption') return json(200, { totalUsage: 42 });
  if (u.pathname === '/v2/bot/chat/loading/start') return json(202, {});
  // MiniMax จำลอง: คัดประโยคจากแหล่งข้อมูลที่ 1 มาตอบ
  if (u.pathname === '/chat/completions') { const src = JSON.parse(body).messages[1].content.match(/\[1\] .*\n([\s\S]*?)(?=\n\n\[2\]|\n<\/sources>)/)?.[1] ?? ''; await new Promise((r) => setTimeout(r, 1200)); return json(200, { choices: [{ finish_reason: 'stop', message: { content: src ? `${src.replace(/^#.*\n+/, '').slice(0, 260)} [1]` : 'NO_ANSWER' } }], base_resp: { status_code: 0 }, usage: { total_tokens: 300 } }); }
  if (u.pathname === '/simulate') {
    if (req.method === 'POST') { const id = PEOPLE[f.get('user')] ? f.get('user') : 'Udemo1'; inbox.push({ to: id, text: f.get('text'), by: 'me' }); await customer(id, { type: 'text', text: f.get('text') ?? '' }); await new Promise((r) => setTimeout(r, 2200)); res.writeHead(303, { location: `/simulate?user=${id}` }); return res.end(); }
    const me = PEOPLE[u.searchParams.get('user')] ? u.searchParams.get('user') : 'Udemo1';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;max-width:460px;margin:20px auto;background:#8cabd9;padding:16px"><h3>จำลองเป็นลูกค้าใน LINE (เครื่องพัฒนา)</h3><p>${Object.entries(PEOPLE).map(([k, v]) => `<a href="?user=${k}">${k === me ? `<b>${v}</b>` : v}</a>`).join(' · ')} · <a href="?user=${me}">รีเฟรช</a></p>${inbox.filter((m) => m.to === me).map((m) => `<p style="text-align:${m.by === 'me' ? 'right' : 'left'}"><span style="display:inline-block;padding:8px 14px;border-radius:16px;white-space:pre-wrap;text-align:left;background:${m.by === 'me' ? '#8de055' : '#fff'}">${m.by === 'me' ? '' : `<small>${escape(m.by)}</small><br>`}${escape(m.text)}</span></p>`).join('')}<form method="post"><input type="hidden" name="user" value="${me}"><input name="text" required style="width:75%;padding:10px" autofocus> <button style="padding:10px">ส่ง</button></form>`);
  }
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
await new Promise((r) => line.listen(Number(port) + 1, '127.0.0.1', r));
const lineUrl = `http://127.0.0.1:${line.address().port}`;
const secret = () => crypto.randomBytes(32).toString('base64');
Object.assign(process.env, {
  NODE_ENV: 'development', PORT: port, APP_URL: `http://localhost:${port}`, TRUST_PROXY: '0', DB_HOST: '127.0.0.1', DB_PORT: String(db.port), DB_NAME: db.dbName, DB_USER: db.username, DB_PASSWORD: '',
  DATA_ENCRYPTION_KEY: secret(), DATA_HASH_KEY: secret(), JOBS_SECRET: secret(), STORAGE_PATH: path.join(local, 'storage'), MAX_UPLOAD_MB: '5',
  LINE_LOGIN_CHANNEL_ID: 'dev', LINE_LOGIN_CHANNEL_SECRET: 'dev', LINE_AUTHORIZE_URL: `${lineUrl}/authorize`, LINE_API_URL: lineUrl, LINE_DATA_URL: lineUrl, MINIMAX_TEST_URL: lineUrl, MINIMAX_API_KEY: 'dev-mock-key', MINIMAX_MODEL: 'mock', LINE_CHANNEL_SECRET: channelSecret, LINE_CHANNEL_ACCESS_TOKEN: 'dev-mock-token', LOG_LEVEL: 'warn',
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
for (const [id, text] of [['Udemo1', 'สวัสดีค่ะ สมัครยังไงคะ'], ['Udemo2', 'ต้องใช้เอกสารอะไรบ้าง'], ['Udemo3', 'ขอคุยกับเจ้าหน้าที่หน่อยครับ']]) { inbox.push({ to: id, text, by: 'me' }); await customer(id, { type: 'text', text }); }
console.log(`จำลองเป็นลูกค้า LINE ได้ที่ ${lineUrl}/simulate`);
console.log(`พร้อมใช้งาน http://localhost:${port}  (บัญชีเจ้าหน้าที่อยู่ใน .local/dev-admin.txt)`);
