import { query, queryOne } from '../config/db.js';

export const list = () => query(`SELECT k.id, k.source_type, k.category, k.title, k.keywords, k.status, k.priority, k.original_name, k.size_bytes, CHAR_LENGTH(k.content) AS chars, k.updated_at, u.display_name AS updated_by_name
  FROM ai_knowledge k LEFT JOIN admin_users u ON u.id = k.updated_by WHERE k.deleted_at IS NULL ORDER BY k.status, k.category, k.priority DESC, k.id DESC`);
export const find = (id, conn) => queryOne('SELECT * FROM ai_knowledge WHERE id = :id AND deleted_at IS NULL', { id }, conn);
export const findBySha = (sha) => queryOne('SELECT id, title FROM ai_knowledge WHERE content_sha256 = :sha AND deleted_at IS NULL LIMIT 1', { sha });
export const published = () => query("SELECT id, category, title, content, keywords, priority FROM ai_knowledge WHERE deleted_at IS NULL AND status = 'published'");
export const stamp = async () => { const r = await queryOne("SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT_WS('|', id, title, keywords, priority, content))), 0) AS c FROM ai_knowledge WHERE deleted_at IS NULL AND status = 'published'"); return `${r.n}:${r.c}`; };
export const insert = async (k, conn) => (await query(`INSERT INTO ai_knowledge (source_type, category, title, content, keywords, status, priority, original_name, storage_name, size_bytes, content_sha256, updated_by)
  VALUES (:sourceType, :category, :title, :content, :keywords, :status, :priority, :originalName, :storageName, :size, :sha, :adminId)`, k, conn)).insertId;
export const update = (k, conn) => query('UPDATE ai_knowledge SET category = :category, title = :title, content = :content, keywords = :keywords, status = :status, priority = :priority, updated_by = :adminId WHERE id = :id', k, conn);
export const remove = (id, adminId, conn) => query("UPDATE ai_knowledge SET deleted_at = UTC_TIMESTAMP(), status = 'draft', updated_by = :adminId WHERE id = :id", { id, adminId }, conn);
