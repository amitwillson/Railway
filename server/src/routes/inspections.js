import express from 'express';
import { all, get, insert, nowIso, tx, update } from '../db/index.js';
import { nextRef, randomToken } from '../lib/ids.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { authenticate, requireCapability, isOfficer } from '../middleware/auth.js';
import { asyncRoute } from '../lib/http.js';
import { body, query, z, optionalId, optionalText, optionalIsoDate, optionalBool } from '../lib/validate.js';
import { decorate, inspectionScopeClause } from '../lib/queries.js';
import { dispatch } from '../lib/notify.js';
import {
  AREA_RESULTS, availableAreas, openSheet, previousOutstanding, recordItemResults,
  setAreaResult, sheetFor, linkPreviousInspection,
} from '../lib/inspectionSheet.js';
import { issueReport, reportFor } from '../lib/inspectionReport.js';
import { timeline } from '../services/observationService.js';

const router = express.Router();
router.use(authenticate);

const LOCATION_TYPES = [
  'Station', 'Train', 'Platform', 'Booking Office', 'Reservation Office', 'Parcel Office',
  'Commercial Establishment', 'Circulating Area', 'Waiting Hall', 'On-Train', 'Other',
];

const SCOPES = ['station', 'train', 'section'];

const createSchema = z.object({
  module_id: z.coerce.number().int().positive(),
  inspection_type_id: z.coerce.number().int().positive(),
  // An inspection covers a place, never a single area: `scope` says which kind of
  // place. `location_type` is still accepted because older clients send it.
  scope: z.enum(SCOPES).optional(),
  location_type: z.string().min(2).optional(),
  station_id: optionalId,
  train_id: optionalId,
  section: optionalText,
  title: optionalText,
  joint_with: optionalText,
  planned_date: optionalIsoDate,
  from_time: optionalText,
  to_time: optionalText,
  notes: optionalText,
  // Opens the full sheet - every area of the station - as the inspection starts,
  // which is what an inspector attending to all of them wants.
  open_sheet: optionalBool,
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  client_uuid: optionalText,
});

/* ------------------------------- list / read ------------------------------ */

