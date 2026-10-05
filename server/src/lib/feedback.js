import { all, get, insert, nowIso, update } from '../db/index.js';
import { badRequest, forbidden, notFound } from './errors.js';

/**
 * What the people using this application think of it.
 *
 * An inspector finishing an inspection has just spent two hours in the system and
 * knows exactly what slowed them down; a week later they do not. So the question
 * is asked there, at the end of the inspection, and from the profile screen as
 * well so that a supervisor who never runs one can still answer it.
 *
 * What was said is never edited. The office replies on the record and moves the
 * status, which is what lets an officer see that their suggestion was read.
 */

const KINDS = ['suggestion', 'problem', 'praise'];
const STATUSES = ['new', 'noted', 'planned', 'done', 'declined'];

export { KINDS, STATUSES };

const ROW = `
  f.*, u.name AS user_name, u.designation AS user_designation, u.role AS user_role,
  i.ref_no AS inspection_ref, i.title AS inspection_title,
  r.name AS responded_by_name`;

const FROM = `
  FROM app_feedback f
  LEFT JOIN users u ON u.id = f.user_id
  LEFT JOIN inspections i ON i.id = f.inspection_id
  LEFT JOIN users r ON r.id = f.responded_by`;

/** One suggestion, with who said it and what it was about. */
export function feedbackById(id) {
  return get(`SELECT ${ROW} ${FROM} WHERE f.id = ?`, [id]) ?? null;
}

/** Records what an officer has to say. */
export function addFeedback({ userId, inspectionId = null, kind = 'suggestion', area = null, suggestion }) {
  const text = String(suggestion ?? '').trim();
  if (text.length < 5) throw badRequest('Say a little more about what would help');
  if (!KINDS.includes(kind)) throw badRequest('Unknown kind of feedback');
  if (inspectionId && !get('SELECT id FROM inspections WHERE id = ?', [inspectionId])) {
    throw badRequest('Unknown inspection');
  }
  const id = insert('app_feedback', {
    user_id: userId ?? null,
    inspection_id: inspectionId,
    kind,
    area: area ?? null,
    suggestion: text,
    status: 'new',
  });
  return feedbackById(id);
}

/** The suggestions, newest first, filtered as the office asked. */
export function listFeedback({ status, kind, userId, inspectionId, mine, limit = 100 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (status) {
    const list = String(status).split(',').map((s) => s.trim()).filter(Boolean);
    where.push(`f.status IN (${list.map(() => '?').join(',')})`);
    params.push(...list);
  }
  if (kind) {
    where.push('f.kind = ?');
    params.push(kind);
  }
  if (mine || userId) {
    where.push('f.user_id = ?');
    params.push(userId);
  }
  if (inspectionId) {
    where.push('f.inspection_id = ?');
    params.push(inspectionId);
  }
  return all(
    `SELECT ${ROW} ${FROM} WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC, f.id DESC LIMIT ?`,
    [...params, limit]
  );
}

/** How the suggestions stand, for the admin screen's header. */
export function feedbackSummary() {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of all('SELECT status, COUNT(*) AS n FROM app_feedback GROUP BY status')) {
    byStatus[row.status] = Number(row.n);
  }
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const row of all('SELECT kind, COUNT(*) AS n FROM app_feedback GROUP BY kind')) {
    byKind[row.kind] = Number(row.n);
  }
  return {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    by_status: byStatus,
    by_kind: byKind,
    open: byStatus.new + byStatus.noted + byStatus.planned,
  };
}

/**
 * The office's reply. It moves the status and adds a response; the suggestion
 * itself is what the officer wrote and stays that way.
 */
export function respondToFeedback(id, { status, response }, actor) {
  const row = get('SELECT * FROM app_feedback WHERE id = ?', [id]);
  if (!row) throw notFound('Feedback');
  if (status && !STATUSES.includes(status)) throw badRequest('Unknown status');
  if (!status && response === undefined) throw badRequest('Give a status or a response');
  update('app_feedback', id, {
    status: status ?? row.status,
    response: response === undefined ? row.response : response,
    responded_by: actor?.id ?? null,
    responded_at: nowIso(),
    updated_at: nowIso(),
  });
  return feedbackById(id);
}

/** An officer may withdraw what they said, while the office has not replied. */
export function withdrawFeedback(id, actor) {
  const row = get('SELECT * FROM app_feedback WHERE id = ?', [id]);
  if (!row) throw notFound('Feedback');
  if (row.user_id !== actor?.id) throw forbidden('Only the person who wrote it can withdraw it');
  if (row.response) throw badRequest('This has already been answered and stays on the record');
  update('app_feedback', id, { status: 'declined', updated_at: nowIso() });
  return feedbackById(id);
}

export default {
  KINDS,
  STATUSES,
  addFeedback,
  feedbackById,
  listFeedback,
  feedbackSummary,
  respondToFeedback,
  withdrawFeedback,
};
