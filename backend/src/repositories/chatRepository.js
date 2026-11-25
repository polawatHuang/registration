import { query, queryOne } from '../config/db.js';

// ---------- webhook ----------
export const insertEvent = async (e) => (await query(`INSERT IGNORE INTO line_webhook_events (event_id, user_hash, payload_enc, created_at)
  VALUES (:eventId, :userHash, :payload, UTC_TIMESTAMP())`, e)).affectedRows;
export async function claimEvents(token, limit) {
  await query("UPDATE line_webhook_events SET status = 'pending', claim_token = NULL WHERE status = 'processing' AND claimed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 MINUTE)");
  // ข้ามผู้ใช้ที่อีกโปรเซสกำลังทำอยู่ ให้ข้อความของคนเดียวกันเรียงลำดับเสมอ
  const busy = (await query("SELECT DISTINCT user_hash FROM line_webhook_events WHERE status = 'processing'")).map((r) => r.user_hash);
  await query(`UPDATE line_webhook_events SET status = 'processing', claim_token = :token, claimed_at = UTC_TIMESTAMP(), attempts = attempts + 1
    WHERE status = 'pending' ${busy.length ? 'AND user_hash NOT IN (:busy)' : ''} ORDER BY id LIMIT :limit`, { token, busy, limit });
  return query("SELECT id, user_hash, payload_enc, attempts FROM line_webhook_events WHERE claim_token = :token AND status = 'processing' ORDER BY id", { token });
}
export const eventDone = (id) => query("UPDATE line_webhook_events SET status = 'done', payload_enc = NULL WHERE id = :id", { id });
export const eventFailed = (id, final) => query("UPDATE line_webhook_events SET status = :status, claim_token = NULL WHERE id = :id", { id, status: final ? 'failed' : 'pending' });
export const cleanEvents = async () => (await query("DELETE FROM line_webhook_events WHERE status IN ('done','failed') AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)")).affectedRows;

// ---------- ผู้ใช้และห้องแชต ----------
export async function ensureUser(lineUserId, conn) {
  await query(`INSERT INTO line_users (line_user_id, last_interaction_at) VALUES (:lineUserId, UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE last_interaction_at = UTC_TIMESTAMP()`, { lineUserId }, conn);
  return queryOne('SELECT id, line_user_id, display_name, status, profile_at FROM line_users WHERE line_user_id = :lineUserId', { lineUserId }, conn);
}
export const setFriend = (id, status, conn) => query('UPDATE line_users SET friend_status = :status WHERE id = :id', { id, status }, conn);
export const setProfile = (id, name, picture) => query('UPDATE line_users SET display_name = COALESCE(:name, display_name), picture_url = COALESCE(:picture, picture_url), profile_at = UTC_TIMESTAMP() WHERE id = :id', { id, name, picture });
export async function ensureConversation(lineUserId, conn) {
  await query('INSERT IGNORE INTO chat_conversations (line_user_id, created_at, updated_at) VALUES (:lineUserId, UTC_TIMESTAMP(), UTC_TIMESTAMP(3))', { lineUserId }, conn);
  return queryOne('SELECT * FROM chat_conversations WHERE line_user_id = :lineUserId FOR UPDATE', { lineUserId }, conn);
}
export const lockConversation = (id, conn) => queryOne(`SELECT c.*, l.line_user_id AS line_uid, l.friend_status FROM chat_conversations c JOIN line_users l ON l.id = c.line_user_id WHERE c.id = :id FOR UPDATE`, { id }, conn);
export const findConversation = (id) => queryOne(`SELECT c.*, l.line_user_id AS line_uid, l.display_name, l.picture_url, l.friend_status, l.status AS user_status, u.display_name AS assigned_name
  FROM chat_conversations c JOIN line_users l ON l.id = c.line_user_id LEFT JOIN admin_users u ON u.id = c.assigned_admin_id WHERE c.id = :id`, { id });
export const findByLineUser = (lineUserId, conn) => queryOne('SELECT * FROM chat_conversations WHERE line_user_id = :lineUserId', { lineUserId }, conn);

const touch = 'updated_at = UTC_TIMESTAMP(3)';
export const onInbound = (c, conn) => query(`UPDATE chat_conversations SET status = 'open', unread_count = unread_count + 1, message_count = message_count + 1, preview_enc = :preview,
  last_sender = 'user', last_message_at = UTC_TIMESTAMP(3), reply_token = :replyToken, reply_token_at = :tokenAt, ${touch} WHERE id = :id`, c, conn);
