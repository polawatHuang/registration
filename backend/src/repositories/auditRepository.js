import { query } from '../config/db.js';

export function insertAudit({ actorType = 'admin', adminId = null, action, entityType = null, entityId = null, ip = null, metadata = null }, conn) {
  return query(`INSERT INTO admin_audit_logs (actor_type, admin_id, action, entity_type, entity_id, ip_address, metadata_json)
    VALUES (:actorType, :adminId, :action, :entityType, :entityId, :ip, :meta)`,
  { actorType, adminId, action, entityType, entityId: entityId === null ? null : String(entityId), ip, meta: metadata ? JSON.stringify(metadata) : null }, conn);
}

export async function listAudit({ action, adminId, page, pageSize }) {
  const where = [];
  if (action) where.push('l.action LIKE :action');
  if (adminId) where.push('l.admin_id = :adminId');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const p = { action: action ? `${action.replace(/[%_\\]/g, '\\$&')}%` : null, adminId, limit: pageSize, offset: (page - 1) * pageSize };
  const rows = await query(`SELECT l.id, l.actor_type, l.action, l.entity_type, l.entity_id, l.ip_address, l.metadata_json, l.created_at, u.display_name AS admin_name
    FROM admin_audit_logs l LEFT JOIN admin_users u ON u.id = l.admin_id ${w} ORDER BY l.id DESC LIMIT :limit OFFSET :offset`, p);
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM admin_audit_logs l ${w}`, p);
  return { rows: rows.map(({ metadata_json: m, ...r }) => ({ ...r, metadata: m ? JSON.parse(m) : null })), total };
}
