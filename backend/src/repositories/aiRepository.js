import { query, queryOne } from '../config/db.js';

const DAY = "DATE_FORMAT(DATE(DATE_ADD(created_at, INTERVAL 7 HOUR)), '%Y-%m-%d')";
export const insert = (i) => query(`INSERT INTO ai_interactions (conversation_id, channel, mode, intent, question_enc, sources_json, model, tokens_in, tokens_out, tokens_total, response_ms, cost, created_at)
  VALUES (:conversationId, :channel, :mode, :intent, :question, :sources, :model, :tokensIn, :tokensOut, :tokensTotal, :ms, :cost, UTC_TIMESTAMP())`, i);
/** ต้นเดือนตามเวลาไทย แปลงกลับเป็น UTC */
const MONTH_START = "DATE_SUB(DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR), '%Y-%m-01'), INTERVAL 7 HOUR)";
export const monthTokens = async () => Number((await queryOne(`SELECT COALESCE(SUM(tokens_total), 0) AS n FROM ai_interactions WHERE created_at >= ${MONTH_START}`)).n);
export const monthSums = () => queryOne(`SELECT COALESCE(SUM(tokens_total), 0) AS total, COALESCE(SUM(tokens_in), 0) AS tin, COALESCE(SUM(tokens_out), 0) AS tout, COALESCE(SUM(CASE WHEN tokens_in IS NULL THEN tokens_total ELSE 0 END), 0) AS unsplit, SUM(cost) AS cost,
  COUNT(*) AS n, COUNT(DISTINCT conversation_id) AS conversations, COALESCE(AVG(CASE WHEN tokens_total > 0 THEN response_ms END), 0) AS avg_ms FROM ai_interactions WHERE created_at >= ${MONTH_START}`);
export const daily = (days) => query(`SELECT ${DAY} AS day, COUNT(*) AS n, SUM(tokens_total) AS tokens, COALESCE(SUM(tokens_in), 0) AS tin, COALESCE(SUM(tokens_out), 0) AS tout, SUM(CASE WHEN tokens_in IS NULL THEN tokens_total ELSE 0 END) AS unsplit, SUM(cost) AS cost, SUM(mode IN ('fallback','error','limit','offline')) AS unanswered
  FROM ai_interactions WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL :days DAY) GROUP BY day ORDER BY day`, { days });
export const modes = (days) => query("SELECT mode, COUNT(*) AS n FROM ai_interactions WHERE channel = 'line' AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL :days DAY) GROUP BY mode", { days });
export const recent = (f) => query(`SELECT id, conversation_id, channel, mode, intent, question_enc, sources_json, tokens_total, response_ms, resolved_at, created_at FROM ai_interactions
  WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL :days DAY) ${f.unanswered ? "AND channel = 'line' AND mode IN ('fallback','error') AND resolved_at IS NULL" : ''} ${f.line ? "AND channel = 'line'" : ''} ORDER BY id DESC LIMIT :limit`, f);
/** ส่งข้อความขออภัยซ้ำในแชตเดิมถี่เกินไปหรือยัง */
export const recentOffline = async (conversationId) => (await queryOne("SELECT COUNT(*) AS n FROM ai_interactions WHERE conversation_id = :conversationId AND mode IN ('offline','limit') AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)", { conversationId })).n > 0;
export const resolve = async (ids, adminId, conn) => (await query('UPDATE ai_interactions SET resolved_at = UTC_TIMESTAMP(), resolved_by = :adminId WHERE id IN (:ids) AND resolved_at IS NULL', { ids, adminId }, conn)).affectedRows;
