import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client, PDF, PNG, startStack, thaiId } from './helpers.js';

let s;
before(async () => { s = await startStack(); });
after(() => s?.stop());
const code = (r) => r.body?.meta?.code;
const A = '/api/v1/admin';

async function approveAllDocs(admin, id) {
  const d = (await admin.get(`${A}/applications/${id}`)).body.data;
  for (const doc of d.documents) assert.equal((await admin.post(`${A}/applications/${id}/documents/${doc.id}/review`, { decision: 'approved' })).status, 200);
}
const move = (admin, id, expectedStatus, status, reason) => admin.post(`${A}/applications/${id}/status`, { expectedStatus, status, reason });

describe('สมัคร', () => {
  test('สำเร็จ เก็บเอกสารเข้ารหัส บันทึก consent/ประวัติ/event และไม่มีเลขบัตรใน DB', async () => {
    const r = await s.apply({ sessionId: await s.newSession() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.data.applicationNo, /^ET\d{2}-[2-9A-HJ-NP-Z]{8}$/);
    assert.ok(!JSON.stringify(r.body).includes(r.fields.nationalId));
    const id = r.body.data.id;
    assert.equal((await s.query('SELECT COUNT(*) n FROM consents WHERE application_id = :id', { id }))[0].n, 2);
    for (const [t, c] of [['application_status_history', 'application_id'], ['domain_events', 'aggregate_id']]) {
      assert.equal((await s.query(`SELECT COUNT(*) n FROM ${t} WHERE ${c} = :id`, { id }))[0].n, 1, t);
    }
    for (const { t } of await s.query('SELECT TABLE_NAME t FROM information_schema.tables WHERE table_schema = DATABASE()')) {
      assert.ok(!JSON.stringify(await s.query(`SELECT * FROM \`${t}\``)).includes(r.fields.nationalId), t);
    }
    const [doc] = await s.query("SELECT storage_name FROM application_documents WHERE application_id = :id AND doc_type='id_card'", { id });
    const raw = await fs.readFile(path.join(s.storage, 'documents', doc.storage_name));
    assert.ok(!raw.includes(PNG.subarray(0, 8)) && !raw.includes(PNG.subarray(100, 140)));
  });
  test('ตรวจข้อมูล: checksum, รหัสไปรษณีย์, consent, เลขไทย', async () => {
    const sessionId = await s.newSession();
    for (const [over, field] of [[{ nationalId: '1234567890123' }, 'nationalId'], [{ address: 'ไม่มีรหัสไปรษณีย์เลย' }, 'address'], [{ acknowledge: 'no' }, 'acknowledge'], [{ mobile: '021234567' }, 'mobile'], [{ fullName: 'ชื่อเดียว' }, 'fullName'], [{ taxId: '123' }, 'taxId'], [{ universityId: '' }, 'universityId']]) {
      const r = await s.apply({ sessionId, ...over });
      assert.equal(r.status, 400);
      assert.ok(r.body.meta.errors.some((e) => e.field === field), field);
    }
    const thai = (v) => [...v].map((d) => String.fromCharCode(0x0e50 + Number(d))).join('');
    assert.equal((await s.apply({ sessionId, nationalId: thai(thaiId()), mobile: thai('0812345678') })).status, 201);
  });
  test('เคยอบรมต้องแนบประกาศนียบัตรเดิม', async () => {
    const sessionId = await s.newSession();
    const r = await s.apply({ sessionId, hasTrainedBefore: 'yes' });
    assert.equal(code(r), 'MISSING_DOCUMENTS');
    assert.equal((await s.apply({ sessionId, hasTrainedBefore: 'yes', files: { previous_certificate: [PDF, 'c.pdf'] } })).status, 201);
  });
  test('ปฏิเสธไฟล์ปลอม ไฟล์ใหญ่ PDF ในช่องรูป และไม่ทิ้งไฟล์ค้าง', async () => {
    const sessionId = await s.newSession();
    const beforeCount = await s.countFiles();
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    assert.equal(code(await s.apply({ sessionId, files: { id_card: [html, 'a.png'] } })), 'INVALID_FILE');
    assert.equal(code(await s.apply({ sessionId, files: { id_card: [PNG, 'a.svg'] } })), 'INVALID_FILE');
    assert.equal(code(await s.apply({ sessionId, files: { portrait_photo: [PDF, 'a.pdf'] } })), 'INVALID_FILE');
    assert.equal((await s.apply({ sessionId, files: { id_card: [Buffer.concat([PNG, Buffer.alloc(1_100_000)]), 'a.png'] } })).status, 413);
    assert.equal(await s.countFiles(), beforeCount);
  });
  test('สมัครซ้ำรุ่นเดิมไม่ได้ แต่สมัครใหม่ได้หลังยกเลิก และไฟล์ของคำขอที่ล้มเหลวถูกลบ', async () => {
    const sessionId = await s.newSession();
    const nationalId = thaiId();
    const first = await s.apply({ sessionId, nationalId });
    const n = await s.countFiles();
    assert.equal(code(await s.apply({ sessionId, nationalId })), 'ALREADY_APPLIED');
    assert.equal(await s.countFiles(), n);
    const admin = await s.adminClient();
    assert.equal((await move(admin, first.body.data.id, 'submitted', 'cancelled', 'ทดสอบ')).status, 200);
    assert.equal((await s.apply({ sessionId, nationalId })).status, 201);
  });
  test('กดส่งซ้ำด้วย key เดิมพร้อมกันได้ใบเดียว', async () => {
    const f = s.applicationForm({ sessionId: await s.newSession() });
    const rs = await Promise.all([1, 2, 3].map(() => new Client(s.base).request('POST', '/api/v1/applications', { form: f.form() })));
    assert.deepEqual(rs.map((r) => r.status), [201, 201, 201], JSON.stringify(rs.map((r) => r.body)));
    assert.equal(new Set(rs.map((r) => r.body.data.applicationNo)).size, 1);
    const other = s.applicationForm({ ...f.fields, nationalId: thaiId() });
    assert.equal(code(await new Client(s.base).request('POST', '/api/v1/applications', { form: other.form() })), 'IDEMPOTENCY_MISMATCH');
  });
  test('ที่นั่งเต็ม: สมัครพร้อมกัน 6 คน รับได้ 2', async () => {
    const sessionId = await s.newSession(2);
    const rs = await Promise.all(Array.from({ length: 6 }, () => s.apply({ sessionId })));
    assert.equal(rs.filter((r) => r.status === 201).length, 2);
    assert.equal(rs.filter((r) => code(r) === 'SESSION_FULL').length, 4);
  });
  test('รุ่นที่ปิดแล้วหรือไม่ใช่ของมหาวิทยาลัยที่เลือก สมัครไม่ได้', async () => {
    const sessionId = await s.newSession();
    assert.equal(code(await s.apply({ sessionId, universityId: 999 })), 'SESSION_CLOSED');
    await s.query("UPDATE training_sessions SET status='closed' WHERE id=:sessionId", { sessionId });
    assert.equal(code(await s.apply({ sessionId })), 'SESSION_CLOSED');
  });
});

describe('ติดตามสถานะและแก้เอกสาร', () => {
  test('วงจรเต็ม: เอกสารไม่ผ่าน → แก้ → ผ่าน → อนุมัติ', async () => {
    const r = await s.apply({ sessionId: await s.newSession() });
    const { id, applicationNo } = r.body.data;
    const admin = await s.adminClient();
    const d = (await admin.get(`${A}/applications/${id}`)).body.data;
    const doc = (t) => d.documents.find((x) => x.type === t);
    assert.equal(code(await move(admin, id, 'submitted', 'documents_approved')), 'DOCS_NOT_APPROVED');
    assert.equal(code(await move(admin, id, 'submitted', 'documents_incomplete')), 'NO_REJECTED_DOCS');
    assert.equal((await admin.post(`${A}/applications/${id}/documents/${doc('id_card').id}/review`, { decision: 'rejected' })).status, 400);
    assert.equal((await admin.post(`${A}/applications/${id}/documents/${doc('id_card').id}/review`, { decision: 'rejected', reason: 'ภาพเบลอ' })).status, 200);
    assert.equal((await move(admin, id, 'under_review', 'documents_incomplete')).status, 200);

    const me = new Client(s.base);
    const acc = await me.post('/api/v1/applications/access', { applicationNo, nationalId: r.fields.nationalId, mobile: r.fields.mobile });
    assert.equal(acc.status, 200);
    const [mine] = (await me.get('/api/v1/applications/me/status')).body.data;
    assert.equal(mine.status, 'documents_incomplete');
    assert.equal(mine.documents.find((x) => x.type === 'id_card').reason, 'ภาพเบลอ');
    const fd = (k) => { const f = new FormData(); f.append(k, new Blob([PNG]), 'n.png'); return f; };
    const n = await s.countFiles();
    assert.equal(code(await me.request('POST', `/api/v1/applications/me/${id}/documents`, { form: fd('portrait_photo') })), 'DOC_NOT_REJECTED');
    assert.equal(await s.countFiles(), n);
    const fix = await me.request('POST', `/api/v1/applications/me/${id}/documents`, { form: fd('id_card') });
    assert.equal(fix.body.data.status, 'under_review');
    assert.equal(code(await me.request('POST', `/api/v1/applications/me/${id}/documents`, { form: fd('id_card') })), 'NOT_EDITABLE');

    await approveAllDocs(admin, id);
    assert.equal((await move(admin, id, 'under_review', 'documents_approved')).status, 200);
    assert.equal(code(await move(admin, id, 'under_review', 'approved')), 'STATUS_CHANGED');
    assert.equal((await move(admin, id, 'documents_approved', 'approved')).status, 200);
    assert.equal(code(await move(admin, id, 'approved', 'certified')), 'INVALID_TRANSITION');
    assert.equal((await me.get('/api/v1/applications/me/status')).body.data[0].timeline.current, 5);
  });
  test('ข้อมูลผิดเข้าไม่ได้ และล็อกเมื่อลองหลายครั้ง', async () => {
    const r = await s.apply({ sessionId: await s.newSession() });
    const body = { applicationNo: r.body.data.applicationNo, nationalId: thaiId(), mobile: r.fields.mobile };
    const c = new Client(s.base);
    for (let i = 0; i < 5; i += 1) assert.equal((await c.post('/api/v1/applications/access', body)).status, 401);
    assert.equal((await c.post('/api/v1/applications/access', { ...body, nationalId: r.fields.nationalId })).status, 429);
    await s.query('DELETE FROM auth_attempts');
  });
  test('แก้หรือดูใบสมัครคนอื่นไม่ได้', async () => {
    const sessionId = await s.newSession();
    const [a, b] = [await s.apply({ sessionId }), await s.apply({ sessionId })];
    const mine = (await a.client.get('/api/v1/applications/me/status')).body.data;
    assert.deepEqual(mine.map((x) => x.id), [a.body.data.id]);
    const f = new FormData(); f.append('id_card', new Blob([PNG]), 'x.png');
    assert.equal((await a.client.request('POST', `/api/v1/applications/me/${b.body.data.id}/documents`, { form: f })).status, 404);
    assert.equal((await new Client(s.base).get('/api/v1/applications/me/status')).status, 401);
  });
});

describe('LINE Login', () => {
  test('ล็อกอิน → สมัคร → เห็นใบของตน และผูกบุคคลหลังเอกสารผ่านเท่านั้น', async () => {
    const c = new Client(s.base);
    const cb = await s.lineLogin(c, 'U-owner');
    assert.equal(cb.location, '/?line=ok');
    const r = await s.apply({ sessionId: await s.newSession() }, c);
    assert.equal(r.status, 201);
    const id = r.body.data.id;
    assert.equal((await c.get('/api/v1/auth/session')).body.data.line.accountLinked, false);
    const admin = await s.adminClient();
    await approveAllDocs(admin, id);
    await move(admin, id, 'under_review', 'documents_approved');
    assert.equal((await c.get('/api/v1/auth/session')).body.data.line.accountLinked, true);
    const again = new Client(s.base);
    await s.lineLogin(again, 'U-owner');
    assert.deepEqual((await again.get('/api/v1/applications/me/status')).body.data.map((x) => x.id), [id]);
    assert.equal((await again.post('/api/v1/line/unlink-account')).status, 200);
    const third = new Client(s.base);
    await s.lineLogin(third, 'U-owner');
    assert.deepEqual((await third.get('/api/v1/applications/me/status')).body.data, []);
  });
  test('คนอื่นใช้เลขบัตรเราสมัครดักไว้ จะไม่เห็นใบสมัครจริงของเรา', async () => {
    const nationalId = thaiId();
    const attacker = new Client(s.base);
    await s.lineLogin(attacker, 'U-attacker');
    const fake = await s.apply({ sessionId: await s.newSession(), nationalId, mobile: '0899999999' }, attacker);
    const real = await s.apply({ sessionId: await s.newSession(), nationalId });
    assert.deepEqual((await attacker.get('/api/v1/applications/me/status')).body.data.map((x) => x.id), [fake.body.data.id]);
    const link = await attacker.post('/api/v1/line/link-account', { applicationNo: fake.body.data.applicationNo, nationalId, mobile: '0899999999' });
    assert.equal(link.body.data.accountLinked, false);
    assert.ok(!(await attacker.get('/api/v1/applications/me/status')).body.data.some((x) => x.id === real.body.data.id));
  });
  test('ใบที่ยืนยันไว้ก่อนล็อกอินถูกผูกให้ และ LINE อื่นแย่งไม่ได้', async () => {
    const r = await s.apply({ sessionId: await s.newSession() });
    await s.lineLogin(r.client, 'U-late');
    assert.deepEqual((await r.client.get('/api/v1/applications/me/status')).body.data.map((x) => x.id), [r.body.data.id]);
    const other = new Client(s.base);
    await s.lineLogin(other, 'U-thief');
    const body = { applicationNo: r.body.data.applicationNo, nationalId: r.fields.nationalId, mobile: r.fields.mobile };
    assert.equal(code(await other.post('/api/v1/line/link-account', body)), 'ALREADY_LINKED');
  });
  test('state ใช้ซ้ำ/คนละเบราว์เซอร์/nonce/aud ผิด ถูกปฏิเสธ', async () => {
    const start = async (c) => new URL((await c.get('/api/v1/auth/line/start?returnTo=https://evil.example')).location).searchParams;
    const put = (u, over = {}) => { const k = crypto.randomUUID(); s.line.codes.set(k, { challenge: u.get('code_challenge'), nonce: u.get('nonce'), sub: 'U-x', ...over }); return k; };
    const go = (c, u, k) => c.get(`/api/v1/auth/line/callback?code=${k}&state=${u.get('state')}`);
    const c1 = new Client(s.base);
    const u1 = await start(c1);
    assert.equal((await go(new Client(s.base), u1, put(u1))).location, '/tracking.html?line=LOGIN_EXPIRED');
    const c2 = new Client(s.base);
    const u2 = await start(c2);
    const jar = new Map(c2.cookies);
    assert.equal((await go(c2, u2, put(u2))).location, '/tracking.html?line=ok');
    c2.cookies = jar;
    assert.equal((await go(c2, u2, put(u2))).location, '/tracking.html?line=LOGIN_EXPIRED');
    for (const [over, mockOver] of [[{ nonce: 'x' }, {}], [{ challenge: 'x' }, {}], [{}, { aud: 'other' }], [{}, { iss: 'https://evil' }], [{}, { exp: 1 }]]) {
      const c = new Client(s.base);
      const u = await start(c);
      s.line.overrides = mockOver;
      assert.match((await go(c, u, put(u, over))).location, /line=LINE_(REJECTED|INVALID_TOKEN)/);
      s.line.overrides = {};
      assert.equal((await c.get('/api/v1/auth/session')).body.data.authenticated, false);
    }
  });
});

describe('ความปลอดภัยฝั่งเจ้าหน้าที่', () => {
  test('ต้องล็อกอินและมี CSRF', async () => {
    assert.equal((await new Client(s.base).get(`${A}/applications`)).status, 401);
    const admin = await s.adminClient();
    assert.equal((await admin.request('POST', `${A}/catalog/universities`, { json: { name: 'x' }, headers: { 'x-csrf-token': 'bad' } })).status, 403);
    assert.equal((await admin.request('POST', `${A}/catalog/universities`, { json: { name: 'x' }, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await admin.post(`${A}/catalog/universities`, { name: `ม.${crypto.randomUUID()}` })).status, 201);
  });
  test('RBAC: เจ้าหน้าที่เช็กชื่อไม่เห็นเอกสาร/ข้อมูลเต็ม', async () => {
    const r = await s.apply({ sessionId: await s.newSession() });
    const id = r.body.data.id;
    const admin = await s.adminClient();
    const doc = (await admin.get(`${A}/applications/${id}`)).body.data.documents[0];
    const file = await admin.get(`${A}/applications/${id}/documents/${doc.id}`);
    assert.ok(file.buffer.equals(PNG));
    assert.equal(file.headers.get('cache-control'), 'no-store');
    assert.equal((await admin.post(`${A}/applications/${id}/reveal-ids`)).body.data.nationalId, r.fields.nationalId);
    const staff = await s.adminClient('attendance_staff');
    const seen = (await staff.get(`${A}/applications/${id}`)).body.data;
    assert.deepEqual(seen.documents, []);
    assert.equal(seen.address, undefined);
    for (const req of [staff.get(`${A}/applications/${id}/documents/${doc.id}`), staff.post(`${A}/applications/${id}/reveal-ids`), staff.get(`${A}/users`), staff.get(`${A}/applications/export`),
      staff.get(`${A}/audit-logs`), staff.get(`${A}/catalog`), move(staff, id, 'submitted', 'cancelled', 'x'), (await s.adminClient('training_staff')).get(`${A}/users`)]) assert.equal((await req).status, 403);
    const other = await s.apply({ sessionId: await s.newSession() });
    assert.equal((await admin.get(`${A}/applications/${other.body.data.id}/documents/${doc.id}`)).status, 404);
    const log = (await admin.get(`${A}/audit-logs?action=application.reveal`)).body.data;
    assert.ok(log.some((l) => l.entity_id === String(id)));
  });
  test('ล็อกบัญชีเมื่อรหัสผิดหลายครั้ง, ปิดบัญชีแล้ว session หลุด, ห้ามปิด Super Admin คนสุดท้าย', async () => {
    const a = await s.newAdmin('admin');
    const c = new Client(s.base);
    for (let i = 0; i < 5; i += 1) assert.equal((await c.post(`${A}/auth/login`, { username: a.username, password: 'wrong' })).status, 401);
    assert.equal((await c.post(`${A}/auth/login`, { username: a.username, password: a.password })).status, 429);
    await s.query('DELETE FROM auth_attempts');
    await s.query('DELETE FROM auth_attempts');
    const ok = await s.newAdmin('admin');
    for (let i = 0; i < 35; i += 1) assert.equal((await new Client(s.base).post(`${A}/auth/login`, { username: ok.username, password: ok.password })).status, 200);
    const boss = await s.adminClient();
    const staff = await s.adminClient('training_staff');
    const upd = (x, status) => boss.put(`${A}/users/${x.id}`, { displayName: 'x', roleId: x.roleId, status });
    assert.equal((await upd(staff.admin, 'disabled')).status, 200);
    assert.equal((await staff.get(`${A}/auth/me`)).status, 401);
    await s.query("UPDATE admin_users SET status='disabled' WHERE id <> :id", { id: boss.admin.id });
    assert.equal(code(await upd(boss.admin, 'disabled')), 'LAST_SUPER_ADMIN');
  });
  test('ค้นหาด้วยเลขบัตร, wildcard ไม่หลุด, export เป็น xlsx', async () => {
    const admin = await s.adminClient();
    const r = await s.apply({ sessionId: await s.newSession() });
    const found = (await admin.get(`${A}/applications?q=${r.fields.nationalId}`)).body;
    assert.deepEqual(found.data.map((x) => x.id), [r.body.data.id]);
    const thai = await s.apply({ sessionId: await s.newSession(), fullName: 'กัญญารัตน์ ค้นหาไทย' });
    assert.deepEqual((await admin.get(`${A}/applications?q=${encodeURIComponent('ค้นหาไทย')}`)).body.data?.map((x) => x.id), [thai.body.data.id]);
    assert.deepEqual((await admin.get(`${A}/applications?q=${thai.body.data.applicationNo.toLowerCase()}`)).body.data.map((x) => x.id), [thai.body.data.id]);
    assert.equal((await admin.get(`${A}/applications?q=${encodeURIComponent("%' OR 1=1 --")}`)).body.meta.total, 0);
    const x = await admin.get(`${A}/applications/export`);
    assert.equal(x.status, 200);
    assert.equal(x.buffer.subarray(0, 2).toString(), 'PK');
    const dash = (await admin.get(`${A}/dashboard`)).body.data;
    assert.ok(dash.total > 0 && dash.today > 0 && dash.daily.length > 0);
  });
  test('ตัวเลือกฟอร์มข้อ 1, 2, 11: เพิ่ม ปิด ลบ มีผลกับฟอร์มทันที และลบรายการที่ใช้อยู่ไม่ได้', async () => {
    const admin = await s.adminClient();
    const pub = new Client(s.base);
    const C = `${A}/catalog`;
    const name = `ม.ตัวเลือก ${crypto.randomUUID()}`;
    const names = async () => (await pub.get('/api/v1/catalog/universities')).body.data.map((u) => u.name);
    const uid = (await admin.post(`${C}/universities`, { name })).body.data.id;
    assert.ok((await names()).includes(name));
    await admin.put(`${C}/universities/${uid}`, { name, isActive: false });
    assert.ok(!(await names()).includes(name));
    await admin.put(`${C}/universities/${uid}`, { name, isActive: true });
    const ses = (await admin.post(`${C}/sessions`, { courseId: 1, universityId: uid, sessionName: 'รุ่นกรอง', startsAt: '2030-01-01T02:00:00Z', endsAt: '2030-01-02T02:00:00Z', status: 'open' })).body.data.id;
    const list = async (u) => (await pub.get(`/api/v1/catalog/sessions?universityId=${u}`)).body.data.map((x) => x.id);
    assert.deepEqual(await list(uid), [ses]);
    assert.ok(!(await list(s.uni)).includes(ses));
    const rm = (c, p) => c.request('DELETE', `${C}/${p}`);
    assert.equal(code(await rm(admin, `universities/${uid}`)), 'IN_USE');
    await s.apply({ sessionId: ses, universityId: uid });
    assert.equal(code(await rm(admin, `sessions/${ses}`)), 'IN_USE');
    assert.equal(code(await rm(admin, `options/${s.option}`)), 'IN_USE');
    const tmp = (await admin.post(`${C}/options`, { label: `ชั่วคราว ${crypto.randomUUID()}` })).body.data.id;
    assert.equal((await rm(await s.adminClient('training_staff'), `options/${tmp}`)).status, 403);
    assert.equal((await rm(admin, `options/${tmp}`)).status, 200);
    assert.equal((await rm(admin, `options/${tmp}`)).status, 404);
  });
  test('ตั้งค่าและรุ่นอบรม: ตรวจข้อมูล และหน้าเว็บเห็นผล', async () => {
    const admin = await s.adminClient();
    assert.equal((await admin.put(`${A}/settings`, { contact_line_url: 'javascript:alert(1)' })).status, 400);
    assert.equal((await admin.put(`${A}/settings`, { contact_phone: '02-000-0000' })).status, 200);
    assert.equal((await new Client(s.base).get('/api/v1/catalog/site-info')).body.data.contact_phone, '02-000-0000');
    const body = { courseId: 1, universityId: s.uni, sessionName: 'รุ่นใหม่', startsAt: '2030-01-02T02:00:00Z', endsAt: '2030-01-01T02:00:00Z', capacity: 10, status: 'open' };
    assert.equal((await admin.post(`${A}/catalog/sessions`, body)).status, 400);
    assert.equal((await admin.post(`${A}/catalog/sessions`, { ...body, endsAt: '2030-01-03T02:00:00Z' })).status, 201);
    const pub = (await new Client(s.base).get(`/api/v1/catalog/sessions?universityId=${s.uni}`)).body.data;
    assert.equal(pub.find((x) => x.name === 'รุ่นใหม่').startsAt, '2030-01-02T02:00:00.000Z');
  });
});

describe('ตั้งค่า API key', () => {
  const put = (c, password, values) => c.put(`${A}/integrations`, { password, values });
  test('เข้ารหัสใน DB ไม่ส่งค่ากลับ ต้องยืนยันรหัสผ่าน และ audit ไม่มีค่า key', async () => {
    const boss = await s.adminClient();
    const secret = `sk-${crypto.randomBytes(20).toString('hex')}`;
    assert.equal(code(await put(boss, 'wrong-password', { minimax_api_key: secret })), 'WRONG_PASSWORD');
    const saved = await put(boss, boss.admin.password, { minimax_api_key: secret, minimax_model: 'MiniMax-Test', minimax_base_url: 'https://api.minimax.io/v1' });
    assert.equal(saved.status, 200);
    assert.ok(!JSON.stringify(saved.body).includes(secret));
    assert.equal(saved.body.data.fields.find((f) => f.key === 'minimax_api_key').value, `••••••••${secret.slice(-4)}`);
    for (const t of ['system_settings', 'admin_audit_logs']) assert.ok(!JSON.stringify(await s.query(`SELECT * FROM ${t}`)).includes(secret), t);
    const { getConfig } = await import('../src/services/integrationService.js');
    assert.equal((await getConfig()).minimax_api_key, secret);
    await put(boss, boss.admin.password, { minimax_api_key: '' });
    assert.equal((await getConfig()).minimax_api_key, secret);
    await put(boss, boss.admin.password, { minimax_api_key: null });
    assert.equal((await getConfig()).minimax_api_key, null);
  });
  test('เฉพาะ Super Admin, ปลายทาง MiniMax จำกัด, ค่าไม่รู้จัก/ผิดรูปแบบถูกปฏิเสธ', async () => {
    const admin = await s.adminClient('admin');
    for (const r of [admin.get(`${A}/integrations`), put(admin, admin.admin.password, {}), admin.post(`${A}/integrations/test/minimax`)]) assert.equal((await r).status, 403);
    const boss = await s.adminClient();
    for (const v of [{ minimax_base_url: 'https://evil.example/v1' }, { nope: 'x' }, { line_channel_access_token: 'has space in token value' }]) assert.equal((await put(boss, boss.admin.password, v)).status, 400);
    assert.equal((await boss.get(`${A}/audit-logs?action=integration.`)).status, 200);
  });
  test('ค่าที่ตั้งจากหน้า Admin มีผลกับ LINE Login ทันที', async () => {
    const boss = await s.adminClient();
    await put(boss, boss.admin.password, { line_login_channel_id: '9999999999' });
    const start = await new Client(s.base).get('/api/v1/auth/line/start');
    assert.equal(new URL(start.location).searchParams.get('client_id'), '9999999999');
    await put(boss, boss.admin.password, { line_login_channel_id: null });
  });
  test('ปุ่มทดสอบ: สำเร็จ / key ผิด / MiniMax ตอบ 200 แต่ผิดพลาด', async () => {
    const boss = await s.adminClient();
    const t = async (name) => (await boss.post(`${A}/integrations/test/${name}`)).body.data;
    assert.equal((await t('line_messaging')).ok, false);
    await put(boss, boss.admin.password, { line_channel_access_token: 'good-token-1234567890', minimax_api_key: 'good-key-1234567890', minimax_model: 'MiniMax-Test' });
    assert.equal((await t('line_messaging')).ok, true);
    assert.equal((await t('minimax')).ok, true);
    await put(boss, boss.admin.password, { line_channel_access_token: 'bad-token-12345678901', minimax_api_key: 'bad-key-12345678901' });
    assert.equal((await t('line_messaging')).ok, false);
    assert.equal((await t('minimax')).ok, false);
  });
});

describe('อีเมลยืนยันการสมัคร', () => {
  const until = async (fn) => { for (let i = 0; i < 60; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };
  const decode = (raw) => raw.split(/Content-Transfer-Encoding: base64\r\n\r\n/i).slice(1).map((p) => Buffer.from(p.split('--')[0].replace(/\s/g, ''), 'base64').toString()).join('\n') + raw.replace(/=\r\n/g, '').replace(/((?:=[0-9A-F]{2})+)/g, (m) => Buffer.from(m.replace(/=/g, ''), 'hex').toString());
  const row = async (id) => (await s.query('SELECT * FROM email_queue WHERE application_id = :id ORDER BY id', { id }));
  const run = () => new Client(s.base).post('/api/v1/internal/jobs/run', {}, { headers: { 'x-jobs-secret': process.env.JOBS_SECRET } });
  test('ส่งครั้งเดียวหลังสมัคร ปิดบังเลขบัตร/เบอร์ และข้อความผู้สมัครไม่กลายเป็น HTML หรือลิงก์', async () => {
    const f = s.applicationForm({ sessionId: await s.newSession(), email: `a${Date.now()}@example.com`, shopName: '<b>x</b> http://evil.com' });
    const go = () => new Client(s.base).request('POST', '/api/v1/applications', { form: f.form() });
    const r = await go();
    assert.equal(r.body.data.emailEnabled, true);
    const mine = () => s.smtp.mails.filter((m) => m.to === f.fields.email);
    await until(() => mine().length);
    await go(); // กดซ้ำ key เดิม
    await run();
    await new Promise((x) => setTimeout(x, 200));
    assert.equal(mine().length, 1);
    const body = decode(mine()[0].raw);
    assert.ok(body.includes(r.body.data.applicationNo));
    assert.ok(body.includes('/tracking.html'));
    for (const bad of [f.fields.nationalId, f.fields.mobile, 'evil.com']) assert.ok(!body.includes(bad), bad);
    const html = body.slice(body.indexOf('<!doctype html>'));
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;') && !html.includes('<b>x</b>'));
    assert.equal((await row(r.body.data.id))[0].status, 'sent');
  });
  test('SMTP ล่มชั่วคราว: ใบสมัครยังสำเร็จ แล้วส่งซ้ำเองภายหลัง; ที่อยู่ผิดถาวรไม่ส่งวน', async () => {
    s.smtp.mode = 'temp';
    const r = await s.apply({ sessionId: await s.newSession(), email: `b${Date.now()}@example.com` });
    assert.equal(r.status, 201);
    const id = r.body.data.id;
    await until(async () => (await row(id))[0].retry_count === 1 && (await row(id))[0].status === 'pending');
    s.smtp.mode = 'ok';
    await s.query('UPDATE email_queue SET next_attempt_at = UTC_TIMESTAMP() WHERE application_id = :id', { id });
    await Promise.all([run(), run()]);
    await until(async () => (await row(id))[0].status === 'sent');
    assert.equal(s.smtp.mails.filter((m) => m.to === r.fields.email).length, 1);
    s.smtp.mode = 'perm';
    const bad = await s.apply({ sessionId: await s.newSession() });
    await until(async () => (await row(bad.body.data.id))[0].status === 'failed');
    s.smtp.mode = 'ok';
  });
  test('เจ้าหน้าที่ส่งซ้ำได้ จำกัด 3 ครั้ง/ชม. และต้องมีสิทธิ์', async () => {
    const r = await s.apply({ sessionId: await s.newSession() });
    const id = r.body.data.id;
    const boss = await s.adminClient();
    const url = `${A}/applications/${id}/resend-email`;
    assert.equal((await (await s.adminClient('attendance_staff')).post(url)).status, 403);
    assert.equal((await boss.post(url)).status, 200);
    assert.equal((await boss.post(url)).status, 200);
    assert.equal((await boss.post(url)).status, 429);
    await until(async () => (await row(id)).every((x) => x.status === 'sent'));
    assert.equal((await boss.post(`${A}/integrations/test/email`)).body.data.ok, true);
  });
});

describe('คลังความรู้ AI', () => {
  const K = '/api/v1/ai';
  const entry = (over = {}) => ({ title: 'เอกสารที่ใช้', content: `ต้องแนบบัตรประชาชนและสลิปโอนเงิน ${crypto.randomUUID()}`, category: 'เอกสารที่ใช้', keywords: 'แนบ', status: 'published', priority: 0, ...over });
  const up = (c, buf, name) => { const fd = new FormData(); fd.append('category', 'FAQ'); fd.append('file', new Blob([buf]), name); return c.request('POST', `${K}/documents`, { form: fd }); };
  const ask = async (c, question) => (await c.post(`${K}/chat`, { question })).body.data;
  test('อัปโหลดเป็นร่าง อ่านข้อความได้ กันไฟล์ปลอม/ซ้ำ/ไม่ใช่ UTF-8 และต้องมีสิทธิ์', async () => {
    const c = await s.adminClient();
    const txt = Buffer.from(`ระเบียบการอบรม ผู้เข้าอบรมต้องมาก่อนเวลา ${crypto.randomUUID()}`);
    const r = await up(c, txt, 'ระเบียบ.txt');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const k = (await c.get(`${K}/knowledge/${r.body.data.id}`)).body.data;
    assert.equal(k.status, 'draft');
    assert.ok(k.content.includes('มาก่อนเวลา'));
    assert.equal(code(await up(c, txt, 'b.txt')), 'DUPLICATE');
    for (const [b, n] of [[txt, 'x.pdf'], [txt, 'x.docx'], [txt, 'x.exe'], [Buffer.from([0xff, 0xfe, 0xd8, 0, 1, 2, 3, 4, 5, 6, 7, 8]), 'x.txt'], [Buffer.from('สั้น'), 'x.txt']]) assert.equal(code(await up(c, b, n)), 'INVALID_FILE', n);
    const n = await s.countFiles();
    assert.equal((await c.request('DELETE', `${K}/knowledge/${r.body.data.id}`)).status, 200);
    assert.equal(await s.countFiles(), n - 1);
    assert.equal((await (await s.adminClient('training_staff')).get(`${K}/knowledge`)).status, 403);
    assert.equal((await new Client(s.base).post(`${K}/chat`, { question: 'ทดสอบ' })).status, 401);
  });
  test('อ่าน PDF และ DOCX จริงได้', async () => {
    const c = await s.adminClient();
    const pdfText = 'Training handbook for pesticide sales controller';
    const stream = `BT /F1 12 Tf 20 100 Td (${pdfText}) Tj ET`;
    const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`);
    const r = await up(c, pdf, 'handbook.pdf');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok((await c.get(`${K}/knowledge/${r.body.data.id}`)).body.data.content.includes('pesticide sales'));
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>คู่มือการอบรมผู้ควบคุมการขายภาษาไทย</w:t></w:r></w:p></w:body></w:document>');
    const d = await up(c, await zip.generateAsync({ type: 'nodebuffer' }), 'คู่มือ.docx');
    assert.equal(d.status, 201, JSON.stringify(d.body));
    assert.ok((await c.get(`${K}/knowledge/${d.body.data.id}`)).body.data.content.includes('ผู้ควบคุมการขายภาษาไทย'));
  });
  test('ตอบเฉพาะจากแหล่งที่เผยแพร่: ไม่อ้างอิง/อ้างมั่ว/แต่งตัวเลข/ถูกตัด = ไม่ตอบ', async () => {
    const c = await s.adminClient();
    const boss = c.admin.password;
    await c.put(`${A}/integrations`, { password: boss, values: { minimax_api_key: 'good-key-1234567890', minimax_model: 'MiniMax-Test' } });
    const draft = await c.post(`${K}/knowledge`, entry({ status: 'draft', content: 'ยูนิคอร์นสีรุ้งพันธุ์พิเศษ' }));
    assert.equal((await ask(c, 'ยูนิคอร์น')).mode, 'fallback');
    const body = entry({ status: 'published', content: 'ยูนิคอร์นสีรุ้งพันธุ์พิเศษ ราคา 500 บาท' });
    assert.equal((await c.put(`${K}/knowledge/${draft.body.data.id}`, body)).status, 200);
    const cases = [['ราคา 500 บาท [1]', 'answer'], ['ราคา ๕๐๐ บาท [1]', 'answer'], ['<think>ลองคิด</think>ราคา 500 บาท [1]', 'answer'], ['ราคา 900 บาท [1]', 'fallback'], ['ราคา 500 บาท', 'fallback'], ['ราคา 500 บาท [9]', 'fallback'], ['NO_ANSWER', 'fallback']];
    for (const [reply, mode] of cases) { s.line.aiReply = reply; assert.equal((await ask(c, 'ยูนิคอร์นราคาเท่าไร')).mode, mode, reply); }
    s.line.aiReply = 'ราคา 500 บาท [1]'; s.line.aiFinish = 'length';
    assert.equal((await ask(c, 'ยูนิคอร์นราคาเท่าไร')).mode, 'error');
    s.line.aiFinish = null;
    const r = await ask(c, 'ยูนิคอร์นราคาเท่าไร');
    assert.ok(!r.answer.includes('[') && r.sources.length === 1);
  });
  test('ไฟล์ตั้งต้นค้นเจอหัวข้อที่ถูกต้องเป็นอันดับแรก', async () => {
    const { buildIndex, chunkText } = await import('../src/utils/knowledgeText.js');
    const dir = path.join(import.meta.dirname, '../../knowledge');
    const chunks = [];
    for (const f of (await fs.readdir(dir)).filter((x) => /^\d/.test(x))) {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      const body = raw.replace(/^(หมวด|คำค้น):.*\n/gm, '').trim();
      for (const text of chunkText(body)) chunks.push({ file: f, title: body.match(/^# (.+)$/m)[1], keywords: raw.match(/^คำค้น:(.+)$/m)[1], text });
    }
    const search = buildIndex(chunks);
    for (const [q, file] of [['ต้องใช้เอกสารอะไรบ้าง', '02'], ['แนบไฟล์แบบไหนได้', '02'], ['สมัครยังไง', '01'], ['ขั้นตอนการลงทะเบียน', '01'], ['ลืมเลขที่ใบสมัคร', '03'], ['ติดตามสถานะยังไง', '03'], ['ยกเลิกผูกไลน์', '04'], ['เชื่อมบัญชี LINE ทำอย่างไร', '04']]) {
      const top = search(q)[0];
      assert.ok(top?.file.startsWith(file), `${q} -> ${top?.file}`);
    }
  });
  test('ไม่ส่งข้อมูลส่วนบุคคลให้ MiniMax และไม่ตอบสถานะส่วนตัว; ตารางอบรมมาจากฐานข้อมูลจริง', async () => {
    const c = await s.adminClient();
    await c.put(`${A}/integrations`, { password: c.admin.password, values: { minimax_api_key: 'good-key-1234567890', minimax_model: 'MiniMax-Test' } });
    s.line.aiReply = 'NO_ANSWER'; s.line.aiRequests.length = 0;
    const nid = thaiId();
    await ask(c, `กำหนดการอบรมรุ่นไหนเปิดรับ เลขบัตร ${nid} โทร 081-234-5678 เมล a.b@example.com ET69-ABCDEFGH`);
    assert.equal(s.line.aiRequests.length, 1);
    for (const x of [nid, '081-234-5678', 'a.b@example.com', 'ET69-ABCDEFGH']) assert.ok(!s.line.aiRequests[0].includes(x), x);
    assert.ok(s.line.aiRequests[0].includes('รุ่นทดสอบ'));
    for (const q of ['สถานะการสมัครของฉัน', 'ผมผ่านหรือยัง', 'เช็คสถานะใบสมัคร']) assert.equal((await ask(c, q)).mode, 'personal', q);
    assert.equal(s.line.aiRequests.length, 1);
    s.line.aiReply = null;
  });
});

describe('กฎหมายและความยินยอม', () => {
  const full = { controller_name: 'หน่วยงานทดสอบ', controller_address: 'ที่อยู่', controller_contact: 'โทร', dpo_contact: '', basis_main: 'contract', recipients: 'มหาวิทยาลัย', retention_applications: 60, retention_documents: 12, retention_rejected: 6, retention_logs: 90, retention_chats: 12, refund_policy: 'นโยบาย', copyright_owner: 'เจ้าของ', effective_date: '2026-12-01', approved: true };
  test('เผยแพร่ได้เมื่อครบ, เปลี่ยนข้อความแล้วผู้สมัครต้องอ่านใหม่, เก็บหลักฐานแต่ละฉบับ', async () => {
    const admin = await s.adminClient();
    assert.equal((await (await s.adminClient('training_staff')).put(`${A}/legal`, full)).status, 403);
    assert.equal(code(await admin.put(`${A}/legal`, { ...full, controller_name: '' })), 'LEGAL_INCOMPLETE');
    const pub = await admin.put(`${A}/legal`, full);
    assert.equal(pub.body.data.approved, true);
    assert.match(pub.body.data.version, /^2026-12-01-[0-9a-f]{8}$/);
    assert.equal(code(await s.apply({ sessionId: await s.newSession() })), 'PRIVACY_CHANGED');
    await s.refreshVersion();
    assert.equal((await s.apply({ sessionId: await s.newSession() })).status, 201);
    assert.equal((await s.query('SELECT COUNT(*) n FROM legal_versions WHERE version = :v', { v: pub.body.data.version }))[0].n, 1);
    const draft = await admin.put(`${A}/legal`, { ...full, refund_policy: 'ใหม่', approved: false });
    assert.ok(draft.body.data.version.startsWith('draft-') && draft.body.data.version.length <= 30);
    await s.refreshVersion();
  });
  test('ความยินยอมข้อมูลอ่อนไหวไม่บังคับ แยกบันทึก และถอนเองได้เฉพาะใบของตน', async () => {
    const sessionId = await s.newSession();
    const no = await s.apply({ sessionId });
    assert.equal(no.body.data.canWithdrawSensitive, false);
    const yes = await s.apply({ sessionId, sensitiveConsent: 'yes' });
    assert.equal(yes.body.data.canWithdrawSensitive, true);
    const url = `/api/v1/applications/me/${yes.body.data.id}/withdraw-consent`;
    assert.equal((await no.client.post(url)).status, 404);
    const w = await yes.client.post(url);
    assert.equal(w.status, 200);
    assert.equal(w.body.data.canWithdrawSensitive, false);
    assert.equal(code(await yes.client.post(url)), 'NOTHING_TO_WITHDRAW');
    const d = (await (await s.adminClient()).get(`${A}/applications/${yes.body.data.id}`)).body.data;
    assert.ok(d.consents.find((c) => c.purpose === 'sensitive_id_card').withdrawn_at);
  });
  test('ทุกช่องในหน้ากฎหมายมีข้อมูลจริงรองรับ', async () => {
    const { LEGAL_FIELDS } = await import('../src/services/legalService.js');
    for (const f of ['privacy.html', 'policy.html']) {
      const html = await fs.readFile(path.join(import.meta.dirname, '../../frontend', f), 'utf8');
      for (const [, k] of html.matchAll(/data-legal="([^"]+)"/g)) assert.ok(k === 'version' || k === 'basis_text' || k in LEGAL_FIELDS, k);
    }
  });
});

describe('ลบข้อมูล', () => {
  const R = `${A}/retention`;
  const LEGAL = { controller_name: 'ก', controller_address: 'ก', controller_contact: 'ก', dpo_contact: '', basis_main: 'contract', recipients: 'ก', retention_applications: 60, retention_documents: 12, retention_rejected: 6, retention_logs: 90, retention_chats: 12, refund_policy: 'ก', copyright_owner: 'ก', effective_date: '2026-12-01', approved: true };
  const publish = async (admin, over = {}) => { const r = await admin.put(`${A}/legal`, { ...LEGAL, ...over }); await s.refreshVersion(); return r; };
  const purge = (admin, kind, ids, over = {}) => admin.post(`${R}/purge`, { kind, ids, password: admin.admin.password, confirm: 'ลบถาวร', ...over });
  const ended = (sessionId, months) => s.query('UPDATE training_sessions SET ends_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL :months MONTH) WHERE id = :sessionId', { sessionId, months });
  const until = async (fn) => { for (let i = 0; i < 60; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };
  const everywhere = async (needles) => {
    const hits = [];
    for (const { t } of await s.query('SELECT TABLE_NAME t FROM information_schema.tables WHERE table_schema = DATABASE()')) {
      const dump = JSON.stringify(await s.query(`SELECT * FROM \`${t}\``));
      for (const n of needles) if (dump.includes(n)) hits.push(`${t}:${n}`);
    }
    return hits;
  };
  const unique = () => { const k = crypto.randomUUID().slice(0, 8); return { fullName: `นาม${k} สกุล${k}`, address: `บ้าน${k} กรุงเทพฯ 10110`, email: `${k}@example.com`, mobile: `08${crypto.randomInt(1e7, 9.9e7)}`, shopName: `ร้าน${k}`, shopAddress: `ที่ร้าน${k}`, receiptName: `ใบเสร็จ${k}`, receiptAddress: `ที่ใบเสร็จ${k} 10110`, lineContactId: `line${k}` }; };

  test('ครบกำหนด: ลบได้เฉพาะที่ถึงเวลา ต้องยืนยันรหัสผ่าน+ข้อความ และข้อมูลหายจากทุกตารางกับดิสก์', async () => {
    const admin = await s.adminClient();
    await publish(admin, { approved: false });
    assert.equal((await admin.get(`${R}/summary`)).body.data.counts.applications, null);
    assert.equal(code(await purge(admin, 'applications', [1])), 'RETENTION_NOT_READY');
    await publish(admin);
    const sessionId = await s.newSession();
    const me = unique();
    const c = new Client(s.base);
    await s.lineLogin(c, `U-purge-${me.lineContactId}`);
    const before = await s.countFiles();
    const r = await s.apply({ sessionId, ...me }, c);
    const other = await s.apply({ sessionId: await s.newSession() });
    const { id, applicationNo } = r.body.data;
    await approveAllDocs(admin, id);
    await move(admin, id, 'under_review', 'documents_approved'); // สร้างลิงก์ LINE กับบุคคล
    await until(async () => (await s.query('SELECT status FROM email_queue WHERE application_id = :id', { id }))[0]?.status === 'sent');
    assert.equal((await purge(admin, 'applications', [id])).body.data.purged, 0);
    await ended(sessionId, 61);
    assert.ok((await admin.get(`${R}/due/applications?pageSize=100`)).body.data.some((x) => x.id === id));
    assert.equal(code(await purge(admin, 'applications', [id], { confirm: 'ลบ' })), 'CONFIRM_REQUIRED');
    assert.equal(code(await purge(admin, 'applications', [id], { password: 'wrong' })), 'WRONG_PASSWORD');
    const done = await purge(admin, 'applications', [id, other.body.data.id]);
    assert.deepEqual(done.body.data, { purged: 1, skipped: 1 });
    assert.deepEqual(await everywhere([...Object.values(me), applicationNo, `U-purge-${me.lineContactId}`]), []);
    assert.equal(await s.countFiles(), before + 3); // เหลือเฉพาะของ other
    for (const t of ['applications', 'consents', 'application_documents', 'application_status_history']) assert.equal((await s.query(`SELECT COUNT(*) n FROM ${t} WHERE ${t === 'applications' ? 'id' : 'application_id'} = :id`, { id }))[0].n, 0, t);
    assert.equal((await c.get('/api/v1/applications/me/status')).status, 401);
    assert.equal((await admin.get(`${A}/applications/${id}`)).status, 404);
    assert.equal((await admin.get(`${R}/log`)).body.data[0].kind, 'applications');
    const ledger = await fs.readFile(path.join(s.storage, 'purge-ledger.jsonl'), 'utf8');
    assert.ok(ledger.length > 0 && !ledger.includes(applicationNo));
  });

  test('บุคคลที่มีหลายใบ: ลบใบหนึ่ง อีกใบและข้อมูลบุคคลยังอยู่', async () => {
    const admin = await s.adminClient();
    const [a, b] = [await s.newSession(), await s.newSession()];
    const nationalId = thaiId();
    const first = await s.apply({ sessionId: a, nationalId });
    const second = await s.apply({ sessionId: b, nationalId });
    await ended(a, 61);
    assert.equal((await purge(admin, 'applications', [first.body.data.id])).body.data.purged, 1);
    const left = await admin.get(`${A}/applications/${second.body.data.id}`);
    assert.equal(left.status, 200);
    assert.equal((await admin.post(`${A}/applications/${second.body.data.id}/reveal-ids`)).body.data.nationalId, nationalId);
  });

  test('ลบเฉพาะเอกสาร, ใบไม่ผ่าน, การระงับการลบ', async () => {
    const admin = await s.adminClient();
    const sessionId = await s.newSession();
    const r = await s.apply({ sessionId });
    const id = r.body.data.id;
    await ended(sessionId, 13);
    assert.equal((await admin.post(`${A}/applications/${id}/hold`, { reason: 'ข้อพิพาท' })).body.data.hold.reason, 'ข้อพิพาท');
    assert.equal((await purge(admin, 'documents', [id])).body.data.purged, 0);
    await admin.post(`${A}/applications/${id}/hold`, { reason: null });
    const n = await s.countFiles();
    assert.equal((await purge(admin, 'documents', [id])).body.data.purged, 1);
    assert.equal(await s.countFiles(), n - 3);
    const d = (await admin.get(`${A}/applications/${id}`)).body.data;
    assert.ok(d.documents.every((x) => x.purged));
    assert.equal(code(await admin.get(`${A}/applications/${id}/documents/${d.documents[0].id}`)), 'FILE_PURGED');
    const rej = await s.apply({ sessionId: await s.newSession() });
    await move(admin, rej.body.data.id, 'submitted', 'rejected', 'ไม่ตรงคุณสมบัติ');
    assert.equal((await purge(admin, 'rejected', [rej.body.data.id])).body.data.purged, 0);
    await s.query('UPDATE application_status_history SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 MONTH) WHERE application_id = :id', { id: rej.body.data.id });
    assert.equal((await purge(admin, 'rejected', [rej.body.data.id])).body.data.purged, 1);
  });

  test('ถอนความยินยอม: ลบเฉพาะภาพบัตร แล้วให้ผู้สมัครส่งใหม่ได้', async () => {
    const admin = await s.adminClient();
    const r = await s.apply({ sessionId: await s.newSession(), sensitiveConsent: 'yes' });
    const id = r.body.data.id;
    assert.equal((await purge(admin, 'withdrawn', [id])).body.data.purged, 0);
    await r.client.post(`/api/v1/applications/me/${id}/withdraw-consent`);
    const n = await s.countFiles();
    assert.equal((await purge(admin, 'withdrawn', [id])).body.data.purged, 1);
    assert.equal(await s.countFiles(), n - 1);
    const [mine] = (await r.client.get('/api/v1/applications/me/status')).body.data;
    assert.equal(mine.status, 'documents_incomplete');
    assert.equal(mine.documents.find((x) => x.type === 'id_card').canReplace, true);
    const fd = new FormData(); fd.append('id_card', new Blob([PNG]), 'n.png');
    assert.equal((await r.client.request('POST', `/api/v1/applications/me/${id}/documents`, { form: fd })).body.data.status, 'under_review');
    assert.equal((await purge(admin, 'withdrawn', [id])).body.data.purged, 0); // ภาพใหม่ไม่ถูกลบ
  });

  test('คำขอลบ: 90 วัน, ซ้ำไม่ได้, ยกเลิกได้, ปฏิเสธพร้อมเหตุผล, อนุมัติแล้วลบและอีเมลแจ้งผล', async () => {
    const admin = await s.adminClient();
    const me = unique();
    const r = await s.apply({ sessionId: await s.newSession(), ...me });
    const id = r.body.data.id;
    const url = `/api/v1/applications/me/${id}/erasure-request`;
    const stranger = await s.apply({ sessionId: await s.newSession() });
    assert.equal((await stranger.client.post(url, {})).status, 404);
    const q = await r.client.post(url, { note: 'ไม่สะดวก' });
    assert.equal(q.body.data.erasure.status, 'pending');
    assert.equal(Math.round((new Date(q.body.data.erasure.dueAt) - Date.now()) / 86_400_000), 90);
    assert.equal(code(await r.client.post(url, {})), 'REQUEST_EXISTS');
    assert.equal((await r.client.post(`${url}/cancel`)).body.data.erasure, null);
    await r.client.post(url, {});
    const find = async () => (await admin.get(`${R}/requests?pageSize=100`)).body.data.find((x) => x.application_id === id && x.status === 'pending');
    const decide = async (over) => admin.post(`${R}/requests/${(await find()).id}/decide`, { password: admin.admin.password, confirm: 'ลบถาวร', ...over });
    assert.equal(code(await decide({ decision: 'rejected' })), 'REASON_REQUIRED');
    assert.equal((await decide({ decision: 'rejected', reason: 'ต้องเก็บตามกฎหมาย' })).status, 200);
    await until(() => s.smtp.mails.filter((m) => m.to === me.email).length === 2);
    assert.equal((await r.client.get('/api/v1/applications/me/status')).body.data[0].erasure.status, 'rejected');
    await r.client.post(url, { note: `โปรดลบ ${me.shopName}` });
    await admin.post(`${A}/applications/${id}/hold`, { reason: 'ข้อพิพาท' });
    assert.equal(code(await decide({ decision: 'approved' })), 'ON_HOLD');
    await admin.post(`${A}/applications/${id}/hold`, { reason: null });
    assert.equal(code(await decide({ decision: 'approved', confirm: '' })), 'CONFIRM_REQUIRED');
    s.smtp.mode = 'perm';
    const reqId = (await find()).id;
    assert.equal((await decide({ decision: 'approved' })).status, 200);
    await until(async () => (await admin.get(`${R}/requests?pageSize=100`)).body.data.find((x) => x.id === reqId).email_status === 'failed');
    s.smtp.mode = 'ok';
    assert.equal((await admin.post(`${R}/requests/${reqId}/notice`, { action: 'retry' })).status, 200);
    await until(() => s.smtp.mails.filter((m) => m.to === me.email).length === 3);
    await until(async () => (await admin.get(`${R}/requests?pageSize=100`)).body.data.find((x) => x.id === reqId).email_status === 'sent');
    assert.deepEqual(await everywhere([...Object.values(me), r.body.data.applicationNo]), []);
    assert.equal((await s.query('SELECT COUNT(*) n FROM email_queue WHERE status = :st AND recipient_enc IS NOT NULL', { st: 'sent' }))[0].n, 0);
  });

  test('กู้คืนข้อมูลสำรอง: รายการที่เคยลบถูกลบซ้ำ แม้ประวัติใน DB หายไป และรายการใหม่ไม่โดน', async () => {
    const { reapply, syncLedger } = await import('../src/services/retentionService.js');
    const admin = await s.adminClient();
    const sessionId = await s.newSession();
    const r = await s.apply({ sessionId });
    const id = r.body.data.id;
    const [row] = await s.query('SELECT * FROM applications WHERE id = :id', { id });
    const [person] = await s.query('SELECT * FROM applicants WHERE id = :id', { id: row.applicant_id });
    await ended(sessionId, 61);
    await purge(admin, 'applications', [id]);
    // จำลองการกู้ DB ย้อนหลัง: แถวเดิมกลับมา และ purge_log หาย
    const put = (t, o) => { const k = Object.keys(o).filter((x) => x !== 'active_flag'); return s.query(`INSERT INTO ${t} (${k.join(',')}) VALUES (${k.map((x) => `:${x}`).join(',')})`, o); };
    await put('applicants', person);
    await put('applications', row);
    await s.query('DELETE FROM purge_log');
    await syncLedger();
    const fresh = await s.apply({ sessionId: await s.newSession() });
    const result = await reapply();
    assert.equal(result.purged, 1);
    assert.equal((await s.query('SELECT COUNT(*) n FROM applications WHERE id = :id', { id }))[0].n, 0);
    assert.equal((await s.query('SELECT COUNT(*) n FROM applications WHERE id = :id', { id: fresh.body.data.id }))[0].n, 1);
    assert.equal((await reapply()).purged, 0);
  });

  test('สิทธิ์: เฉพาะ Super Admin; บันทึกเก่าและ LINE ที่ไม่ใช้; ลบพร้อมกันไม่ซ้ำ', async () => {
    const staff = await s.adminClient('admin');
    for (const q of [staff.get(`${R}/summary`), purge(staff, 'applications', [1]), staff.get(`${R}/requests`), staff.post(`${A}/applications/1/hold`, { reason: 'x' })]) assert.equal((await q).status, 403);
    const admin = await s.adminClient();
    await s.query("INSERT INTO admin_audit_logs (action, created_at) VALUES ('old.one', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 91 DAY)), ('new.one', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 89 DAY))");
    assert.equal((await purge(admin, 'logs', [])).body.data.purged, 1);
    assert.equal((await s.query("SELECT COUNT(*) n FROM admin_audit_logs WHERE action = 'new.one'"))[0].n, 1);
    await s.query("INSERT INTO line_users (line_user_id, display_name, last_interaction_at) VALUES ('U-stale', 'เก่า', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 MONTH))");
    const [l] = await s.query("SELECT id FROM line_users WHERE line_user_id = 'U-stale'");
    assert.equal((await purge(admin, 'line_users', [l.id])).body.data.purged, 1);
    const sessionId = await s.newSession();
    const r = await s.apply({ sessionId });
    await ended(sessionId, 61);
    const both = await Promise.all([purge(admin, 'applications', [r.body.data.id]), purge(admin, 'applications', [r.body.data.id])]);
    assert.equal(both.reduce((t, x) => t + x.body.data.purged, 0), 1);
  });
});

describe('รวมแชต LINE OA', () => {
  const C = `${A}/chat`;
  let admin; let n = 0;
  const until = async (fn) => { for (let i = 0; i < 100; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); } throw new Error('timeout'); };
  const sign = (raw) => crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(raw).digest('base64');
  const hook = (events, { raw = JSON.stringify({ destination: 'x', events }), signature = sign(raw) } = {}) => fetch(`${s.base}/api/v1/line/webhook`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...(signature ? { 'x-line-signature': signature } : {}) } });
  const ev = (uid, message, over = {}) => ({ type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: crypto.randomUUID(), source: { type: 'user', userId: uid }, replyToken: crypto.randomUUID(), message: { id: String(1e6 + (n += 1)), ...message }, ...over });
  const say = async (uid, text, over) => { const e = ev(uid, { type: 'text', text }, over); assert.equal((await hook([e])).status, 200); await settled(); return e; };
  const settled = () => until(async () => !(await s.query("SELECT 1 FROM line_webhook_events WHERE status IN ('pending','processing') LIMIT 1")).length);
  const conv = async (uid) => (await s.query('SELECT c.* FROM chat_conversations c JOIN line_users l ON l.id = c.line_user_id WHERE l.line_user_id = :uid', { uid }))[0];
  const sentTo = (mark) => s.line.chat.sent.filter((x) => JSON.stringify(x).includes(mark));
  const uid = () => `U${crypto.randomUUID().replaceAll('-', '')}`;
  const msgs = async (id) => (await admin.get(`${C}/${id}/messages`)).body.data.items;
  const send = (id, text, clientId = crypto.randomUUID(), c = admin) => c.post(`${C}/${id}/messages`, { text, clientId });
  before(async () => { admin = await s.adminClient(); });
  const aiOn = async () => {
    await admin.put(`${A}/integrations`, { password: admin.admin.password, values: { minimax_api_key: 'good-key-1234567890', minimax_model: 'MiniMax-Test' } });
    assert.equal((await admin.put(`${C}/ai`, { enabled: true })).status, 200);
    await admin.post('/api/v1/ai/knowledge', { title: 'มังกร', content: `มังกรทองราคา 700 บาท ${crypto.randomUUID()}`, category: 'FAQ', keywords: 'มังกร', status: 'published', priority: 0 });
    s.line.aiReply = 'มังกรราคา 700 บาท [1]';
  };
  const aiOff = async () => { await admin.put(`${C}/ai`, { enabled: false }); s.line.aiReply = null; };

  test('webhook: ต้องมีลายเซ็นถูกต้องจาก raw body, ปุ่ม Verify ได้ 200, ซ้ำไม่บันทึกซ้ำ, ไม่รับกลุ่ม', async () => {
    const u = uid();
    const e = ev(u, { type: 'text', text: 'สวัสดี' });
    assert.equal((await hook([e], { signature: 'bad' })).status, 401);
    assert.equal((await hook([e], { signature: null })).status, 401);
    assert.equal((await hook([e], { raw: `${JSON.stringify({ destination: 'x', events: [e] })} `, signature: sign(JSON.stringify({ destination: 'x', events: [e] })) })).status, 401);
    assert.equal((await hook([])).status, 200);
    assert.equal(await conv(u), undefined);
    await Promise.all([hook([e]), hook([{ ...e, deliveryContext: { isRedelivery: true } }]), hook([e, e])]);
    await settled();
    assert.equal((await conv(u)).message_count, 1);
    assert.equal((await hook([ev(u, { type: 'text', text: 'x' }, { source: { type: 'group', groupId: 'G', userId: u } })])).status, 200);
    await settled();
    assert.equal((await conv(u)).message_count, 1);
    const raw = JSON.stringify(await s.query('SELECT * FROM chat_messages')) + JSON.stringify(await s.query('SELECT * FROM chat_conversations')) + JSON.stringify(await s.query('SELECT * FROM line_webhook_events'));
    assert.ok(!raw.includes('สวัสดี'));
  });

  test('ทุกคนที่ทักอยู่ในรายการ ค้นหา/กรอง/อ่านแล้ว และข้อความของคนเดียวกันเรียงลำดับ', async () => {
    const [a, b] = [uid(), uid()];
    await hook([ev(a, { type: 'text', text: 'หนึ่ง' }), ev(b, { type: 'text', text: 'บี' }), ev(a, { type: 'text', text: 'สอง' }), ev(a, { type: 'sticker', keywords: ['hi'] }), ev(a, { type: 'location', address: 'กรุงเทพ' })]);
    await settled();
    const ca = await conv(a);
    assert.deepEqual((await msgs(ca.id)).map((m) => m.text), ['หนึ่ง', 'สอง', '[สติกเกอร์] hi', '[ตำแหน่ง] กรุงเทพ']);
    const p = (await admin.get(`${C}/poll?filter=unread`)).body.data;
    const row = p.conversations.find((x) => x.id === ca.id);
    assert.equal(row.unread, 4);
    assert.match(row.name, /^คุณ U/);
    const same = (await admin.get(`${C}/poll?filter=unread&rev=${encodeURIComponent(p.rev)}`)).body.data;
    assert.equal(same.conversations, null);
    const last = (await msgs(ca.id)).at(-1).id;
    assert.equal((await admin.post(`${C}/${ca.id}/update`, { readUpTo: last })).body.data.unread, 0);
    assert.ok(!(await admin.get(`${C}/poll?filter=unread`)).body.data.conversations.some((x) => x.id === ca.id));
    assert.deepEqual((await admin.get(`${C}/poll?q=${encodeURIComponent(row.name)}`)).body.data.conversations.map((x) => x.id), [ca.id]);
  });

  test('เจ้าหน้าที่ตอบ: ใช้ reply token ก่อน (ครั้งเดียว) แล้ว push, กดซ้ำไม่ส่งซ้ำ, AI ของแชตนั้นหยุด', async () => {
    const u = uid();
    const e = await say(u, 'ถามหน่อย');
    const c = await conv(u);
    const id = crypto.randomUUID();
    const rs = await Promise.all([send(c.id, 'ตอบแรก-A1', id), send(c.id, 'ตอบแรก-A1', id)]);
    assert.ok(rs.every((r) => r.status === 200));
    await until(() => sentTo('ตอบแรก-A1').length === 1);
    assert.equal(sentTo('ตอบแรก-A1')[0].kind, 'reply');
    assert.equal(sentTo('ตอบแรก-A1')[0].replyToken, e.replyToken);
    const second = await send(c.id, 'ตอบสอง-A2');
    assert.equal(second.body.data.via, 'push');
    assert.equal(sentTo('ตอบสอง-A2')[0].to, u);
    const after = await conv(u);
    assert.equal(after.ai_mode, 'off');
    assert.equal(after.assigned_admin_id, admin.admin.id);
  });

  test('ส่งไม่สำเร็จ: token หมดอายุ→push, push ไม่รู้ผลแล้วส่งซ้ำไม่ซ้ำข้อความ, reply ไม่รู้ผลไม่ push เอง, โควตาหมด, ถูกบล็อก', async () => {
    const u = uid();
    await say(u, 'x');
    const c = await conv(u);
    s.line.chat.status.reply = [400];
    assert.equal((await send(c.id, 'B1')).body.data.via, 'push');
    s.line.chat.status.push = ['lost'];
    assert.equal((await send(c.id, 'B2')).body.data.status, 'sent');
    assert.equal(sentTo('B2').length, 1);
    await say(u, 'y');
    s.line.chat.status.reply = ['hang'];
    const unknown = await send(c.id, 'B3');
    assert.equal(unknown.body.data.status, 'failed');
    assert.equal(sentTo('B3').length, 0);
    const again = await admin.post(`${C}/${c.id}/messages/${unknown.body.data.id}/retry`);
    assert.equal(again.body.data.status, 'sent');
    assert.equal((await admin.post(`${C}/${c.id}/messages/${unknown.body.data.id}/retry`)).status, 409);
    const { forgetQuota } = await import('../src/integrations/lineMessagingClient.js');
    s.line.chat.used = 1000; forgetQuota();
    const q = await send(c.id, 'B4');
    assert.match(q.body.data.error, /โควตา/);
    assert.equal(sentTo('B4').length, 0);
    s.line.chat.used = 0; forgetQuota();
    await hook([{ type: 'unfollow', mode: 'active', timestamp: Date.now(), webhookEventId: crypto.randomUUID(), source: { type: 'user', userId: u } }]);
    await settled();
    assert.equal(code(await send(c.id, 'B5')), 'USER_BLOCKED');
  });

  test('AI: เปิด/ปิดทั้งระบบและรายแชต ตอบจากคลังความรู้ พร้อมป้ายผู้ช่วย AI', async () => {
    const fresh = await s.adminClient();
    await fresh.put(`${A}/integrations`, { password: fresh.admin.password, values: { minimax_api_key: null } });
    assert.equal(code(await fresh.put(`${C}/ai`, { enabled: true })), 'AI_NOT_READY');
    const u = uid();
    s.line.aiReply = 'มังกรราคา 700 บาท [1]';
    await say(u, 'มังกรราคา C0');
    assert.ok(!s.line.chat.sent.some((x) => x.messages[0].sender));
    await aiOn();
    const load = s.line.chat.loading;
    await say(u, 'มังกรราคาเท่าไร');
    const c = await conv(u);
    const ai = (await msgs(c.id)).at(-1);
    assert.equal(ai.sender, 'ai');
    assert.equal(ai.via, 'reply');
    assert.deepEqual(ai.ai.sources, ['มังกร']);
    assert.ok(s.line.chat.loading > load);
    assert.equal(s.line.chat.sent.at(-1).messages[0].sender.name, 'ผู้ช่วย AI');
    await admin.post(`${C}/${c.id}/update`, { aiMode: 'off' });
    await say(u, 'มังกรอีกครั้ง');
    assert.equal((await msgs(c.id)).at(-1).sender, 'user');
    await admin.post(`${C}/${c.id}/update`, { aiMode: 'auto' });
    await say(u, 'มังกรรอบสาม');
    assert.equal((await msgs(c.id)).at(-1).sender, 'ai');
    await aiOff();
    await say(u, 'มังกรรอบสี่');
    assert.equal((await msgs(c.id)).at(-1).sender, 'user');
  });

  test('AI ไม่รู้/ขอคุยกับคน/ข้อความเก่า/ส่งรูป → เรียกเจ้าหน้าที่ และไม่ส่ง PII ให้ MiniMax', async () => {
    await aiOn();
    const u = uid();
    s.line.aiReply = 'NO_ANSWER';
    s.line.aiRequests.length = 0;
    const nid = thaiId();
    await say(u, `มังกร เลขบัตรผม ${nid}`);
    assert.ok(s.line.aiRequests.length === 1 && !s.line.aiRequests[0].includes(nid));
    let c = await conv(u);
    assert.equal(c.attention_reason, 'AI ไม่มีข้อมูลตอบ');
    assert.ok((await admin.get(`${C}/poll?filter=attention`)).body.data.conversations.some((x) => x.id === c.id));
    s.line.aiReply = 'มังกรราคา 700 บาท [1]';
    await say(u, 'ขอคุยกับเจ้าหน้าที่');
    c = await conv(u);
    assert.equal(c.ai_mode, 'off');
    assert.equal(c.attention_reason, 'ขอคุยกับเจ้าหน้าที่');
    const count = s.line.aiRequests.length;
    await say(u, 'มังกร');
    assert.equal(s.line.aiRequests.length, count);
    await send(c.id, 'มาแล้วครับ');
    assert.equal((await conv(u)).attention_reason, null);
    await admin.post(`${C}/${c.id}/update`, { status: 'closed' });
    assert.equal((await conv(u)).ai_mode, 'auto');
    await say(u, 'มังกรหลังปิดเคส');
    c = await conv(u);
    assert.equal(c.status, 'open');
    assert.equal((await msgs(c.id)).at(-1).sender, 'ai');
    const old = uid();
    await say(old, 'มังกรเก่า', { timestamp: Date.now() - 600_000 });
    assert.equal((await msgs((await conv(old)).id)).length, 1);
    const pic = uid();
    await hook([ev(pic, { type: 'image', contentProvider: { type: 'line' } })]);
    await settled();
    assert.equal((await conv(pic)).attention_reason, 'ส่งไฟล์/รูป/สติกเกอร์');
    const standby = uid();
    const before2 = s.line.chat.sent.length;
    await say(standby, 'มังกร', { mode: 'standby', replyToken: undefined });
    assert.equal(s.line.chat.sent.length, before2);
    await aiOff();
  });

  test('แข่งกัน: เจ้าหน้าที่ตอบหรือปิด AI ระหว่าง AI กำลังคิด → คำตอบ AI ถูกทิ้ง', async () => {
    await aiOn();
    for (const action of [(id) => send(id, 'คนตอบก่อน'), (id) => admin.post(`${C}/${id}/update`, { aiMode: 'off' }), () => admin.put(`${C}/ai`, { enabled: false })]) {
      await admin.put(`${C}/ai`, { enabled: true });
      const u = uid();
      let release; let started;
      const begun = new Promise((r) => { started = r; });
      s.line.aiDelay = () => { started(); return new Promise((r) => { release = r; }); };
      await hook([ev(u, { type: 'text', text: 'มังกรช้า' })]);
      await begun;
      const c = await conv(u);
      await action(c.id);
      release();
      s.line.aiDelay = null;
      await settled();
      assert.ok(!(await msgs(c.id)).some((m) => m.sender === 'ai'));
    }
    await aiOff();
  });

  test('รูปภาพเก็บเข้ารหัสและเปิดดูได้, ยกเลิกข้อความแล้วเนื้อหาและไฟล์หาย, ไฟล์ปลอมไม่เก็บ', async () => {
    const u = uid();
    const e = ev(u, { type: 'image', contentProvider: { type: 'line' } });
    const files = await s.countFiles();
    await hook([e]); await settled();
    const c = await conv(u);
    const [m] = await msgs(c.id);
    assert.equal(m.media, 'image/png');
    assert.ok((await admin.get(`${C}/${c.id}/messages/${m.id}/media`)).buffer.equals(PNG));
    const un = (id) => hook([{ type: 'unsend', mode: 'active', timestamp: Date.now(), webhookEventId: crypto.randomUUID(), source: { type: 'user', userId: u }, unsend: { messageId: id } }]);
    await un(e.message.id); await settled();
    assert.equal((await msgs(c.id))[0].type, 'unsent');
    assert.equal((await msgs(c.id))[0].text, null);
    assert.equal(await s.countFiles(), files);
    assert.equal((await admin.get(`${C}/${c.id}/messages/${m.id}/media`)).status, 404);
    s.line.chat.content = Buffer.from('<html><script>alert(1)</script></html>');
    await hook([ev(u, { type: 'file', fileName: 'a.png' })]); await settled();
    s.line.chat.content = PNG;
    assert.equal((await msgs(c.id)).at(-1).media, null);
  });

  test('ต้อนรับเมื่อเพิ่มเพื่อน, ใบสมัครที่ผูกแสดงข้างแชต, ร่างคำตอบด้วย AI ไม่ส่งเอง', async () => {
    const u = uid();
    await hook([{ type: 'follow', mode: 'active', timestamp: Date.now(), webhookEventId: crypto.randomUUID(), source: { type: 'user', userId: u }, replyToken: crypto.randomUUID() }]);
    await settled();
    assert.equal(s.line.chat.sent.at(-1).messages[0].type, 'flex');
    const client = new Client(s.base);
    await s.lineLogin(client, u);
    const app = await s.apply({ sessionId: await s.newSession() }, client);
    const c = await conv(u);
    assert.deepEqual((await admin.get(`${C}/${c.id}`)).body.data.applications.map((x) => x.no), [app.body.data.applicationNo]);
    await aiOn(); await admin.put(`${C}/ai`, { enabled: false });
    await say(u, 'มังกรเท่าไร');
    const k = s.line.chat.sent.length;
    const draft = (await admin.post(`${C}/${c.id}/suggest`)).body.data;
    assert.equal(draft.text, 'มังกรราคา 700 บาท');
    assert.equal(s.line.chat.sent.length, k);
    await aiOff();
  });

  test('สิทธิ์: เจ้าหน้าที่เช็กชื่อเข้าไม่ได้, Training Staff ตอบได้แต่ปิด AI ทั้งระบบไม่ได้; กู้เหตุการณ์ค้าง', async () => {
    const u = uid();
    await say(u, 'ทดสอบสิทธิ์');
    const c = await conv(u);
    assert.equal((await (await s.adminClient('attendance_staff')).get(`${C}/poll`)).status, 403);
    const staff = await s.adminClient('training_staff');
    assert.equal((await send(c.id, 'จากสตาฟ', crypto.randomUUID(), staff)).status, 200);
    assert.equal((await staff.put(`${C}/ai`, { enabled: true })).status, 403);
    assert.equal((await staff.post(`${C}/${c.id}/update`, { aiMode: 'auto' })).status, 200);
    const { encryptText } = await import('../src/utils/crypto.js');
    const stuck = ev(u, { type: 'text', text: 'ค้างอยู่' });
    await s.query("INSERT INTO line_webhook_events (event_id, user_hash, payload_enc, status, claimed_at, created_at) VALUES ('stuck-1', REPEAT('a', 64), :p, 'processing', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE), UTC_TIMESTAMP())", { p: encryptText(JSON.stringify(stuck), 'webhook') });
    await new Client(s.base).post('/api/v1/internal/jobs/run', {}, { headers: { 'x-jobs-secret': process.env.JOBS_SECRET } });
    assert.equal((await msgs(c.id)).at(-1).text, 'ค้างอยู่');
  });

  test('PDPA: ลบแชตเก่า และลบแชตทั้งหมดเมื่อบุคคลถูกลบ', async () => {
    const u = uid();
    await hook([ev(u, { type: 'image', contentProvider: { type: 'line' } })]); await settled();
    await say(u, 'ใหม่');
    const c = await conv(u);
    const first = (await msgs(c.id))[0];
    await s.query('UPDATE chat_messages SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 13 MONTH) WHERE id = :id', { id: first.id });
    const files = await s.countFiles();
    const purge = (kind, ids) => admin.post(`${A}/retention/purge`, { kind, ids, password: admin.admin.password, confirm: 'ลบถาวร' });
    assert.equal((await purge('chats', [])).body.data.purged, 1);
    assert.equal(await s.countFiles(), files - 1);
    assert.deepEqual((await msgs(c.id)).map((m) => m.text), ['ใหม่']);
    await s.query('UPDATE line_users SET last_interaction_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 MONTH) WHERE line_user_id = :u', { u });
    const [l] = await s.query('SELECT id FROM line_users WHERE line_user_id = :u', { u });
    assert.equal((await purge('line_users', [l.id])).body.data.purged, 1);
    assert.equal((await s.query('SELECT COUNT(*) n FROM chat_messages WHERE conversation_id = :id', { id: c.id }))[0].n, 0);
  });
});

describe('ระบบ', () => {
  test('ไฟล์นอก frontend เข้าไม่ถึง, security headers, งานตั้งเวลาใช้ secret', async () => {
    const c = new Client(s.base);
    for (const p of ['/.env', '/package.json', '/backend/server.js', '/app.cjs', '/..%2fpackage.json', '/storage/', '/.git/config']) assert.ok([403, 404].includes((await c.get(p)).status), p);
    const h = await c.get('/api/v1/health');
    assert.equal(h.status, 200);
    assert.match(h.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(h.headers.get('x-powered-by'), null);
    assert.equal((await c.post('/api/v1/internal/jobs/run')).status, 403);
    const run = await c.post('/api/v1/internal/jobs/run', {}, { headers: { 'x-jobs-secret': process.env.JOBS_SECRET } });
    assert.equal(run.status, 200);
    assert.equal(typeof run.body.data.cleanup, 'object');
    assert.equal((await c.get('/api/v1/nope')).status, 404);
    assert.equal((await c.request('POST', `${A}/auth/login`, { form: '{bad', headers: { 'content-type': 'application/json' } })).body.meta.code, 'INVALID_JSON');
  });
});
