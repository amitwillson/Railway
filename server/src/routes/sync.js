import express from 'express';
import { all, get, insert, nowIso, update } from '../db/index.js';
import { nextRef, randomToken } from '../lib/ids.js';
import { audit } from '../lib/audit.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { asyncRoute } from '../lib/http.js';
import { body, z, optionalText } from '../lib/validate.js';
import { createObservation } from '../services/observationService.js';
import { observationById } from '../lib/queries.js';

const router = express.Router();
router.use(authenticate);

/**
 * Master-data snapshot for offline work. The PWA stores this in IndexedDB so
 * that the whole inspection screen - stations, units, amenities, departments,
 * supervisors - keeps working with no connectivity.
 */
router.get('/snapshot', requireCapability('master:read'), (req, res) => {
  res.json({
    generated_at: nowIso(),
    version: 1,
    modules: all('SELECT * FROM modules WHERE active = 1 ORDER BY sort_order'),
    inspection_types: all(
      'SELECT id, name, module_id, sort_order FROM inspection_types WHERE active = 1 ORDER BY sort_order, name'
    ),
    departments: all('SELECT id, code, name, sort_order FROM departments WHERE active = 1 ORDER BY sort_order'),
    severities: all('SELECT * FROM severities WHERE active = 1 ORDER BY rank'),
    observation_categories: all(
      'SELECT id, name, sort_order FROM observation_categories WHERE active = 1 ORDER BY sort_order'
    ),
    item_parameters: all('SELECT * FROM item_parameters WHERE active = 1 ORDER BY sort_order'),
    item_groups: all(
      'SELECT id, module_id, name, sort_order FROM item_groups WHERE active = 1 ORDER BY sort_order'
    ),
    inspection_items: all(
      `SELECT id, group_id, module_id, name, applies_to, default_department_id,
              default_category_id, default_severity_id, sort_order
         FROM inspection_items WHERE active = 1 ORDER BY sort_order, name`
    ),
    stations: all(
      `SELECT s.id, s.code, s.name, s.category, s.station_type, s.platforms,
              d.name AS division_name, z.code AS zone_code
         FROM stations s JOIN divisions d ON d.id = s.division_id
         JOIN zones z ON z.id = s.zone_id WHERE s.active = 1 ORDER BY s.name`
    ),
    trains: all('SELECT id, number, name, origin, destination, has_pantry FROM trains WHERE active = 1 ORDER BY number'),
    units: all(
      'SELECT id, name, applies_to, station_id, kind, sort_order FROM units WHERE active = 1 ORDER BY sort_order, name'
    ),
    supervisors: all(
      `SELECT s.id, s.name, s.employee_id, s.designation, s.department_id, s.station_id,
              s.area_of_responsibility, s.mobile, s.email, s.is_default_for_department
         FROM supervisors s WHERE s.active = 1 ORDER BY s.name`
    ),
    supervisor_coverage: all('SELECT * FROM supervisor_coverage WHERE active = 1'),
    rule_references: all('SELECT id, code, title, authority FROM rule_references WHERE active = 1'),
  });
});

/* -------------------------------------------------------------------------- */
/* Batch upload of work captured offline                                      */
/* -------------------------------------------------------------------------- */

const operationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('inspection'),
    client_uuid: z.string().min(8),
    payload: z.object({
      module_id: z.coerce.number().int().positive(),
      inspection_type_id: z.coerce.number().int().positive(),
      location_type: z.string().min(2),
      station_id: z.coerce.number().int().positive().optional(),
      train_id: z.coerce.number().int().positive().optional(),
      section: optionalText,
      title: optionalText,
      joint_with: optionalText,
      planned_date: optionalText,
      notes: optionalText,
      started_at: optionalText,
      latitude: z.coerce.number().optional(),
      longitude: z.coerce.number().optional(),
    }),
  }),
  z.object({
    type: z.literal('observation'),
    client_uuid: z.string().min(8),
    /** Set when the parent inspection was also created offline. */
    inspection_client_uuid: z.string().min(8).optional(),
    payload: z.object({
      inspection_id: z.coerce.number().int().positive().optional(),
      unit_id: z.coerce.number().int().positive().optional(),
      unit_name: optionalText,
      item_id: z.coerce.number().int().positive().optional(),
      coach: optionalText,
      parameters: z.array(z.object({ parameter_id: z.coerce.number().optional(), name: z.string(), value: z.any() })).optional(),
      observation: z.string().trim().min(5),
      category_id: z.coerce.number().int().positive().optional(),
      severity_id: z.coerce.number().int().positive().optional(),
      action_by_department_id: z.coerce.number().int().positive(),
      supervisor_id: z.coerce.number().int().positive().optional(),
      rule_reference_id: z.coerce.number().int().positive().optional(),
      tdc: optionalText,
      latitude: z.coerce.number().optional(),
      longitude: z.coerce.number().optional(),
      observed_at: optionalText,
    }),
  }),
]);

