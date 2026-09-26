import express from 'express';
import { all, get, nowIso, run } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { authenticate, requireCapability, isAdmin } from '../middleware/auth.js';
import { query, z, optionalBool } from '../lib/validate.js';

const router = express.Router();
router.use(authenticate);
router.use(requireCapability('notification:read'));

router.get(
  '/',
  query(
    z.object({
      unread: optionalBool,
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
  ),
  (req, res) => {
    const { unread, limit } = req.validQuery;
    const where = ['n.user_id = ?'];
    const params = [req.user.id];
    if (unread) where.push('n.read_at IS NULL');
    res.json({
      unread_count: get(
        'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
        [req.user.id]
      ).n,
      data: all(
        `SELECT n.*, o.ref_no AS observation_ref, o.status AS observation_status,
                o.station_name, o.unit_name, o.item_name, o.severity_name, o.tdc,
                (SELECT group_concat(d.channel || ':' || d.status, ', ')
                   FROM notification_deliveries d WHERE d.notification_id = n.id) AS delivery_status
           FROM notifications n
           LEFT JOIN v_observations o ON o.id = n.observation_id
          WHERE ${where.join(' AND ')}
          ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
        [...params, limit]
      ),
    });
  }
);

router.post('/:id/read', (req, res) => {
  const row = get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', [
    req.params.id,
    req.user.id,
  ]);
  if (!row) throw notFound('Notification');
  if (!row.read_at) run('UPDATE notifications SET read_at = ? WHERE id = ?', [nowIso(), row.id]);
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  const info = run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [
    nowIso(),
    req.user.id,
  ]);
  res.json({ ok: true, updated: info.changes });
});

/**
 * Delivery tracking. Admins see every channel attempt; other users see the
 * deliveries addressed to them.
 */
router.get(
  '/deliveries',
  query(
    z.object({
      observation_id: z.coerce.number().int().positive().optional(),
      status: z.enum(['queued', 'sent', 'failed', 'skipped']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    const where = ['1=1'];
    const params = [];
    if (!isAdmin(req.user)) {
      where.push('n.user_id = ?');
      params.push(req.user.id);
    }
    if (f.observation_id) {
      where.push('n.observation_id = ?');
      params.push(f.observation_id);
    }
    if (f.status) {
      where.push('d.status = ?');
      params.push(f.status);
    }
    res.json({
      data: all(
        `SELECT d.*, n.event, n.title, n.observation_id, u.name AS recipient_name, u.role AS recipient_role,
                o.ref_no AS observation_ref
           FROM notification_deliveries d
           JOIN notifications n ON n.id = d.notification_id
           JOIN users u ON u.id = n.user_id
           LEFT JOIN observations o ON o.id = n.observation_id
          WHERE ${where.join(' AND ')}
          ORDER BY d.id DESC LIMIT ?`,
        [...params, f.limit]
      ),
    });
  }
);

export default router;
