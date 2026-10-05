import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import config from '../config.js';
import { get } from '../db/index.js';
import { notFound, forbidden } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * Serves inspection evidence. Files are never exposed by a guessable public
 * path: the request must carry a valid session and the attachment row must
 * exist. Supervisors, inspectors and officers can read the evidence of any
 * observation they are allowed to see; the scope check reuses the observation
 * row so no separate rule set can drift.
 */
router.get('/:storedName', authenticate, (req, res) => {
  const storedName = path.basename(req.params.storedName);
  const attachment = get('SELECT * FROM attachments WHERE stored_name = ?', [storedName]);
  if (!attachment) throw notFound('Attachment');

  if (req.user.role === 'supervisor' && attachment.observation_id) {
    const visible = get(
      `SELECT 1 FROM observations o
         LEFT JOIN supervisors s ON s.id = o.supervisor_id
        WHERE o.id = ? AND (s.user_id = ? OR o.created_by = ? OR o.action_by_department_id = ?)`,
      [attachment.observation_id, req.user.id, req.user.id, req.user.department_id ?? -1]
    );
    if (!visible) throw forbidden('This evidence belongs to another department');
  }

  const abs = path.join(config.uploadDir, storedName);
  if (!fs.existsSync(abs)) throw notFound('File');
  res.setHeader('content-type', attachment.mime_type || 'application/octet-stream');
  res.setHeader('cache-control', 'private, max-age=86400');
  if (req.query.download) {
    res.setHeader('content-disposition', `attachment; filename="${attachment.file_name}"`);
  }
  fs.createReadStream(abs).pipe(res);
});

export default router;