router.post(
  '/batch',
  requireCapability('observation:create'),
  body(z.object({ operations: z.array(operationSchema).min(1).max(100) })),
  asyncRoute(async (req, res) => {
    const results = [];
    /** Maps an offline inspection uuid to the server id created in this batch. */
    const inspectionIds = new Map();

    for (const op of req.body.operations) {
      try {
        if (op.type === 'inspection') {
          const existing = get('SELECT id, ref_no FROM inspections WHERE client_uuid = ?', [op.client_uuid]);
          if (existing) {
            inspectionIds.set(op.client_uuid, existing.id);
            results.push({ client_uuid: op.client_uuid, type: op.type, status: 'duplicate', id: existing.id, ref_no: existing.ref_no });
            continue;
          }
          const id = insert('inspections', {
            ref_no: nextRef('inspections', 'INSP'),
            module_id: op.payload.module_id,
            inspection_type_id: op.payload.inspection_type_id,
            location_type: op.payload.location_type,
            station_id: op.payload.station_id ?? null,
            train_id: op.payload.train_id ?? null,
            section: op.payload.section ?? null,
            title: op.payload.title ?? null,
            inspector_id: req.user.id,
            joint_with: op.payload.joint_with ?? null,
            planned_date: op.payload.planned_date ?? null,
            started_at: op.payload.started_at ?? nowIso(),
            status: 'in_progress',
            notes: op.payload.notes ?? null,
            latitude: op.payload.latitude ?? null,
            longitude: op.payload.longitude ?? null,
            qr_token: randomToken(10),
            client_uuid: op.client_uuid,
          });
          inspectionIds.set(op.client_uuid, id);
          const row = get('SELECT ref_no FROM inspections WHERE id = ?', [id]);
          audit(req, {
            action: 'INSPECTION_CREATE',
            entityType: 'inspection',
            entityId: id,
            next: { ...op.payload, source: 'offline-sync' },
          });
          results.push({ client_uuid: op.client_uuid, type: op.type, status: 'created', id, ref_no: row.ref_no });
          continue;
        }

        // observation
        const inspectionId =
          op.payload.inspection_id ??
          inspectionIds.get(op.inspection_client_uuid) ??
          get('SELECT id FROM inspections WHERE client_uuid = ?', [op.inspection_client_uuid ?? ''])?.id;
        if (!inspectionId) {
          results.push({
            client_uuid: op.client_uuid,
            type: op.type,
            status: 'failed',
            error: 'Parent inspection has not been synced yet',
          });
          continue;
        }
        const outcome = await createObservation({
          payload: { ...op.payload, inspection_id: inspectionId, client_uuid: op.client_uuid },
          user: req.user,
          req,
        });
        results.push({
          client_uuid: op.client_uuid,
          type: op.type,
          status: outcome.deduplicated ? 'duplicate' : 'created',
          id: outcome.observation.id,
          ref_no: outcome.observation.ref_no,
          repeat_count: outcome.observation.repeat_count,
          supervisor_name: outcome.observation.supervisor_name,
          notification_recipients: outcome.notification?.recipients ?? 0,
        });
      } catch (err) {
        results.push({
          client_uuid: op.client_uuid,
          type: op.type,
          status: 'failed',
          error: err.message,
          code: err.code ?? 'ERROR',
        });
      }
    }

    const created = results.filter((r) => r.status === 'created').length;
    const duplicates = results.filter((r) => r.status === 'duplicate').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    audit(req, {
      action: 'OFFLINE_SYNC',
      entityType: 'sync',
      entityId: null,
      next: { created, duplicates, failed, total: results.length },
    });
    res.status(failed && !created ? 207 : 200).json({
      synced_at: nowIso(),
      summary: { total: results.length, created, duplicates, failed },
      results,
    });
  })
);

/** Attach a photo captured offline to an already-synced observation. */
router.get('/status', (req, res) => {
  res.json({
    server_time: nowIso(),
    user: { id: req.user.id, name: req.user.name, role: req.user.role },
    pending_for_me: get(
      `SELECT COUNT(*) AS n FROM observations o
        WHERE o.created_by = ? AND o.status NOT IN ('closed','cancelled')`,
      [req.user.id]
    ).n,
  });
});

/** Marks an offline-captured inspection as completed after sync. */
router.post(
  '/complete-inspection',
  requireCapability('inspection:update'),
  body(z.object({ client_uuid: z.string().min(8), summary: optionalText })),
  (req, res) => {
    const inspection = get('SELECT * FROM inspections WHERE client_uuid = ?', [req.body.client_uuid]);
    if (!inspection) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Inspection has not been synced' } });
      return;
    }
    update('inspections', inspection.id, {
      status: 'completed',
      completed_at: inspection.completed_at ?? nowIso(),
      summary: req.body.summary ?? inspection.summary,
      updated_at: nowIso(),
    });
    res.json(observationSafe(inspection.id));
  }
);

const observationSafe = (id) => get('SELECT * FROM v_inspections i WHERE i.id = ?', [id]);

export default router;
