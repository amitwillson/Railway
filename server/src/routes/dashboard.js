import express from 'express';
import { all, get } from '../db/index.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { query, z, optionalId, optionalText, optionalIsoDate } from '../lib/validate.js';
import { observationFilter } from '../lib/queries.js';

const router = express.Router();
router.use(authenticate);
router.use(requireCapability('dashboard:read'));

const filterSchema = z.object({
  module_id: optionalId,
  module_code: optionalText,
  station_id: optionalId,
  division_id: optionalId,
  department_id: optionalId,
  from: optionalIsoDate,
  to: optionalIsoDate,
  days: z.coerce.number().int().min(1).max(3650).optional(),
  mine: z.coerce.boolean().optional(),
  assigned_to_me: z.coerce.boolean().optional(),
});

/** Aggregate helper: counts over v_observations with the shared filter applied. */
function metrics(filters, user) {
  const { sql, params } = observationFilter(filters, user);
  const row = get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN o.status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN o.is_overdue = 1 THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN o.status = 'compliance_submitted' THEN 1 ELSE 0 END) AS compliance_submitted,
       SUM(CASE WHEN o.status = 'closed' THEN 1 ELSE 0 END) AS closed,
       SUM(CASE WHEN o.status = 'reopened' THEN 1 ELSE 0 END) AS reopened,
       SUM(CASE WHEN o.status = 'acknowledged' THEN 1 ELSE 0 END) AS acknowledged,
       SUM(CASE WHEN o.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN o.status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
       SUM(CASE WHEN o.status = 'assigned' THEN 1 ELSE 0 END) AS assigned,
       SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
       SUM(CASE WHEN o.severity_rank = 1 THEN 1 ELSE 0 END) AS critical,
       SUM(CASE WHEN o.severity_rank = 1 AND o.status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END) AS critical_open,
       SUM(CASE WHEN o.repeat_count > 0 THEN 1 ELSE 0 END) AS repeated,
       SUM(CASE WHEN o.tdc IS NOT NULL THEN 1 ELSE 0 END) AS with_tdc,
       SUM(CASE WHEN o.is_open = 1 AND o.days_to_tdc BETWEEN 0 AND 3 THEN 1 ELSE 0 END) AS due_soon
     FROM v_observations o WHERE ${sql}`,
    params
  );
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v ?? 0)]));
}

/* ------------------------------ key metrics ------------------------------- */

router.get('/overview', query(filterSchema), (req, res) => {
  const f = req.validQuery;
  const obs = metrics(f, req.user);
  const inspectionWhere = [];
  const inspectionParams = [];
  if (f.module_id) {
    inspectionWhere.push('i.module_id = ?');
    inspectionParams.push(f.module_id);
  }
  if (f.station_id) {
    inspectionWhere.push('i.station_id = ?');
    inspectionParams.push(f.station_id);
  }
  if (f.division_id) {
    inspectionWhere.push('i.station_id IN (SELECT id FROM stations WHERE division_id = ?)');
    inspectionParams.push(f.division_id);
  }
  if (f.mine) {
    inspectionWhere.push('i.inspector_id = ?');
    inspectionParams.push(req.user.id);
  }
  if (f.from) {
    inspectionWhere.push('date(i.created_at) >= date(?)');
    inspectionParams.push(f.from);
  }
  if (f.to) {
    inspectionWhere.push('date(i.created_at) <= date(?)');
    inspectionParams.push(f.to);
  }
  const iw = inspectionWhere.length ? inspectionWhere.join(' AND ') : '1=1';
  const inspections = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN date(i.created_at) = date('now','localtime') THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN i.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN i.status = 'completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN date(i.created_at) >= date('now','localtime','-6 days') THEN 1 ELSE 0 END) AS this_week
       FROM v_inspections i WHERE ${iw}`,
    inspectionParams
  );

  const { sql, params } = observationFilter(f, req.user);
  const closure = get(
    `SELECT ROUND(AVG(julianday(o.closed_at) - julianday(o.observed_at)), 1) AS avg_days,
            ROUND(MIN(julianday(o.closed_at) - julianday(o.observed_at)), 1) AS min_days,
            ROUND(MAX(julianday(o.closed_at) - julianday(o.observed_at)), 1) AS max_days
       FROM v_observations o WHERE ${sql} AND o.closed_at IS NOT NULL`,
    params
  );
  const onTime = get(
    `SELECT
       SUM(CASE WHEN o.tdc IS NOT NULL AND date(o.closed_at) <= date(o.tdc) THEN 1 ELSE 0 END) AS on_time,
       SUM(CASE WHEN o.tdc IS NOT NULL AND date(o.closed_at) > date(o.tdc) THEN 1 ELSE 0 END) AS late
     FROM v_observations o WHERE ${sql} AND o.status = 'closed'`,
    params
  );

  res.json({
    observations: obs,
    inspections: Object.fromEntries(
      Object.entries(inspections).map(([k, v]) => [k, Number(v ?? 0)])
    ),
    compliance: {
      avg_closure_days: closure.avg_days ?? null,
      fastest_closure_days: closure.min_days ?? null,
      slowest_closure_days: closure.max_days ?? null,
      closed_on_time: Number(onTime.on_time ?? 0),
      closed_late: Number(onTime.late ?? 0),
      closure_rate:
        obs.total > 0 ? Math.round((obs.closed / obs.total) * 1000) / 10 : 0,
    },
  });
});

