// นำเข้า knowledge/*.md เป็นฉบับร่าง (รันซ้ำได้ ข้ามเนื้อหาที่มีแล้ว)
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config/env.js';
import { pool } from '../src/config/db.js';
import { CATEGORIES, create } from '../src/services/knowledgeService.js';

export async function importKnowledge(log = console.log) {
  const dir = path.join(ROOT, 'knowledge');
  for (const file of (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort()) {
    const raw = await fs.readFile(path.join(dir, file), 'utf8');
    const category = raw.match(/^หมวด:\s*(.+)$/m)?.[1]?.trim();
    if (!CATEGORIES.includes(category)) continue;
    const keywords = raw.match(/^คำค้น:\s*(.+)$/m)?.[1]?.trim() ?? null;
    const content = raw.replace(/^(หมวด|คำค้น):.*\n/gm, '').trim();
    const title = content.match(/^# (.+)$/m)[1];
    try { await create({ category, title, content, keywords, status: 'draft', priority: 0 }, { adminId: null, ip: 'cli' }); log(`นำเข้า ${file}`); } catch (err) {
      if (err.code !== 'DUPLICATE') throw err;
      log(`ข้าม ${file} (มีแล้ว)`);
    }
  }
}
if (process.argv[1] === import.meta.filename) { await importKnowledge(); await pool.end(); }
