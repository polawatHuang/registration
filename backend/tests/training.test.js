import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { Client, PNG, startStack } from './helpers.js';

let s;
before(async () => { s = await startStack(); });
after(() => s?.stop());
const A = '/api/v1/admin';
const code = (r) => r.body?.meta?.code;

/** ใบสมัครที่พร้อมเข้าอบรมวันนี้ */
async function ready(sessionId, status = 'awaiting_training', over = {}) {
  const r = await s.apply({ sessionId, ...over });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { id } = r.body.data;
  await s.query('UPDATE applications SET status = :status WHERE id = :id', { id, status });
  return { id, client: r.client, fields: r.fields, no: r.body.data.applicationNo };
}
/** รุ่นที่รับสมัครแล้วเลื่อนให้กำลังจัดอยู่ */
const startNow = (id, days = 1) => s.query(`UPDATE training_sessions SET starts_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), ends_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :h HOUR) WHERE id = :id`, { id, h: (days - 1) * 24 + 1 });
const tokenOf = async (p) => (await p.client.get(`/api/v1/applications/me/${p.id}/qr`)).body.data.token;
const statusOf = async (id) => (await s.query('SELECT status FROM applications WHERE id = :id', { id }))[0].status;
const scan = (admin, session, token, action = 'in') => admin.post(`${A}/attendance/sessions/${session}/scan`, { token, action });
/** PNG ที่ถอดรหัสได้จริง */
function realPng() {
  const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); b.copy(out, 4); out.writeUInt32BE(zlib.crc32(b), 8 + data.length); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(3, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(3 * 13, 200))), chunk('IEND', Buffer.alloc(0))]);
}

