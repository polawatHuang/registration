// เขียนส่วนหัวของทุกหน้าให้เบราว์เซอร์โหลดพร้อมกัน ไม่ต้องไล่ทีละชั้น: npm run pages
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
async function deps(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = await fs.readFile(path.join(root, 'assets/js', file), 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s+'\.\/([\w-]+\.js)'/g)) await deps(m[1], seen);
  return seen;
}
const START = '<!-- preload -->'; const END = '<!-- /preload -->';
export async function stamp(write = true) {
  const pages = [...(await fs.readdir(root)).filter((f) => f.endsWith('.html')), ...(await fs.readdir(path.join(root, 'admin'))).map((f) => `admin/${f}`)];
  const stale = [];
  for (const p of pages) {
    const file = path.join(root, p);
    const html = await fs.readFile(file, 'utf8');
    const entry = html.match(/<script type="module" src="\/assets\/js\/([\w-]+\.js)">/)?.[1];
    if (!entry) continue;
    const mods = [...await deps(entry)].sort();
    const block = [START, '<script async src="/api/v1/warm.js"></script>', '<link rel="preload" href="/assets/fonts/prompt-thai-400.woff2" as="font" type="font/woff2" crossorigin>',
      ...mods.map((m) => `<link rel="modulepreload" href="/assets/js/${m}">`), END].join('\n');
    const clean = html.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), '').replace(/<script src="\/assets\/vendor\/(?:chart\.umd|jsqr)\.js"><\/script>\n?/g, '');
    const next = clean.replace('<link rel="icon"', `${block}\n<link rel="icon"`);
    if (next !== html) { stale.push(p); if (write) await fs.writeFile(file, next); }
  }
  return stale;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`updated ${(await stamp()).length} pages`);
