import { all, get, insert, nowIso, today, tx, update } from '../db/index.js';
import { randomToken } from './ids.js';
import { badRequest, notFound } from './errors.js';

/**
 * Inspection Notes - several observations compiled into one numbered letter in
 * the office format.
 *
 * An inspection produces a list of observations, each already assigned to a
 * department with its own target date. What goes out of the office, though, is a
 * letter: one number, one subject, one signature, the observations tabulated
 * under it. This module builds that letter.
 *
 * The note is stored rather than rendered on demand, because it is a record: its
 * number and its wording must not change when the observations it cites move
 * through the workflow. The status of each observation is read live, so reopening
 * a note shows where its items now stand, against the text as it was issued.
 */

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

const setting = (key, fallback = null) => get('SELECT value FROM settings WHERE key = ?', [key])?.value ?? fallback;

/** The office block, signature and standing wording, all editable in Admin. */
export function letterDefaults() {
  return {
    letterhead: setting('note.letterhead', 'WEST CENTRAL RAILWAY\nOffice of the Divisional Railway Manager (Commercial)\nJabalpur Division'),
    office: setting('note.office', 'Sr. Divisional Commercial Manager, Jabalpur'),
    number_prefix: setting('note.number_prefix', 'JBP/COM/INSP'),
    addressee: setting('note.addressee', 'The Concerned Supervisors / Departmental Officers'),
    salutation: setting('note.salutation', 'Sir / Madam,'),
    preamble: setting(
      'note.preamble',
      'The following deficiencies were noticed during the inspection referred to above. '
        + 'The concerned officials are requested to take necessary action and advise compliance '
        + 'to this office within the target date indicated against each item.'
    ),
    closing: setting(
      'note.closing',
      'Compliance may please be advised through the inspection management system, '
        + 'with photographic evidence where applicable.'
    ),
    copy_to: setting('note.copy_to', 'Sr. DCM / DCM / concerned Branch Officers - for information and necessary action.'),
  };
}

/**
 * Financial-year serial: JBP/COM/INSP/2026-27/014. Counted per prefix and year so
 * the series restarts each April, the way the office series does.
 */
