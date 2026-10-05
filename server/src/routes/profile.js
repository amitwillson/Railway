import express from 'express';
import { get } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { forbidden, notFound } from '../lib/errors.js';
import { authenticate, isAdmin, isOfficer } from '../middleware/auth.js';
import { body, query, z, optionalId, optionalText } from '../lib/validate.js';
import { choicesFor, jurisdictionOf, setJurisdiction, stationsCovered } from '../lib/jurisdiction.js';
import {
  KINDS, STATUSES, addFeedback, feedbackSummary, listFeedback, respondToFeedback, withdrawFeedback,
} from '../lib/feedback.js';

/**
 * What an officer says about themselves: the sections and stations they cover,
 * and what they think of this application.
 *
 * Both are the officer's own: they do not need an administrator to set their
 * jurisdiction, and nobody rewrites what they said about the app. An
 * administrator can set another officer's jurisdiction, and answer feedback, and
 * both of those are recorded as such.
 */
const router = express.Router();
router.use(authenticate);

/* -------------------------------------------------------------------------- */
/* Jurisdiction                                                               */
/* -------------------------------------------------------------------------- */

const jurisdictionSchema = z.object({
  sections: z.array(z.string().trim().min(1)).max(100).optional(),
  stations: z.array(z.coerce.number().int().positive()).max(500).optional(),
  divisions: z.array(z.coerce.number().int().positive()).max(20).optional(),
  primary: z
    .object({
      kind: z.enum(['division', 'section', 'station']),
      value: z.union([z.string(), z.coerce.number()]),
    })
    .nullable()
    .optional(),
});

/** What I cover now, and everything I could choose from. */
router.get('/jurisdiction', (req, res) => {
  res.json({
    user: { id: req.user.id, name: req.user.name, role: req.user.role, designation: req.user.designation },
    data: jurisdictionOf(req.user.id),
    stations_covered: stationsCovered(req.user.id).length,
    choices: choicesFor(req.user),
  });
});

/** Replaces my jurisdiction with what I have just chosen. */
router.put('/jurisdiction', body(jurisdictionSchema), (req, res) => {
  const previous = jurisdictionOf(req.user.id);
  const next = setJurisdiction(req.user.id, req.body, req.user);
  audit(req, {
    action: 'JURISDICTION_SET',
    entityType: 'user',
    entityId: req.user.id,
    previous: { covers: previous.map(label) },
    next: { covers: next.map(label) },
  });
  res.json({ data: next, stations_covered: stationsCovered(req.user.id).length });
});

/** A short label for the audit trail, so a change reads without a join. */
const label = (row) =>
  row.kind === 'station'
    ? `${row.station_name} (${row.station_code})`
    : row.kind === 'section'
      ? `${row.section} section`
      : `${row.division_name ?? row.division_id} division`;

/**
 * Another officer's jurisdiction. Reading it is open to any officer, because the
 * division needs to see who covers what; setting it is an administrator's, and is
 * recorded as administrator-set rather than self-declared.
 */
router.get('/jurisdiction/:userId', (req, res) => {
  const user = get('SELECT id, name, role, designation, division_id FROM users WHERE id = ?', [
    req.params.userId,
  ]);
  if (!user) throw notFound('User');
  if (user.id !== req.user.id && !isOfficer(req.user)) {
    throw forbidden('Only a divisional officer or an administrator can see another officer\'s jurisdiction');
  }
  res.json({
    user,
    data: jurisdictionOf(user.id),
    stations_covered: stationsCovered(user.id).length,
    choices: user.id === req.user.id ? choicesFor(req.user) : undefined,
  });
});

router.put('/jurisdiction/:userId', body(jurisdictionSchema), (req, res) => {
  const userId = Number(req.params.userId);
  if (userId !== req.user.id && !isAdmin(req.user)) {
    throw forbidden('Only an administrator can set another officer\'s jurisdiction');
  }
  const previous = jurisdictionOf(userId);
  const next = setJurisdiction(userId, req.body, req.user);
  audit(req, {
    action: 'JURISDICTION_SET',
    entityType: 'user',
    entityId: userId,
    previous: { covers: previous.map(label) },
    next: { covers: next.map(label) },
    remarks: userId === req.user.id ? undefined : 'Set by an administrator',
  });
  res.json({ data: next, stations_covered: stationsCovered(userId).length });
});

/* -------------------------------------------------------------------------- */
/* What the people using this application think of it                         */
/* -------------------------------------------------------------------------- */

/** My own suggestions, or - for the office - everybody's. */
router.get(
  '/feedback',
  query(
    z.object({
      mine: z.coerce.boolean().optional(),
      status: optionalText,
      kind: z.enum(KINDS).optional(),
      inspection_id: optionalId,
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    // Everyone sees their own; only the office sees everybody's.
    const mine = f.mine === true || !isOfficer(req.user);
    res.json({
      data: listFeedback({ ...f, mine, userId: mine ? req.user.id : undefined }),
      summary: isOfficer(req.user) ? feedbackSummary() : undefined,
      statuses: STATUSES,
      kinds: KINDS,
    });
  }
);

/** Says what would make this application easier to use. */
router.post(
  '/feedback',
  body(
    z.object({
      suggestion: z.string().trim().min(5, 'Say a little more about what would help'),
      kind: z.enum(KINDS).default('suggestion'),
      area: optionalText,
      inspection_id: optionalId,
    })
  ),
  (req, res) => {
    const created = addFeedback({
      userId: req.user.id,
      inspectionId: req.body.inspection_id ?? null,
      kind: req.body.kind,
      area: req.body.area ?? null,
      suggestion: req.body.suggestion,
    });
    audit(req, {
      action: 'FEEDBACK_SUBMIT',
      entityType: 'feedback',
      entityId: created.id,
      next: { kind: created.kind, area: created.area, inspection: created.inspection_ref },
    });
    res.status(201).json(created);
  }
);

/** The office's reply. It never edits what was said. */
router.patch(
  '/feedback/:id',
  body(
    z.object({
      status: z.enum(STATUSES).optional(),
      response: optionalText,
    })
  ),
  (req, res) => {
    if (!isOfficer(req.user)) throw forbidden('Only a divisional officer or an administrator can answer feedback');
    const next = respondToFeedback(Number(req.params.id), req.body, req.user);
    audit(req, {
      action: 'FEEDBACK_RESPOND',
      entityType: 'feedback',
      entityId: next.id,
      next: { status: next.status, responded: Boolean(next.response) },
    });
    res.json(next);
  }
);

/** Withdrawing something you said, while it has not been answered. */
router.delete('/feedback/:id', (req, res) => {
  const next = withdrawFeedback(Number(req.params.id), req.user);
  audit(req, { action: 'FEEDBACK_WITHDRAW', entityType: 'feedback', entityId: next.id });
  res.json(next);
});

export default router;
