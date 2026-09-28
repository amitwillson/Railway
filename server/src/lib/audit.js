import { insert } from '../db/index.js';

/**
 * Writes an immutable audit row. Every state-changing route calls this with
 * the previous and new value so that "who changed what, when" is answerable
 * for any record in the system.
 */
export function audit(req, { action, entityType, entityId, previous, next, remarks }) {
  const user = req?.user;
  return insert('audit_log', {
    user_id: user?.id ?? null,
    user_name: user?.name ?? 'system',
    role: user?.role ?? null,
    action,
    entity_type: entityType ?? null,
    entity_id: entityId != null ? String(entityId) : null,
    previous_value: previous === undefined ? null : JSON.stringify(previous),
    new_value: next === undefined ? null : JSON.stringify(next),
    remarks: remarks ?? null,
    ip: req?.ip ?? null,
    user_agent: req?.get?.('user-agent') ?? null,
  });
}

/** Audit entry written by background jobs (no request context). */
export function auditSystem({ action, entityType, entityId, next, remarks }) {
  return insert('audit_log', {
    user_id: null,
    user_name: 'scheduler',
    role: 'system',
    action,
    entity_type: entityType ?? null,
    entity_id: entityId != null ? String(entityId) : null,
    new_value: next === undefined ? null : JSON.stringify(next),
    remarks: remarks ?? null,
  });
}
