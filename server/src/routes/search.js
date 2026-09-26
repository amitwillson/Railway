import express from 'express';
import { all } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { query, z } from '../lib/validate.js';
import { listObservations } from '../lib/queries.js';

const router = express.Router();
router.use(authenticate);

/**
 * Global search across stations, trains, observations, inspections and
 * supervisors. One endpoint powers the search bar in the application header.
 */
router.get(
  '/',
  query(
    z.object({
      q: z.string().trim().min(1),
      limit: z.coerce.number().int().min(1).max(25).default(6),
    })
  ),
  (req, res) => {
    const { q, limit } = req.validQuery;
    const like = `%${q.toLowerCase()}%`;

    const stations = all(
      `SELECT s.id, s.code, s.name, s.category, d.name AS division_name
         FROM stations s JOIN divisions d ON d.id = s.division_id
        WHERE s.active = 1 AND (lower(s.name) LIKE ? OR lower(s.code) LIKE ?)
        ORDER BY CASE WHEN lower(s.code) = lower(?) THEN 0 ELSE 1 END, s.name LIMIT ?`,
      [like, like, q, limit]
    );
    const trains = all(
      `SELECT id, number, name, origin, destination FROM trains
        WHERE active = 1 AND (lower(name) LIKE ? OR number LIKE ?) ORDER BY number LIMIT ?`,
      [like, `%${q}%`, limit]
    );
    const supervisors = all(
      `SELECT sup.id, sup.name, sup.designation, sup.mobile, sup.employee_id,
              dep.name AS department_name, st.name AS station_name
         FROM supervisors sup
         JOIN departments dep ON dep.id = sup.department_id
         LEFT JOIN stations st ON st.id = sup.station_id
        WHERE sup.active = 1 AND (lower(sup.name) LIKE ? OR lower(sup.employee_id) LIKE ?)
        ORDER BY sup.name LIMIT ?`,
      [like, like, limit]
    );
    const inspections = all(
      `SELECT i.id, i.ref_no, i.inspection_type_name, i.module_code, i.station_name,
              i.train_number, i.status, i.created_at, i.inspector_name
         FROM v_inspections i
        WHERE lower(i.ref_no) LIKE ? OR lower(COALESCE(i.title,'')) LIKE ?
           OR lower(COALESCE(i.station_name,'')) LIKE ?
        ORDER BY i.created_at DESC LIMIT ?`,
      [like, like, like, limit]
    );
    const observations = listObservations({ q, page_size: limit }, req.user);

    res.json({
      query: q,
      stations,
      trains,
      supervisors,
      inspections,
      observations: observations.data,
      totals: {
        stations: stations.length,
        trains: trains.length,
        supervisors: supervisors.length,
        inspections: inspections.length,
        observations: observations.total,
      },
    });
  }
);

export default router;