export const onOutbound = (c, conn) => query(`UPDATE chat_conversations SET message_count = message_count + 1, preview_enc = :preview, last_sender = :sender, last_message_at = UTC_TIMESTAMP(3), ${touch} WHERE id = :id`, c, conn);
export const setToken = (id, token, at, conn) => query('UPDATE chat_conversations SET reply_token = :token, reply_token_at = :at WHERE id = :id', { id, token, at }, conn);
export const takeToken = async (id, token) => (await query('UPDATE chat_conversations SET reply_token = NULL WHERE id = :id AND reply_token = :token', { id, token })).affectedRows === 1;
export const bump = (id, conn) => query(`UPDATE chat_conversations SET ${touch} WHERE id = :id`, { id }, conn);
export const setAttention = (id, reason, conn) => query(`UPDATE chat_conversations SET attention_reason = :reason, ${touch} WHERE id = :id`, { id, reason }, conn);
export const setAiMode = (id, mode, conn) => query(`UPDATE chat_conversations SET ai_mode = :mode, ${touch} WHERE id = :id`, { id, mode }, conn);
export const setStatus = (id, status, conn) => query(`UPDATE chat_conversations SET status = :status, ${touch} WHERE id = :id`, { id, status }, conn);
export const assign = (id, adminId, conn) => query(`UPDATE chat_conversations SET assigned_admin_id = :adminId, ${touch} WHERE id = :id`, { id, adminId }, conn);
export const markRead = (id, upTo, conn) => query(`UPDATE chat_conversations SET unread_count = (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = :id AND m.direction = 'in' AND m.id > :upTo), ${touch} WHERE id = :id AND unread_count > 0`, { id, upTo }, conn);

// ---------- ข้อความ ----------
export const insertMessage = async (m, conn) => (await query(`INSERT INTO chat_messages (conversation_id, direction, sender, admin_id, message_type, content_enc, line_message_id, status, retry_key, ai_meta_json, created_at, updated_at)
  VALUES (:conversationId, :direction, :sender, :adminId, :type, :content, :lineMessageId, :status, :retryKey, :aiMeta, COALESCE(:at, UTC_TIMESTAMP(3)), UTC_TIMESTAMP(3))`,
{ adminId: null, lineMessageId: null, retryKey: null, aiMeta: null, at: null, ...m }, conn)).insertId;
export const findByLineMessage = (lineMessageId, conn) => queryOne('SELECT * FROM chat_messages WHERE line_message_id = :lineMessageId', { lineMessageId }, conn);
export const findByRetryKey = (key) => queryOne('SELECT * FROM chat_messages WHERE retry_key = :key', { key });
export const findMessage = (id, conversationId) => queryOne('SELECT * FROM chat_messages WHERE id = :id AND conversation_id = :conversationId', { id, conversationId });
export const setMedia = (id, name, mime) => query('UPDATE chat_messages SET media_storage_name = :name, media_mime = :mime, updated_at = UTC_TIMESTAMP(3) WHERE id = :id', { id, name, mime });
export const finishMessage = (m) => query('UPDATE chat_messages SET status = :status, delivered_via = :via, error_message = :error, updated_at = UTC_TIMESTAMP(3) WHERE id = :id', m);
export const beginRetry = async (id, retryKey) => (await query("UPDATE chat_messages SET status = 'pending', error_message = NULL, retry_key = :retryKey, updated_at = UTC_TIMESTAMP(3) WHERE id = :id AND status = 'failed' AND direction = 'out'", { id, retryKey })).affectedRows === 1;
export const failStuck = async () => (await query("UPDATE chat_messages SET status = 'failed', error_message = 'ระบบหยุดระหว่างส่ง ตรวจใน LINE ก่อนส่งซ้ำ', updated_at = UTC_TIMESTAMP(3) WHERE status = 'pending' AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 MINUTE)")).affectedRows;
export const claimAi = async (id) => (await query("UPDATE chat_messages SET ai_state = 'working' WHERE id = :id AND ai_state IS NULL", { id })).affectedRows === 1;
export const aiDone = (id) => query("UPDATE chat_messages SET ai_state = 'done' WHERE id = :id", { id });
export const countAiReplies = async (conversationId) => (await queryOne("SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = :conversationId AND sender = 'ai' AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)", { conversationId })).n;
export const adminRepliedAfter = async (conversationId, messageId, conn) => Boolean(await queryOne("SELECT 1 FROM chat_messages WHERE conversation_id = :conversationId AND sender = 'admin' AND id > :messageId LIMIT 1", { conversationId, messageId }, conn));
export const lastInboundText = (conversationId) => queryOne("SELECT id, content_enc FROM chat_messages WHERE conversation_id = :conversationId AND direction = 'in' AND message_type = 'text' AND content_enc IS NOT NULL ORDER BY id DESC LIMIT 1", { conversationId });
export async function unsend(message, conn) {
  if (message.media_storage_name) await query('INSERT IGNORE INTO purge_files (storage_name) VALUES (:n)', { n: message.media_storage_name }, conn);
  await query("UPDATE chat_messages SET message_type = 'unsent', content_enc = NULL, media_storage_name = NULL, media_mime = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = :id", { id: message.id }, conn);
}
export const isLastMessage = async (m, conn) => (await queryOne('SELECT MAX(id) AS id FROM chat_messages WHERE conversation_id = :c', { c: m.conversation_id }, conn)).id === m.id;
export const setPreview = (id, preview, conn) => query(`UPDATE chat_conversations SET preview_enc = :preview, ${touch} WHERE id = :id`, { id, preview }, conn);

