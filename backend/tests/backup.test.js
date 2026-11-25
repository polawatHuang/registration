import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startStack } from './helpers.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
let s;
before(async () => { s = await startStack(); });
after(() => s?.stop());
const run = (script, args = [], env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [`backend/scripts/${script}`, ...args], { cwd: ROOT, env: { ...process.env, ...env } });
  let out = ''; for (const x of [c.stdout, c.stderr]) x.on('data', (d) => { out += d; });
  c.on('close', (code) => resolve({ code, out }));
});
const dir = () => path.join(s.storage, 'backups');

describe('สำรองและกู้คืน', () => {
  test('สำรอง → กู้ลงฐานข้อมูลว่าง ได้ข้อมูลและโครงสร้างเท่าเดิม ถอดรหัสเลขบัตรได้ และไม่มี session', async () => {
    const r = await s.apply({ sessionId: await s.newSession(), fullName: "ต้น 'ข้าว' \\ ใจดี" });
    const admin = await s.adminClient();
    await s.query("UPDATE applications SET created_at = '2020-01-02 03:04:05'");
    await s.query("UPDATE application_documents SET created_at = '2020-01-02 03:04:05.678'");
    const b = await run('backup.js', [], { BACKUP_KEEP: '2' });
    assert.equal(b.code, 0, b.out);
    const [name] = (await fs.readdir(dir())).filter((n) => n.endsWith('.lstb'));
    const raw = await fs.readFile(path.join(dir(), name));
    for (const bad of [r.fields.email, r.fields.mobile, 'CREATE TABLE']) assert.ok(!raw.includes(bad), bad);
    assert.equal((await fs.stat(path.join(dir(), name))).mode & 0o777, 0o600);
    await s.query('CREATE DATABASE lst_restore');
    const target = { DB_NAME: 'lst_restore' };
    const done = await run('restore.js', [name], target);
    assert.equal(done.code, 0, done.out);
    const tables = (await s.query("SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'lst_test'")).map((t) => t.n);
    for (const t of tables) {
      const [a] = await s.query(`SELECT COUNT(*) n FROM lst_test.${t}`); const [c] = await s.query(`SELECT COUNT(*) n FROM lst_restore.${t}`);
      if (['admin_sessions', 'applicant_sessions', 'line_login_states', 'auth_attempts', 'job_locks', 'admin_line_codes'].includes(t)) assert.equal(c.n, 0, t); else assert.equal(c.n, a.n, t);
    }
    for (const t of tables.filter((x) => !['admin_sessions', 'applicant_sessions', 'line_login_states', 'auth_attempts', 'job_locks', 'admin_line_codes'].includes(x))) assert.deepEqual(await s.query(`SELECT * FROM lst_restore.${t} ORDER BY 1`), await s.query(`SELECT * FROM lst_test.${t} ORDER BY 1`), t);
    const { decryptText } = await import('../src/utils/crypto.js');
    const [p] = await s.query('SELECT national_id_enc FROM lst_restore.applicants LIMIT 1');
    assert.equal(decryptText(p.national_id_enc, 'national_id'), r.fields.nationalId);
    assert.equal((await run('migrate.js', [], target)).code, 0, 'migrate ต่อได้');
    assert.match((await run('restore.js', [name], target)).out, /ปลายทางไม่ว่าง/);
    assert.ok(admin);
  });
  test('ไฟล์ถูกแก้ ขาด หรือคนละกุญแจ ถูกปฏิเสธก่อนแตะฐานข้อมูล; เก็บเฉพาะไฟล์ล่าสุดตามกำหนด', async () => {
    const [name] = (await fs.readdir(dir())).filter((n) => n.endsWith('.lstb'));
    const good = await fs.readFile(path.join(dir(), name));
    const bad = path.join(s.storage, 'bad.lstb');
    for (const b of [Buffer.concat([good.subarray(0, 60), Buffer.from([good[60] ^ 1]), good.subarray(61)]), good.subarray(0, good.length - 40), Buffer.from('hello world hello world hello world hello')]) {
      await fs.writeFile(bad, b);
      const r = await run('restore.js', ['--check', bad]);
      assert.equal(r.code, 1, r.out);
    }
    const other = await run('restore.js', ['--check', name], { DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
    assert.match(other.out, /กุญแจ/);
    assert.match((await run('restore.js', ['--check', name])).out, /ไฟล์สมบูรณ์/);
    for (let i = 0; i < 3; i += 1) assert.equal((await run('backup.js', [], { BACKUP_KEEP: '2' })).code, 0);
    assert.equal((await fs.readdir(dir())).length, 2);
  });
  test('สร้าง Super Admin จากตัวแปรใน .env ได้โดยไม่ต้องใช้ SSH', async () => {
    const r = await run('create-admin.js', [], { ADMIN_USERNAME: 'fromenv', ADMIN_NAME: 'ผู้ดูแล', ADMIN_PASSWORD: 'x'.repeat(16) });
    assert.equal(r.code, 0, r.out);
    assert.ok(!r.out.includes('xxxx'));
    assert.equal((await s.query("SELECT COUNT(*) n FROM admin_users WHERE username = 'fromenv'"))[0].n, 1);
  });
  test('ตัวตั้งเวลาในแอปรันงานเอง และหยุดได้', async () => {
    const { startScheduler } = await import('../src/jobs/scheduler.js');
    await s.query('UPDATE job_locks SET last_finished_at = NULL');
    const keep = setInterval(() => {}, 50); // timer ของตัวตั้งเวลาไม่ค้ำโปรเซส
    const stop = startScheduler({ every: 60_000, first: 10 });
    let n = 0;
    for (let i = 0; i < 60 && n < 5; i += 1) { await new Promise((x) => setTimeout(x, 50)); [{ n }] = await s.query('SELECT COUNT(*) n FROM job_locks WHERE last_finished_at IS NOT NULL'); }
    stop(); clearInterval(keep);
    assert.equal(n, 5);
  });
});
