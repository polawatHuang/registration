// วัดทุก API ที่หน้าเว็บใช้ ด้วยข้อมูลจำนวนมากในระบบชั่วคราว: npm run test:perf
import { Client, startStack } from '../tests/helpers.js';

const LIMIT = Number(process.env.PERF_LIMIT_MS ?? 1500);
const s = await startStack();
const { pool } = await import('../src/config/db.js'); const seedConn = await pool.getConnection(); await seedConn.query("SET SESSION sql_mode = ''");
const fill = async (sql, n, row, size = 1000) => { for (let i = 0; i < n; i += size) { const rows = Array.from({ length: Math.min(size, n - i) }, (_, k) => row(i + k)); await seedConn.query(`${sql} VALUES ${rows.map((r) => `(${r.map((v) => (v === null ? 'NULL' : typeof v === 'number' ? v : `'${v}'`)).join(',')})`).join(',')}`).catch((e) => { throw new Error(`${e.code} ${e.sqlMessage} :: ${sql.slice(0, 70)}`); }); } };
let bad = 0;
try {
  const session = await s.newSession();
  const one = await s.apply({ sessionId: session });
  const A = 'SELECT applicant_id, shop_duration_option_id FROM applications LIMIT 1';
  const [{ applicant_id: ap, shop_duration_option_id: op }] = await s.query(A);
  const sessions = [session]; for (let i = 0; i < 59; i += 1) sessions.push(await s.newSession());
  const st = ['submitted', 'under_review', 'documents_incomplete', 'approved', 'awaiting_training', 'attended', 'passed', 'certified', 'cancelled'];
  const { encryptText, keyedHash } = await import('../src/utils/crypto.js');
  const nid = encryptText('1101700230708', 'national_id'); const chat = encryptText('ข้อความทดสอบความเร็ว', 'chat'); const q = encryptText('ต้องใช้เอกสารอะไรบ้าง', 'ai_question');
  const N = 8000;
  await fill('INSERT INTO applicants (id, full_name, national_id_enc, national_id_hash)', N, (i) => [100000 + i, `ผู้ทดสอบ ${i}`, nid, keyedHash('x', i)]);
  await fill('INSERT INTO applications (id, application_no, applicant_id, session_id, idempotency_key, full_name, address, mobile, email, shop_name, shop_address, shop_duration_option_id, has_trained_before, receipt_name, receipt_address, status, submitted_at)', N,
    (i) => [100000 + i, `ET69-P${String(i).padStart(7, '0')}`, 100000 + i, i < 2500 ? session : sessions[i % 60], `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `ผู้ทดสอบ ${i}`, 'ที่อยู่ 10110', '0812345678', 'p@example.com', 'ร้าน', 'ที่อยู่', op, 0, 'ชื่อ', 'ที่อยู่', st[i % 9], `2026-${String(1 + (i % 11)).padStart(2, '0')}-10 03:00:00`]);
  await fill('INSERT INTO application_documents (application_id, doc_type, original_name, storage_name, mime_type, size_bytes, sha256)', N * 3, (i) => [100000 + Math.floor(i / 3), ['id_card', 'payment_slip', 'portrait_photo'][i % 3], 'a.png', `aa/${i}`, 'image/png', 1, 'x']);
  await fill('INSERT INTO application_status_history (application_id, to_status, actor_type)', N * 4, (i) => [100000 + Math.floor(i / 4), 'submitted', 'applicant']);
  await fill('INSERT INTO line_users (id, line_user_id, display_name)', 4000, (i) => [100000 + i, `Uperf${i}`, `LINE ${i}`]);
  await fill('INSERT INTO chat_conversations (id, line_user_id, last_message_at, preview_enc)', 4000, (i) => [100000 + i, 100000 + i, '2026-11-20 00:00:00', chat]);
  await fill('INSERT INTO chat_messages (conversation_id, direction, sender, message_type, content_enc, status, created_at)', 60000, (i) => [i < 5000 ? 100000 : 100000 + (i % 4000), i % 2 ? 'in' : 'out', i % 2 ? 'user' : 'admin', 'text', chat, 'sent', '2026-11-20 00:00:00']);
  await fill('INSERT INTO ai_interactions (conversation_id, channel, mode, question_enc, tokens_total, created_at)', 6000, (i) => [100000 + (i % 4000), 'line', i % 3 ? 'answer' : 'fallback', q, 100, '2026-11-20 00:00:00']);
  await s.query('UPDATE ai_interactions SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL id % 25 DAY)');
  await fill('INSERT INTO notification_queue (application_id, line_user_id, notification_type, scheduled_at, expires_at, next_attempt_at, idempotency_key, retry_key, created_at, status, sent_at)', 30000, (i) => [100000 + (i % N), 100000 + (i % 4000), 'approved', '2026-11-20', '2026-11-21', '2026-11-20', `p${i}`, 'x', '2026-11-20', 'sent', '2026-11-20']);
  await fill('INSERT INTO attendance_records (application_id, session_id, day, check_in_at, check_in_method)', N, (i) => [100000 + i, i < 2500 ? session : sessions[i % 60], '2026-11-20', '2026-11-20 02:00:00', 'qr']);
  await fill('INSERT INTO attendance_scans (session_id, application_id, action, method, result, created_at)', 20000, (i) => [session, 100000 + (i % N), 'in', 'qr', 'ok', '2026-11-20']);
  await fill('INSERT INTO certificates (certificate_no, verify_code, application_id, holder_name, course_name, university_name, session_name, starts_at, ends_at, issued_at)', 4000, (i) => [`C${i}`, String(i).padStart(16, 'A'), 100000 + i, `ผู้ทดสอบ ${i}`, 'ห', 'ม', 'ร', '2026-11-20', '2026-11-20', '2026-11-20']);
  await fill('INSERT INTO admin_audit_logs (actor_type, action, entity_type)', 60000, () => ['system', 'x', 'y']);
  await fill('INSERT INTO ai_knowledge (source_type, category, title, content, status)', 400, (i) => ['faq', 'FAQ', `คำถาม ${i}`, 'คำตอบ '.repeat(80), 'published']);
  seedConn.release();
  for (const t of ['applications', 'applicants', 'chat_messages', 'chat_conversations', 'notification_queue', 'ai_interactions', 'attendance_records', 'application_documents']) await s.query(`ANALYZE TABLE ${t}`);
  const admin = await s.adminClient(); const anon = new Client(s.base);
  const a = '/api/v1/admin';
  const list = [[anon, '/api/v1/catalog/universities'], [anon, `/api/v1/catalog/sessions?universityId=${s.uni}`], [anon, '/api/v1/catalog/options'], [anon, '/api/v1/catalog/site-info'], [anon, '/api/v1/catalog/schedule'], [anon, '/api/v1/catalog/legal'], [anon, '/api/v1/auth/session'], [one.client, '/api/v1/applications/me/status'], [anon, '/api/v1/certificates/verify/AAAAAAAAAAAAA222'],
    ...['/auth/me', '/dashboard', '/system', '/retention/summary', '/notifications/state', '/chat/state', '/chat/poll?filter=attention', '/chat/poll?filter=all', '/chat/poll?filter=all&q=LINE', '/chat/100000', '/chat/100000/messages', '/applications?page=1&pageSize=20', '/applications?q=%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A&pageSize=8', '/applications?page=300&pageSize=20', '/applications/100000', '/attendance/sessions', `/attendance/sessions/${session}/roster`, `/attendance/sessions/${session}/scans`, '/certificates?page=1', `/certificates/candidates/${session}`, '/certificates/templates', '/catalog', '/notifications/templates', '/notifications/queue', '/notifications/campaigns', '/notifications/recipients', '/line/state', '/line/users', '/users', '/settings', '/legal', '/integrations', '/audit-logs', '/retention/due/applications', '/retention/requests', '/retention/log'].map((p) => [admin, a + p]),
    ...['/knowledge', '/report', '/history', '/credit'].map((p) => [admin, `/api/v1/ai${p}`])];
  for (const [c, p] of list) {
    const times = [];
    let r; for (let i = 0; i < 3; i += 1) { const t = performance.now(); r = await c.get(p); times.push(performance.now() - t); }
    const max = Math.max(...times); const ok = r.status === 200 && max < LIMIT; if (!ok) bad += 1;
    console.log(`${ok ? ' ' : '✖'} ${String(Math.round(max)).padStart(5)} ms  ${String(Math.round(r.buffer.length / 1024)).padStart(5)} KB  ${r.status}  ${p.slice(0, 90)}`);
  }
} finally { await s.stop(); }
console.log(bad ? `มี ${bad} รายการเกิน ${LIMIT} ms หรือผิดพลาด` : `ทุกรายการเร็วกว่า ${LIMIT} ms`);
process.exitCode = bad ? 1 : 0;
