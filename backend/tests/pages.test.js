import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '../..');
describe('ความเร็วการโหลดหน้า', () => {
  test('ทุกหน้ามีรายการโหลดล่วงหน้าตรงกับโค้ด และไม่มีไลบรารีใหญ่ขวางการแสดงผล', async () => {
    const { stamp } = await import('../scripts/stamp-pages.js');
    assert.deepEqual(await stamp(false), [], 'รัน npm run pages หลังแก้ import');
    for (const dir of ['', 'admin/']) for (const f of await fs.readdir(path.join(ROOT, 'frontend', dir))) {
      if (!f.endsWith('.html')) continue;
      const html = await fs.readFile(path.join(ROOT, 'frontend', dir, f), 'utf8');
      assert.ok(!/<script(?![^>]*(?:async|defer|type="module"))[^>]*src=/.test(html), `${dir}${f} มี script ที่ขวางการแสดงผล`);
    }
  });
  test('เมนูครบทุกหน้า แต่ละหน้าอยู่ในหมวด และไม่มีลิงก์ไปหน้าที่ไม่มีจริง', async () => {
    const src = await fs.readFile(path.join(ROOT, 'frontend/assets/js/admin.js'), 'utf8');
    const block = src.slice(src.indexOf('export const GROUPS'), src.indexOf('export const MENU'));
    const linked = new Set([...block.matchAll(/^\s*(?:\['', \[)?\['([a-z-]+)', '[a-z0-9-]+', '/gm)].map((m) => m[1]).concat([...block.matchAll(/\[\['(dashboard)'/g)].map((m) => m[1])));
    const pages = (await fs.readdir(path.join(ROOT, 'frontend/admin'))).map((f) => f.replace('.html', '')).filter((p) => p !== 'login');
    assert.deepEqual([...linked].sort(), pages.sort());
    const { PERMISSIONS } = await import('../src/config/permissions.js');
    for (const [, key] of block.matchAll(/'([a-z]+\.[a-z]+)'/g)) assert.ok(PERMISSIONS[key], key);
  });
  test('เปิดแอปเร็ว ไม่มีงานหนักตอนโหลดโมดูล และปิดเรียบร้อย', async () => {
    const env = { ...process.env, NODE_ENV: 'production', PORT: '0', APP_URL: 'https://example.test', TRUST_PROXY: '1', DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'x', DB_USER: 'x', DB_PASSWORD: 'x', JOBS_IN_APP: '0', LOG_LEVEL: 'silent', STORAGE_PATH: './storage', DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), DATA_HASH_KEY: crypto.randomBytes(32).toString('base64'), JOBS_SECRET: crypto.randomBytes(24).toString('hex') };
    const run = (code) => new Promise((resolve) => { const c = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env }); let o = ''; for (const x of [c.stdout, c.stderr]) x.on('data', (d) => { o += d; }); c.on('close', (exit) => resolve({ exit, o })); });
    const loaded = await run("import { registerHooks } from 'node:module'; const seen = new Set(); registerHooks({ load(u, c, n) { for (const m of ['pdfkit', 'mammoth', 'nodemailer', 'write-excel-file', 'unpdf']) if (u.includes(`/node_modules/${m}/`)) seen.add(m); return n(u, c); } }); await import('./backend/src/app.js'); console.log('HEAVY:' + [...seen].join(',')); process.exit(0);");
    assert.match(loaded.o, /HEAVY:\s*$/m, 'ไลบรารีใหญ่ต้องโหลดเมื่อใช้');
    const src = await fs.readFile(path.join(ROOT, 'backend/src/services/adminAuthService.js'), 'utf8');
    assert.ok(!/hashSync\(/.test(src), 'ห้ามคำนวณ hash ตอนเปิดแอป');
    const port = 3900 + Math.floor(Math.random() * 90);
    const c = spawn(process.execPath, ['app.cjs'], { cwd: ROOT, env: { ...env, PORT: String(port) }, stdio: 'ignore' });
    const res = await new Promise((resolve, reject) => { const t = Date.now(); const poll = () => { const r = http.get(`http://127.0.0.1:${port}/api/v1/warm.js`, (x) => { x.resume(); resolve(x); }); r.on('error', () => (Date.now() - t < 30_000 ? setTimeout(poll, 40) : reject(new Error('ไม่เปิด')))); }; poll(); });
    assert.equal(res.headers['cache-control'], 'no-store');
    const exit = new Promise((r) => { c.once('exit', r); });
    c.kill('SIGINT');
    assert.equal(await exit, 0);
  });
});
describe('SEO หน้าแรก', () => {
  test('meta, ภาพแชร์, ข้อมูลโครงสร้าง, sitemap และ robots สอดคล้องกัน', async () => {
    const f = (p) => fs.readFile(path.join(ROOT, 'frontend', p), 'utf8');
    const html = await f('index.html');
    const meta = (n) => html.match(new RegExp(`<meta (?:name|property)="${n}" content="([^"]+)"`))?.[1];
    assert.ok(html.match(/<title>(.+)<\/title>/)[1].length <= 70);
    assert.ok(meta('description').length >= 70 && meta('description').length <= 160);
    const base = html.match(/rel="canonical" href="(https:\/\/[^"]+)\/"/)[1];
    for (const n of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:image']) assert.ok(meta(n), n);
    const img = await fs.readFile(path.join(ROOT, 'frontend', new URL(meta('og:image')).pathname));
    assert.ok(img[0] === 0xff && img[1] === 0xd8 && img.length < 300_000);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
    for (const q of ld.find((x) => x['@type'] === 'FAQPage').mainEntity) assert.ok(html.includes(`<summary>${q.name}</summary><p>${q.acceptedAnswer.text}</p>`), 'คำถามในข้อมูลโครงสร้างต้องเห็นได้บนหน้า');
    const sitemap = await f('sitemap.xml');
    for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) { assert.ok(loc.startsWith(base)); const p = new URL(loc).pathname; await f(p === '/' ? 'index.html' : p.slice(1)); }
    const robots = await f('robots.txt');
    assert.ok(robots.includes(`Sitemap: ${base}/sitemap.xml`) && robots.includes('Disallow: /admin/') && robots.includes('Allow: /api/v1/catalog/'));
    for (const p of ['tracking.html', 'me.html', 'certificate.html', '404.html', 'admin/login.html', 'admin/dashboard.html']) assert.match(await f(p), /name="robots" content="noindex/, p);
    assert.equal((html.match(/<h1/g) ?? []).length, 1);
    JSON.parse(await f('site.webmanifest'));
  });
});
describe('งานเบื้องหลัง', () => {
  test('ปิดแอปรองานที่ค้างให้จบ รวมงานที่งอกเพิ่ม และไม่รอเกินเวลา', async () => {
    const { drain, pendingTasks, track } = await import('../src/utils/background.js');
    const done = [];
    track((async () => { await new Promise((r) => setTimeout(r, 80)); done.push('a'); track((async () => { await new Promise((r) => setTimeout(r, 80)); done.push('b'); })()); })());
    track(Promise.reject(new Error('x'))).catch(() => {});
    assert.equal(await drain(3000), true);
    assert.deepEqual(done, ['a', 'b']);
    assert.equal(pendingTasks(), 0);
    let stop; track(new Promise((r) => { stop = r; }));
    const t = Date.now();
    assert.equal(await drain(150), false);
    assert.ok(Date.now() - t < 1000);
    stop();
  });
});
