import express from 'express';
import { all, get } from '../db/index.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { query, z, optionalId, optionalText } from '../lib/validate.js';
import { listObservations } from '../lib/queries.js';

const router = express.Router();
router.use(authenticate);
router.use(requireCapability('compliance:read'));

/** The supervisor's work queue: everything assigned and still open. */
router.get(
  '/queue',
  query(
    z.object({
      status: optionalText,
      overdue: z.coerce.boolean().optional(),
      station_id: optionalId,
      module_id: optionalId,
      q: optionalText,
      sort: z.enum(['newest', 'oldest', 'tdc', 'severity', 'overdue', 'status']).default('tdc'),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(25),
    })
  ),
  (req, res) => {
    const result = listObservations(
      { ...req.validQuery, assigned_to_me: true, open: !req.validQuery.status },
      req.user
    );
    res.json({
      ...result,
      buckets: {
        to_acknowledge: listObservations(
          { assigned_to_me: true, status: 'assigned,submitted', page_size: 1 },
          req.user
        ).total,
        in_progress: listObservations(
          { assigned_to_me: true, status: 'acknowledged,in_progress', page_size: 1 },
          req.user
        ).total,
        rejected: listObservations(
          { assigned_to_me: true, status: 'rejected,reopened', page_size: 1 },
          req.user
        ).total,
        overdue: listObservations({ assigned_to_me: true, overdue: true, page_size: 1 }, req.user).total,
        submitted: listObservations(
          { assigned_to_me: true, status: 'compliance_submitted', page_size: 1 },
          req.user
        ).total,
      },
    });
  }
);

/** The inspecting officer's verification queue. */
router.get(
  '/awaiting-verification',
  query(
    z.object({
      mine: z.coerce.boolean().default(true),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(25),
      q: optionalText,
    })
  ),
  (req, res) => {
    res.json(
      listObservations(
        { ...req.validQuery, awaiting_verification: true, sort: 'oldest' },
        req.user
      )
    );
  }
);

/** Full compliance register with the verification outcome of each round. */
router.get(
  '/',
  query(
    z.object({
      observation_id: optionalId,
      status: optionalText,
      from: optionalText,
      to: optionalText,
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(25),
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    const where = ['1=1'];
    const params = [];
    if (f.observation_id) {
      where.push('c.observation_id = ?');
      params.push(f.observation_id);
    }
    if (f.status) {
      const list = f.status.split(',').map((s) => s.trim());
      where.push(`c.status IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
    if (f.from) {
      where.push('date(c.submitted_at) >= date(?)');
      params.push(f.from);
    }
    if (f.to) {
      where.push('date(c.submitted_at) <= date(?)');
      params.push(f.to);
    }
    const total = get(`SELECT COUNT(*) AS n FROM compliances c WHERE ${where.join(' AND ')}`, params).n;
    res.json({
      data: all(
        `SELECT c.*, o.ref_no AS observation_ref, o.observation, o.status AS observation_status,
                o.station_name, o.unit_name, o.item_name, o.module_code, o.severity_name, o.tdc,
                o.department_name, u.name AS submitted_by_name, v.name AS verified_by_name,
                (SELECT COUNT(*) FROM attachments a WHERE a.compliance_id = c.id) AS attachment_count
           FROM compliances c
           JOIN v_observations o ON o.id = c.observation_id
           JOIN users u ON u.id = c.submitted_by
           LEFT JOIN users v ON v.id = c.verified_by
          WHERE ${where.join(' AND ')}
          ORDER BY c.submitted_at DESC
          LIMIT ? OFFSET ?`,
        [...params, f.page_size, (f.page - 1) * f.page_size]
      ),
      page: f.page,
      page_size: f.page_size,
      total,
      total_pages: Math.max(1, Math.ceil(total / f.page_size)),
    });
  }
);

export default router;
