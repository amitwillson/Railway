import express from 'express';
import { all, get, insert, nowIso, run, today, tx, update } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { authenticate, requireCapability, isAdmin, isOfficer } from '../middleware/auth.js';
import { asyncRoute } from '../lib/http.js';
import { body, query, z, optionalId, optionalText, optionalIsoDate, isoDate, optionalBool } from '../lib/validate.js';
import { listObservations, observationById } from '../lib/queries.js';
import { autoAssign } from '../lib/assignment.js';
import { findRepeats } from '../lib/repeats.js';
import { dispatch } from '../lib/notify.js';
import { createObservation, timeline } from '../services/observationService.js';
import { upload, kindForMime, removeStoredFile } from '../middleware/uploads.js';

const router = express.Router();
router.use(authenticate);

const OPEN_FOR_SUPERVISOR = ['submitted', 'assigned', 'acknowledged', 'in_progress', 'rejected', 'reopened'];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The supervisor record owned by the signed-in user, when any. */
const mySupervisor = (user) =>
  get('SELECT * FROM supervisors WHERE user_id = ? AND active = 1', [user.id]);

function assertSupervisorOf(observation, user) {
  if (isAdmin(user)) return;
  const sup = mySupervisor(user);
  if (sup && observation.supervisor_id === sup.id) return;
  if (user.department_id && user.department_id === observation.action_by_department_id) return;
  throw forbidden('This observation is not assigned to you');
}

function assertVerifier(observation, user) {
  if (isAdmin(user) || isOfficer(user)) return;
  if (observation.created_by === user.id) return;
  throw forbidden('Only the inspecting officer who raised this observation can verify it');
}

