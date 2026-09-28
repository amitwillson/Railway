import { get, insert, nowIso, today, tx, update } from '../db/index.js';
import { nextRef } from '../lib/ids.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { observationById } from '../lib/queries.js';
import { autoAssign } from '../lib/assignment.js';
import { findRepeats } from '../lib/repeats.js';
import { deficiencyFor } from '../lib/deficiencies.js';
import { dispatch } from '../lib/notify.js';
import { tdcRuleFor } from '../lib/scheduler.js';
import { audit } from '../lib/audit.js';
import { isOfficer } from '../middleware/auth.js';

/** Records one immutable step on the observation timeline. */
export function timeline(observationId, { action, from, to, actor, remarks, metadata }) {
  return insert('observation_events', {
    observation_id: observationId,
    action,
    from_status: from ?? null,
    to_status: to ?? null,
    actor_id: actor?.id ?? null,
    actor_name: actor?.name ?? 'System',
    actor_role: actor?.role ?? 'system',
    remarks: remarks ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

export const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Creates an observation and runs the whole automatic chain behind it:
 * reference number -> smart supervisor assignment -> repeated-deficiency
 * detection -> timeline -> audit -> notification (and immediate escalation for
 * critical severities).
 *
 * Shared by the REST endpoint and the offline sync endpoint so both behave
 * identically. `client_uuid` makes it idempotent.
 */
export async function createObservation({ payload, user, req = null }) {
  if (payload.client_uuid) {
    const existing = get('SELECT id FROM observations WHERE client_uuid = ?', [payload.client_uuid]);
    if (existing) {
      return { observation: observationById(existing.id), deduplicated: true };
    }
  }

  const inspection = get('SELECT * FROM v_inspections i WHERE i.id = ?', [payload.inspection_id]);
  if (!inspection) throw badRequest('Unknown inspection');
  if (inspection.status === 'cancelled') throw badRequest('This inspection has been cancelled');
  if (inspection.inspector_id !== user.id && !isOfficer(user)) {
    throw forbidden('Observations can only be added by the inspecting officer of this inspection');
  }

  const item = payload.item_id
    ? get(
        `SELECT i.*, g.name AS group_name FROM inspection_items i
           JOIN item_groups g ON g.id = i.group_id WHERE i.id = ?`,
        [payload.item_id]
      )
    : null;
  const unit = payload.unit_id ? get('SELECT * FROM units WHERE id = ?', [payload.unit_id]) : null;
  // Which suggested deficiency the inspector picked, if any. Recording it is what
  // lets the dashboard answer "which deficiencies are reported most often"; the
  // text itself stays whatever the inspector finally submitted.
  const deficiency = deficiencyFor(payload.deficiency_id, item);
  const department = get('SELECT * FROM departments WHERE id = ? AND active = 1', [
    payload.action_by_department_id,
  ]);
  if (!department) throw badRequest('Unknown department for "Action By"');

  const severityId =
    payload.severity_id ??
    item?.default_severity_id ??
    get("SELECT id FROM severities WHERE active = 1 AND name = 'Moderate'")?.id ??
    get('SELECT id FROM severities WHERE active = 1 ORDER BY rank DESC LIMIT 1')?.id;
  if (!severityId) throw badRequest('No severity master is configured');
  const severity = get('SELECT * FROM severities WHERE id = ?', [severityId]);
  const categoryId = payload.category_id ?? item?.default_category_id ?? null;

  // Smart assignment: an explicit choice always wins, otherwise resolve it.
  let supervisorId = payload.supervisor_id ?? null;
  let assignmentMode = payload.supervisor_id ? 'manual' : 'auto';
  if (!supervisorId) {
    const auto = autoAssign({
      stationId: inspection.station_id,
      unitId: payload.unit_id,
      departmentId: payload.action_by_department_id,
      itemId: payload.item_id,
    });
    supervisorId = auto?.id ?? null;
    if (!supervisorId) assignmentMode = 'unassigned';
  }

  const unitName = payload.unit_name ?? unit?.name ?? null;
  const repeats = findRepeats({
    stationId: inspection.station_id,
    trainId: inspection.train_id,
    unitId: payload.unit_id,
    unitName,
    itemId: payload.item_id,
    itemName: item?.name,
    categoryId,
    observation: payload.observation,
  });

  const createdId = tx(() => {
    const id = insert('observations', {
      ref_no: nextRef('observations', 'OBS'),
      inspection_id: inspection.id,
      module_id: inspection.module_id,
      station_id: inspection.station_id ?? null,
      train_id: inspection.train_id ?? null,
      coach: payload.coach ?? null,
      unit_id: payload.unit_id ?? null,
      unit_name: unitName,
      item_id: payload.item_id ?? null,
      item_name: item?.name ?? null,
      deficiency_id: deficiency?.id ?? null,
      parameters: payload.parameters?.length ? JSON.stringify(payload.parameters) : null,
      observation: payload.observation,
      category_id: categoryId,
      severity_id: severityId,
      action_by_department_id: payload.action_by_department_id,
      supervisor_id: supervisorId,
      assignment_mode: assignmentMode,
      contractor_id: payload.contractor_id ?? null,
      rule_reference_id: payload.rule_reference_id ?? item?.rule_reference_id ?? null,
      tdc: payload.tdc ?? null,
      status: supervisorId ? 'assigned' : 'submitted',
      repeat_count: repeats.count,
      repeat_of_id: repeats.matches[0]?.id ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      created_by: user.id,
      observed_at: payload.observed_at ?? nowIso(),
      assigned_at: supervisorId ? nowIso() : null,
      client_uuid: payload.client_uuid ?? null,
    });
    timeline(id, {
      action: 'SUBMITTED',
      to: 'submitted',
      actor: user,
      remarks: `Observation recorded during ${inspection.ref_no}`,
      metadata: { repeat_count: repeats.count, offline: Boolean(payload.client_uuid) },
    });
    if (supervisorId) {
      const sup = get('SELECT * FROM supervisors WHERE id = ?', [supervisorId]);
      timeline(id, {
        action: 'ASSIGNED',
        from: 'submitted',
        to: 'assigned',
        actor: user,
        remarks: `Assigned to ${sup?.name}${sup?.designation ? `, ${sup.designation}` : ''} (${department.name})`,
        metadata: { assignment_mode: assignmentMode, supervisor_id: supervisorId },
      });
    }
    if (inspection.status === 'planned') {
      update('inspections', inspection.id, { status: 'in_progress', started_at: nowIso() });
    }
    return id;
  });

  const created = observationById(createdId);
  audit(req ?? { user }, {
    action: 'OBSERVATION_CREATE',
    entityType: 'observation',
    entityId: createdId,
    next: created,
    remarks: repeats.count ? `Repeated deficiency (${repeats.count} previous occurrence(s))` : undefined,
  });

  const notified = await dispatch({
    event: supervisorId ? 'OBSERVATION_ASSIGNED' : 'OBSERVATION_UNASSIGNED',
    observation: created,
    actorId: user.id,
    extraVars: { repeat_count: repeats.count },
  }).catch((err) => ({ event: 'ERROR', error: err.message, recipients: 0, deliveries: [] }));

  let escalated = null;
  if (severity?.notify_immediately || severity?.escalate_immediately) {
    escalated = await dispatch({
      event: 'CRITICAL_OBSERVATION',
      observation: created,
      actorId: user.id,
    }).catch(() => null);
  }

  return {
    observation: created,
    repeats,
    notification: {
      event: notified?.event,
      recipients: notified?.recipients ?? 0,
      deliveries: notified?.deliveries ?? [],
      escalated_recipients: escalated?.recipients ?? 0,
    },
    tdc_rule: payload.tdc ? tdcRuleFor(severityId) : null,
    suggested_tdc:
      !payload.tdc && severity?.default_tdc_days
        ? addDays(today(), severity.default_tdc_days)
        : null,
  };
}
