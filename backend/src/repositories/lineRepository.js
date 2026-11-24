import { query, queryOne } from '../config/db.js';

export const insertState = (s) => query(`INSERT INTO line_login_states (state_hash, browser_hash, nonce, code_verifier, return_to, expires_at)
  VALUES (:stateHash, :browserHash, :nonce, :codeVerifier, :returnTo, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))`, s);
export const lockState = (stateHash, conn) => queryOne(
  'SELECT *, expires_at > UTC_TIMESTAMP() AS is_valid FROM line_login_states WHERE state_hash = :stateHash FOR UPDATE', { stateHash }, conn);
export const deleteState = (stateHash, conn) => query('DELETE FROM line_login_states WHERE state_hash = :stateHash', { stateHash }, conn);

export async function upsertLineUser({ lineUserId, displayName, pictureUrl }) {
  await query(`INSERT INTO line_users (line_user_id, display_name, picture_url, last_interaction_at)
    VALUES (:lineUserId, :displayName, :pictureUrl, UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE display_name = :displayName, picture_url = :pictureUrl, last_interaction_at = UTC_TIMESTAMP()`,
  { lineUserId, displayName, pictureUrl });
  return queryOne('SELECT id, status FROM line_users WHERE line_user_id = :lineUserId', { lineUserId });
}

export const activeLinkOfLine = (lineUserId, conn) => queryOne(
  "SELECT id, applicant_id, linked_at FROM line_account_links WHERE line_user_id = :lineUserId AND status = 'active'", { lineUserId }, conn);
export const activeLinkOfApplicant = (applicantId, conn) => queryOne(
  "SELECT id, line_user_id FROM line_account_links WHERE applicant_id = :applicantId AND status = 'active'", { applicantId }, conn);
export async function insertLink({ lineUserId, applicantId, method }, conn) {
  await query(`INSERT INTO line_account_links (line_user_id, applicant_id, link_method, linked_at)
    VALUES (:lineUserId, :applicantId, :method, UTC_TIMESTAMP())`, { lineUserId, applicantId, method }, conn);
  await query('UPDATE line_users SET linked_at = UTC_TIMESTAMP() WHERE id = :lineUserId', { lineUserId }, conn);
}
export async function unlinkAll(lineUserId, conn) {
  await query("UPDATE line_account_links SET status = 'unlinked', unlinked_at = UTC_TIMESTAMP() WHERE line_user_id = :lineUserId AND status = 'active'", { lineUserId }, conn);
  await query('UPDATE applications SET line_user_id = NULL WHERE line_user_id = :lineUserId', { lineUserId }, conn);
  await query('UPDATE line_users SET linked_at = NULL WHERE id = :lineUserId', { lineUserId }, conn);
}

export const insertApplicantSession = (s) => query(`INSERT INTO applicant_sessions (token_hash, csrf_token, line_user_id, application_id, expires_at)
  VALUES (:tokenHash, :csrf, :lineUserId, :applicationId, DATE_ADD(UTC_TIMESTAMP(), INTERVAL :minutes MINUTE))`, s);
export const findApplicantSession = (tokenHash) => queryOne(`SELECT s.id, s.csrf_token, s.line_user_id, s.application_id, l.display_name, l.picture_url
  FROM applicant_sessions s LEFT JOIN line_users l ON l.id = s.line_user_id
  WHERE s.token_hash = :tokenHash AND s.expires_at > UTC_TIMESTAMP() AND (s.line_user_id IS NULL OR l.status = 'active')`, { tokenHash });
export const deleteApplicantSession = (id) => query('DELETE FROM applicant_sessions WHERE id = :id', { id });
