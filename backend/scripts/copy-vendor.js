// คัดลอกไลบรารี frontend มาไว้ในเว็บเอง (ไม่พึ่ง CDN) รันเมื่ออัปเดตเวอร์ชันเท่านั้น
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'frontend/assets');
const copies = [
  ['bootstrap-icons/font/bootstrap-icons.min.css', 'vendor/bootstrap-icons.min.css'],
  ['bootstrap-icons/font/fonts/bootstrap-icons.woff2', 'vendor/fonts/bootstrap-icons.woff2'],
  ['chart.js/dist/chart.umd.js', 'vendor/chart.umd.js'],
  ['jsqr/dist/jsQR.js', 'vendor/jsqr.js'],
];
for (const w of [400, 500, 600, 700]) for (const s of ['thai', 'latin']) copies.push([`@fontsource/prompt/files/prompt-${s}-${w}-normal.woff2`, `fonts/prompt-${s}-${w}.woff2`]);
copies.push(['@fontsource/prompt/files/prompt-latin-700-italic.woff2', 'fonts/prompt-latin-700-italic.woff2']);
for (const [from, to] of copies) {
  await fs.mkdir(path.dirname(path.join(out, to)), { recursive: true });
  let data = await fs.readFile(path.join(nm, from));
  if (/\.(js|css)$/.test(to)) data = data.toString().replace(/\n?(?:\/\/|\/\*)# sourceMappingURL=.*$/m, '');
  await fs.writeFile(path.join(out, to), data);
}
const notices = [];
for (const [pkg, file] of [['bootstrap-icons', 'LICENSE'], ['chart.js', 'LICENSE.md'], ['jsqr', 'LICENSE'], ['@fontsource/prompt', 'LICENSE']]) notices.push(`===== ${pkg} =====\n${await fs.readFile(path.join(nm, pkg, file), 'utf8')}`);
await fs.writeFile(path.join(out, 'licenses.txt'), notices.join('\n\n'));
console.log(`copied ${copies.length} files`);
