// ทดสอบโหลดกับระบบชั่วคราวในเครื่อง (MySQL จำลอง) ไม่แตะระบบจริง: npm run test:load -- [พร้อมกัน] [วินาทีต่อหน้า]
import { Client, startStack } from '../tests/helpers.js';

const [conc = '50', secs = '3'] = process.argv.slice(2);
const s = await startStack();
const stat = (name, times, codes, ms) => { times.sort((a, b) => a - b); const q = (x) => times[Math.min(times.length - 1, Math.floor(times.length * x))].toFixed(0); console.log(`${name.padEnd(38)} ${String(Math.round(times.length / (ms / 1000))).padStart(5)}/วินาที  p50 ${q(0.5)}  p95 ${q(0.95)}  p99 ${q(0.99)} ms  ${JSON.stringify(codes)}`); };
async function hammer(name, fn, n = Number(conc), until = Number(secs) * 1000) {
  const times = []; const codes = {}; const t0 = Date.now();
  await Promise.all(Array.from({ length: n }, async () => { while (Date.now() - t0 < until) { const t = performance.now(); const c = await fn().catch(() => 'error'); codes[c] = (codes[c] ?? 0) + 1; times.push(performance.now() - t); } }));
  stat(name, times, codes, Date.now() - t0);
}
async function burst(name, list, fn) {
  const times = []; const codes = {}; const t0 = Date.now();
  await Promise.all(list.map(async (x) => { const t = performance.now(); const c = await fn(x).catch((e) => e.message); codes[c] = (codes[c] ?? 0) + 1; times.push(performance.now() - t); }));
  stat(name, times, codes, Date.now() - t0);
}
try {
  const session = await s.newSession(120);
  for (const p of ['/api/v1/catalog/universities', `/api/v1/catalog/sessions?universityId=${s.uni}`, '/api/v1/catalog/site-info', '/api/v1/catalog/schedule', '/', '/me.html']) await hammer(p, async () => { const r = await fetch(s.base + p); await r.arrayBuffer(); return r.status; });
  const people = [];
  await burst('สมัครพร้อมกัน 150 คน ที่นั่ง 120', Array.from({ length: 150 }), async () => { const r = await s.apply({ sessionId: session }); if (r.status === 201) people.push({ client: r.client, id: r.body.data.id }); return r.status; });
  console.log(`  ที่นั่งที่ได้จริง ${people.length} (ต้องเป็น 120)`);
  await burst('เปิดสถานะพร้อมกันทุกคน', people, async (p) => (await p.client.get('/api/v1/applications/me/status')).status);
  await s.query("UPDATE applications SET status = 'awaiting_training' WHERE session_id = :session", { session });
  await burst('เปิด QR พร้อมกันทุกคน', people, async (p) => { const r = await p.client.get(`/api/v1/applications/me/${p.id}/qr`); p.token = r.body.data.token; return r.status; });
  await s.query('UPDATE training_sessions SET starts_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE), ends_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE id = :session', { session });
  const staff = await s.adminClient('attendance_staff');
  await burst('สแกนพร้อมกันทุกคน (คนละ 2 ครั้ง)', [...people, ...people], async (p) => (await staff.post(`/api/v1/admin/attendance/sessions/${session}/scan`, { token: p.token, action: 'in' })).body.data.result);
  await s.query("UPDATE applications SET status = 'passed' WHERE session_id = :session", { session });
  const admin = await s.adminClient();
  await burst('ออกใบประกาศ 120 ใบ', [0], async () => `ออก ${(await admin.post('/api/v1/admin/certificates/issue', { ids: people.map((p) => p.id) })).body.data.issued}`);
  await burst('ดาวน์โหลด PDF 120 ใบพร้อมกัน', people, async (p) => (await p.client.get(`/api/v1/applications/me/${p.id}/certificate.pdf`)).status);
  await hammer('โปรไฟล์ไม่ล็อกอิน (401)', async () => (await new Client(s.base).get('/api/v1/applications/me/status')).status, 20, 1500);
} finally { await s.stop(); }
