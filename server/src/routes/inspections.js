import express from 'express';
import { all, get, insert, nowIso, tx, update } from '../db/index.js';
import { nextRef, randomToken } from '../lib/ids.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { authenticate, requireCapability, isOfficer } from '../middleware/auth.js';
import { asyncRoute } from '../lib/http.js';
import { body, query, z, optionalId, optionalText, optionalIsoDate } from '../lib/validate.js';
import { decorate, inspectionScopeClause } from '../lib/queries.js';
import { dispatch } from '../lib/notify.js';

const router = express.Router();
router.use(authenticate);

const LOCATION_TYPES = [
  'Station', 'Train', 'Platform', 'Booking Office', 'Reservation Office', 'Parcel Office',
  'Commercial Establishment', 'Circulating Area', 'Waiting Hall', 'On-Train', 'Other',
];

const createSchema = z.object({
  module_id: z.coerce.number().int().positive(),
  inspection_type_id: z.coerce.number().int().positive(),
  location_type: z.string().min(2),
  station_id: optionalId,
  train_id: optionalId,
  section: optionalText,
  title: optionalText,
  joint_with: optionalText,
  planned_date: optionalIsoDate,
  notes: optionalText,
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
      mine: z.coerce.boolean().optional(),
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

  const created = tx(() => {
    const ref = nextRef('inspections', 'INSP');
    const id = insert('inspections', {
      ref_no: ref,
      module_id: payload.module_id,
      inspection_type_id: payload.inspection_type_id,
      location_type: payload.location_type,
      station_id: payload.station_id ?? null,
      train_id: payload.train_id ?? null,
      section: payload.section ?? null,
      title: payload.title ?? defaultTitle(payload, module, type),
      inspector_id: req.user.id,
      joint_with: payload.joint_with ?? null,
      planned_date: payload.planned_date ?? null,
      started_at: nowIso(),
      status: 'in_progress',
      notes: payload.notes ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      qr_token: randomToken(10),
      client_uuid: payload.client_uuid ?? null,
    });
    return get('SELECT * FROM v_inspections i WHERE i.id = ?', [id]);
  });

  audit(req, {
    action: 'INSPECTION_CREATE',
    entityType: 'inspection',
    entityId: created.id,
    next: created,
  });
  res.status(201).json(created);
});

function defaultTitle(payload, module, type) {
  const place = payload.station_id ? 'station' : payload.train_id ? 'train' : payload.section;
  return `${type.name} - ${module.name}${place ? '' : ''}`.trim();
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

/* ------------------------- automatic summary + close ---------------------- */

/** Builds the narrative summary of an inspection from its observations. */
export function buildAutoSummary(inspectionId) {
  const inspection = get('SELECT * FROM v_inspections i WHERE i.id = ?', [inspectionId]);
  if (!inspection) return null;
  const observations = all('SELECT * FROM v_observations o WHERE o.inspection_id = ?', [inspectionId]);
  const bySeverity = {};
  const byDepartment = {};
  const byModule = {};
  let withTdc = 0;
  let repeated = 0;
  for (const o of observations) {
    bySeverity[o.severity_name] = (bySeverity[o.severity_name] ?? 0) + 1;
    byDepartment[o.department_name] = (byDepartment[o.department_name] ?? 0) + 1;
    byModule[o.module_name] = (byModule[o.module_name] ?? 0) + 1;
    if (o.tdc) withTdc += 1;
    if (o.repeat_count > 0) repeated += 1;
  }
  const place = inspection.station_name
    ? `${inspection.station_name} (${inspection.station_code})`
    : [inspection.train_number, inspection.train_name].filter(Boolean).join(' ') ||
      inspection.section ||
      '-';
  const parts = [
    `${inspection.inspection_type_name} of ${place} was carried out by ${inspection.inspector_name}` +
      `${inspection.inspector_designation ? `, ${inspection.inspector_designation}` : ''} on ` +
      `${(inspection.started_at ?? inspection.created_at).slice(0, 10)}.`,
    observations.length
      ? `${observations.length} observation(s) were recorded` +
        `${Object.keys(bySeverity).length ? ` (${Object.entries(bySeverity).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}.`
      : 'No deficiency was noticed during this inspection.',
  ];
  if (Object.keys(byDepartment).length) {
    parts.push(
      `Action has been advised to: ${Object.entries(byDepartment)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} (${v})`)
        .join(', ')}.`
    );
  }
  if (withTdc) parts.push(`${withTdc} observation(s) carry a target date of compliance.`);
  if (repeated) {
    parts.push(
      `${repeated} observation(s) are repeated deficiencies and need sustained attention by the concerned department.`
    );
  }
  const critical = observations.filter((o) => o.severity_rank === 1);
  if (critical.length) {
    parts.push(
      `Critical observation(s) requiring immediate attention: ${critical
        .map((o) => `${o.ref_no} - ${o.item_name ?? o.category_name ?? 'observation'} at ${o.unit_name ?? place}`)
        .join('; ')}.`
    );
  }
  return {
    text: parts.join(' '),
    stats: {
      total: observations.length,
      by_severity: bySeverity,
      by_department: byDepartment,
      by_module: byModule,
      with_tdc: withTdc,
      repeated,
      critical: critical.length,
    },
  };
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