/* --------------------------- module-wise dashboard ------------------------- */

router.get('/modules', query(filterSchema), (req, res) => {
  const modules = all('SELECT * FROM modules WHERE active = 1 ORDER BY sort_order');
  res.json({
    data: modules.map((m) => ({
      module: m,
      inspections: Number(
        get(
          `SELECT COUNT(*) AS n FROM v_inspections i WHERE i.module_id = ?${
            req.validQuery.from ? ' AND date(i.created_at) >= date(?)' : ''
          }`,
          req.validQuery.from ? [m.id, req.validQuery.from] : [m.id]
        ).n
      ),
      ...metrics({ ...req.validQuery, module_id: m.id }, req.user),
    })),
  });
});

/* ------------------------- department-wise dashboard ---------------------- */

router.get('/departments', query(filterSchema), (req, res) => {
  const { sql, params } = observationFilter(req.validQuery, req.user);
  res.json({
    data: all(
      `SELECT o.action_by_department_id AS department_id,
              o.department_name,
              o.department_code,
              COUNT(*) AS total,
              SUM(CASE WHEN o.status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN o.is_open = 1 AND o.days_to_tdc BETWEEN 0 AND 3 THEN 1 ELSE 0 END) AS due_soon,
              SUM(CASE WHEN o.is_overdue = 1 THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN o.status = 'compliance_submitted' THEN 1 ELSE 0 END) AS compliance_submitted,
              SUM(CASE WHEN o.status = 'closed' THEN 1 ELSE 0 END) AS closed,
              SUM(CASE WHEN o.severity_rank = 1 THEN 1 ELSE 0 END) AS critical,
              ROUND(AVG(CASE WHEN o.closed_at IS NOT NULL
                   THEN julianday(o.closed_at) - julianday(o.observed_at) END), 1) AS avg_closure_days
         FROM v_observations o
        WHERE ${sql}
        GROUP BY o.action_by_department_id
        ORDER BY total DESC`,
      params
    ),
  });
});

/* -------------------------- station-wise dashboard ------------------------ */

router.get('/stations', query(filterSchema.extend({ limit: z.coerce.number().int().min(1).max(200).default(50) })), (req, res) => {
  const { limit, ...rest } = req.validQuery;
  const { sql, params } = observationFilter(rest, req.user);
  res.json({
    data: all(
      `SELECT o.station_id, o.station_name, o.station_code, o.division_name,
              COUNT(*) AS observations,
              SUM(CASE WHEN o.status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN o.is_overdue = 1 THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN o.status = 'closed' THEN 1 ELSE 0 END) AS closed,
              SUM(CASE WHEN o.repeat_count > 0 THEN 1 ELSE 0 END) AS repeated,
              SUM(CASE WHEN o.severity_rank = 1 THEN 1 ELSE 0 END) AS critical,
              SUM(CASE WHEN o.module_code = 'PA' THEN 1 ELSE 0 END) AS passenger_amenities,
              SUM(CASE WHEN o.module_code = 'CI' THEN 1 ELSE 0 END) AS commercial,
              SUM(CASE WHEN o.module_code = 'SR' THEN 1 ELSE 0 END) AS safe_running,
              (SELECT COUNT(*) FROM inspections i WHERE i.station_id = o.station_id) AS inspections,
              MAX(o.observed_at) AS last_observation_at
         FROM v_observations o
        WHERE ${sql} AND o.station_id IS NOT NULL
        GROUP BY o.station_id
        ORDER BY pending DESC, observations DESC
        LIMIT ?`,
      [...params, limit]
    ),
  });
});

/* ------------------------------ severity mix ------------------------------ */

router.get('/severity', query(filterSchema), (req, res) => {
  const { sql, params } = observationFilter(req.validQuery, req.user);
  res.json({
    data: all(
      `SELECT o.severity_id, o.severity_name, o.severity_rank, o.severity_accent,
              COUNT(*) AS total,
              SUM(CASE WHEN o.status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN o.is_overdue = 1 THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN o.status = 'closed' THEN 1 ELSE 0 END) AS closed
         FROM v_observations o WHERE ${sql}
        GROUP BY o.severity_id ORDER BY o.severity_rank`,
      params
    ),
  });
});

