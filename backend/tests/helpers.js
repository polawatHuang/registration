import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createDB } from 'mysql-memory-server';

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(500)]);
export const PDF = Buffer.from('%PDF-1.4\n%test document body\n%%EOF');

/** เลขบัตรทดสอบที่ checksum ถูกต้อง สุ่มขึ้นใหม่ ไม่ใช่ของบุคคลจริง */
export function thaiId() {
  const d = `1${String(crypto.randomInt(1e11)).padStart(11, '0')}`;
  const sum = [...d].reduce((s, c, i) => s + Number(c) * (13 - i), 0);
  return d + ((11 - (sum % 11)) % 10);
}

/** SMTP จำลอง เก็บเมลที่ได้รับ; mode = 'ok' | 'temp' | 'perm' */
async function startSmtpMock() {
  const mock = { mails: [], mode: 'ok' };
  const server = net.createServer((sock) => {
    let data = null; let to = ''; let buf = '';
    sock.on('error', () => {});
    sock.write('220 mock\r\n');
    sock.on('data', (chunk) => {
      buf += chunk;
      for (let i; (i = buf.indexOf('\r\n')) >= 0;) {
        const l = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data !== null) { if (l === '.') { mock.mails.push({ to, raw: data }); data = null; sock.write('250 ok\r\n'); } else data += `${l}\r\n`; continue; }
        const c = l.toUpperCase();
        if (c.startsWith('RCPT')) { to = l.match(/<(.*)>/)[1]; sock.write(mock.mode === 'temp' ? '451 later\r\n' : mock.mode === 'perm' ? '550 no such user\r\n' : '250 ok\r\n'); } else if (c === 'DATA') { data = ''; sock.write('354 go\r\n'); } else if (c === 'QUIT') sock.end('221 bye\r\n'); else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return Object.assign(mock, { port: server.address().port, close: () => server.close() });
}

/** LINE จำลอง ตรวจ PKCE จริงและคืน ID Token ตาม code */
async function startLineMock() {
  const codes = new Map();
  const tokens = new Map();
  const mock = { overrides: {}, codes, aiReply: null, aiRequests: [] };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const f = new URLSearchParams(body);
    const json = (status, o) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/oauth2/v2.1/token') {
      const c = codes.get(f.get('code'));
      codes.delete(f.get('code'));
      if (!c || crypto.createHash('sha256').update(f.get('code_verifier')).digest('base64url') !== c.challenge) return json(400, {});
      const t = crypto.randomUUID();
      tokens.set(t, c);
      return json(200, { id_token: t });
    }
    const good = /^Bearer good-/.test(req.headers.authorization ?? '');
    if (req.url === '/v2/bot/info') return good ? json(200, { displayName: 'OA' }) : json(401, {});
    if (req.url === '/chat/completions' && mock.aiReply) { mock.aiRequests.push(body); return json(200, { choices: [{ finish_reason: mock.aiFinish ?? 'stop', message: { content: mock.aiReply } }], base_resp: { status_code: 0 } }); }
    if (req.url === '/chat/completions') return good ? json(200, { choices: [{}], base_resp: { status_code: 0 } }) : json(200, { base_resp: { status_code: 1004 } });
    const t = tokens.get(f.get('id_token'));
    if (!t || t.nonce !== f.get('nonce')) return json(400, {});
    return json(200, { iss: 'https://access.line.me', sub: t.sub, aud: f.get('client_id'), exp: Math.floor(Date.now() / 1000) + 600, nonce: t.nonce, name: 'ผู้ทดสอบ', ...mock.overrides });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return Object.assign(mock, { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
}

export class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); this.csrf = null; }
  async request(method, url, { json, form, headers = {} } = {}) {
    const h = { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers };
    if (this.csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = this.csrf;
    if (json) h['content-type'] = 'application/json';
    const res = await fetch(url.startsWith('http') ? url : this.base + url, { method, headers: h, body: json ? JSON.stringify(json) : form, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [k, v] = c.split(';')[0].split('=');
      if (v) this.cookies.set(k, v); else this.cookies.delete(k);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    let body = null;
    try { body = JSON.parse(buffer.toString()); } catch { /* binary */ }
    if (body?.data?.csrfToken) this.csrf = body.data.csrfToken;
    return { status: res.status, body, buffer, headers: res.headers, location: res.headers.get('location') };
  }
  get(url, o) { return this.request('GET', url, o); }
  post(url, json, o) { return this.request('POST', url, { json: json ?? {}, ...o }); }
  put(url, json) { return this.request('PUT', url, { json }); }
}

export async function startStack() {
  const db = await createDB({ version: '8.4.x', dbName: 'lst_test', logLevel: 'ERROR' });
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'lst-test-'));
  const line = await startLineMock();
  const smtp = await startSmtpMock();
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  Object.assign(process.env, {
    NODE_ENV: 'test', PORT: String(port), APP_URL: `http://127.0.0.1:${port}`, TRUST_PROXY: '0', DB_HOST: '127.0.0.1', DB_PORT: String(db.port), DB_NAME: db.dbName, DB_USER: db.username, DB_PASSWORD: '',
    DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), DATA_HASH_KEY: crypto.randomBytes(32).toString('base64'), JOBS_SECRET: crypto.randomBytes(24).toString('hex'),
    STORAGE_PATH: storage, MAX_UPLOAD_MB: '1', LINE_LOGIN_CHANNEL_ID: '1234567890', LINE_LOGIN_CHANNEL_SECRET: crypto.randomBytes(16).toString('hex'), LINE_API_URL: line.url, MINIMAX_TEST_URL: line.url, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_FROM_EMAIL: 'noreply@example.com', SMTP_ALLOW_INSECURE: '1', LOG_LEVEL: 'silent',
  });
  const { pool, query } = await import('../src/config/db.js');
  const { migrate, seed } = await import('../src/utils/migrator.js');
  const { createApp } = await import('../src/app.js');
  const { createAdminUser } = await import('../src/services/adminUserService.js');
  await migrate();
  await seed();
  const server = await new Promise((r) => { const s = createApp().listen(port, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${port}`;

  const uni = (await query("INSERT INTO universities (name) VALUES ('มหาวิทยาลัยทดสอบ')")).insertId;
  const option = (await query("INSERT INTO lookup_options (category, label) VALUES ('shop_duration', 'ทดสอบ')")).insertId;
  const newSession = async (capacity = null) => (await query(`INSERT INTO training_sessions (course_id, university_id, session_name, starts_at, ends_at, capacity, status)
    VALUES (1, :uni, 'รุ่นทดสอบ', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 31 DAY), :capacity, 'open')`, { uni, capacity })).insertId;
  const ctx = {};
  const refreshVersion = async () => { ctx.privacyVersion = (await (await fetch(`${base}/api/v1/catalog/site-info`)).json()).data.privacyVersion; };
  await refreshVersion();
  const passwords = {};
  const newAdmin = async (roleKey) => {
    const username = `${roleKey}_${crypto.randomUUID().slice(0, 6)}`;
    const password = passwords[username] = crypto.randomBytes(12).toString('hex');
    const [role] = await query('SELECT id FROM roles WHERE role_key = :roleKey', { roleKey });
    const id = await createAdminUser({ username, displayName: username, password, roleId: role.id }, { adminId: null, ip: 'test' });
    return { id, username, password, roleId: role.id };
  };
  const adminClient = async (roleKey = 'super_admin') => {
    const a = await newAdmin(roleKey);
    const c = new Client(base);
    const r = await c.post('/api/v1/admin/auth/login', { username: a.username, password: a.password });
    if (r.status !== 200) throw new Error(`login ${r.status}`);
    await c.get('/api/v1/admin/auth/me');
    return Object.assign(c, { admin: a });
  };
  const applicationForm = ({ files = {}, ...over } = {}) => {
    const fields = { universityId: uni, sessionId: over.sessionId, fullName: 'ทดสอบ ระบบ', nationalId: thaiId(), address: '1 ถนนทดสอบ เขตทดสอบ กรุงเทพฯ 10110', mobile: '0812345678', lineContactId: '',
      email: 'test@example.com', shopName: 'ร้านทดสอบ', shopAddress: '1 ถนนทดสอบ กรุงเทพฯ', shopDurationId: option, hasTrainedBefore: 'no', receiptName: 'ทดสอบ ระบบ',
      receiptAddress: '1 ถนนทดสอบ กรุงเทพฯ 10110', taxId: '', acknowledge: 'yes', privacyVersion: ctx.privacyVersion, idempotencyKey: crypto.randomUUID(), ...over };
    const docs = { id_card: [PNG, 'id.png'], payment_slip: [PDF, 'slip.pdf'], portrait_photo: [PNG, 'me.png'], ...files };
    const form = () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
      for (const [k, v] of Object.entries(docs)) if (v) fd.append(k, new Blob([v[0]]), v[1]);
      return fd;
    };
    return { fields, form };
  };
  const apply = async (over, client = new Client(base)) => {
    const f = applicationForm(over);
    const r = await client.request('POST', '/api/v1/applications', { form: f.form() });
    return { ...r, fields: f.fields, client };
  };
  const lineLogin = async (client, sub) => {
    const start = await client.get('/api/v1/auth/line/start?returnTo=/');
    const u = new URL(start.location).searchParams;
    const code = crypto.randomUUID();
    line.codes.set(code, { challenge: u.get('code_challenge'), nonce: u.get('nonce'), sub });
    const cb = await client.get(`/api/v1/auth/line/callback?code=${code}&state=${u.get('state')}`);
    await client.get('/api/v1/auth/session');
    return cb;
  };
  const countFiles = async () => (await fs.readdir(path.join(storage, 'documents'), { recursive: true }).catch(() => [])).filter((f) => f.endsWith('.bin')).length;
  return { base, db, query, refreshVersion, line, smtp, uni, option, storage, newSession, newAdmin, adminClient, applicationForm, apply, lineLogin, countFiles,
    stop: async () => { server.closeAllConnections(); server.close(); line.close(); smtp.close(); await new Promise((r) => setTimeout(r, 300)); await pool.end(); await db.stop(); await fs.rm(storage, { recursive: true, force: true }); } };
}