export function nextNoteNo(prefix = letterDefaults().number_prefix, date = today()) {
  const [y, m] = date.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  const like = `${prefix}/${fy}/%`;
  const row = get(
    `SELECT note_no FROM inspection_notes WHERE note_no LIKE ?
      ORDER BY length(note_no) DESC, note_no DESC LIMIT 1`,
    [like]
  );
  const last = row ? Number.parseInt(String(row.note_no).split('/').pop(), 10) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}/${fy}/${String(next).padStart(3, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Compiling                                                                  */
/* -------------------------------------------------------------------------- */

const NOTE_OBSERVATION_COLUMNS = `
  o.id, o.ref_no, o.station_id, o.train_id, o.module_id,
  o.unit_name, o.coach, o.item_name, o.observation, o.tdc, o.status,
  o.severity_name, o.department_name, o.department_code, o.supervisor_name,
  o.supervisor_designation, o.supervisor_mobile, o.station_name, o.station_code,
  o.train_number, o.train_name, o.module_code, o.module_name, o.observed_at,
  o.is_overdue, o.days_to_tdc, o.repeat_count, o.attachment_count, o.inspection_id`;

/** The observations of one inspection, in the order they were recorded. */
export function observationsForInspection(inspectionId) {
  return all(
    `SELECT ${NOTE_OBSERVATION_COLUMNS} FROM v_observations o
      WHERE o.inspection_id = ? AND o.status != 'cancelled'
      ORDER BY o.id`,
    [inspectionId]
  );
}

/** Named observations, in the order the caller asked for them. */
export function observationsByIds(ids) {
  if (!ids?.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = all(
    `SELECT ${NOTE_OBSERVATION_COLUMNS} FROM v_observations o WHERE o.id IN (${placeholders})`,
    ids
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(Number(id))).filter(Boolean);
}

/**
 * Everything the compose screen needs before a note exists: the observations that
 * would go into it, a suggested subject, and the standing wording.
 */
export function draftFor({ inspectionId = null, observationIds = null } = {}) {
  const inspection = inspectionId
    ? get('SELECT * FROM v_inspections WHERE id = ?', [inspectionId])
    : null;
  if (inspectionId && !inspection) throw notFound('Inspection');

  const observations = inspectionId
    ? observationsForInspection(inspectionId)
    : observationsByIds(observationIds ?? []);

  const where = placeOf(inspection, observations);

  const defaults = letterDefaults();
  return {
    inspection: inspection ?? null,
    observations,
    note_no: nextNoteNo(defaults.number_prefix),
    letter_date: today(),
    subject: suggestSubject({ inspection, observations, where }),
    ...defaults,
  };
}

/** "at Jabalpur" for a station, "on Train 12189" for a train. */
function placeOf(inspection, observations = []) {
  if (inspection?.station_name) return { preposition: 'at', name: inspection.station_name };
  if (inspection?.train_number) return { preposition: 'on', name: `Train ${inspection.train_number}` };
  const stations = [...new Set(observations.map((o) => o.station_name).filter(Boolean))];
  if (stations.length) return { preposition: 'at', name: stations.join(', ') };
  const trains = [...new Set(observations.map((o) => o.train_number).filter(Boolean))];
  if (trains.length) return { preposition: 'on', name: `Train ${trains.join(', ')}` };
  return null;
}

function suggestSubject({ inspection, observations, where }) {
  const module = inspection?.module_name ?? observations[0]?.module_name ?? 'Commercial';
  const type = inspection?.inspection_type_name;
  const parts = [`Deficiencies noticed during ${module.toLowerCase()} inspection`];
  if (where) parts.push(`${where.preposition} ${where.name}`);
  if (inspection?.completed_at || inspection?.started_at || inspection?.created_at) {
    parts.push(`on ${String(inspection.completed_at ?? inspection.started_at ?? inspection.created_at).slice(0, 10)}`);
  }
  return `${parts.join(' ')}${type ? ` (${type})` : ''}`;
}

/* -------------------------------------------------------------------------- */
/* Create / read                                                              */
/* -------------------------------------------------------------------------- */

export function createNote({ payload, user }) {
  const inspection = payload.inspection_id
    ? get('SELECT * FROM v_inspections WHERE id = ?', [payload.inspection_id])
    : null;
  if (payload.inspection_id && !inspection) throw notFound('Inspection');

  const observations = payload.observation_ids?.length
    ? observationsByIds(payload.observation_ids)
    : observationsForInspection(payload.inspection_id);
  if (observations.length === 0) {
    throw badRequest('A note needs at least one observation. Nothing was found for this selection.');
  }

  const defaults = letterDefaults();
  const noteId = tx(() => {
    const id = insert('inspection_notes', {
      note_no: payload.note_no?.trim() || nextNoteNo(defaults.number_prefix),
      inspection_id: payload.inspection_id ?? null,
      module_id: inspection?.module_id ?? observations[0]?.module_id ?? null,
      station_id: inspection?.station_id ?? observations[0]?.station_id ?? null,
      train_id: inspection?.train_id ?? observations[0]?.train_id ?? null,
      letter_date: payload.letter_date ?? today(),
      subject:
        payload.subject?.trim()
        || suggestSubject({ inspection, observations, where: placeOf(inspection, observations) }),
      addressee: payload.addressee ?? defaults.addressee,
      salutation: payload.salutation ?? defaults.salutation,
      preamble: payload.preamble ?? defaults.preamble,
      closing: payload.closing ?? defaults.closing,
      copy_to: payload.copy_to ?? defaults.copy_to,
      signatory_name: payload.signatory_name ?? user.name,
      signatory_designation: payload.signatory_designation ?? user.designation ?? null,
      office: payload.office ?? defaults.office,
      letterhead: payload.letterhead ?? defaults.letterhead,
      status: payload.status === 'issued' ? 'issued' : 'draft',
      qr_token: randomToken(12),
      created_by: user.id,
      issued_at: payload.status === 'issued' ? nowIso() : null,
    });
    observations.forEach((o, index) => {
      insert('inspection_note_observations', {
        note_id: id,
        observation_id: o.id,
        sl_no: index + 1,
        remarks: payload.remarks?.[String(o.id)] ?? null,
      });
    });
    return id;
  });
  return noteById(noteId);
}

/** A note with its observations read live, so their current status is shown. */
export function noteById(id) {
  const note = get(
    `SELECT n.*, m.code AS module_code, m.name AS module_name,
            s.name AS station_name, s.code AS station_code,
            t.number AS train_number, t.name AS train_name,
            i.ref_no AS inspection_ref, it.name AS inspection_type_name,
            u.name AS created_by_name, u.designation AS created_by_designation
       FROM inspection_notes n
       LEFT JOIN modules m ON m.id = n.module_id
       LEFT JOIN stations s ON s.id = n.station_id
       LEFT JOIN trains t ON t.id = n.train_id
       LEFT JOIN inspections i ON i.id = n.inspection_id
       LEFT JOIN inspection_types it ON it.id = i.inspection_type_id
       JOIN users u ON u.id = n.created_by
      WHERE n.id = ?`,
    [id]
  );
  if (!note) return null;
  return { ...note, observations: noteObservations(id) };
}

export const noteByToken = (token) => {
  const row = get('SELECT id FROM inspection_notes WHERE qr_token = ?', [token]);
  return row ? noteById(row.id) : null;
};

function noteObservations(noteId) {
  return all(
    `SELECT no.sl_no, no.remarks, ${NOTE_OBSERVATION_COLUMNS}
       FROM inspection_note_observations no
       JOIN v_observations o ON o.id = no.observation_id
      WHERE no.note_id = ?
      ORDER BY no.sl_no`,
    [noteId]
  );
}

export function listNotes({ inspectionId = null, stationId = null, createdBy = null, status = null, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (inspectionId) {
    where.push('n.inspection_id = ?');
    params.push(inspectionId);
  }
  if (stationId) {
    where.push('n.station_id = ?');
    params.push(stationId);
  }
  if (createdBy) {
    where.push('n.created_by = ?');
    params.push(createdBy);
  }
  if (status) {
    where.push('n.status = ?');
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    data: all(
      `SELECT n.*, m.code AS module_code, s.name AS station_name, s.code AS station_code,
              t.number AS train_number, i.ref_no AS inspection_ref,
              u.name AS created_by_name,
              (SELECT COUNT(*) FROM inspection_note_observations x WHERE x.note_id = n.id) AS observation_count,
              (SELECT COUNT(*) FROM inspection_note_observations x
                 JOIN observations o ON o.id = x.observation_id
                WHERE x.note_id = n.id AND o.status = 'closed') AS closed_count
         FROM inspection_notes n
         LEFT JOIN modules m ON m.id = n.module_id
         LEFT JOIN stations s ON s.id = n.station_id
         LEFT JOIN trains t ON t.id = n.train_id
         LEFT JOIN inspections i ON i.id = n.inspection_id
         JOIN users u ON u.id = n.created_by
         ${clause}
        ORDER BY n.letter_date DESC, n.id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    total: get(`SELECT COUNT(*) AS n FROM inspection_notes n ${clause}`, params).n,
  };
}

/** Wording and status only; the number, the observations and the date are fixed. */
export function updateNote(id, payload, user) {
  const note = get('SELECT * FROM inspection_notes WHERE id = ?', [id]);
  if (!note) throw notFound('Inspection note');
  if (note.status === 'issued' && payload.status !== 'cancelled') {
    throw badRequest('This note has been issued. Cancel it and raise a fresh note instead of rewording it.');
  }
  const fields = {
    subject: payload.subject,
    addressee: payload.addressee,
    salutation: payload.salutation,
    preamble: payload.preamble,
    closing: payload.closing,
    copy_to: payload.copy_to,
    signatory_name: payload.signatory_name,
    signatory_designation: payload.signatory_designation,
    office: payload.office,
    letterhead: payload.letterhead,
    status: payload.status,
    updated_at: nowIso(),
  };
  if (payload.status === 'issued' && note.status !== 'issued') fields.issued_at = nowIso();
  update('inspection_notes', id, fields);
  return noteById(id);
}

/**
 * Groups the note's observations by the department that has to act, which is how
 * the letter is read: each department looks for its own block.
 */
export function byDepartment(observations) {
  const groups = new Map();
  for (const o of observations) {
    const key = o.department_name ?? 'Not assigned';
    if (!groups.has(key)) groups.set(key, { department: key, code: o.department_code ?? null, observations: [] });
    groups.get(key).observations.push(o);
  }
  return [...groups.values()].sort((a, b) => a.department.localeCompare(b.department));
}