router.get(
  '/',
  requireCapability('inspection:read'),
  query(
    z.object({
      mine: optionalBool,
      module_id: optionalId,
      station_id: optionalId,
      train_id: optionalId,
      inspector_id: optionalId,
      status: optionalText,
      location_type: optionalText,
      from: optionalIsoDate,
      to: optionalIsoDate,
      q: optionalText,
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(200).default(20),
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    const where = ['1=1'];
    const params = [];
    const eq = (col, val) => {
      if (val === undefined) return;
      where.push(`i.${col} = ?`);
      params.push(val);
    };
    if (f.mine) eq('inspector_id', req.user.id);
    eq('module_id', f.module_id);
    eq('station_id', f.station_id);
    eq('train_id', f.train_id);
    eq('inspector_id', f.inspector_id);
    eq('location_type', f.location_type);
    if (f.status) {
      const list = f.status.split(',').map((s) => s.trim()).filter(Boolean);
      where.push(`i.status IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
    if (f.from) {
      where.push('date(i.created_at) >= date(?)');
      params.push(f.from);
    }
    if (f.to) {
      where.push('date(i.created_at) <= date(?)');
      params.push(f.to);
    }
    if (f.q) {
      const like = `%${f.q.toLowerCase()}%`;
      where.push(
        `(lower(i.ref_no) LIKE ? OR lower(COALESCE(i.title,'')) LIKE ? OR lower(COALESCE(i.station_name,'')) LIKE ?
          OR lower(COALESCE(i.station_code,'')) LIKE ? OR lower(COALESCE(i.train_number,'')) LIKE ?
          OR lower(COALESCE(i.train_name,'')) LIKE ? OR lower(i.inspector_name) LIKE ?)`
      );
      params.push(like, like, like, like, like, like, like);
    }
    const scope = inspectionScopeClause(req.user, { table: 'i' });
    if (scope.sql !== '1=1') {
      where.push(scope.sql);
      params.push(...scope.params);
    }

    const total = get(`SELECT COUNT(*) AS n FROM v_inspections i WHERE ${where.join(' AND ')}`, params).n;
    const data = all(
      `SELECT * FROM v_inspections i WHERE ${where.join(' AND ')}
        ORDER BY i.created_at DESC, i.id DESC LIMIT ? OFFSET ?`,
      [...params, f.page_size, (f.page - 1) * f.page_size]
    );
    res.json({
      data,
      page: f.page,
      page_size: f.page_size,
      total,
      total_pages: Math.max(1, Math.ceil(total / f.page_size)),
    });
  }
);

router.get('/location-types', (_req, res) => res.json({ data: LOCATION_TYPES }));

router.get('/:id', requireCapability('inspection:read'), (req, res) => {
  const inspection = get('SELECT * FROM v_inspections i WHERE i.id = ?', [req.params.id]);
  if (!inspection) throw notFound('Inspection');
  res.json({
    ...inspection,
    // The areas are part of the inspection, so the detail reads as one visit over
    // many areas rather than as a bare list of deficiencies.
    areas: all(
      'SELECT * FROM inspection_areas WHERE inspection_id = ? ORDER BY sort_order, unit_name, id',
      [inspection.id]
    ),
    item_results: all(
      'SELECT * FROM inspection_item_results WHERE inspection_id = ? ORDER BY inspection_area_id, id',
      [inspection.id]
    ),
    observations: all('SELECT * FROM v_observations o WHERE o.inspection_id = ? ORDER BY o.id', [
      inspection.id,
    ]).map(decorate),
    approvals: all(
      `SELECT * FROM approvals WHERE entity_type = 'inspection' AND entity_id = ? ORDER BY signed_at`,
      [inspection.id]
    ),
    attachments: all(
      `SELECT * FROM attachments WHERE inspection_id = ? AND observation_id IS NULL ORDER BY id`,
      [inspection.id]
    ),
  });
});

/* --------------------------------- create --------------------------------- */

router.post('/', requireCapability('inspection:create'), body(createSchema), (req, res) => {
  const payload = req.body;
  if (payload.client_uuid) {
    const existing = get('SELECT * FROM v_inspections i WHERE i.client_uuid = ?', [payload.client_uuid]);
    if (existing) {
      res.status(200).json({ ...existing, deduplicated: true });
      return;
    }
  }
  if (!payload.station_id && !payload.train_id && !payload.section) {
    throw badRequest('Select a station, a train or a section for this inspection');
  }
  const module = get('SELECT * FROM modules WHERE id = ? AND active = 1', [payload.module_id]);
  if (!module) throw badRequest('Unknown inspection module');
  const type = get('SELECT * FROM inspection_types WHERE id = ? AND active = 1', [
    payload.inspection_type_id,
  ]);
  if (!type) throw badRequest('Unknown inspection type');

  const scope =
    payload.scope ??
    (payload.train_id ? 'train' : payload.station_id ? 'station' : 'section');

  const createdId = tx(() => {
    const ref = nextRef('inspections', 'INSP');
    return insert('inspections', {
      ref_no: ref,
      module_id: payload.module_id,
      inspection_type_id: payload.inspection_type_id,
      scope,
      location_type: payload.location_type ?? locationTypeFor(scope),
      station_id: payload.station_id ?? null,
      train_id: payload.train_id ?? null,
      section: payload.section ?? null,
      title: payload.title ?? defaultTitle(payload, module, type),
      inspector_id: req.user.id,
      joint_with: payload.joint_with ?? null,
      planned_date: payload.planned_date ?? null,
      started_at: nowIso(),
      from_time: payload.from_time ?? null,
      to_time: payload.to_time ?? null,
      status: 'in_progress',
      report_status: 'draft',
      notes: payload.notes ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      qr_token: randomToken(10),
      client_uuid: payload.client_uuid ?? null,
    });
  });

  // The previous inspection of this place is what Part I of the report reviews,
  // so the link is made as the inspection starts rather than at the end.
  linkPreviousInspection(createdId);
  // An inspector who attends to every area gets every area on the sheet, each one
  // starting at "not inspected" so the record can later tell an area found in
  // order from one nobody looked at.
  let sheet = null;
  if (payload.open_sheet !== false) sheet = openSheet(createdId);

  const created = get('SELECT * FROM v_inspections i WHERE i.id = ?', [createdId]);
  audit(req, {
    action: 'INSPECTION_CREATE',
    entityType: 'inspection',
    entityId: created.id,
    next: created,
    remarks: sheet ? `Sheet opened with ${sheet.added} area(s)` : undefined,
  });
  res.status(201).json({ ...created, sheet_opened: sheet?.added ?? 0 });
});

/** `location_type` is kept for older records and the admin filters. */
function locationTypeFor(scope) {
  return scope === 'train' ? 'Train' : scope === 'section' ? 'Other' : 'Station';
}

function defaultTitle(payload, module, type) {
  return `${type.name} - ${module.name}`.trim();
}

/* --------------------------------- update --------------------------------- */

router.patch(
  '/:id',
  requireCapability('inspection:update'),
  body(
    z.object({
      title: optionalText,
      summary: optionalText,
      notes: optionalText,
      joint_with: optionalText,
      planned_date: optionalIsoDate,
      from_time: optionalText,
      to_time: optionalText,
      general_remarks: optionalText,
      status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
    })
  ),
  (req, res) => {
    const inspection = get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) throw notFound('Inspection');
    if (inspection.inspector_id !== req.user.id && !isOfficer(req.user)) {
      throw forbidden('Only the inspecting officer or a divisional officer can change this inspection');
    }
    const changes = { ...req.body, updated_at: nowIso() };
    if (changes.status === 'completed' && !inspection.completed_at) changes.completed_at = nowIso();
    update('inspections', inspection.id, changes);
    const next = get('SELECT * FROM v_inspections i WHERE i.id = ?', [inspection.id]);
    audit(req, {
      action: 'INSPECTION_UPDATE',
      entityType: 'inspection',
      entityId: inspection.id,
      previous: inspection,
      next,
    });
    res.json(next);
  }
);

/* -------------------------------------------------------------------------- */
/* The inspection sheet: one visit, many areas                                */
/* -------------------------------------------------------------------------- */

/** Guards an action that only the inspecting officer (or an officer) may take. */
function ownInspection(req) {
  const inspection = get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
  if (!inspection) throw notFound('Inspection');
  if (inspection.inspector_id !== req.user.id && !isOfficer(req.user)) {
    throw forbidden('Only the inspecting officer or a divisional officer can change this inspection');
  }
  if (inspection.report_status === 'issued') {
    throw badRequest(`The report ${inspection.inspection_no} has been issued; this inspection is now a record`);
  }
  return inspection;
}

/** The sheet: every area with its result, items, deficiencies and catalogue. */
router.get(
  '/:id/sheet',
  requireCapability('inspection:read'),
  query(z.object({ catalogue: optionalBool.default(true) })),
  (req, res) => {
    res.json(sheetFor(Number(req.params.id), { catalogue: req.validQuery.catalogue }));
  }
);

/** The areas this location offers, whether or not they are on the sheet yet. */
router.get('/:id/areas/available', requireCapability('inspection:read'), (req, res) => {
  const inspection = get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
  if (!inspection) throw notFound('Inspection');
  res.json({ data: availableAreas(inspection) });
});

/**
 * Puts areas on the sheet. With no `unit_ids` the whole station goes on, which is
 * the normal case; naming them is for an inspector covering part of it.
 */
router.post(
  '/:id/sheet',
  requireCapability('inspection:update'),
  body(
    z.object({
      unit_ids: z.array(z.coerce.number().int().positive()).optional(),
      coach: optionalText,
    })
  ),
  (req, res) => {
    const inspection = ownInspection(req);
    const result = openSheet(inspection.id, {
      unitIds: req.body.unit_ids ?? null,
      coach: req.body.coach ?? null,
    });
    audit(req, {
      action: 'INSPECTION_SHEET_OPEN',
      entityType: 'inspection',
      entityId: inspection.id,
      next: result,
    });
    res.status(201).json({ ...result, ...sheetFor(inspection.id, { catalogue: false }) });
  }
);

/** Records the finding for one area: in order, deficient, not inspected, absent. */
router.patch(
  '/:id/areas/:areaId',
  requireCapability('inspection:update'),
  body(
    z.object({
      result: z.enum(AREA_RESULTS).optional(),
      remarks: optionalText,
    })
  ),
  (req, res) => {
    const inspection = ownInspection(req);
    const area = get('SELECT * FROM inspection_areas WHERE id = ? AND inspection_id = ?', [
      req.params.areaId,
      inspection.id,
    ]);
    if (!area) throw notFound('Inspection area');
    const next = setAreaResult(area.id, req.body, req.user.id);
    audit(req, {
      action: 'INSPECTION_AREA_RESULT',
      entityType: 'inspection',
      entityId: inspection.id,
      previous: { area: area.unit_name, result: area.result },
      next: { area: next.unit_name, result: next.result },
    });
    res.json(next);
  }
);

/**
 * Records item results inside an area: what was checked and found in order, and
 * what does not apply. This is what lets the report print the satisfactory items
 * rather than only the deficiencies.
 */
router.post(
  '/:id/areas/:areaId/items',
  requireCapability('inspection:update'),
  body(
    z.object({
      results: z
        .array(
          z.object({
            item_id: optionalId,
            item_name: optionalText,
            result: z.enum(['ok', 'deficient', 'not_applicable']).default('ok'),
            remarks: optionalText,
            observation_id: optionalId,
            parameters: z
              .array(
                z.object({
                  parameter_id: z.coerce.number().int().positive().optional(),
                  name: z.string(),
                  value: z.union([z.boolean(), z.string()]).optional(),
                })
              )
              .optional(),
          })
        )
        .min(1, 'Record at least one item'),
    })
  ),
  (req, res) => {
    const inspection = ownInspection(req);
    const saved = recordItemResults(inspection.id, Number(req.params.areaId), req.body.results, req.user.id);
    audit(req, {
      action: 'INSPECTION_ITEMS_RECORDED',
      entityType: 'inspection',
      entityId: inspection.id,
      next: { area_id: Number(req.params.areaId), items: saved.length },
    });
    res.status(201).json({ data: saved });
  }
);

/* -------------------------------------------------------------------------- */
/* Part I: the previous inspection of this place                              */
/* -------------------------------------------------------------------------- */

/** What the previous inspection of this location left outstanding. */
router.get('/:id/previous', requireCapability('inspection:read'), (req, res) => {
  res.json(previousOutstanding(Number(req.params.id)));
});

const PREVIOUS_FINDINGS = ['complied', 'partially_complied', 'not_complied', 'dropped'];

/**
 * Records the inspector's finding on one outstanding item of the previous
 * inspection. The finding is a record of this visit; it never edits the wording of
 * the observation it is about. Where the department had already submitted its
 * compliance, a finding of "complied" is the verification the workflow was waiting
 * for and closes it; "not complied" sends it back.
 */
router.post(
  '/:id/previous/:observationId',
  requireCapability('inspection:update'),
  body(
    z.object({
      finding: z.enum(PREVIOUS_FINDINGS),
      remarks: optionalText,
    })
  ),
  (req, res) => {
    const inspection = ownInspection(req);
    const observation = get('SELECT * FROM v_observations o WHERE o.id = ?', [req.params.observationId]);
    if (!observation) throw notFound('Observation');
    const { finding, remarks } = req.body;

    const existing = get(
      'SELECT * FROM inspection_previous_reviews WHERE inspection_id = ? AND observation_id = ?',
      [inspection.id, observation.id]
    );
    tx(() => {
      if (existing) {
        update('inspection_previous_reviews', existing.id, {
          finding,
          remarks: remarks ?? null,
          reviewed_by: req.user.id,
          reviewed_at: nowIso(),
        });
      } else {
        insert('inspection_previous_reviews', {
          inspection_id: inspection.id,
          observation_id: observation.id,
          finding,
          remarks: remarks ?? null,
          reviewed_by: req.user.id,
        });
      }
      timeline(observation.id, {
        action: 'REVIEWED_AT_INSPECTION',
        from: observation.status,
        to: observation.status,
        actor: req.user,
        remarks: `Reviewed during ${inspection.ref_no}: ${finding.replace('_', ' ')}${remarks ? ` - ${remarks}` : ''}`,
        metadata: { inspection_id: inspection.id, finding },
      });
    });

    // Verification on the ground is exactly what a compliance awaiting the
    // inspecting officer needs, so a finding recorded here moves the workflow.
    let moved = null;
    if (finding === 'complied' && !['closed', 'cancelled'].includes(observation.status)) {
      update('observations', observation.id, {
        status: 'closed',
        verified_at: nowIso(),
        closed_at: nowIso(),
        closed_by: req.user.id,
        updated_at: nowIso(),
      });
      timeline(observation.id, {
        action: 'CLOSED',
        from: observation.status,
        to: 'closed',
        actor: req.user,
        remarks: `Compliance verified on site during ${inspection.ref_no}`,
      });
      moved = 'closed';
    } else if (finding === 'not_complied' && observation.status === 'compliance_submitted') {
      update('observations', observation.id, {
        status: 'reopened',
        reopen_count: (observation.reopen_count ?? 0) + 1,
        updated_at: nowIso(),
      });
      timeline(observation.id, {
        action: 'REOPENED',
        from: observation.status,
        to: 'reopened',
        actor: req.user,
        remarks: `Found not complied on site during ${inspection.ref_no}`,
      });
      moved = 'reopened';
    }

    audit(req, {
      action: 'INSPECTION_PREVIOUS_REVIEW',
      entityType: 'inspection',
      entityId: inspection.id,
      next: { observation: observation.ref_no, finding, moved },
      remarks: remarks ?? undefined,
    });
    res.status(201).json({
      ...previousOutstanding(inspection.id),
      observation: get('SELECT * FROM v_observations o WHERE o.id = ?', [observation.id]),
      moved,
    });
  }
);

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

/** The whole report model: coverage, Part I to Part V, statistics, signatures. */
router.get('/:id/report', requireCapability('inspection:read'), (req, res) => {
  res.json(reportFor(Number(req.params.id)));
});

/**
 * Issues the report, which gives it its office running number. Once issued the
 * inspection is a record: the sheet is frozen, while the status of every
 * observation it cites still reads live.
 */
router.post(
  '/:id/issue',
  requireCapability('inspection:update'),
  body(z.object({ remarks: optionalText })),
  (req, res) => {
    const inspection = get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) throw notFound('Inspection');
    if (inspection.inspector_id !== req.user.id && !isOfficer(req.user)) {
      throw forbidden('Only the inspecting officer or a divisional officer can issue this report');
    }
    const next = issueReport(inspection.id, req.user.id);
    audit(req, {
      action: 'INSPECTION_REPORT_ISSUE',
      entityType: 'inspection',
      entityId: inspection.id,
      next: { inspection_no: next.inspection_no },
      remarks: req.body.remarks ?? undefined,
    });
    res.json(next);
  }
);

/* ------------------------- automatic summary + close ---------------------- */

/**
 * The narrative summary of an inspection.
 *
 * It is written from the coverage first and the deficiencies second, because the
 * inspection is the unit of record: an inspector who attended to fourteen areas
 * and found twelve of them in order has carried out a full inspection, and the
 * summary has to say so rather than reading as an empty page. The wording lives in
 * lib/inspectionReport.js so that the summary, the report and the dashboards all
 * speak with one voice.
 */
export function buildAutoSummary(inspectionId) {
  const inspection = get('SELECT * FROM v_inspections i WHERE i.id = ?', [inspectionId]);
  if (!inspection) return null;
  const report = reportFor(inspectionId);
  return { text: report.narrative, stats: report.statistics };
}

router.get('/:id/summary', requireCapability('inspection:read'), (req, res) => {
  const summary = buildAutoSummary(Number(req.params.id));
  if (!summary) throw notFound('Inspection');
  res.json(summary);
});

router.post(
  '/:id/complete',
  requireCapability('inspection:update'),
  body(
    z.object({
      summary: optionalText,
      signature_data: optionalText,
      remarks: optionalText,
    })
  ),
  asyncRoute(async (req, res) => {
    const inspection = get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) throw notFound('Inspection');
    if (inspection.inspector_id !== req.user.id && !isOfficer(req.user)) {
      throw forbidden('Only the inspecting officer can complete this inspection');
    }
    if (inspection.status === 'completed') throw badRequest('This inspection is already completed');

    const auto = buildAutoSummary(inspection.id);
    tx(() => {
      update('inspections', inspection.id, {
        status: 'completed',
        completed_at: nowIso(),
        summary: req.body.summary ?? inspection.summary ?? auto?.text ?? null,
        auto_summary: auto?.text ?? null,
        updated_at: nowIso(),
      });
      insert('approvals', {
        entity_type: 'inspection',
        entity_id: inspection.id,
        approval_role: 'inspector',
        user_id: req.user.id,
        user_name: req.user.name,
        designation: req.user.designation ?? null,
        remarks: req.body.remarks ?? null,
        signature_data: req.body.signature_data ?? null,
      });
    });
    const next = get('SELECT * FROM v_inspections i WHERE i.id = ?', [inspection.id]);
    audit(req, {
      action: 'INSPECTION_COMPLETE',
      entityType: 'inspection',
      entityId: inspection.id,
      previous: { status: inspection.status },
      next: { status: 'completed', observations: next.observation_count },
    });
    await dispatch({
      event: 'INSPECTION_COMPLETED',
      inspection: next,
      actorId: req.user.id,
      extraVars: {
        ref_no: next.ref_no,
        inspection_ref: next.ref_no,
        station_or_train: next.station_name ?? next.train_number ?? next.section ?? '-',
        observation_count: next.observation_count,
        inspector_name: next.inspector_name,
        module_name: next.module_name,
      },
      link: `/inspections/${next.id}`,
    }).catch(() => {});
    res.json({ ...next, auto_summary_stats: auto?.stats });
  })
);

/** Officer counter-signature on a completed inspection. */
router.post(
  '/:id/approve',
  requireCapability('inspection:read'),
  body(z.object({ remarks: optionalText, signature_data: optionalText })),
  (req, res) => {
    if (!isOfficer(req.user)) throw forbidden('Only a divisional officer or admin can approve');
    const inspection = get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) throw notFound('Inspection');
    if (inspection.status !== 'completed') throw badRequest('Only a completed inspection can be approved');
    const id = insert('approvals', {
      entity_type: 'inspection',
      entity_id: inspection.id,
      approval_role: 'officer',
      user_id: req.user.id,
      user_name: req.user.name,
      designation: req.user.designation ?? null,
      remarks: req.body.remarks ?? null,
      signature_data: req.body.signature_data ?? null,
    });
    audit(req, {
      action: 'INSPECTION_APPROVE',
      entityType: 'inspection',
      entityId: inspection.id,
      next: { approval_id: id },
    });
    res.status(201).json(get('SELECT * FROM approvals WHERE id = ?', [id]));
  }
);

export default router;