const MSG = `SELECT m.id, m.direction, m.sender, m.message_type, m.content_enc, m.media_mime, m.media_storage_name IS NOT NULL AS has_media, m.status, m.delivered_via, m.error_message, m.ai_meta_json, m.created_at, u.display_name AS admin_name
  FROM chat_messages m LEFT JOIN admin_users u ON u.id = m.admin_id`;
export const messagesBefore = (conversationId, before, limit) => query(`${MSG} WHERE m.conversation_id = :conversationId AND (:before IS NULL OR m.id < :before) ORDER BY m.id DESC LIMIT :limit`, { conversationId, before, limit });
export const messagesSince = (conversationId, after, since) => query(`${MSG} WHERE m.conversation_id = :conversationId AND (m.id > :after OR m.updated_at > :since) ORDER BY m.id LIMIT 200`, { conversationId, after, since });

// ---------- รายการ ----------
const FILTER = { all: "c.status = 'open'", unread: "c.status = 'open' AND c.unread_count > 0", attention: "c.status = 'open' AND c.attention_reason IS NOT NULL", mine: "c.status = 'open' AND c.assigned_admin_id = :adminId", closed: "c.status = 'closed'" };
export function listConversations({ filter, q, adminId, limit, offset }) {
  const like = q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null;
  return query(`SELECT c.id, c.status, c.ai_mode, c.attention_reason, c.unread_count, c.assigned_admin_id, c.preview_enc, c.last_sender, c.last_message_at, l.display_name, l.picture_url, l.friend_status
    FROM chat_conversations c JOIN line_users l ON l.id = c.line_user_id WHERE ${FILTER[filter]} AND c.last_message_at IS NOT NULL
    ${q ? 'AND (l.display_name LIKE :like OR EXISTS (SELECT 1 FROM applications a WHERE a.line_user_id = l.id AND (a.full_name LIKE :like OR CONVERT(a.application_no USING utf8mb4) LIKE :like OR a.mobile LIKE :like)))' : ''}
    ORDER BY c.last_message_at DESC, c.id DESC LIMIT :limit OFFSET :offset`, { like, adminId, limit, offset });
}
export const counts = (adminId) => queryOne(`SELECT COALESCE(SUM(status = 'open'), 0) AS open, COALESCE(SUM(status = 'open' AND unread_count > 0), 0) AS unread, COALESCE(SUM(status = 'open' AND attention_reason IS NOT NULL), 0) AS attention,
  COALESCE(SUM(status = 'open' AND assigned_admin_id = :adminId), 0) AS mine FROM chat_conversations WHERE last_message_at IS NOT NULL`, { adminId });
export const revision = async () => { const r = await queryOne('SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS t, COALESCE(SUM(message_count), 0) AS m, COALESCE(SUM(unread_count), 0) AS u FROM chat_conversations'); return `${r.n}.${new Date(r.t).getTime() || 0}.${r.m}.${r.u}`; };
export const linkedApplications = (lineUserId) => query(`SELECT a.id, a.application_no, a.full_name, a.status, s.session_name, s.starts_at FROM applications a JOIN training_sessions s ON s.id = a.session_id
  WHERE a.line_user_id = :lineUserId ORDER BY a.submitted_at DESC LIMIT 10`, { lineUserId });
export const serverNow = async () => (await queryOne('SELECT UTC_TIMESTAMP(3) AS t')).t;

// ---------- ลบ ----------
export async function deleteForLineUser(lineUserId, conn) {
  await query(`INSERT IGNORE INTO purge_files (storage_name) SELECT m.media_storage_name FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
    WHERE c.line_user_id = :lineUserId AND m.media_storage_name IS NOT NULL`, { lineUserId }, conn);
  const c = await queryOne('SELECT id FROM chat_conversations WHERE line_user_id = :lineUserId FOR UPDATE', { lineUserId }, conn);
  if (!c) return;
  await query('DELETE FROM chat_messages WHERE conversation_id = :id', { id: c.id }, conn);
  await query("UPDATE admin_audit_logs SET metadata_json = NULL WHERE entity_type = 'chat' AND entity_id = CAST(:id AS CHAR)", { id: c.id }, conn);
  await query('DELETE FROM chat_conversations WHERE id = :id', { id: c.id }, conn);
}
export const countOld = async (months) => (await queryOne('SELECT COUNT(*) AS n FROM chat_messages WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL :months MONTH)', { months })).n;
export async function deleteOld(months, conn) {
  const ids = (await query('SELECT id FROM chat_messages WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL :months MONTH) ORDER BY id LIMIT 5000 FOR UPDATE', { months }, conn)).map((r) => r.id);
  if (!ids.length) return 0;
  await query('INSERT IGNORE INTO purge_files (storage_name) SELECT media_storage_name FROM chat_messages WHERE id IN (:ids) AND media_storage_name IS NOT NULL', { ids }, conn);
  const { affectedRows } = await query('DELETE FROM chat_messages WHERE id IN (:ids)', { ids }, conn);
  await query('UPDATE chat_conversations SET preview_enc = NULL WHERE last_message_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL :months MONTH)', { months }, conn);
  return affectedRows;
}
