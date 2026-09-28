import express from 'express';
import config from '../config.js';
import { get, insert } from '../db/index.js';
import { notFound, badRequest } from '../lib/errors.js';
import { randomToken } from '../lib/ids.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { asyncRoute } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { body, query, z, optionalId, optionalText, optionalIsoDate } from '../lib/validate.js';
import {
  byDepartment, createNote, draftFor, letterDefaults, listNotes, noteById, noteByToken, updateNote,
} from '../lib/notes.js';
import { streamNotePdf, formatLetterDate, toCsv } from '../lib/exporters.js';

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Public verification - mounted before the auth guard, like report verify     */
/* -------------------------------------------------------------------------- */

/** Anyone holding the printed note can confirm it came from this system. */
router.get('/verify/:token', (req, res) => {
  const note = noteByToken(req.params.token);
  if (!note) throw notFound('Inspection note');
  res.json({
    verified: true,
    note_no: note.note_no,
    letter_date: note.letter_date,
    subject: note.subject,
    status: note.status,
    issued_at: note.issued_at,
    station: note.station_name,
    train: note.train_number,
    inspection_ref: note.inspection_ref,
    signed_by: { name: note.signatory_name, designation: note.signatory_designation },
    observations: note.observations.map((o) => ({
      sl_no: o.sl_no,
      ref_no: o.ref_no,
      item: o.item_name,
      unit: o.unit_name,
      action_by: o.department_name,
      tdc: o.tdc,
      status: o.status,
    })),
  });
});

router.use(authenticate);

/* -------------------------------------------------------------------------- */
/* Compose                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What would go into a note, before one exists: the observations, a suggested
 * number and subject, and the standing wording. Either an inspection or an
 * explicit list of observations - the second is how several inspections are
 * compiled into one letter.
 */
router.get(
  '/draft',
  requireCapability('report:read'),
  query(
    z.object({
      inspection_id: optionalId,
      observation_ids: optionalText,
    })
  ),
  (req, res) => {
    const { inspection_id: inspectionId, observation_ids: ids } = req.validQuery;
    const observationIds = ids
      ? ids.split(',').map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v > 0)
      : null;
    if (!inspectionId && !observationIds?.length) {
      throw badRequest('Give an inspection_id, or observation_ids to compile');
    }
    res.json(draftFor({ inspectionId, observationIds }));
  }
);

/** The standing letter wording on its own, for the settings screen. */
router.get('/defaults', requireCapability('report:read'), (_req, res) => res.json(letterDefaults()));

/* -------------------------------------------------------------------------- */
/* List / read                                                                */
/* -------------------------------------------------------------------------- */