const queryFilterSchema = z.object({
  status: optionalText,
  module_id: optionalId,
  module_code: optionalText,
  station_id: optionalId,
  train_id: optionalId,
  department_id: optionalId,
  supervisor_id: optionalId,
  severity_id: optionalId,
  category_id: optionalId,
  item_id: optionalId,
  unit_id: optionalId,
  inspection_id: optionalId,
  created_by: optionalId,
  division_id: optionalId,
  open: optionalBool,
  closed: optionalBool,
  overdue: optionalBool,
  due_soon: optionalBool,
  awaiting_verification: optionalBool,
  repeated: optionalBool,
  critical: optionalBool,
  mine: optionalBool,
  assigned_to_me: optionalBool,
  has_tdc: optionalBool,
  from: optionalIsoDate,
  to: optionalIsoDate,
  tdc_from: optionalIsoDate,
  tdc_to: optionalIsoDate,
  days: z.coerce.number().int().min(1).max(3650).optional(),
  q: optionalText,
  sort: z.enum(['newest', 'oldest', 'tdc', 'severity', 'overdue', 'status']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
});

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

router.get('/', requireCapability('observation:read'), query(queryFilterSchema), (req, res) => {
  res.json(listObservations(req.validQuery, req.user));
});

/** Counters used by the home screen and the navigation badges. */
router.get('/counters', requireCapability('observation:read'), (req, res) => {
  const count = (filters) => listObservations({ ...filters, page_size: 1 }, req.user).total;
  res.json({
    my_open: count({ mine: true, open: true }),
    assigned_to_me: count({ assigned_to_me: true, open: true }),
    pending: count({ open: true }),
    compliance_pending: count({ status: 'assigned,acknowledged,in_progress,reopened,rejected' }),
    awaiting_verification: count({ awaiting_verification: true }),
    overdue: count({ overdue: true }),
    critical_open: count({ critical: true, open: true }),
    closed: count({ closed: true }),
    repeated_open: count({ repeated: true, open: true }),
  });
});

/* -------------------------------------------------------------------------- */
/* Pre-submit helpers: repeat check                                            */
/* -------------------------------------------------------------------------- */

router.get(
  '/repeat-check',
  requireCapability('observation:read'),
  query(
    z.object({
      station_id: optionalId,
      train_id: optionalId,
      unit_id: optionalId,
      unit_name: optionalText,
      item_id: optionalId,
      item_name: optionalText,
      category_id: optionalId,
      observation: optionalText,
      window_days: z.coerce.number().int().min(1).max(3650).default(90),
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    res.json(
      findRepeats({
        stationId: f.station_id,
        trainId: f.train_id,
        unitId: f.unit_id,
        unitName: f.unit_name,
        itemId: f.item_id,
        itemName: f.item_name,
        categoryId: f.category_id,
        observation: f.observation ?? '',
        windowDays: f.window_days,
      })
    );
  }
);

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

const createSchema = z.object({
  inspection_id: z.coerce.number().int().positive(),
  unit_id: optionalId,
  unit_name: optionalText,
  item_id: optionalId,
  deficiency_id: optionalId,
  coach: optionalText,
  parameters: z
    .array(
      z.object({
        parameter_id: z.coerce.number().int().positive().optional(),
        name: z.string(),
        value: z.union([z.boolean(), z.string()]).optional(),
      })
    )
    .optional(),
  observation: z.string().trim().min(5, 'Describe the observation in at least 5 characters'),
  category_id: optionalId,
  severity_id: optionalId,
  action_by_department_id: z.coerce.number().int().positive(),
  supervisor_id: optionalId,
  contractor_id: optionalId,
  rule_reference_id: optionalId,
  tdc: optionalIsoDate,
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  client_uuid: optionalText,
  observed_at: optionalText,
});

router.post(
  '/',
  requireCapability('observation:create'),
  body(createSchema),
  asyncRoute(async (req, res) => {
    const result = await createObservation({ payload: req.body, user: req.user, req });
    if (result.deduplicated) {
      res.status(200).json({ ...result.observation, deduplicated: true });
      return;
    }
    res.status(201).json({
      ...result.observation,
      repeats: result.repeats,
      notification: result.notification,
      tdc_rule: result.tdc_rule,
      suggested_tdc: result.suggested_tdc,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Read one                                                                   */
/* -------------------------------------------------------------------------- */

router.get('/:id', requireCapability('observation:read'), (req, res) => {
  const observation = observationById(req.params.id);
  if (!observation) throw notFound('Observation');
  const repeats = findRepeats({
    stationId: observation.station_id,
    trainId: observation.train_id,
    unitId: observation.unit_id,
    unitName: observation.unit_name,
    itemId: observation.item_id,
    itemName: observation.item_name,
    categoryId: observation.category_id,
    observation: observation.observation,
    excludeObservationId: observation.id,
    windowDays: 365,
  });
  res.json({
    ...observation,
    timeline: all('SELECT * FROM observation_events WHERE observation_id = ? ORDER BY id', [
      observation.id,
    ]).map((e) => ({ ...e, metadata: safeJson(e.metadata) })),
    attachments: all('SELECT * FROM attachments WHERE observation_id = ? ORDER BY id', [observation.id]),
    compliances: all(
      `SELECT c.*, u.name AS submitted_by_name, u.designation AS submitted_by_designation,
              v.name AS verified_by_name, v.designation AS verified_by_designation
         FROM compliances c
         JOIN users u ON u.id = c.submitted_by
         LEFT JOIN users v ON v.id = c.verified_by
        WHERE c.observation_id = ? ORDER BY c.round`,
      [observation.id]
    ).map((c) => ({
      ...c,
      attachments: all('SELECT * FROM attachments WHERE compliance_id = ? ORDER BY id', [c.id]),
    })),
    repeats,
    approvals: all(
      `SELECT * FROM approvals WHERE entity_type = 'observation' AND entity_id = ? ORDER BY signed_at`,
      [observation.id]
    ),
    rule_reference: observation.rule_reference_id
      ? get('SELECT * FROM rule_references WHERE id = ?', [observation.rule_reference_id])
      : null,
    supervisor: observation.supervisor_id
      ? get(
          `SELECT s.*, d.name AS department_name, ro.name AS reporting_officer_name
             FROM supervisors s JOIN departments d ON d.id = s.department_id
             LEFT JOIN supervisors ro ON ro.id = s.reporting_officer_id WHERE s.id = ?`,
          [observation.supervisor_id]
        )
      : null,
    notifications: all(
      `SELECT n.id, n.event, n.title, n.created_at, u.name AS recipient,
              (SELECT group_concat(d.channel || ':' || d.status, ', ')
                 FROM notification_deliveries d WHERE d.notification_id = n.id) AS channels
         FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE n.observation_id = ? ORDER BY n.id DESC LIMIT 50`,
      [observation.id]
    ),
    permissions: {
      can_acknowledge:
        OPEN_FOR_SUPERVISOR.includes(observation.status) &&
        observation.status !== 'acknowledged' &&
        canActAsSupervisor(observation, req.user),
      can_submit_compliance:
        OPEN_FOR_SUPERVISOR.includes(observation.status) && canActAsSupervisor(observation, req.user),
      can_verify:
        observation.status === 'compliance_submitted' &&
        (isAdmin(req.user) || isOfficer(req.user) || observation.created_by === req.user.id),
      can_reassign: isAdmin(req.user) || isOfficer(req.user) || observation.created_by === req.user.id,
      can_edit: canEdit(observation, req.user),
      can_cancel: isAdmin(req.user) || isOfficer(req.user),
    },
  });
});

const safeJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

function canActAsSupervisor(observation, user) {
  if (isAdmin(user)) return true;
  const sup = mySupervisor(user);
  if (sup && observation.supervisor_id === sup.id) return true;
  return user.role === 'supervisor' && user.department_id === observation.action_by_department_id;
}

function canEdit(observation, user) {
  if (isAdmin(user)) return true;
  return (
    observation.created_by === user.id &&
    ['submitted', 'assigned'].includes(observation.status) &&
    !observation.acknowledged_at
  );
}

router.get('/:id/repeats', requireCapability('observation:read'), (req, res) => {
  const observation = observationById(req.params.id);
  if (!observation) throw notFound('Observation');
  res.json(
    findRepeats({
      stationId: observation.station_id,
      trainId: observation.train_id,
      unitId: observation.unit_id,
      unitName: observation.unit_name,
      itemId: observation.item_id,
      itemName: observation.item_name,
      categoryId: observation.category_id,
      observation: observation.observation,
      excludeObservationId: observation.id,
      windowDays: Number(req.query.window_days) || 365,
    })
  );
});

/**
 * Photo comparison for a recurring deficiency: the current observation's
 * photographs next to those of the matched earlier observations.
 */
router.get('/:id/photo-comparison', requireCapability('observation:read'), (req, res) => {
  const observation = observationById(req.params.id);
  if (!observation) throw notFound('Observation');
  const repeats = findRepeats({
    stationId: observation.station_id,
    trainId: observation.train_id,
    unitId: observation.unit_id,
    unitName: observation.unit_name,
    itemId: observation.item_id,
    itemName: observation.item_name,
    categoryId: observation.category_id,
    observation: observation.observation,
    excludeObservationId: observation.id,
    windowDays: 730,
    limit: 5,
  });
  const photos = (obsId, phase) =>
    all(
      `SELECT id, stored_name, file_name, caption, created_at, phase FROM attachments
        WHERE observation_id = ? AND kind = 'photo' AND phase = ? ORDER BY id`,
      [obsId, phase]
    );
  res.json({
    current: {
      observation: {
        id: observation.id,
        ref_no: observation.ref_no,
        observed_at: observation.observed_at,
        observation: observation.observation,
        status: observation.status,
      },
      observation_photos: photos(observation.id, 'observation'),
      compliance_photos: photos(observation.id, 'compliance'),
    },
    previous: repeats.matches.map((m) => ({
      observation: {
        id: m.id,
        ref_no: m.ref_no,
        observed_at: m.observed_at,
        observation: m.observation,
        status: m.status,
        match_reason: m.match_reason,
        similarity: m.similarity,
      },
      observation_photos: photos(m.id, 'observation'),
      compliance_photos: photos(m.id, 'compliance'),
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* Update / reassign / cancel                                                 */
/* -------------------------------------------------------------------------- */

router.patch(
  '/:id',
  requireCapability('observation:update'),
  body(
    z.object({
      observation: z.string().trim().min(5).optional(),
      category_id: optionalId,
      severity_id: optionalId,
      tdc: z.union([isoDate, z.null()]).optional(),
      rule_reference_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
      contractor_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
      requires_physical_verification: optionalBool,
      remarks: optionalText,
    })
  ),
  asyncRoute(async (req, res) => {
    const before = observationById(req.params.id);
    if (!before) throw notFound('Observation');
    const { remarks, ...changes } = req.body;

    if (changes.observation !== undefined && !canEdit(before, req.user)) {
      throw forbidden(
        'The text of a submitted observation can only be corrected by the raising officer before it is acknowledged, or by an administrator. Every correction is recorded in the audit trail.'
      );
    }
    if (!isAdmin(req.user) && !isOfficer(req.user) && before.created_by !== req.user.id) {
      throw forbidden('Only the raising officer, a divisional officer or an admin can change this');
    }
    if (Object.keys(changes).length === 0) throw badRequest('Nothing to update');

    const tdcChanged = 'tdc' in changes && (changes.tdc ?? null) !== (before.tdc ?? null);
    update('observations', before.id, { ...changes, updated_at: nowIso() });
    const after = observationById(before.id);
    timeline(before.id, {
      action: 'UPDATED',
      from: before.status,
      to: after.status,
      actor: req.user,
      remarks: remarks ?? describeChanges(before, after, Object.keys(changes)),
      metadata: { fields: Object.keys(changes) },
    });
    audit(req, {
      action: 'OBSERVATION_UPDATE',
      entityType: 'observation',
      entityId: before.id,
      previous: pickFields(before, Object.keys(changes)),
      next: pickFields(after, Object.keys(changes)),
      remarks,
    });
    if (tdcChanged) {
      await dispatch({
        event: 'TDC_CHANGED',
        observation: after,
        actorId: req.user.id,
        extraVars: { old_tdc: before.tdc ?? 'not specified', new_tdc: after.tdc ?? 'removed' },
      }).catch(() => {});
    }
    res.json(after);
  })
);

const pickFields = (row, fields) => Object.fromEntries(fields.map((f) => [f, row[f]]));

function describeChanges(before, after, fields) {
  return fields
    .map((f) => `${f}: "${before[f] ?? '-'}" -> "${after[f] ?? '-'}"`)
    .join('; ')
    .slice(0, 900);
}

router.post(
  '/:id/reassign',
  requireCapability('observation:update'),
  body(
    z.object({
      action_by_department_id: optionalId,
      supervisor_id: optionalId,
      reason: z.string().trim().min(3, 'Give the reason for reassignment'),
      tdc: z.union([isoDate, z.null()]).optional(),
    })
  ),
  asyncRoute(async (req, res) => {
    const before = observationById(req.params.id);
    if (!before) throw notFound('Observation');
    if (!isAdmin(req.user) && !isOfficer(req.user) && before.created_by !== req.user.id) {
      throw forbidden('Only the raising officer, a divisional officer or an admin can reassign');
    }
    if (['closed', 'cancelled'].includes(before.status)) {
      throw badRequest('A closed observation cannot be reassigned. Reopen it first.');
    }
    const departmentId = req.body.action_by_department_id ?? before.action_by_department_id;
    let supervisorId = req.body.supervisor_id ?? null;
    if (!supervisorId) {
      supervisorId =
        autoAssign({
          stationId: before.station_id,
          unitId: before.unit_id,
          departmentId,
          itemId: before.item_id,
        })?.id ?? null;
    }
    update('observations', before.id, {
      action_by_department_id: departmentId,
      supervisor_id: supervisorId,
      assignment_mode: req.body.supervisor_id ? 'manual' : supervisorId ? 'auto' : 'unassigned',
      status: supervisorId ? 'assigned' : 'submitted',
      assigned_at: supervisorId ? nowIso() : null,
      acknowledged_at: null,
      escalation_level: 0,
      ...(req.body.tdc !== undefined ? { tdc: req.body.tdc } : {}),
      updated_at: nowIso(),
    });
    const after = observationById(before.id);
    timeline(before.id, {
      action: 'REASSIGNED',
      from: before.status,
      to: after.status,
      actor: req.user,
      remarks: `${before.department_name} -> ${after.department_name}${
        after.supervisor_name ? ` / ${after.supervisor_name}` : ''
      }. Reason: ${req.body.reason}`,
    });
    audit(req, {
      action: 'OBSERVATION_REASSIGN',
      entityType: 'observation',
      entityId: before.id,
      previous: { department: before.department_name, supervisor: before.supervisor_name },
      next: { department: after.department_name, supervisor: after.supervisor_name },
      remarks: req.body.reason,
    });
    await dispatch({
      event: 'OBSERVATION_ASSIGNED',
      observation: after,
      actorId: req.user.id,
      extraVars: { reassigned: 'yes' },
    }).catch(() => {});
    res.json(after);
  })
);

router.post(
  '/:id/cancel',
  requireCapability('observation:read'),
  body(z.object({ reason: z.string().trim().min(5, 'Give the reason for cancellation') })),
  (req, res) => {
    if (!isAdmin(req.user) && !isOfficer(req.user)) {
      throw forbidden('Only a divisional officer or an admin can cancel an observation');
    }
    const before = observationById(req.params.id);
    if (!before) throw notFound('Observation');
    if (before.status === 'closed') throw badRequest('A closed observation cannot be cancelled');
    update('observations', before.id, {
      status: 'cancelled',
      cancel_reason: req.body.reason,
      updated_at: nowIso(),
    });
    timeline(before.id, {
      action: 'CANCELLED',
      from: before.status,
      to: 'cancelled',
      actor: req.user,
      remarks: req.body.reason,
    });
    audit(req, {
      action: 'OBSERVATION_CANCEL',
      entityType: 'observation',
      entityId: before.id,
      previous: { status: before.status },
      next: { status: 'cancelled' },
      remarks: req.body.reason,
    });
    res.json(observationById(before.id));
  }
);

/* -------------------------------------------------------------------------- */
/* Supervisor actions: acknowledge, progress, compliance                      */
/* -------------------------------------------------------------------------- */

router.post(
  '/:id/acknowledge',
  requireCapability('observation:acknowledge'),
  body(z.object({ remarks: optionalText })),
  asyncRoute(async (req, res) => {
    const before = observationById(req.params.id);
    if (!before) throw notFound('Observation');
    assertSupervisorOf(before, req.user);
    if (!OPEN_FOR_SUPERVISOR.includes(before.status)) {
      throw badRequest(`An observation with status "${before.status}" cannot be acknowledged`);
    }
    update('observations', before.id, {
      status: 'acknowledged',
      acknowledged_at: before.acknowledged_at ?? nowIso(),
      updated_at: nowIso(),
    });
    timeline(before.id, {
      action: 'ACKNOWLEDGED',
      from: before.status,
      to: 'acknowledged',
      actor: req.user,
      remarks: req.body.remarks ?? null,
    });
    audit(req, {
      action: 'OBSERVATION_ACKNOWLEDGE',
      entityType: 'observation',
      entityId: before.id,
      previous: { status: before.status },
      next: { status: 'acknowledged' },
    });
    const after = observationById(before.id);
    await dispatch({ event: 'OBSERVATION_ACKNOWLEDGED', observation: after, actorId: req.user.id }).catch(
      () => {}
    );
    res.json(after);
  })
);

router.post(
  '/:id/progress',
  requireCapability('compliance:submit'),
  body(z.object({ remarks: z.string().trim().min(3, 'Describe the progress') })),
  (req, res) => {
    const before = observationById(req.params.id);
    if (!before) throw notFound('Observation');
    assertSupervisorOf(before, req.user);
    if (!OPEN_FOR_SUPERVISOR.includes(before.status)) {
      throw badRequest(`An observation with status "${before.status}" cannot be progressed`);
    }
    update('observations', before.id, {
      status: 'in_progress',
      acknowledged_at: before.acknowledged_at ?? nowIso(),
      updated_at: nowIso(),
    });
    timeline(before.id, {
      action: 'ACTION_IN_PROGRESS',
      from: before.status,
      to: 'in_progress',
      actor: req.user,
      remarks: req.body.remarks,
    });
    audit(req, {
      action: 'OBSERVATION_PROGRESS',
      entityType: 'observation',
      entityId: before.id,
      previous: { status: before.status },
      next: { status: 'in_progress' },
      remarks: req.body.remarks,
    });
    res.json(observationById(before.id));
  }
);

router.post(
  '/:id/compliance',
  requireCapability('compliance:submit'),
  upload.array('files', 10),
  asyncRoute(async (req, res) => {
    const before = observationById(req.params.id);
    if (!before) {
      (req.files ?? []).forEach((f) => removeStoredFile(f.filename));
      throw notFound('Observation');
    }
    try {
      assertSupervisorOf(before, req.user);
      if (!OPEN_FOR_SUPERVISOR.includes(before.status)) {
        throw badRequest(`Compliance cannot be submitted while the status is "${before.status}"`);
      }
      const payload = parseCompliance(req.body);
      const round =
        (get('SELECT MAX(round) AS r FROM compliances WHERE observation_id = ?', [before.id])?.r ?? 0) + 1;

      const complianceId = tx(() => {
        const id = insert('compliances', {
          observation_id: before.id,
          round,
          supervisor_id: before.supervisor_id ?? null,
          submitted_by: req.user.id,
          action_taken: payload.action_taken,
          remarks: payload.remarks ?? null,
          compliance_date: payload.compliance_date ?? today(),
          expenditure: payload.expenditure ?? null,
          status: 'submitted',
        });
        for (const file of req.files ?? []) {
          insert('attachments', {
            observation_id: before.id,
            compliance_id: id,
            kind: kindForMime(file.mimetype),
            phase: 'compliance',
            file_name: file.originalname,
            stored_name: file.filename,
            mime_type: file.mimetype,
            size_bytes: file.size,
            uploaded_by: req.user.id,
          });
        }
        update('observations', before.id, {
          status: 'compliance_submitted',
          compliance_submitted_at: nowIso(),
          acknowledged_at: before.acknowledged_at ?? nowIso(),
          updated_at: nowIso(),
        });
        timeline(before.id, {
          action: 'COMPLIANCE_SUBMITTED',
          from: before.status,
          to: 'compliance_submitted',
          actor: req.user,
          remarks: payload.action_taken,
          metadata: { round, attachments: (req.files ?? []).length },
        });
        return id;
      });

      const after = observationById(before.id);
      audit(req, {
        action: 'COMPLIANCE_SUBMIT',
        entityType: 'observation',
        entityId: before.id,
        previous: { status: before.status },
        next: { status: 'compliance_submitted', compliance_id: complianceId, round },
      });
      await dispatch({
        event: 'COMPLIANCE_SUBMITTED',
        observation: after,
        actorId: req.user.id,
        extraVars: { action_taken: payload.action_taken, round },
      }).catch(() => {});
      res.status(201).json({
        ...after,
        compliance: get('SELECT * FROM compliances WHERE id = ?', [complianceId]),
      });
    } catch (err) {
      (req.files ?? []).forEach((f) => removeStoredFile(f.filename));
      throw err;
    }
  })
);

function parseCompliance(raw) {
  const schema = z.object({
    action_taken: z.string().trim().min(5, 'Describe the action taken'),
    remarks: optionalText,
    compliance_date: optionalIsoDate,
    expenditure: z.coerce.number().nonnegative().optional(),
  });
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    throw badRequest(
      'Validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Inspector verification                                                     */
/* -------------------------------------------------------------------------- */

router.post(
  '/:id/verify',
  requireCapability('observation:verify'),
  body(
    z.object({
      decision: z.enum(['accept', 'reject', 'physical_verification']),
      remarks: optionalText,
      rejection_reason: optionalText,
      signature_data: optionalText,
    })
  ),
  asyncRoute(async (req, res) => {
    const before = observationById(req.params.id);
    if (!before) throw notFound('Observation');
    assertVerifier(before, req.user);
    if (before.status !== 'compliance_submitted') {
      throw badRequest('Only an observation with submitted compliance can be verified');
    }
    const compliance = get(
      'SELECT * FROM compliances WHERE observation_id = ? ORDER BY round DESC LIMIT 1',
      [before.id]
    );
    if (!compliance) throw badRequest('No compliance has been submitted for this observation');

    const { decision } = req.body;
    if (decision === 'reject' && !req.body.rejection_reason) {
      throw badRequest('A reason is mandatory when rejecting compliance');
    }

    const outcome = tx(() => {
      if (decision === 'accept') {
        update('compliances', compliance.id, {
          status: 'accepted',
          verified_by: req.user.id,
          verified_at: nowIso(),
          verification_remarks: req.body.remarks ?? null,
        });
        update('observations', before.id, {
          status: 'closed',
          verified_at: nowIso(),
          closed_at: nowIso(),
          closed_by: req.user.id,
          requires_physical_verification: 0,
          updated_at: nowIso(),
        });
        timeline(before.id, {
          action: 'VERIFIED',
          from: before.status,
          to: 'verified',
          actor: req.user,
          remarks: req.body.remarks ?? 'Compliance accepted',
        });
        timeline(before.id, {
          action: 'CLOSED',
          from: 'verified',
          to: 'closed',
          actor: req.user,
          remarks: 'Observation closed after verification of compliance',
        });
        insert('approvals', {
          entity_type: 'observation',
          entity_id: before.id,
          approval_role: 'inspector',
          user_id: req.user.id,
          user_name: req.user.name,
          designation: req.user.designation ?? null,
          remarks: req.body.remarks ?? null,
          signature_data: req.body.signature_data ?? null,
        });
        return { status: 'closed', event: 'OBSERVATION_CLOSED' };
      }
      if (decision === 'reject') {
        update('compliances', compliance.id, {
          status: 'rejected',
          verified_by: req.user.id,
          verified_at: nowIso(),
          rejection_reason: req.body.rejection_reason,
          verification_remarks: req.body.remarks ?? null,
        });
        update('observations', before.id, {
          status: 'reopened',
          reopen_count: before.reopen_count + 1,
          compliance_submitted_at: null,
          updated_at: nowIso(),
        });
        timeline(before.id, {
          action: 'COMPLIANCE_REJECTED',
          from: before.status,
          to: 'reopened',
          actor: req.user,
          remarks: req.body.rejection_reason,
        });
        return { status: 'reopened', event: 'COMPLIANCE_REJECTED' };
      }
      update('compliances', compliance.id, {
        status: 'physical_verification_required',
        verified_by: req.user.id,
        verified_at: nowIso(),
        verification_remarks: req.body.remarks ?? null,
      });
      update('observations', before.id, {
        status: 'in_progress',
        requires_physical_verification: 1,
        compliance_submitted_at: null,
        updated_at: nowIso(),
      });
      timeline(before.id, {
        action: 'PHYSICAL_VERIFICATION_REQUIRED',
        from: before.status,
        to: 'in_progress',
        actor: req.user,
        remarks: req.body.remarks ?? 'Physical verification required before closure',
      });
      return { status: 'in_progress', event: 'PHYSICAL_VERIFICATION_REQUIRED' };
    });

    const after = observationById(before.id);
    audit(req, {
      action: 'COMPLIANCE_VERIFY',
      entityType: 'observation',
      entityId: before.id,
      previous: { status: before.status },
      next: { status: outcome.status, decision },
      remarks: req.body.rejection_reason ?? req.body.remarks,
    });
    await dispatch({
      event: outcome.event,
      observation: after,
      actorId: req.user.id,
      extraVars: {
        decision,
        rejection_reason: req.body.rejection_reason ?? '',
        verification_remarks: req.body.remarks ?? '',
      },
    }).catch(() => {});
    res.json(after);
  })
);

/** Reopen a closed observation (officer/admin), e.g. deficiency recurred. */
router.post(
  '/:id/reopen',
  requireCapability('observation:update'),
  body(z.object({ reason: z.string().trim().min(5, 'Give the reason for reopening') })),
  asyncRoute(async (req, res) => {
    const before = observationById(req.params.id);
    if (!before) throw notFound('Observation');
    if (!isAdmin(req.user) && !isOfficer(req.user) && before.created_by !== req.user.id) {
      throw forbidden('Only the raising officer, a divisional officer or an admin can reopen');
    }
    if (before.status !== 'closed') throw badRequest('Only a closed observation can be reopened');
    update('observations', before.id, {
      status: 'reopened',
      reopen_count: before.reopen_count + 1,
      closed_at: null,
      closed_by: null,
      verified_at: null,
      updated_at: nowIso(),
    });
    timeline(before.id, {
      action: 'REOPENED',
      from: 'closed',
      to: 'reopened',
      actor: req.user,
      remarks: req.body.reason,
    });
    audit(req, {
      action: 'OBSERVATION_REOPEN',
      entityType: 'observation',
      entityId: before.id,
      previous: { status: 'closed' },
      next: { status: 'reopened' },
      remarks: req.body.reason,
    });
    const after = observationById(before.id);
    await dispatch({
      event: 'OBSERVATION_REOPENED',
      observation: after,
      actorId: req.user.id,
      extraVars: { reason: req.body.reason },
    }).catch(() => {});
    res.json(after);
  })
);

/* -------------------------------------------------------------------------- */
/* Attachments                                                                */
/* -------------------------------------------------------------------------- */

router.post(
  '/:id/attachments',
  requireCapability('observation:read'),
  upload.array('files', 10),
  (req, res) => {
    const observation = observationById(req.params.id);
    if (!observation) {
      (req.files ?? []).forEach((f) => removeStoredFile(f.filename));
      throw notFound('Observation');
    }
    const phase = ['observation', 'compliance', 'verification'].includes(req.body?.phase)
      ? req.body.phase
      : 'observation';
    if (!req.files?.length) throw badRequest('No file was uploaded');
    const ids = tx(() =>
      (req.files ?? []).map((file) =>
        insert('attachments', {
          observation_id: observation.id,
          kind: kindForMime(file.mimetype),
          phase,
          file_name: file.originalname,
          stored_name: file.filename,
          mime_type: file.mimetype,
          size_bytes: file.size,
          caption: req.body?.caption ?? null,
          uploaded_by: req.user.id,
        })
      )
    );
    audit(req, {
      action: 'ATTACHMENT_ADD',
      entityType: 'observation',
      entityId: observation.id,
      next: { attachment_ids: ids, phase, count: ids.length },
    });
    res.status(201).json({
      data: all(
        `SELECT * FROM attachments WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      ),
    });
  }
);

router.delete('/:id/attachments/:attachmentId', requireCapability('observation:read'), (req, res) => {
  const attachment = get('SELECT * FROM attachments WHERE id = ? AND observation_id = ?', [
    req.params.attachmentId,
    req.params.id,
  ]);
  if (!attachment) throw notFound('Attachment');
  const observation = observationById(req.params.id);
  const isUploader = attachment.uploaded_by === req.user.id;
  if (!isAdmin(req.user) && !isUploader) {
    throw forbidden('Only the uploader or an admin can remove this file');
  }
  if (['closed', 'verified'].includes(observation.status) && !isAdmin(req.user)) {
    throw badRequest('Evidence cannot be removed once the observation is closed');
  }
  run('DELETE FROM attachments WHERE id = ?', [attachment.id]);
  removeStoredFile(attachment.stored_name);
  timeline(observation.id, {
    action: 'ATTACHMENT_REMOVED',
    from: observation.status,
    to: observation.status,
    actor: req.user,
    remarks: `Removed ${attachment.kind} "${attachment.file_name}"`,
  });
  audit(req, {
    action: 'ATTACHMENT_DELETE',
    entityType: 'observation',
    entityId: observation.id,
    previous: attachment,
  });
  res.json({ ok: true });
});

export default router;