router.get('/categories', query(filterSchema), (req, res) => {
  const { sql, params } = observationFilter(req.validQuery, req.user);
  res.json({
    data: all(
      `SELECT COALESCE(o.category_name, 'Uncategorised') AS category_name, o.category_id,
              COUNT(*) AS total,
              SUM(CASE WHEN o.status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END) AS open
         FROM v_observations o WHERE ${sql}
        GROUP BY o.category_id ORDER BY total DESC LIMIT 20`,
      params
    ),
  });
});

/* -------------------------------- trends --------------------------------- */

router.get(
  '/trends',
  query(filterSchema.extend({ bucket_days: z.coerce.number().int().min(1).max(90).default(1) })),
  (req, res) => {
    const days = req.validQuery.days ?? 30;
    const { sql, params } = observationFilter({ ...req.validQuery, days }, req.user);
    const raised = all(
      `SELECT date(o.observed_at) AS day, COUNT(*) AS n
         FROM v_observations o WHERE ${sql} GROUP BY day ORDER BY day`,
      params
    );
    const closed = all(
      `SELECT date(o.closed_at) AS day, COUNT(*) AS n
         FROM v_observations o WHERE ${sql} AND o.closed_at IS NOT NULL GROUP BY day ORDER BY day`,
      params
    );
    const byDay = new Map();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { day: key, raised: 0, closed: 0 });
    }
    for (const r of raised) if (byDay.has(r.day)) byDay.get(r.day).raised = Number(r.n);
    for (const c of closed) if (byDay.has(c.day)) byDay.get(c.day).closed = Number(c.n);
    res.json({ days, data: [...byDay.values()] });
  }
);

/* --------------------------- repeated deficiencies ----------------------- */

router.get(
  '/repeats',
  query(filterSchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(15) })),
  (req, res) => {
    const { limit, ...rest } = req.validQuery;
    const { sql, params } = observationFilter({ ...rest, days: rest.days ?? 90 }, req.user);
    res.json({
      window_days: rest.days ?? 90,
      data: all(
        `SELECT o.station_id, o.station_name, o.station_code, o.unit_name, o.item_name,
                o.module_code, o.module_name,
                COUNT(*) AS occurrences,
                SUM(CASE WHEN o.status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END) AS open,
                MAX(o.observed_at) AS last_seen,
                MIN(o.observed_at) AS first_seen,
                group_concat(o.ref_no) AS refs
           FROM v_observations o
          WHERE ${sql} AND o.item_name IS NOT NULL
          GROUP BY o.station_id, o.unit_name, o.item_name
         HAVING COUNT(*) > 1
          ORDER BY occurrences DESC, last_seen DESC
          LIMIT ?`,
        [...params, limit]
      ).map((r) => ({ ...r, refs: String(r.refs ?? '').split(',') })),
    });
  }
);

/* --------------------------- supervisor scoreboard ----------------------- */

router.get('/supervisors', query(filterSchema), (req, res) => {
  const { sql, params } = observationFilter(req.validQuery, req.user);
  res.json({
    data: all(
      `SELECT o.supervisor_id, o.supervisor_name, o.supervisor_designation, o.department_name,
              COUNT(*) AS assigned,
              SUM(CASE WHEN o.status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN o.is_overdue = 1 THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN o.status = 'closed' THEN 1 ELSE 0 END) AS closed,
              ROUND(AVG(CASE WHEN o.compliance_submitted_at IS NOT NULL
                   THEN julianday(o.compliance_submitted_at) - julianday(o.observed_at) END), 1)
                AS avg_response_days
         FROM v_observations o
        WHERE ${sql} AND o.supervisor_id IS NOT NULL
        GROUP BY o.supervisor_id
        ORDER BY overdue DESC, pending DESC
        LIMIT 40`,
      params
    ),
  });
});

/** Compact payload for the mobile home screen. */
router.get('/home', (req, res) => {
  const mine = metrics({ mine: true }, req.user);
  const assigned = metrics({ assigned_to_me: true }, req.user);
  const all_ = metrics({}, req.user);
  res.json({
    modules: all('SELECT * FROM modules WHERE active = 1 ORDER BY sort_order').map((m) => ({
      ...m,
      ...metrics({ module_id: m.id }, req.user),
    })),
    tiles: {
      my_inspections: Number(
        get('SELECT COUNT(*) AS n FROM inspections WHERE inspector_id = ?', [req.user.id]).n
      ),
      my_observations: mine.total,
      pending_observations: all_.open,
      compliance_pending: assigned.open,
      awaiting_verification: all_.compliance_submitted,
      overdue: all_.overdue,
      critical_open: all_.critical_open,
      closed: all_.closed,
    },
    recent_observations: all(
      `SELECT o.id, o.ref_no, o.observation, o.status, o.severity_name, o.module_code,
              o.station_name, o.unit_name, o.item_name, o.tdc, o.is_overdue, o.observed_at
         FROM v_observations o
        WHERE o.created_by = ? OR o.supervisor_id IN (SELECT id FROM supervisors WHERE user_id = ?)
        ORDER BY o.observed_at DESC LIMIT 8`,
      [req.user.id, req.user.id]
    ),
  });
});

export default router;