router.get(
  '/',
  requireCapability('report:read'),
  query(
    z.object({
      inspection_id: optionalId,
      station_id: optionalId,
      mine: z.enum(['0', '1', 'true', 'false']).optional(),
      status: z.enum(['draft', 'issued', 'cancelled']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    const mine = f.mine === '1' || f.mine === 'true';
    res.json(
      listNotes({
        inspectionId: f.inspection_id,
        stationId: f.station_id,
        createdBy: mine ? req.user.id : null,
        status: f.status,
        limit: f.limit,
        offset: f.offset,
      })
    );
  }
);

router.get('/:id', requireCapability('report:read'), (req, res) => {
  const note = noteById(req.params.id);
  if (!note) throw notFound('Inspection note');
  res.json({ ...note, by_department: byDepartment(note.observations) });
});

/* -------------------------------------------------------------------------- */
/* Create / update                                                            */
/* -------------------------------------------------------------------------- */

const createSchema = z
  .object({
    inspection_id: optionalId,
    observation_ids: z.array(z.coerce.number().int().positive()).optional(),
    note_no: optionalText,
    letter_date: optionalIsoDate,
    subject: optionalText,
    addressee: optionalText,
    salutation: optionalText,
    preamble: optionalText,
    closing: optionalText,
    copy_to: optionalText,
    signatory_name: optionalText,
    signatory_designation: optionalText,
    office: optionalText,
    letterhead: optionalText,
    status: z.enum(['draft', 'issued']).default('draft'),
    remarks: z.record(z.string(), z.string()).optional(),
  })
  .refine((v) => v.inspection_id || v.observation_ids?.length, {
    message: 'Give an inspection to compile, or the observations to compile',
  });

router.post('/', requireCapability('note:create'), body(createSchema), (req, res) => {
  const note = createNote({ payload: req.body, user: req.user });
  audit(req, {
    action: note.status === 'issued' ? 'NOTE_ISSUED' : 'NOTE_CREATED',
    entityType: 'inspection_note',
    entityId: note.id,
    next: note,
    remarks: `${note.note_no} - ${note.observations.length} observation(s)`,
  });
  res.status(201).json({ ...note, by_department: byDepartment(note.observations) });
});

const updateSchema = z.object({
  subject: optionalText,
  addressee: optionalText,
  salutation: optionalText,
  preamble: optionalText,
  closing: optionalText,
  copy_to: optionalText,
  signatory_name: optionalText,
  signatory_designation: optionalText,
  office: optionalText,
  letterhead: optionalText,
  status: z.enum(['draft', 'issued', 'cancelled']).optional(),
});

router.patch('/:id', requireCapability('note:create'), body(updateSchema), (req, res) => {
  const before = noteById(req.params.id);
  if (!before) throw notFound('Inspection note');
  const note = updateNote(Number(req.params.id), req.body, req.user);
  audit(req, {
    action: req.body.status === 'issued' ? 'NOTE_ISSUED' : 'NOTE_UPDATED',
    entityType: 'inspection_note',
    entityId: note.id,
    previous: before,
    next: note,
  });
  res.json({ ...note, by_department: byDepartment(note.observations) });
});

/* -------------------------------------------------------------------------- */
/* Print                                                                      */
/* -------------------------------------------------------------------------- */

const printSchema = z.object({
  format: z.enum(['pdf', 'csv', 'json']).default('pdf'),
  /** Group the table by the department that has to act. */
  group_by_department: z.enum(['0', '1', 'true', 'false']).optional(),
});

router.get(
  '/:id/print',
  requireCapability('report:read'),
  query(printSchema),
  asyncRoute(async (req, res) => {
    const note = noteById(req.params.id);
    if (!note) throw notFound('Inspection note');
    const f = req.validQuery;
    const grouped = f.group_by_department === '1' || f.group_by_department === 'true';

    if (f.format === 'json') {
      res.json({ ...note, by_department: byDepartment(note.observations) });
      return;
    }
    if (f.format === 'csv') {
      res.type('text/csv').send(
        toCsv(note.observations, [
          { key: 'sl_no', label: 'Sl. No.' },
          { key: 'ref_no', label: 'Observation' },
          { key: 'unit_name', label: 'Location / Unit' },
          { key: 'item_name', label: 'Item' },
          { key: 'observation', label: 'Deficiency noticed' },
          { key: 'department_name', label: 'Action by' },
          { key: 'supervisor_name', label: 'Concerned supervisor' },
          { label: 'TDC', value: (r) => (r.tdc ? formatLetterDate(r.tdc) : 'Not fixed') },
          { key: 'status', label: 'Present status' },
        ])
      );
      return;
    }

    // The note carries its own verification token; a fresh report token is
    // recorded as well so that printing is visible in the report register.
    insert('report_tokens', {
      token: randomToken(10),
      report_type: 'inspection_note',
      entity_type: 'inspection_note',
      entity_id: note.id,
      params: JSON.stringify({ grouped }),
      generated_by: req.user.id,
    });
    await streamNotePdf(res, note, {
      fileName: `${note.note_no.replace(/[^\w.-]+/g, '-')}.pdf`,
      verifyUrl: `${config.publicUrl}/api/notes/verify/${note.qr_token}`,
      groups: grouped ? byDepartment(note.observations) : null,
    });
  })
);

export default router;