describe('QR ประจำตัวและเช็กชื่อ', () => {
  test('QR ออกได้เมื่ออนุมัติแล้ว เห็นเฉพาะเจ้าของ ไม่มีข้อมูลบุคคล และแก้ไขไม่ได้', async () => {
    const session = await s.newSession();
    const p = await ready(session, 'under_review');
    assert.equal(code(await p.client.get(`/api/v1/applications/me/${p.id}/qr`)), 'QR_NOT_READY');
    await s.query("UPDATE applications SET status = 'approved' WHERE id = :id", { id: p.id });
    const token = await tokenOf(p);
    assert.equal(token, await tokenOf(p), 'เปิดซ้ำได้ใบเดิม');
    for (const bad of [p.fields.nationalId, p.fields.mobile, p.no]) assert.ok(!token.includes(bad));
    const svg = await p.client.get(`/api/v1/applications/me/${p.id}/qr.svg`);
    assert.match(svg.headers.get('content-type'), /svg/);
    const other = await ready(session);
    assert.equal((await other.client.get(`/api/v1/applications/me/${p.id}/qr`)).status, 404);
    assert.equal((await new Client(s.base).get(`/api/v1/applications/me/${p.id}/qr`)).status, 401);
    await startNow(session);
    const admin = await s.adminClient('attendance_staff');
    const parts = token.split('.');
    for (const t of ['', 'x', `${parts[0]}.${other.id.toString(36)}.${parts[2]}.${parts[3]}`, token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')]) {
      const r = await scan(admin, session, t);
      assert.equal(r.body.data.result, 'invalid', t);
      assert.equal(r.body.data.person, null);
    }
    const renewed = await p.client.post(`/api/v1/applications/me/${p.id}/qr/renew`);
    assert.notEqual(renewed.body.data.token, token);
    assert.equal((await scan(admin, session, token)).body.data.result, 'revoked');
    assert.equal((await scan(admin, session, renewed.body.data.token)).body.data.result, 'ok');
  });

  test('เช็กอิน → สถานะเข้าอบรมแล้ว; ซ้ำ, ข้ามรุ่น, ไม่มีสิทธิ์, นอกวัน ถูกปฏิเสธและบันทึกทุกครั้ง', async () => {
    const [session, another, future] = [await s.newSession(), await s.newSession(), await s.newSession()];
    const p = await ready(session);
    const rejected = await ready(session);
    const later = await ready(future);
    const [token, lost, futureToken] = [await tokenOf(p), await tokenOf(rejected), await tokenOf(later)];
    await s.query("UPDATE applications SET status = 'cancelled' WHERE id = :id", { id: rejected.id });
    await startNow(session); await startNow(another);
    const admin = await s.adminClient('attendance_staff');
    assert.equal((await scan(admin, another, token)).body.data.result, 'wrong_session');
    assert.equal(await statusOf(p.id), 'awaiting_training');
    assert.equal((await scan(admin, session, lost)).body.data.result, 'unauthorized');
    assert.equal((await scan(admin, future, futureToken)).body.data.result, 'wrong_day');
    assert.equal((await scan(admin, session, token, 'out')).body.data.result, 'not_in');
    const ok = await scan(admin, session, token);
    assert.equal(ok.body.data.result, 'ok');
    assert.equal(ok.body.data.person.fullName, p.fields.fullName);
    assert.equal(await statusOf(p.id), 'attended');
    const again = await scan(admin, session, token);
    assert.equal(again.body.data.result, 'already');
    assert.ok(again.body.data.at);
    const scans = (await admin.get(`${A}/attendance/sessions/${session}/scans`)).body.data;
    assert.deepEqual(scans.map((x) => x.result), ['already', 'ok', 'not_in', 'unauthorized']);
    assert.ok(scans.every((x) => x.admin_name));
    assert.equal((await s.query("SELECT COUNT(*) n FROM domain_events WHERE aggregate_id = :id AND event_type = 'application.status_changed' AND payload_json LIKE '%attended%'", { id: p.id }))[0].n, 1);
  });

  test('สแกนพร้อมกัน 8 เครื่อง บันทึกแถวเดียว', async () => {
    const session = await s.newSession();
    const p = await ready(session);
    const token = await tokenOf(p);
    await startNow(session);
    const admin = await s.adminClient('training_staff');
    const out = await Promise.all(Array.from({ length: 8 }, () => scan(admin, session, token)));
    assert.equal(out.filter((r) => r.body.data?.result === 'ok').length, 1, JSON.stringify(out.map((r) => r.body)));
    assert.equal(out.filter((r) => r.body.data?.result === 'already').length, 7);
    assert.equal((await s.query('SELECT COUNT(*) n FROM attendance_records WHERE application_id = :id', { id: p.id }))[0].n, 1);
  });

  test('เช็กชื่อเอง แก้บันทึก เกณฑ์ชั่วโมง/เช็กเอาต์ และประกาศผล', async () => {
    const session = await s.newSession();
    const p = await ready(session); const q = await ready(session);
    await startNow(session);
    await s.query('UPDATE training_sessions SET require_checkout = 1, min_minutes = 30 WHERE id = :session', { session });
    const admin = await s.adminClient('training_staff');
    const base = `${A}/attendance/sessions/${session}`;
    assert.equal((await admin.post(`${base}/people/${p.id}`, { action: 'in' })).status, 400, 'ต้องมีเหตุผล');
    const inAt = new Date(Date.now() - 40 * 60_000).toISOString();
    assert.equal((await admin.post(`${base}/people/${p.id}`, { action: 'in', note: 'กล้องเสีย', at: new Date(Date.now() + 3_600_000).toISOString() })).body.meta.code, 'BAD_TIME');
    assert.equal((await admin.post(`${base}/people/${p.id}`, { action: 'in', note: 'กล้องเสีย', at: inAt })).body.data.result, 'ok');
    let roster = (await admin.get(`${base}/roster`)).body.data;
    assert.deepEqual([roster.counts.expected, roster.counts.attended, roster.counts.ready], [2, 1, 0]);
    assert.equal(roster.items.find((x) => x.id === p.id).met, false);
    assert.deepEqual((await admin.get(`${base}/roster?filter=absent`)).body.data.items.map((x) => x.id), [q.id]);
    const early = await admin.post(`${base}/announce`, { ids: [p.id, q.id] });
    assert.equal(early.body.data.passed, 0);
    assert.equal(early.body.data.skipped.length, 2);
    assert.equal((await admin.post(`${base}/people/${p.id}`, { action: 'out', note: 'กลับบ้าน', at: new Date(Date.now() - 60 * 60_000).toISOString() })).status, 400, 'ออกก่อนเข้า');
    assert.equal((await admin.post(`${base}/people/${p.id}`, { action: 'out', note: 'กลับบ้าน' })).body.data.result, 'ok');
    const person = (await admin.get(`${base}/people/${p.id}`)).body.data;
    assert.equal(person.records.length, 1);
    assert.equal((await admin.post(`${A}/attendance/records/${person.records[0].id}/undo`, { what: 'out', reason: 'กดผิด' })).status, 200);
    assert.equal((await admin.get(`${base}/people/${p.id}`)).body.data.records[0].check_out_at, null);
    await admin.post(`${base}/people/${p.id}`, { action: 'out', note: 'กลับบ้าน' });
    roster = (await admin.get(`${base}/roster?filter=ready`)).body.data;
    assert.deepEqual(roster.items.map((x) => x.id), [p.id]);
    assert.equal((await admin.post(`${base}/announce`, { ids: [p.id] })).body.data.passed, 1);
    assert.equal(await statusOf(p.id), 'passed');
    assert.equal(code(await admin.post(`${A}/attendance/records/${person.records[0].id}/undo`, { what: 'in', reason: 'ทดสอบ' })), 'ALREADY_PASSED');
    // ให้ผ่านโดยไม่ครบเกณฑ์ ต้องมีเหตุผล และเหตุผลไม่โผล่ให้ผู้สมัครเห็น
    await admin.post(`${base}/people/${q.id}`, { action: 'in', note: 'มาสาย' });
    assert.equal((await admin.post(`${base}/announce`, { ids: [q.id], override: true })).status, 400);
    assert.equal((await admin.post(`${base}/announce`, { ids: [q.id], override: true, reason: 'เหตุผลภายใน' })).body.data.passed, 1);
    assert.ok(!(await q.client.get('/api/v1/applications/me/status')).buffer.toString().includes('เหตุผลภายใน'));
    const x = await admin.get(`${base}/export`);
    assert.equal(x.buffer.subarray(0, 2).toString(), 'PK');
  });

  test('ลบบันทึกเดียวที่มี สถานะถอยกลับเป็นรออบรม', async () => {
    const session = await s.newSession();
    const p = await ready(session);
    const token = await tokenOf(p);
    await startNow(session);
    const admin = await s.adminClient('training_staff');
    await scan(admin, session, token);
    const { records } = (await admin.get(`${A}/attendance/sessions/${session}/people/${p.id}`)).body.data;
    await admin.post(`${A}/attendance/records/${records[0].id}/undo`, { what: 'in', reason: 'สแกนผิดคน' });
    assert.equal(await statusOf(p.id), 'awaiting_training');
    assert.equal((await scan(admin, session, token)).body.data.result, 'ok');
  });

  test('สิทธิ์: เจ้าหน้าที่เช็กชื่อประกาศผล/แก้บันทึก/ออกใบไม่ได้ และดูได้เฉพาะภาพหน้าตรงของคนในรุ่น', async () => {
    const [session, other] = [await s.newSession(), await s.newSession()];
    const p = await ready(session);
    const staff = await s.adminClient('attendance_staff');
    const base = `${A}/attendance/sessions/${session}`;
    assert.equal((await staff.post(`${base}/announce`, { ids: [p.id] })).status, 403);
    assert.equal((await staff.post(`${A}/attendance/records/1/undo`, { what: 'in', reason: 'xxx' })).status, 403);
    assert.equal((await staff.get(`${A}/certificates`)).status, 403);
    const photo = await staff.get(`${base}/people/${p.id}/portrait`);
    assert.equal(photo.headers.get('content-type'), 'image/png');
    assert.equal(photo.headers.get('cache-control'), 'no-store');
    assert.equal((await staff.get(`${A}/attendance/sessions/${other}/people/${p.id}/portrait`)).status, 404);
    assert.equal((await s.query("SELECT COUNT(*) n FROM admin_audit_logs WHERE action = 'attendance.view_portrait' AND entity_id = :id", { id: String(p.id) }))[0].n, 1);
    assert.equal((await new Client(s.base).get(`${base}/roster`)).status, 401);
  });
});

describe('ใบประกาศ', () => {
  const layout = async (admin) => (await admin.get(`${A}/certificates/templates`)).body.data.defaults;
  const form = (o, file) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, typeof v === 'string' ? v : JSON.stringify(v)); if (file) f.append('image', new Blob([file]), 'bg.png'); return f; };

  test('ออกใบ → เลขเรียง สถานะ PDF ตรวจสอบสาธารณะ เพิกถอน และออกใหม่', async () => {
    const session = await s.newSession();
    const [p, q, notPassed] = [await ready(session, 'passed', { fullName: 'กิตติ น้ำใส' }), await ready(session, 'passed'), await ready(session, 'attended')];
    const admin = await s.adminClient('training_staff');
    assert.equal((await p.client.get(`/api/v1/applications/me/${p.id}/certificate.pdf`)).status, 404);
    const issued = (await admin.post(`${A}/certificates/issue`, { ids: [p.id, q.id, notPassed.id, p.id] })).body.data;
    assert.equal(issued.issued, 2);
    assert.deepEqual(issued.skipped.map((x) => x.id), [notPassed.id]);
    assert.equal(await statusOf(p.id), 'certified');
    const list = (await admin.get(`${A}/certificates?q=${encodeURIComponent('กิตติ')}`)).body.data;
    assert.equal(list.length, 1);
    assert.match(list[0].number, /^ET-25\d\d-\d{6}$/);
    const seq = (await s.query('SELECT certificate_no n FROM certificates ORDER BY id')).map((x) => Number(x.n.slice(-6)));
    assert.deepEqual(seq, seq.map((_, i) => seq[0] + i));
    const pdf = await p.client.get(`/api/v1/applications/me/${p.id}/certificate.pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.headers.get('content-disposition'), /^inline; filename="ET-/);
    assert.equal((await q.client.get(`/api/v1/applications/me/${p.id}/certificate.pdf`)).status, 404);
    const v = await new Client(s.base).get(`/api/v1/certificates/verify/${list[0].code}`);
    assert.equal(v.body.data.name, 'กิตติ น้ำใ***');
    assert.equal(v.body.data.status, 'valid');
    for (const bad of [p.fields.nationalId, p.fields.mobile, p.fields.email, 'น้ำใส', p.no]) assert.ok(!v.buffer.toString().includes(bad), bad);
    assert.equal((await new Client(s.base).get('/api/v1/certificates/verify/AAAAAAAAAAAAAAAA')).status, 404);
    assert.equal((await new Client(s.base).get('/api/v1/certificates/verify/1%27OR')).status, 400);
    const page = await new Client(s.base).get(`/certificate/verify/${list[0].code}`);
    assert.equal(page.status, 200);
    const mine = (await p.client.get('/api/v1/applications/me/status')).body.data[0];
    assert.equal(mine.certificate.number, list[0].number);
    assert.equal((await admin.post(`${A}/certificates/${list[0].id}/revoke`, { reason: '' })).status, 400);
    assert.equal((await admin.post(`${A}/certificates/${list[0].id}/revoke`, { reason: 'ชื่อสะกดผิด' })).status, 200);
    assert.equal(code(await admin.post(`${A}/certificates/${list[0].id}/revoke`, { reason: 'ชื่อสะกดผิด' })), 'ALREADY_REVOKED');
    const rv = await new Client(s.base).get(`/api/v1/certificates/verify/${list[0].code}`);
    assert.equal(rv.body.data.status, 'revoked');
    assert.ok(!rv.buffer.toString().includes('สะกดผิด'), 'เหตุผลภายในไม่เปิดเผย');
    assert.equal(await statusOf(p.id), 'passed');
    assert.equal((await p.client.get(`/api/v1/applications/me/${p.id}/certificate.pdf`)).status, 404);
    assert.equal((await admin.post(`${A}/certificates/issue`, { ids: [p.id, q.id], name: 'ชื่อใหม่ ทดสอบ' })).status, 400);
    assert.equal((await admin.post(`${A}/certificates/issue`, { ids: [p.id], name: 'กิตติ์ น้ำใส' })).body.data.issued, 1);
    const again = (await s.query("SELECT holder_name FROM certificates WHERE application_id = :id AND status = 'valid'", { id: p.id }))[0];
    assert.equal(again.holder_name, 'กิตติ์ น้ำใส');
  });

  test('ออกใบเดียวกันพร้อมกัน ได้ใบเดียว', async () => {
    const p = await ready(await s.newSession(), 'passed');
    const admin = await s.adminClient('training_staff');
    const out = await Promise.all(Array.from({ length: 5 }, () => admin.post(`${A}/certificates/issue`, { ids: [p.id] })));
    assert.equal(out.reduce((t, r) => t + (r.body.data?.issued ?? 0), 0), 1, JSON.stringify(out.map((r) => r.body)));
    assert.equal((await s.query('SELECT COUNT(*) n FROM certificates WHERE application_id = :id', { id: p.id }))[0].n, 1);
  });

  test('แบบที่ใช้แล้วไม่เปลี่ยน ภาพปลอมถูกปฏิเสธ และแบบของหลักสูตรมาก่อนแบบกลาง', async () => {
    const admin = await s.adminClient('training_staff');
    const d = await layout(admin);
    const send = (m, p, o, file) => admin.request(m, `${A}/certificates/templates${p}`, { form: form(o, file) });
    assert.equal(code(await send('POST', '', { name: 'x', layout: d }, Buffer.from('not an image'))), 'INVALID_FILE');
    assert.equal(code(await send('POST', '', { name: 'x', layout: d }, PNG)), 'INVALID_FILE', 'หัวไฟล์ถูกแต่ถอดรหัสไม่ได้');
    const evil = structuredClone(d); evil.fields.name.color = 'red;}';
    assert.equal(code(await send('POST', '', { name: 'x', layout: evil })), 'VALIDATION_ERROR');
    const general = (await send('POST', '', { name: 'แบบกลาง', layout: d })).body.data.id;
    const own = await send('POST', '', { name: 'แบบหลักสูตร', courseId: '1', layout: d }, realPng());
    assert.equal(own.status, 201, JSON.stringify(own.body));
    const id = own.body.data.id;
    const img = await admin.get(`${A}/certificates/templates/${id}/image`);
    assert.equal(img.headers.get('content-type'), 'image/png');
    const before = await s.countFiles();
    assert.equal((await send('PUT', `/${id}`, { name: 'แก้ก่อนใช้', courseId: '1', layout: d }, realPng())).body.data.id, id, 'ยังไม่เคยใช้ แก้แถวเดิม');
    assert.equal(await s.countFiles(), before, 'ภาพเดิมถูกลบ');
    const p = await ready(await s.newSession(), 'passed');
    await admin.post(`${A}/certificates/issue`, { ids: [p.id] });
    const [c] = await s.query('SELECT id, template_id FROM certificates WHERE application_id = :id', { id: p.id });
    assert.equal(c.template_id, id);
    const newId = (await send('PUT', `/${id}`, { name: 'แบบใหม่', courseId: '1', layout: d })).body.data.id;
    assert.notEqual(newId, id);
    assert.equal((await s.query('SELECT name FROM certificate_templates WHERE id = :id', { id }))[0].name, 'แก้ก่อนใช้');
    assert.equal((await admin.get(`${A}/certificates/${c.id}/pdf`)).status, 200);
    assert.ok((await admin.get(`${A}/certificates/templates`)).body.data.items.some((t) => t.id === general));
    const pv = await admin.request('POST', `${A}/certificates/templates/preview`, { form: form({ layout: d }, realPng()) });
    assert.equal(pv.buffer.subarray(0, 5).toString(), '%PDF-');
    for (const x of [newId, general]) assert.equal((await admin.request('DELETE', `${A}/certificates/templates/${x}`)).status, 200);
  });

  test('ลบข้อมูลบุคคลแล้วใบประกาศเหลือเพียงเลขที่ ไม่มีชื่อ และไม่เหลือข้อมูลเช็กชื่อ', async () => {
    const session = await s.newSession();
    const p = await ready(session);
    const token = await tokenOf(p);
    await startNow(session);
    const admin = await s.adminClient();
    await scan(admin, session, token);
    await admin.post(`${A}/attendance/sessions/${session}/announce`, { ids: [p.id] });
    await admin.post(`${A}/certificates/issue`, { ids: [p.id] });
    const [c] = await s.query('SELECT id, verify_code FROM certificates WHERE application_id = :id', { id: p.id });
    await p.client.post(`/api/v1/applications/me/${p.id}/erasure-request`, { note: '' });
    const [r] = await s.query('SELECT id FROM data_requests WHERE application_id = :id', { id: p.id });
    const done = await admin.post(`${A}/retention/requests/${r.id}/decide`, { decision: 'approved', password: admin.admin.password, confirm: 'ลบถาวร' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    for (const t of ['attendance_records', 'attendance_scans', 'attendance_qr']) assert.equal((await s.query(`SELECT COUNT(*) n FROM ${t} WHERE application_id = :id`, { id: p.id }))[0].n, 0, t);
    const v = await new Client(s.base).get(`/api/v1/certificates/verify/${c.verify_code}`);
    assert.equal(v.body.data.name, null);
    assert.equal(v.body.data.status, 'valid');
    assert.equal((await admin.get(`${A}/certificates/${c.id}/pdf`)).status, 410);
    assert.equal((await scan(admin, session, token)).body.data.result, 'revoked');
  });
});

describe('หลักสูตร', () => {
  test('เพิ่ม แก้ ปิด ลบ และกันลบหลักสูตรที่มีรุ่น', async () => {
    const admin = await s.adminClient();
    const r = await admin.post(`${A}/catalog/courses`, { code: 'new-01', name: 'หลักสูตรใหม่' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const { id } = r.body.data;
    assert.equal(code(await admin.post(`${A}/catalog/courses`, { code: 'NEW-01', name: 'ซ้ำ' })), 'DUPLICATE');
    assert.equal((await admin.put(`${A}/catalog/courses/${id}`, { code: 'NEW-01', name: 'แก้ชื่อ', isActive: false })).status, 200);
    assert.equal((await admin.request('DELETE', `${A}/catalog/courses/${id}`)).status, 200);
    await s.newSession();
    assert.equal(code(await admin.request('DELETE', `${A}/catalog/courses/1`)), 'IN_USE');
    assert.equal((await (await s.adminClient('training_staff')).post(`${A}/catalog/courses`, { code: 'X1', name: 'x' })).status, 403);
  });
});

describe('LIFF, Rich Menu และพื้นที่ของฉัน', () => {
  const token = (sub, over = {}) => { const t = `liff-token-${Math.random().toString(36).slice(2)}-${sub}`; s.line.tokens.set(t, { sub, ...over }); return t; };
  test('LIFF: ตรวจ ID Token กับ LINE ผูกใบที่ยืนยันไว้ ปฏิเสธ token ปลอม/ผิด channel/หมดอายุ และคำขอข้ามเว็บ', async () => {
    const session = await s.newSession();
    const p = await ready(session);
    const sub = `Uliff${Date.now()}`;
    assert.equal((await new Client(s.base).post('/api/v1/auth/liff/session', { idToken: 'x'.repeat(40) })).status, 401);
    for (const bad of [{ aud: 'other-channel' }, { exp: 1 }, { iss: 'https://evil.example' }]) { s.line.overrides = bad; assert.equal((await new Client(s.base).post('/api/v1/auth/liff/session', { idToken: token(sub) })).status, 401, JSON.stringify(bad)); }
    s.line.overrides = {};
    const cross = await new Client(s.base).post('/api/v1/auth/liff/session', { idToken: token(sub) }, { headers: { origin: 'https://evil.example' } });
    assert.equal(cross.status, 403);
    // เบราว์เซอร์นี้ยืนยันใบด้วยเลขที่แล้ว → LIFF ผูกใบให้ทันที และมีแจ้งเตือนเชื่อมสำเร็จ
    const r = await p.client.post('/api/v1/auth/liff/session', { idToken: token(sub) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await p.client.get('/api/v1/auth/session')).body.data.line.displayName, 'ผู้ทดสอบ');
    const fresh = new Client(s.base);
    await fresh.post('/api/v1/auth/liff/session', { idToken: token(sub) });
    assert.deepEqual((await fresh.get('/api/v1/applications/me/status')).body.data.map((a) => a.id), [p.id]);
    assert.equal((await s.query("SELECT COUNT(*) n FROM domain_events WHERE event_type = 'line.linked' AND aggregate_id = :id", { id: p.id }))[0].n, 1);
    const stranger = new Client(s.base);
    await stranger.post('/api/v1/auth/liff/session', { idToken: token('Ustranger') });
    assert.equal((await stranger.get('/api/v1/applications/me/status')).body.data.length, 0);
    assert.equal((await stranger.get(`/api/v1/applications/me/${p.id}/attendance`)).status, 404);
  });
  test('หน้า me ผ่อน CSP เฉพาะตัวเอง หน้าอื่นเข้มเท่าเดิม', async () => {
    const c = new Client(s.base);
    assert.match((await c.get('/me.html')).headers.get('content-security-policy'), /script-src 'self' https:\/\/static\.line-scdn\.net/);
    for (const p of ['/', '/tracking.html', '/admin/login.html']) assert.match((await c.get(p)).headers.get('content-security-policy'), /script-src 'self';/);
  });
  test('Rich Menu: 6 ปุ่มครอบคลุมทั้งภาพ เผยแพร่แทนของเก่า และย้อนกลับเมื่อ LINE ปฏิเสธ', async () => {
    const admin = await s.adminClient('admin');
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500)]);
    const send = (b, bar = 'เมนู') => { const f = new FormData(); f.append('chatBarText', bar); f.append('image', new Blob([b]), 'm.jpg'); return admin.request('POST', `${A}/line/rich-menu`, { form: f }); };
    assert.equal((await send(PNG)).body.meta.code, 'INVALID_FILE');
    assert.equal((await send(jpg, 'ข้อความยาวเกินสิบสี่ตัวอักษร')).status, 400);
    const one = await send(jpg);
    assert.equal(one.status, 200, JSON.stringify(one.body));
    const first = s.line.rich.default;
    const menu = s.line.rich.menus.get(first);
    assert.equal(menu.areas.length, 6);
    assert.equal(menu.image, true);
    assert.equal(menu.areas.reduce((t, a) => t + a.bounds.width * a.bounds.height, 0), 2500 * 1686, 'ไม่มีช่องว่าง');
    assert.deepEqual(menu.areas.map((a) => a.action.type), ['uri', 'uri', 'uri', 'uri', 'uri', 'postback']);
    for (const status of [{ create: 400 }, { image: 400 }]) {
      s.line.rich.status = status;
      assert.equal((await send(jpg)).status, 502);
      s.line.rich.status = {};
      assert.equal(s.line.rich.default, first, 'เมนูเดิมยังอยู่');
      assert.equal(s.line.rich.menus.size, 1, 'ไม่ทิ้งเมนูค้าง');
    }
    await send(jpg);
    assert.notEqual(s.line.rich.default, first);
    assert.equal(s.line.rich.menus.has(first), false);
    assert.equal((await admin.request('DELETE', `${A}/line/rich-menu`)).status, 200);
    assert.equal(s.line.rich.default, null);
    assert.equal((await (await s.adminClient('training_staff')).get(`${A}/line/state`)).status, 403);
    assert.equal((await admin.get(`${A}/line/users?filter=linked`)).status, 200);
  });
  test('ปุ่มติดต่อบนเมนูตอบด้วย reply ไม่กินโควตา และไม่เข้า AI', async () => {
    const crypto = await import('node:crypto');
    const event = (data) => { const raw = JSON.stringify({ events: [{ type: 'postback', mode: 'active', timestamp: Date.now(), webhookEventId: crypto.randomUUID(), source: { type: 'user', userId: 'Upostback' }, replyToken: crypto.randomUUID(), postback: { data } }] }); return fetch(`${s.base}/api/v1/line/webhook`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-line-signature': crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(raw).digest('base64') } }); };
    const before = s.line.chat.sent.length;
    assert.equal((await event('menu=contact')).status, 200);
    for (let i = 0; i < 60 && s.line.chat.sent.length === before; i += 1) await new Promise((r) => setTimeout(r, 50));
    const sent = s.line.chat.sent.slice(before);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'reply');
    assert.match(sent[0].messages[0].text, /พิมพ์คำถามได้เลย/);
    await event('something=else');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(s.line.chat.sent.length, before + 1);
  });
});

describe('AI: บันทึกการใช้งาน เพดาน รายงาน', () => {
  const ask = async (admin, question) => (await admin.post('/api/v1/ai/chat', { question })).body.data;
  test('ค่าที่ตั้งมีผลจริง บันทึก token/ค่าใช้จ่าย จัดกลุ่มคำถามที่ตอบไม่ได้ และหยุดเมื่อครบเพดาน', async () => {
    const admin = await s.adminClient('admin');
    const keys = { MINIMAX_API_KEY: 'good-minimax-key-000', MINIMAX_MODEL: 'mock-model' };
    const root = await s.adminClient();
    assert.equal((await root.put(`${A}/integrations`, { password: root.admin.password, values: { minimax_api_key: keys.MINIMAX_API_KEY, minimax_model: keys.MINIMAX_MODEL } })).status, 200);
    await admin.post('/api/v1/ai/knowledge', { title: 'ค่าจอดรถ', content: 'ค่าจอดรถคันละ 40 บาท', category: 'FAQ', status: 'published', keywords: 'จอดรถ' });
    const base = { maxTokens: 777, temperature: 0.3, fallback: 'โปรดรอเจ้าหน้าที่', perHour: 5, monthlyTokens: '', priceIn: 2, priceOut: 8, currency: 'USD' };
    assert.equal((await admin.put('/api/v1/ai/settings', { ...base, temperature: 2 })).status, 400);
    assert.equal((await admin.put('/api/v1/ai/settings', base)).status, 200);
    s.line.aiReply = 'คันละ 40 บาท [1]'; s.line.aiUsage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 };
    s.line.aiRequests.length = 0;
    assert.equal((await ask(admin, 'ค่าจอดรถเท่าไหร่')).mode, 'answer');
    const sent = JSON.parse(s.line.aiRequests.at(-1));
    assert.deepEqual([sent.max_tokens, sent.temperature], [777, 0.3]);
    assert.match((await ask(admin, 'ยูนิคอร์นสีอะไร')).answer, /^โปรดรอเจ้าหน้าที่/);
    const [row] = await s.query("SELECT * FROM ai_interactions WHERE mode = 'answer' ORDER BY id DESC LIMIT 1");
    assert.deepEqual([row.tokens_in, row.tokens_out, row.tokens_total, row.channel, row.model], [1000, 500, 1500, 'test', 'mock-model']);
    assert.ok(!row.question_enc.includes('จอดรถ'));
    let r = (await admin.get('/api/v1/ai/report')).body.data;
    assert.ok(Math.abs(r.month.cost - 0.006) < 1e-9, String(r.month.cost));
    // คำถามจาก LINE ที่ต่างกันแค่คำลงท้ายรวมเป็นข้อเดียว
    const { encryptText } = await import('../src/utils/crypto.js');
    for (const q of ['มีที่พักไหมคะ', 'มีที่พักไหมครับ', 'มีที่พักไหม?']) await s.query("INSERT INTO ai_interactions (channel, mode, question_enc, created_at) VALUES ('line', 'fallback', :q, UTC_TIMESTAMP())", { q: encryptText(q, 'ai_question') });
    r = (await admin.get('/api/v1/ai/report')).body.data;
    const g = r.unanswered.find((x) => x.question.startsWith('มีที่พัก'));
    assert.equal(g.count, 3);
    assert.equal((await admin.post('/api/v1/ai/report/resolve', { ids: g.ids })).status, 200);
    r = (await admin.get('/api/v1/ai/report')).body.data;
    assert.ok(!r.unanswered.some((x) => x.question.startsWith('มีที่พัก')));
    await admin.put('/api/v1/ai/settings', { ...base, monthlyTokens: 1000 });
    const before = s.line.aiRequests.length;
    assert.equal((await ask(admin, 'ค่าจอดรถเท่าไหร่')).mode, 'limit');
    assert.equal(s.line.aiRequests.length, before, 'ไม่เรียก MiniMax');
    await admin.put('/api/v1/ai/settings', { ...base, fallback: '' });
    s.line.aiReply = null; s.line.aiUsage = null;
    assert.equal((await (await s.adminClient('training_staff')).get('/api/v1/ai/report')).status, 403);
    const dash = (await admin.get(`${A}/dashboard`)).body.data;
    assert.ok(dash.ai.tokens >= 1500 && Number.isInteger(dash.certificates) && Number.isInteger(dash.attendance.total), JSON.stringify(dash.ai));
    assert.equal((await (await s.adminClient('training_staff')).get(`${A}/dashboard`)).body.data.ai, null);
  });
  test('เรียก MiniMax ตามรุ่น ลองใหม่ครั้งเดียวเมื่อพารามิเตอร์ไม่รับ และบันทึก token ของคำตอบที่ใช้ไม่ได้', async () => {
    const root = await s.adminClient(); const admin = await s.adminClient('admin');
    const model = (m) => root.put(`${A}/integrations`, { password: root.admin.password, values: { minimax_model: m } });
    const set = (o) => admin.put('/api/v1/ai/settings', { maxTokens: 3000, temperature: 0.3, fallback: '', perHour: 20, monthlyTokens: '', priceIn: '', priceOut: '', currency: 'USD', ...o });
    const last = () => JSON.parse(s.line.aiRequests.at(-1));
    s.line.aiReply = 'คันละ 40 บาท [1]'; s.line.aiUsage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    await set({});
    assert.equal((await model('minimax-m3.1-flash')).status, 200);
    assert.equal((await s.query("SELECT setting_value v FROM system_settings WHERE setting_key = 'minimax_model'"))[0].v, 'MiniMax-M3.1-Flash', 'แก้ตัวพิมพ์ให้ตรง');
    // ค่าที่เคยบันทึกแบบขาดคำนำหน้าต้องใช้ได้โดยไม่ต้องแก้
    await s.query("UPDATE system_settings SET setting_value = 'M3.1-Flash' WHERE setting_key = 'minimax_model'");
    assert.equal((await ask(admin, 'ค่าจอดรถเท่าไหร่')).mode, 'answer');
    assert.equal(last().model, 'MiniMax-M3.1-Flash');
    let q = last();
    assert.deepEqual([q.reasoning_effort, q.reasoning_split, q.max_completion_tokens, q.max_tokens, q.temperature, q.thinking], ['low', true, 3000, undefined, undefined, undefined]);
    await set({ effort: 'high' });
    await ask(admin, 'ค่าจอดรถเท่าไหร่');
    assert.equal(last().reasoning_effort, 'high');
    assert.equal((await set({ effort: 'max' })).status, 400);
    const report = (await admin.get('/api/v1/ai/report')).body.data;
    assert.deepEqual(report.model, { name: 'MiniMax-M3.1-Flash', ignoresTemperature: true, usesEffort: true });
    await model('MiniMax-M3');
    await ask(admin, 'ค่าจอดรถเท่าไหร่');
    q = last();
    assert.deepEqual([q.thinking, q.reasoning_effort, q.reasoning_split, q.max_completion_tokens], [{ type: 'disabled' }, undefined, undefined, 3000]);
    // MiniMax ไม่รับพารามิเตอร์เฉพาะรุ่น
    s.line.aiRequests.length = 0; s.line.aiReject = (b) => 'thinking' in b;
    assert.equal((await ask(admin, 'ค่าจอดรถเท่าไหร่')).mode, 'answer');
    assert.equal(s.line.aiRequests.length, 2);
    assert.deepEqual(Object.keys(last()).sort(), ['max_tokens', 'messages', 'model']);
    s.line.aiRequests.length = 0; s.line.aiReject = () => true;
    assert.equal((await ask(admin, 'ค่าจอดรถเท่าไหร่')).mode, 'error');
    assert.equal(s.line.aiRequests.length, 2, 'ไม่วนซ้ำ');
    const ping = await root.post(`${A}/integrations/test/minimax`);
    assert.match(ping.body.data.message, /ชื่อ model/);
    s.line.aiReject = null;
    // คิดจน token หมด: ไม่ส่งคำตอบครึ่งเดียว แต่ยังนับค่าใช้จ่าย
    s.line.aiFinish = 'length'; s.line.aiUsage = { prompt_tokens: 100, completion_tokens: 3000, total_tokens: 3100 };
    const cut = await ask(admin, 'ค่าจอดรถเท่าไหร่');
    assert.equal(cut.mode, 'error');
    assert.match(cut.error, /Max tokens/);
    const [row] = await s.query('SELECT mode, tokens_total, tokens_out FROM ai_interactions ORDER BY id DESC LIMIT 1');
    assert.deepEqual([row.mode, row.tokens_total, row.tokens_out], ['error', 3100, 3000]);
    s.line.aiFinish = null;
    for (const bad of ['', '   ', '<think>คิดไม่จบ คันละ 40 บาท [1]']) { s.line.aiReply = bad || ' '; assert.equal((await ask(admin, 'ค่าจอดรถเท่าไหร่')).mode, 'error', bad); }
    s.line.aiReply = null; s.line.aiUsage = null;
    await model('mock-model');
  });
  test('คำถามที่มีข้อมูลส่วนบุคคลถูกตัดก่อนบันทึก และลบตามระยะเวลาเก็บแชต', async () => {
    const admin = await s.adminClient('admin');
    await ask(admin, 'เบอร์ผม 081-234-5678 อีเมล a@b.com ค่าจอดรถ');
    const { decryptText } = await import('../src/utils/crypto.js');
    const [row] = await s.query('SELECT question_enc FROM ai_interactions ORDER BY id DESC LIMIT 1');
    const q = decryptText(row.question_enc, 'ai_question');
    assert.ok(!q.includes('5678') && !q.includes('a@b.com'), q);
  });
});

describe('อีเมลแทน LINE', () => {
  const until = async (fn) => { for (let i = 0; i < 80; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };
  const jobs = () => new Client(s.base).post('/api/v1/internal/jobs/run', {}, { headers: { 'x-jobs-secret': process.env.JOBS_SECRET } });
  test('ผู้ไม่เชื่อม LINE ได้อีเมลครั้งเดียวต่อเหตุการณ์ ข้อความล้าสมัยไม่ส่ง และปิดได้', async () => {
    const admin = await s.adminClient();
    const set = (emailFallback) => admin.put(`${A}/notifications/settings`, { enabled: true, daysBefore: 0, hoursBefore: 0, emailFallback });
    await jobs(); // เก็บเหตุการณ์เก่าก่อนเปิด
    assert.equal((await set(true)).status, 200);
    const p = await ready(await s.newSession(), 'submitted', { email: `fb${Date.now()}@example.com` });
    const mails = () => s.smtp.mails.filter((m) => m.to === p.fields.email);
    const move = (from, to, reason) => admin.post(`${A}/applications/${p.id}/status`, { expectedStatus: from, status: to, reason });
    await until(() => mails().length === 1); // ยืนยันการสมัคร
    await s.query("UPDATE application_documents SET review_status = 'approved' WHERE application_id = :id", { id: p.id });
    assert.equal((await move('submitted', 'documents_approved')).status, 200);
    await until(() => mails().length === 2);
    await jobs(); await jobs();
    assert.equal(mails().length, 2);
    // ล้าสมัย: สถานะเปลี่ยนไปก่อนส่ง
    s.smtp.mode = 'temp';
    await move('documents_approved', 'approved');
    await until(async () => (await s.query("SELECT COUNT(*) n FROM email_queue WHERE application_id = :id AND template = 'status' AND retry_count = 1", { id: p.id }))[0].n === 1);
    s.smtp.mode = 'ok';
    await s.query("UPDATE applications SET status = 'awaiting_training' WHERE id = :id", { id: p.id });
    await s.query("UPDATE email_queue SET next_attempt_at = UTC_TIMESTAMP() WHERE application_id = :id AND status = 'pending'", { id: p.id });
    await jobs();
    assert.equal(mails().length, 2);
    assert.equal((await s.query("SELECT status FROM email_queue WHERE application_id = :id ORDER BY id DESC LIMIT 1", { id: p.id }))[0].status, 'cancelled');
    await set(false);
    await move('awaiting_training', 'cancelled', 'ทดสอบ');
    await jobs();
    assert.equal(mails().length, 2);
  });
});

describe('แจ้งเตือนเช็กอิน', () => {
  const until = async (fn) => { for (let i = 0; i < 100; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };
  const jobs = () => new Client(s.base).post('/api/v1/internal/jobs/run', {}, { headers: { 'x-jobs-secret': process.env.JOBS_SECRET } });
  const queued = (id) => s.query("SELECT status, error_message, expires_at FROM notification_queue WHERE application_id = :id AND notification_type = 'checked_in' ORDER BY id", { id });
  test('แจ้งผู้เข้าอบรมเฉพาะเมื่อเปิด ครั้งเดียวต่อเช็กอิน ยกเลิกบันทึกแล้วไม่ส่ง และแจ้งเจ้าหน้าที่แบบรวม', async () => {
    const admin = await s.adminClient();
    const set = (o) => admin.put(`${A}/notifications/settings`, { enabled: true, daysBefore: 0, hoursBefore: 0, emailFallback: true, checkin: true, ...o });
    const session = await s.newSession();
    const person = async (sub) => {
      const c = new Client(s.base); await s.lineLogin(c, sub);
      const r = await s.apply({ sessionId: session }, c);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      await s.query("UPDATE applications SET status = 'awaiting_training' WHERE id = :id", { id: r.body.data.id });
      await s.query("UPDATE line_users SET friend_status = 'friend' WHERE line_user_id = :sub", { sub });
      return { id: r.body.data.id, client: c, sub };
    };
    const [off, on, undone] = [await person('Uci-off'), await person('Uci-on'), await person('Uci-undo')];
    const noLine = await ready(session, 'awaiting_training', { email: `ci${Date.now()}@example.com` });
    const tokens = new Map();
    for (const p of [off, on, undone, noLine]) tokens.set(p.id, await tokenOf(p));
    await startNow(session);
    await s.query('INSERT INTO line_users (line_user_id, friend_status) VALUES (:u, :f)', { u: 'Uci-staff', f: 'friend' });
    await s.query("UPDATE admin_users SET line_user_id = (SELECT id FROM line_users WHERE line_user_id = 'Uci-staff') WHERE id = :id", { id: admin.admin.id });
    assert.equal((await admin.put(`${A}/notifications/recipients/${admin.admin.id}`, { events: ['checked_in'] })).status, 200);
    const pushes = (u) => s.line.chat.sent.filter((m) => m.to === u && JSON.stringify(m).includes('เช็กอินเรียบร้อย'));
    await set({ checkin: false });
    await jobs();
    await scan(admin, session, tokens.get(off.id)); await jobs();
    assert.equal((await queued(off.id)).length, 0);
    await set({});
    await scan(admin, session, tokens.get(on.id)); await scan(admin, session, tokens.get(on.id)); await scan(admin, session, tokens.get(on.id), 'out');
    await jobs();
    await until(() => pushes('Uci-on').length === 1);
    await until(async () => (await queued(on.id))[0]?.status === 'sent');
    assert.equal((await queued(on.id)).length, 1);
    assert.match(JSON.stringify(pushes('Uci-on')[0]), /เวลาเข้าอบรม \d{1,2}[:.]\d{2}/);
    // LINE ล่มชั่วคราว → ยกเลิกบันทึก → ไม่ส่ง
    s.line.chat.status.push.push(500);
    await scan(admin, session, tokens.get(undone.id)); await jobs();
    await until(async () => (await queued(undone.id))[0]?.status === 'pending' && (await queued(undone.id))[0].error_message);
    const { records } = (await admin.get(`${A}/attendance/sessions/${session}/people/${undone.id}`)).body.data;
    await admin.post(`${A}/attendance/records/${records[0].id}/undo`, { what: 'in', reason: 'สแกนผิดคน' });
    await s.query("UPDATE notification_queue SET next_attempt_at = UTC_TIMESTAMP() WHERE application_id = :id AND notification_type = 'checked_in'", { id: undone.id });
    await jobs();
    await until(async () => (await queued(undone.id))[0].status === 'cancelled');
    assert.equal(pushes('Uci-undo').length, 0);
    // ไม่มี LINE: ไม่ส่งอีเมลแทนสำหรับเช็กอิน
    const before = s.smtp.mails.filter((m) => m.to === noLine.fields.email).length;
    await scan(admin, session, tokens.get(noLine.id)); await jobs();
    assert.equal(s.smtp.mails.filter((m) => m.to === noLine.fields.email).length, before);
    const [a] = await s.query("SELECT SUM(item_count) n, COUNT(*) c FROM notification_queue WHERE admin_id = :id AND notification_type = 'admin_checked_in'", { id: admin.admin.id });
    assert.equal(Number(a.n), 4, 'นับทุกเช็กอิน ไม่นับสแกนซ้ำและเช็กเอาต์');
    assert.ok(a.c <= 2, 'รวมเป็นข้อความเดียวต่อช่วงเวลา');
    await set({ checkin: false, emailFallback: false });
  });
});

describe('เครดิต AI', () => {
  const ask = async (admin, question) => (await admin.post('/api/v1/ai/chat', { question })).body.data;
  const until = async (fn) => { for (let i = 0; i < 100; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };
  const jobs = () => new Client(s.base).post('/api/v1/internal/jobs/run', {}, { headers: { 'x-jobs-secret': process.env.JOBS_SECRET } });
  const health = async () => JSON.parse((await s.query("SELECT setting_value v FROM system_settings WHERE setting_key = 'ai_health_json'"))[0].v);
  const patchHealth = async (o) => s.query("UPDATE system_settings SET setting_value = :v WHERE setting_key = 'ai_health_json'", { v: JSON.stringify({ ...(await health()), ...o }) });
  const events = async (t) => (await s.query('SELECT COUNT(*) n FROM domain_events WHERE event_type = :t', { t }))[0].n;
  let admin; let root;
  const Q = 'ค่าจอดรถคันละกี่บาทต่อวัน';
  before(async () => {
    admin = await s.adminClient('admin'); root = await s.adminClient();
    await root.put(`${A}/integrations`, { password: root.admin.password, values: { minimax_api_key: 'good-minimax-key-000', minimax_model: 'MiniMax-M3.1-Flash' } });
    await admin.post('/api/v1/ai/knowledge', { title: 'ที่จอดรถบรรทุกอยู่ตรงไหน', content: 'อยู่ด้านหลังอาคาร B', category: 'FAQ', status: 'published' });
    await admin.post('/api/v1/ai/knowledge', { title: 'ค่าจอดรถ', content: 'ค่าจอดรถคันละ 40 บาท', category: 'FAQ', status: 'published', keywords: 'จอดรถ' });
    await admin.put('/api/v1/ai/settings', { maxTokens: 3000, temperature: 0.3, fallback: '', perHour: 50, monthlyTokens: '', priceIn: '', priceOut: '', currency: 'USD' });
    await admin.put('/api/v1/ai/credit/options', { lowPct: 20, email: 'ops@example.com' });
  });
  after(() => { s.line.aiReply = null; s.line.aiUsage = null; s.line.aiReject = null; s.line.aiFail = null; });
  /** นับเฉพาะที่ถึงกล่องจดหมายจริง (sent) */
  const mails = async (key) => (await s.query("SELECT COUNT(*) n FROM email_queue WHERE template = 'ai_alert' AND status = 'sent' AND idempotency_key LIKE :k", { k: `${key}%` }))[0].n;

  test('จำแนกรหัส MiniMax ทุกแบบ', async () => {
    const { classify } = await import('../src/config/minimaxErrors.js');
    const cases = [[200, { base_resp: { status_code: 1008 } }, 'credit'], [402, null, 'credit'], [400, { error: { message: 'insufficient balance (1008)' } }, 'credit'], [429, { error: { message: 'Insufficient balance' } }, 'credit'], [200, { base_resp: { status_code: 2056 } }, 'quota'], [401, null, 'auth'], [200, { base_resp: { status_code: 2049 } }, 'auth'], [400, { error: { message: 'model is not exist (2022)' } }, 'model'], [429, null, 'rate'], [400, { error: { message: 'bad (2013)' } }, 'params'], [200, { base_resp: { status_code: 1027 } }, 'content'], [500, null, 'server'], [0, null, 'network']];
    for (const [st, body, kind] of cases) assert.equal(classify(st, body).kind, kind, JSON.stringify([st, body]));
  });

  test('เครดิตหมด: หยุดเรียกทันที ตอบถาม-ตอบที่ตรง ไม่เดา แจ้งครั้งเดียว แล้วฟื้นเองหลังเติม', async () => {
    s.line.aiReply = 'คันละ 40 บาท [1]'; s.line.aiUsage = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 };
    assert.equal((await ask(admin, Q)).mode, 'answer');
    const before = await events('ai.unavailable');
    s.line.aiFail = { status: 200, body: { base_resp: { status_code: 1008, status_msg: 'insufficient balance' } } };
    const all = await Promise.all(Array.from({ length: 6 }, () => ask(admin, Q)));
    assert.ok(all.every((r) => r.mode === 'offline'), JSON.stringify(all.map((r) => r.mode)));
    assert.equal((await health()).kind, 'credit');
    assert.equal(await events('ai.unavailable') - before, 1, 'ล้มพร้อมกันแจ้งครั้งเดียว');
    await until(async () => await mails('ai:down:credit') === 1);
    assert.ok(s.smtp.mails.some((m) => m.to === 'ops@example.com'));
    const calls = s.line.aiRequests.length;
    const direct = await ask(admin, 'ที่จอดรถบรรทุก อยู่ตรงไหนครับ?');
    assert.deepEqual([direct.mode, direct.answer], ['faq', 'อยู่ด้านหลังอาคาร B']);
    const other = await ask(admin, Q);
    assert.equal(other.mode, 'offline');
    assert.match(other.answer, /ส่งต่อให้เจ้าหน้าที่/);
    assert.ok(!other.answer.includes('40 บาท'), 'ไม่เดาจากรายการที่แค่ใกล้เคียง');
    assert.equal(s.line.aiRequests.length, calls, 'ไม่เรียก MiniMax ระหว่างหยุด');
    let c = (await admin.get('/api/v1/ai/credit')).body.data;
    assert.deepEqual([c.level, c.health.status, c.kindText], ['empty', 'blocked', 'เครดิต MiniMax หมด']);
    assert.match((await admin.get(`${A}/chat/state`)).body.data.aiHealth.text, /เครดิต/);
    // งานตั้งเวลาลองเองเมื่อถึงเวลา และไม่ถี่กว่านั้น
    await s.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('ai_chat_enabled', '1') ON DUPLICATE KEY UPDATE setting_value = '1'");
    await jobs();
    assert.equal(s.line.aiRequests.length, calls);
    await patchHealth({ nextProbeAt: new Date(Date.now() - 1000).toISOString() });
    await jobs();
    assert.equal(s.line.aiRequests.length, calls + 1);
    assert.equal((await health()).status, 'blocked');
    s.line.aiFail = null;
    await patchHealth({ nextProbeAt: new Date(Date.now() - 1000).toISOString() });
    await jobs();
    assert.equal((await health()).status, 'ok');
    await until(async () => await mails('ai:up') === 1);
    assert.equal(await mails('ai:down:credit'), 1);
    assert.equal((await ask(admin, Q)).mode, 'answer');
    c = (await admin.get('/api/v1/ai/credit')).body.data;
    assert.notEqual(c.level, 'empty');
  });

  test('ในแชต LINE: ขออภัยครั้งเดียวต่อ 30 นาที แล้วเรียกเจ้าหน้าที่ต่อโดยไม่ส่งซ้ำ', async () => {
    const crypto = await import('node:crypto');
    const say = (text) => { const raw = JSON.stringify({ events: [{ type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: crypto.randomUUID(), source: { type: 'user', userId: 'Ucredit' }, replyToken: crypto.randomUUID(), message: { id: crypto.randomUUID(), type: 'text', text } }] }); return fetch(`${s.base}/api/v1/line/webhook`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-line-signature': crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(raw).digest('base64') } }); };
    s.line.aiFail = { status: 402, body: {} };
    const sent = () => s.line.chat.sent.filter((m) => JSON.stringify(m).includes('ส่งต่อให้เจ้าหน้าที่แล้ว จะตอบ')).length;
    const n0 = sent();
    const done = async (k) => until(async () => (await s.query("SELECT COUNT(*) n FROM ai_interactions WHERE channel = 'line' AND mode = 'offline'"))[0].n >= k);
    await say(Q); await done(1);
    await until(() => sent() === n0 + 1);
    await say(`${Q} ตอบหน่อย`); await done(2);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sent(), n0 + 1);
    const [conv] = await s.query("SELECT attention_reason r FROM chat_conversations c JOIN line_users l ON l.id = c.line_user_id WHERE l.line_user_id = 'Ucredit'");
    assert.equal(conv.r, 'AI หยุดชั่วคราว');
    s.line.aiFail = null;
    assert.equal((await admin.post('/api/v1/ai/credit/check')).body.data.result.ok, true, 'กดตรวจอีกครั้งแล้วกลับมาทันที');
    assert.equal((await health()).status, 'ok');
    await s.query("UPDATE system_settings SET setting_value = '' WHERE setting_key = 'ai_chat_enabled'");
  });

  test('ขัดข้องชั่วคราวไม่หยุดทันที ครบ 5 ครั้งจึงพัก และคำถามต้องห้ามไม่นับเป็นบริการล่ม', async () => {
    s.line.aiFail = { status: 200, body: { base_resp: { status_code: 1027 } } };
    for (let i = 0; i < 7; i += 1) assert.equal((await ask(admin, Q)).mode, 'error');
    assert.equal((await health()).status, 'ok');
    s.line.aiFail = { status: 500, body: {} };
    for (let i = 0; i < 4; i += 1) assert.equal((await ask(admin, Q)).mode, 'error');
    assert.equal((await health()).status, 'ok');
    await ask(admin, Q);
    assert.deepEqual([(await health()).status, (await health()).kind], ['degraded', 'server']);
    assert.equal((await ask(admin, Q)).mode, 'offline');
    s.line.aiFail = null;
    await patchHealth({ nextProbeAt: new Date(Date.now() - 1).toISOString() });
    assert.equal((await ask(admin, Q)).mode, 'answer');
    assert.equal((await health()).status, 'ok');
    // คีย์เสีย → ใส่คีย์ใหม่แล้วลองทันที
    s.line.aiFail = { status: 401, body: {} };
    await ask(admin, Q);
    assert.equal((await health()).kind, 'auth');
    s.line.aiFail = null;
    await root.put(`${A}/integrations`, { password: root.admin.password, values: { minimax_api_key: 'good-minimax-key-111' } });
    assert.equal((await ask(admin, Q)).mode, 'answer');
  });

  test('ยอดคงเหลือ พยากรณ์ ระดับเตือน และราคาที่เปลี่ยนไม่กระทบยอดเก่า', async () => {
    const get = async () => (await admin.get('/api/v1/ai/credit')).body.data;
    assert.equal((await admin.post('/api/v1/ai/credit', { kind: 'balance', amount: -1 })).status, 400);
    assert.equal((await admin.post('/api/v1/ai/credit', { kind: 'topup', amount: 0 })).status, 400);
    assert.equal((await (await s.adminClient('training_staff')).get('/api/v1/ai/credit')).status, 403);
    await s.query('DELETE FROM ai_interactions'); // เริ่มวัดใหม่
    await new Promise((r) => setTimeout(r, 1100));
    await admin.post('/api/v1/ai/credit', { kind: 'balance', amount: 1 });
    let c = await get();
    assert.deepEqual([c.remaining, c.level, c.price.source, c.price.in, c.price.out], [1, 'ok', 'reference', 0.15, 0.6]);
    s.line.aiReply = 'คันละ 40 บาท [1]'; s.line.aiUsage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 };
    await ask(admin, Q); // 0.15 + 0.60
    c = await get();
    assert.ok(Math.abs(c.remaining - 0.25) < 1e-6, String(c.remaining));
    assert.ok(Math.abs(c.perDay - 0.75) < 1e-6);
    assert.equal(c.level, 'critical', 'ใช้ได้ไม่ถึง 2 วัน');
    await admin.put('/api/v1/ai/settings', { maxTokens: 3000, temperature: 0.3, fallback: '', perHour: 50, monthlyTokens: '', priceIn: 100, priceOut: 100, currency: 'USD' });
    assert.ok(Math.abs((await get()).remaining - 0.25) < 1e-6, 'ยอดเก่าไม่คิดราคาใหม่');
    await admin.put('/api/v1/ai/settings', { maxTokens: 3000, temperature: 0.3, fallback: '', perHour: 50, monthlyTokens: '', priceIn: '', priceOut: '', currency: 'USD' });
    const low = await events('ai.credit_low'); const critical = await mails('ai:level:critical');
    await s.query("UPDATE system_settings SET setting_value = 'ok' WHERE setting_key = 'ai_credit_level'");
    await Promise.all([jobs(), jobs(), jobs()]);
    assert.equal(await events('ai.credit_low') - low, 1);
    await until(async () => await mails('ai:level:critical') === critical + 1);
    await jobs();
    assert.equal(await mails('ai:level:critical'), critical + 1, 'ระดับเดิมไม่เตือนซ้ำ');
    c = (await admin.post('/api/v1/ai/credit', { kind: 'topup', amount: 99.75 })).body.data;
    assert.ok(Math.abs(c.remaining - 100) < 1e-6);
    assert.equal(c.level, 'ok');
    await admin.post('/api/v1/ai/credit', { kind: 'balance', amount: 50 });
    c = await get();
    assert.ok(c.remaining <= 50 && c.entries[0].kind === 'balance');
    assert.equal(c.total, 50, 'ตั้งยอดจริงแล้วเริ่มนับใหม่');
    assert.ok(Math.abs(c.entries[0].estimate - 100) < 1e-6, 'เก็บยอดที่ระบบประมาณไว้เทียบกับยอดจริง');
  });

  test('ค่าเงินบาท: อัตราจากการเติมจริง, ตั้งเองได้, สรุปค่าใช้จ่ายรายเดือน และแถบหน้าแชตแสดงเครดิต AI', async () => {
    const get = async () => (await admin.get('/api/v1/ai/credit')).body.data;
    const opts = (o) => admin.put('/api/v1/ai/credit/options', { lowPct: 20, email: '', ...o });
    assert.equal((await opts({ fxRate: 0 })).status, 400);
    assert.equal((await opts({ fxRate: '' })).status, 200);
    assert.equal((await get()).fx.rate, null);
    const before = (await get()).spending.topups;
    let c = (await admin.post('/api/v1/ai/credit', { kind: 'topup', amount: 10, paidThb: 345.6 })).body.data;
    assert.equal(c.fx.rate, 34.56, 'อัตรา = บาทที่จ่าย / ดอลลาร์ที่เติม');
    assert.equal(c.entries[0].paid_thb, 345.6);
    assert.ok(Math.abs(c.spending.topups.usd - before.usd - 10) < 1e-6);
    assert.equal(c.spending.months.length, 6);
    assert.ok(c.spending.months[0].topupUsd >= 10);
    assert.equal((await opts({ fxRate: 35 })).body.data.fx.rate, 35);
    assert.equal((await opts({})).body.data.fx.rate, 35, 'ไม่ส่งอัตรามา = คงค่าเดิม');
    assert.equal((await admin.post('/api/v1/ai/credit', { kind: 'balance', amount: 5, paidThb: 999 })).status, 200);
    assert.equal((await get()).entries[0].paid_thb, null, 'ยอดคงเหลือไม่มีเงินที่จ่าย');
    assert.equal((await admin.get('/api/v1/ai/report')).body.data.fx.rate, 35);
    assert.equal((await admin.get(`${A}/dashboard`)).body.data.ai.fx.rate, 35);
    const chat = (await admin.get(`${A}/chat/state`)).body.data;
    assert.equal(chat.aiCredit.rate, 35);
    assert.ok(chat.aiCredit.remaining <= 5);
  });
});

describe('หน้าตรวจความพร้อม', () => {
  test('บอกสิ่งที่ขาดตามจริง ไม่มีค่าลับ และเห็นเฉพาะผู้มีสิทธิ์', async () => {
    const admin = await s.adminClient('admin');
    let r = (await admin.get(`${A}/system`)).body.data;
    const of = (k) => r.items.find((i) => i.key === k);
    assert.equal(r.ready, false);
    assert.deepEqual([of('https').ok, of('legal').ok, of('universities').ok, of('migrations').ok, of('storage').ok, of('jobs').ok], [false, false, true, true, true, true]);
    assert.equal(of('payment').ok, false);
    await admin.put(`${A}/settings`, { payment_instructions: 'โอนที่เคาน์เตอร์', contact_phone: '021234567' });
    r = (await admin.get(`${A}/system`)).body.data;
    assert.equal(of('payment').ok && of('contact').ok, true);
    const text = JSON.stringify(r);
    for (const k of ['LINE_CHANNEL_SECRET', 'LINE_LOGIN_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'JOBS_SECRET', 'DATA_ENCRYPTION_KEY']) assert.ok(!text.includes(process.env[k]), k);
    assert.equal((await (await s.adminClient('training_staff')).get(`${A}/system`)).status, 403);
    assert.equal((await admin.post(`${A}/system/backup`)).status, 403, 'สำรองเองเฉพาะ Super Admin');
  });
});
