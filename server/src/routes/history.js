import express from 'express';
import { all, get } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { query, z, optionalId } from '../lib/validate.js';
import { decorate } from '../lib/queries.js';

const router = express.Router();
router.use(authenticate);
router.use(requireCapability('inspection:read'));

/* ---------------------------- station history ----------------------------- */

router.get(
  '/stations/:id',
  query(z.object({ days: z.coerce.number().int().min(1).max(3650).default(365) })),
  (req, res) => {
    const station = get(
      `SELECT s.*, d.name AS division_name, z.name AS zone_name, z.code AS zone_code
         FROM stations s JOIN divisions d ON d.id = s.division_id
         JOIN zones z ON z.id = s.zone_id WHERE s.id = ?`,
      [req.params.id]
    );
    if (!station) throw notFound('Station');
    const { days } = req.validQuery;

    const inspections = all(
      `SELECT * FROM v_inspections i
        WHERE i.station_id = ? AND julianday('now') - julianday(i.created_at) <= ?
        ORDER BY i.created_at DESC`,
      [station.id, days]
    );
    const observations = all(
      `SELECT * FROM v_observations o
        WHERE o.station_id = ? AND julianday('now') - julianday(o.observed_at) <= ?
        ORDER BY o.observed_at DESC`,
      [station.id, days]
    ).map(decorate);

    const summary = {
      inspections: inspections.length,
      observations: observations.length,
      pending: observations.filter((o) => o.is_open).length,
      overdue: observations.filter((o) => o.is_overdue).length,
      closed: observations.filter((o) => o.status === 'closed').length,
      repeated: observations.filter((o) => o.repeat_count > 0).length,
      critical: observations.filter((o) => o.severity_rank === 1).length,
      by_module: countBy(observations, (o) => o.module_name),
      by_department: countBy(observations, (o) => o.department_name),
      by_unit: countBy(observations, (o) => o.unit_name ?? 'Not specified'),
      avg_closure_days: average(
        observations
          .filter((o) => o.closed_at)
          .map((o) => (Date.parse(o.closed_at) - Date.parse(o.observed_at)) / 86_400_000)
      ),
    };

    const repeated = all(
      `SELECT o.unit_name, o.item_name, o.module_code, COUNT(*) AS occurrences,
              MAX(o.observed_at) AS last_seen, MIN(o.observed_at) AS first_seen,
              SUM(CASE WHEN o.status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END) AS open,
              group_concat(o.ref_no) AS refs
         FROM v_observations o
        WHERE o.station_id = ? AND o.item_name IS NOT NULL
          AND julianday('now') - julianday(o.observed_at) <= ?
        GROUP BY o.unit_name, o.item_name
       HAVING COUNT(*) > 1
        ORDER BY occurrences DESC, last_seen DESC`,
      [station.id, days]
    ).map((r) => ({ ...r, refs: String(r.refs ?? '').split(',') }));

    res.json({
      station,
      window_days: days,
      summary,
      repeated_deficiencies: repeated,
      inspections,
      observations,
      units: all(
        `SELECT u.* FROM units u
          WHERE u.active = 1 AND (u.station_id = ? OR u.station_id IS NULL)
            AND u.applies_to IN ('station','both') ORDER BY u.sort_order, u.name`,
        [station.id]
      ),
    });
  }
);

/**
 * Compares two inspections of the same station: what was carried forward,
 * what was newly noticed and what got closed in between.
 */
router.get(
  '/stations/:id/compare',
  query(z.object({ previous: optionalId, current: optionalId })),
  (req, res) => {
    const stationId = Number(req.params.id);
    const list = all(
      `SELECT * FROM v_inspections i WHERE i.station_id = ? ORDER BY i.created_at DESC LIMIT 20`,
      [stationId]
    );
    if (list.length === 0) throw notFound('Inspection for this station');
    const current = req.validQuery.current
      ? list.find((i) => i.id === req.validQuery.current) ?? list[0]
      : list[0];
    const previous = req.validQuery.previous
      ? list.find((i) => i.id === req.validQuery.previous)
      : list.find((i) => i.id !== current.id);

    const obsFor = (inspectionId) =>
      inspectionId
        ? all('SELECT * FROM v_observations o WHERE o.inspection_id = ?', [inspectionId]).map(decorate)
        : [];
    const currentObs = obsFor(current?.id);
    const previousObs = obsFor(previous?.id);
    const key = (o) => `${(o.unit_name ?? '').toLowerCase()}|${(o.item_name ?? '').toLowerCase()}`;
    const previousKeys = new Map(previousObs.map((o) => [key(o), o]));
    const currentKeys = new Map(currentObs.map((o) => [key(o), o]));

    res.json({
      available_inspections: list,
      current,
      previous: previous ?? null,
      carried_forward: currentObs
        .filter((o) => previousKeys.has(key(o)))
        .map((o) => ({ current: o, previous: previousKeys.get(key(o)) })),
      newly_observed: currentObs.filter((o) => !previousKeys.has(key(o))),
      rectified_since_last: previousObs.filter(
        (o) => o.status === 'closed' && !currentKeys.has(key(o))
      ),
      still_open_from_previous: previousObs.filter((o) => o.is_open),
    });
  }
);

/* ----------------------------- train history ------------------------------ */

router.get('/trains/:id', (req, res) => {
  const train = get('SELECT * FROM trains WHERE id = ?', [req.params.id]);
  if (!train) throw notFound('Train');
  const inspections = all(
    'SELECT * FROM v_inspections i WHERE i.train_id = ? ORDER BY i.created_at DESC',
    [train.id]
  );
  const observations = all(
    'SELECT * FROM v_observations o WHERE o.train_id = ? ORDER BY o.observed_at DESC',
    [train.id]
  ).map(decorate);
  res.json({
    train,
    summary: {
      inspections: inspections.length,
      observations: observations.length,
      pending: observations.filter((o) => o.is_open).length,
      overdue: observations.filter((o) => o.is_overdue).length,
      closed: observations.filter((o) => o.status === 'closed').length,
      critical: observations.filter((o) => o.severity_rank === 1).length,
      by_coach: countBy(observations, (o) => o.coach ?? o.unit_name ?? 'Not specified'),
      by_department: countBy(observations, (o) => o.department_name),
    },
    inspections,
    observations,
  });
});

/** Train inspection register: one row per observation, searchable. */
router.get(
  '/trains',
  query(
    z.object({
      q: z.string().trim().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
  ),
  (req, res) => {
    const { q, limit } = req.validQuery;
    const where = ['1=1'];
    const params = [];
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      where.push('(lower(t.name) LIKE ? OR t.number LIKE ?)');
      params.push(like, `%${q}%`);
    }
    res.json({
      data: all(
        `SELECT t.*,
                (SELECT COUNT(*) FROM inspections i WHERE i.train_id = t.id) AS inspections,
                (SELECT COUNT(*) FROM observations o WHERE o.train_id = t.id) AS observations,
                (SELECT COUNT(*) FROM observations o WHERE o.train_id = t.id
                   AND o.status NOT IN ('closed','cancelled')) AS pending,
                (SELECT MAX(i.created_at) FROM inspections i WHERE i.train_id = t.id) AS last_inspected_at
           FROM trains t WHERE ${where.join(' AND ')} AND t.active = 1
          ORDER BY (inspections > 0) DESC, t.number LIMIT ?`,
        [...params, limit]
      ),
    });
  }
);

const countBy = (rows, fn) => {
  const out = {};
  for (const row of rows) {
    const key = fn(row) ?? 'Not specified';
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};

const average = (values) =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

export default router;
