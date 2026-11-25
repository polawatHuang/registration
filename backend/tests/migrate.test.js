import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { createDB } from 'mysql-memory-server';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIR = path.join(ROOT, 'backend/database/migrations');
let server; let root; let statements; let clean; let n = 0;
const KEYS = { DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), DATA_HASH_KEY: crypto.randomBytes(32).toString('base64'), JOBS_SECRET: crypto.randomBytes(24).toString('hex') };

/** รันสคริปต์จริงแบบเดียวกับ Plesk */
function run(db, script = 'migrate.js', { killWhen } = {}) {
  const child = spawn(process.execPath, [`backend/scripts/${script}`], { cwd: ROOT, env: { ...process.env, NODE_ENV: 'test', APP_URL: 'http://127.0.0.1:3999', TRUST_PROXY: '0', DB_HOST: '127.0.0.1', DB_PORT: String(server.port), DB_NAME: db, DB_USER: server.username, DB_PASSWORD: '', LOG_LEVEL: 'silent', ...KEYS } });
  let out = '';
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; });
  const done = new Promise((r) => { child.on('close', (code) => r({ code, out })); });
  if (killWhen) killWhen(child);
  return done;
}
async function newDb() {
  const name = `mig_${n += 1}`;
  await root.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  return name;
}
async function raw(db, list) {
  await root.query(`USE ${db}`);
  for (const sql of list) await root.query(sql);
  await root.query('USE mysql');
}
async function schema(db) {
  const q = async (sql) => (await root.query(sql, [db]))[0].map((r) => Object.values(r).join('|')).sort();
  return {
    columns: await q("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COALESCE(COLUMN_DEFAULT, 'NULL'), EXTRA, COALESCE(COLLATION_NAME, '') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?"),
    indexes: await q('SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?'),
    constraints: await q('SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ?'),
  };
}
const ok = (r) => { assert.equal(r.code, 0, r.out); assert.match(r.out, /database is up to date/); };

before(async () => {
  server = await createDB({ version: '8.4.x', dbName: 'base', logLevel: 'ERROR' });
  root = await mysql.createConnection({ host: '127.0.0.1', port: server.port, user: server.username });
  statements = [];
  for (const f of (await fs.readdir(DIR)).sort()) statements.push(...(await fs.readFile(path.join(DIR, f), 'utf8')).replace(/^--.*$/gm, '').split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean));
  const db = await newDb();
  ok(await run(db));
  clean = await schema(db);
  assert.ok(clean.columns.length > 200);
});
after(async () => { await root?.end(); await server?.stop(); });

describe('db:migrate ทำต่อจากจุดค้าง', () => {
  test('ค้างหลังคำสั่งใดก็ตามโดยไม่มีบันทึก รันซ้ำแล้วได้โครงสร้างเท่าติดตั้งใหม่', async () => {
    const total = statements.length;
    const cuts = process.env.MIGRATE_ALL_CUTS ? Array.from({ length: total }, (_, i) => i + 1) : [1, 8, 22, 23, 27, Math.floor(total * 0.75), total];
    for (const cut of cuts) {
      const db = await newDb();
      await raw(db, statements.slice(0, cut));
      ok(await run(db));
      assert.deepEqual(await schema(db), clean, `cut ${cut}/${total}`);
      await root.query(`DROP DATABASE ${db}`);
    }
  });

  test('โปรเซสถูกฆ่ากลางทาง รันซ้ำแล้วสำเร็จ และรันอีกครั้งไม่มีอะไรเปลี่ยน', async () => {
    const db = await newDb();
    const dead = await run(db, 'migrate.js', { killWhen: async (child) => {
      for (let i = 0; i < 500; i += 1) {
        const [[r]] = await root.query('SELECT COUNT(*) c FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [db]);
        if (r.c >= 9) break;
        await new Promise((x) => { setTimeout(x, 5); });
      }
      child.kill('SIGKILL');
    } });
    assert.notEqual(dead.code, 0);
    assert.doesNotMatch(dead.out, /up to date/);
    ok(await run(db));
    assert.deepEqual(await schema(db), clean);
    ok(await run(db));
    const [[left]] = await root.query(`SELECT COUNT(*) c FROM ${db}.schema_migration_steps`);
    assert.equal(left.c, 0);
  });

  test('กด Run สองครั้งพร้อมกัน ไม่พัง', async () => {
    const db = await newDb();
    const both = await Promise.all([run(db), run(db)]);
    for (const r of both) if (r.code !== 0) assert.match(r.out, /มีการรัน db:migrate อีกชุด/);
    assert.ok(both.some((r) => r.code === 0), both[0].out);
    ok(await run(db));
    assert.deepEqual(await schema(db), clean);
  });

  test('ข้อมูลเดิมไม่หาย', async () => {
    const db = await newDb();
    await raw(db, [...statements.slice(0, 22), "INSERT INTO universities (name) VALUES ('เดิม')"]);
    ok(await run(db));
    const [[u]] = await root.query(`SELECT name FROM ${db}.universities`);
    assert.equal(u.name, 'เดิม');
  });

  test('ตารางชื่อซ้ำของระบบอื่น: หยุด บอกสาเหตุ ไม่แตะตาราง', async () => {
    const db = await newDb();
    await raw(db, ['CREATE TABLE courses (id INT PRIMARY KEY, title VARCHAR(10))', "INSERT INTO courses VALUES (1, 'x')"]);
    const r = await run(db);
    assert.equal(r.code, 1);
    assert.match(r.out, /courses อยู่แล้วแต่โครงสร้างไม่ตรง/);
    const [rows] = await root.query(`SELECT * FROM ${db}.courses`);
    assert.deepEqual(rows.map((x) => ({ ...x })), [{ id: 1, title: 'x' }]);
  });

  test('คำสั่งที่ล้มเหลวบอกไฟล์และลำดับ แก้สาเหตุแล้วทำต่อได้', async () => {
    const db = await newDb();
    await raw(db, ['CREATE VIEW applicants AS SELECT 1 AS a']);
    const bad = await run(db);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /001_core\.sql คำสั่งที่ 6\//);
    await raw(db, ['DROP VIEW applicants']);
    ok(await run(db));
    assert.deepEqual(await schema(db), clean);
  });

  test('db:status อ่านได้ทุกสภาพโดยไม่เปลี่ยนฐานข้อมูล', async () => {
    const db = await newDb();
    const empty = await run(db, 'db-status.js');
    assert.equal(empty.code, 0, empty.out);
    assert.match(empty.out, /– 001_core\.sql/);
    const [tables] = await root.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [db]);
    assert.equal(tables.length, 0);
    ok(await run(db));
    const full = await run(db, 'db-status.js');
    assert.match(full.out, /✓ 008_notifications\.sql/);
    assert.match(full.out, /บทบาท: 4 \| ผู้ดูแล: 0/);
    assert.ok(!full.out.includes('ยังไม่มี'));
  });
});
