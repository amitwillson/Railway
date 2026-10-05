import { all, get, insert, nowIso, run, tx, update } from '../db/index.js';
import { unitsFor } from './units.js';
import { badRequest, notFound } from './errors.js';

/**
 * The inspection sheet.
 *
 * One commercial inspector attends to many areas - often every area - of a
 * station in a single visit. The inspection is therefore the unit of record and
 * the areas sit inside it, which is what this module maintains.
 *
 * The sheet is the list of areas the inspection covers. Opening it writes one
 * `inspection_areas` row per area of the station, every one starting at
 * `not_inspected`. As the inspector works through them each row becomes
 * `satisfactory`, `deficiencies` (set automatically the moment an observation is
 * raised there), or `not_available`. The result is a record that can tell an
 * area found in order from an area nobody looked at - the difference between an
 * inspection report and a list of complaints.
 *
 * Nothing here deletes or rewords anything the inspector has submitted: an area
 * row can be re-marked while the inspection is open, and once the report is
 * issued the sheet is frozen along with it.
 */

const AREA_RESULTS = ['satisfactory', 'deficiencies', 'not_inspected', 'not_available'];
const ITEM_RESULTS = ['ok', 'deficient', 'not_applicable'];
const COVERED = ['satisfactory', 'deficiencies'];

export { AREA_RESULTS, ITEM_RESULTS };

/* -------------------------------------------------------------------------- */
/* Areas available to an inspection                                           */
/* -------------------------------------------------------------------------- */

/** The scope of an inspection: what kind of place it covers. */
export function scopeOf(inspection) {
  if (inspection.scope) return inspection.scope;
  if (inspection.train_id) return 'train';
  if (inspection.station_id) return 'station';
  return 'section';
}

/** Every area this inspection could cover, in inspection order. */
export function availableAreas(inspection) {
  const scope = scopeOf(inspection);
  return unitsFor({
    stationId: scope === 'station' ? inspection.station_id : null,
    appliesTo: scope === 'train' ? 'train' : 'station',
  });
}

/* -------------------------------------------------------------------------- */
/* Opening and maintaining the sheet                                          */
/* -------------------------------------------------------------------------- */

/**
 * Puts areas on the sheet. With no `unitIds` it opens the full sheet - every
 * area of the station - which is the normal case for an inspector who attends to
 * all of them. Areas already on the sheet are left exactly as they are, so this
 * is safe to call again when a station gains an area mid-inspection.
 */
export function openSheet(inspectionId, { unitIds = null, coach = null } = {}) {
  const inspection = get('SELECT * FROM inspections WHERE id = ?', [inspectionId]);
  if (!inspection) throw notFound('Inspection');

  const areas = availableAreas(inspection);
  // "Other" is the catch-all for recording something in a place the master list
  // does not name. It is not an area of the station, so it stays off the sheet
  // unless it is asked for by name - otherwise every report would carry a line
  // saying an area called Other was not inspected.
  const wanted = unitIds
    ? areas.filter((u) => unitIds.includes(u.id))
    : areas.filter((u) => (u.kind ?? '').toLowerCase() !== 'other');
  if (unitIds && wanted.length !== unitIds.length) {
    throw badRequest('One or more of those areas do not belong to this location');
  }
  const existing = new Set(
    all('SELECT unit_id, coach FROM inspection_areas WHERE inspection_id = ?', [inspectionId]).map(
      (r) => `${r.unit_id}|${r.coach ?? ''}`
    )
  );
  let added = 0;
  tx(() => {
    for (const unit of wanted) {
      if (existing.has(`${unit.id}|${coach ?? ''}`)) continue;
      insert('inspection_areas', {
        inspection_id: inspectionId,
        unit_id: unit.id,
        unit_name: unit.name,
        unit_kind: unit.kind ?? null,
        coach: coach ?? null,
        result: 'not_inspected',
        sort_order: unit.sort_order ?? 100,
      });
      added += 1;
    }
  });
  return { added, total: existing.size + added };
}

/** Records the inspector's finding for one area. */
export function setAreaResult(areaId, { result, remarks }, userId = null) {
  const area = get('SELECT * FROM inspection_areas WHERE id = ?', [areaId]);
  if (!area) throw notFound('Inspection area');
  if (result && !AREA_RESULTS.includes(result)) throw badRequest('Unknown area result');

  // An area with an observation against it is deficient as a matter of fact, not
  // of opinion: the observation is the evidence and it cannot be marked away.
  const observations = get(
    'SELECT COUNT(*) AS n FROM observations WHERE inspection_area_id = ? AND status <> ?',
    [areaId, 'cancelled']
  ).n;
  if (observations > 0 && result && result !== 'deficiencies') {
    throw badRequest(
      `${area.unit_name} carries ${observations} observation(s); cancel them before marking it ${result.replace('_', ' ')}`
    );
  }

  const changes = {
    remarks: remarks === undefined ? area.remarks : remarks,
    updated_at: nowIso(),
  };
  if (result) {
    changes.result = result;
    changes.inspected_at = COVERED.includes(result) ? area.inspected_at ?? nowIso() : null;
  }
  update('inspection_areas', areaId, changes);
  touchInspection(area.inspection_id, userId);
  return get('SELECT * FROM inspection_areas WHERE id = ?', [areaId]);
}

/**
 * Marks the area an observation was raised in. Called by the observation
 * service, so recording a deficiency updates the sheet without the inspector
 * having to say twice that the area has a problem.
 */
export function markAreaDeficient(observation) {
  if (!observation?.inspection_id) return null;
  let areaId = observation.inspection_area_id;
  if (!areaId && observation.unit_id) {
    const area = get(
      `SELECT * FROM inspection_areas
        WHERE inspection_id = ? AND unit_id = ?
          AND (coach IS ? OR coach = ?)`,
      [observation.inspection_id, observation.unit_id, observation.coach ?? null, observation.coach ?? '']
    );
    // An observation may be the first thing recorded in an area, in which case
    // the area joins the sheet now rather than being lost.
    if (area) {
      areaId = area.id;
    } else {
      const unit = get('SELECT * FROM units WHERE id = ?', [observation.unit_id]);
      areaId = insert('inspection_areas', {
        inspection_id: observation.inspection_id,
        unit_id: observation.unit_id,
        unit_name: observation.unit_name ?? unit?.name ?? 'Area',
        unit_kind: unit?.kind ?? null,
        coach: observation.coach ?? null,
        result: 'not_inspected',
        sort_order: unit?.sort_order ?? 100,
      });
    }
    run('UPDATE observations SET inspection_area_id = ? WHERE id = ?', [areaId, observation.id]);
  }
  if (!areaId) return null;
  update('inspection_areas', areaId, {
    result: 'deficiencies',
    inspected_at: get('SELECT inspected_at FROM inspection_areas WHERE id = ?', [areaId])?.inspected_at ?? nowIso(),
    updated_at: nowIso(),
  });
  return areaId;
}

/**
 * Re-reads an area's result after an observation there was cancelled. An area
 * whose last live observation is gone falls back to satisfactory if anything was
 * checked in it, and to not_inspected if nothing was. It is never silently left
 * reading "deficiencies" for a deficiency that no longer stands.
 */
export function refreshAreaResult(areaId) {
  const area = get('SELECT * FROM inspection_areas WHERE id = ?', [areaId]);
  if (!area) return null;

  // An item marked deficient by an observation that has since been cancelled was
  // never a deficiency, so its row goes with it. Leaving it would make Part II say
  // the area was found in order while the item record still read "deficient", and
  // point at an observation that no longer stands.
  run(
    `DELETE FROM inspection_item_results
      WHERE inspection_area_id = ?
        AND observation_id IN (SELECT id FROM observations WHERE status = 'cancelled')`,
    [areaId]
  );

  const live = get(
    "SELECT COUNT(*) AS n FROM observations WHERE inspection_area_id = ? AND status <> 'cancelled'",
    [areaId]
  ).n;
  if (live > 0) {
    if (area.result !== 'deficiencies') {
      update('inspection_areas', areaId, { result: 'deficiencies', updated_at: nowIso() });
    }
    return 'deficiencies';
  }
  if (area.result !== 'deficiencies') return area.result;
  const checked = get(
    'SELECT COUNT(*) AS n FROM inspection_item_results WHERE inspection_area_id = ?',
    [areaId]
  ).n;
  const result = checked > 0 ? 'satisfactory' : 'not_inspected';
  update('inspection_areas', areaId, {
    result,
    inspected_at: result === 'satisfactory' ? area.inspected_at ?? nowIso() : null,
    updated_at: nowIso(),
  });
  return result;
}

/**
 * Records item-level results inside an area: what was checked and found in
 * order, what was not applicable, and which deficiency an observation came from.
 * Re-recording an item replaces that item's own row and nothing else.
 */
export function recordItemResults(inspectionId, areaId, entries, userId = null) {
  const area = get('SELECT * FROM inspection_areas WHERE id = ? AND inspection_id = ?', [areaId, inspectionId]);
  if (!area) throw notFound('Inspection area');
  const saved = [];
  tx(() => {
    for (const entry of entries) {
      if (entry.result && !ITEM_RESULTS.includes(entry.result)) throw badRequest('Unknown item result');
      const item = entry.item_id
        ? get(
            `SELECT i.*, g.name AS group_name FROM inspection_items i
               JOIN item_groups g ON g.id = i.group_id
              WHERE i.id = ?`,
            [entry.item_id]
          )
        : null;
      if (entry.item_id && !item) throw badRequest('Unknown inspection item');
      const existing = get(
        'SELECT id FROM inspection_item_results WHERE inspection_id = ? AND inspection_area_id = ? AND item_id IS ?',
        [inspectionId, areaId, entry.item_id ?? null]
      );
      const row = {
        inspection_id: inspectionId,
        inspection_area_id: areaId,
        unit_id: area.unit_id,
        item_id: entry.item_id ?? null,
        item_name: item?.name ?? entry.item_name ?? 'Item',
        group_name: item?.group_name ?? null,
        result: entry.result ?? 'ok',
        parameters: entry.parameters ? JSON.stringify(entry.parameters) : null,
        remarks: entry.remarks ?? null,
        observation_id: entry.observation_id ?? null,
        recorded_at: nowIso(),
      };
      if (existing) {
        update('inspection_item_results', existing.id, row);
        saved.push(existing.id);
      } else {
        saved.push(insert('inspection_item_results', row));
      }
    }
    // An area where something was checked has been attended to. It only moves to
    // satisfactory on its own if nothing was found wrong there.
    if (area.result === 'not_inspected') {
      const deficient = entries.some((e) => e.result === 'deficient');
      update('inspection_areas', areaId, {
        result: deficient ? 'deficiencies' : 'satisfactory',
        inspected_at: nowIso(),
        updated_at: nowIso(),
      });
    }
  });
  touchInspection(inspectionId, userId);
  return all(
    `SELECT * FROM inspection_item_results WHERE id IN (${saved.map(() => '?').join(',') || 'NULL'})`,
    saved
  );
}

function touchInspection(inspectionId, userId) {
  const changes = { updated_at: nowIso() };
  const inspection = get('SELECT status FROM inspections WHERE id = ?', [inspectionId]);
  if (inspection?.status === 'planned') changes.status = 'in_progress';
  update('inspections', inspectionId, changes);
  return userId;
}

/* -------------------------------------------------------------------------- */
/* Reading the sheet                                                          */
/* -------------------------------------------------------------------------- */

/** The item catalogue offered inside one area, grouped as the catalogue is. */
export function itemsForArea(inspection, area) {
  const scope = scopeOf(inspection);
  const kind = (area?.unit_kind ?? '').toLowerCase();
  const groups = all(
    `SELECT g.* FROM item_groups g
      WHERE g.active = 1 AND g.module_id = ?
      ORDER BY g.sort_order, g.name`,
    [inspection.module_id]
  ).filter((g) => groupCovers(g, kind));
  if (groups.length === 0) return [];
  const ids = groups.map((g) => g.id);
  const items = all(
    `SELECT i.* FROM inspection_items i
      WHERE i.active = 1 AND i.group_id IN (${ids.map(() => '?').join(',')})
        AND (i.applies_to = ? OR i.applies_to = 'both')
      ORDER BY i.sort_order, i.name`,
    [...ids, scope === 'train' ? 'train' : 'station']
  );
  return groups
    .map((g) => ({
      group_id: g.id,
      group_name: g.name,
      items: items.filter((i) => i.group_id === g.id),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Whether an item group belongs in an area. A group with no kinds listed applies
 * everywhere, which keeps the sheet useful before an administrator has scoped
 * anything.
 */
function groupCovers(group, kind) {
  const list = (group.applies_to_kinds ?? '')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  if (!kind) return true;
  return list.includes(kind);
}

/**
 * The whole sheet for one inspection: every area with its result, the items
 * recorded in it, the observations raised in it, and the catalogue still
 * available to tick off.
 */
export function sheetFor(inspectionId, { catalogue = true } = {}) {
  const inspection = get('SELECT * FROM v_inspections i WHERE i.id = ?', [inspectionId]);
  if (!inspection) throw notFound('Inspection');

  const areas = all(
    'SELECT * FROM inspection_areas WHERE inspection_id = ? ORDER BY sort_order, unit_name, id',
    [inspectionId]
  );
  const results = all(
    'SELECT * FROM inspection_item_results WHERE inspection_id = ? ORDER BY id',
    [inspectionId]
  );
  const observations = all(
    `SELECT o.id, o.ref_no, o.inspection_area_id, o.unit_id, o.unit_name, o.item_id, o.item_name,
            o.observation, o.status, o.tdc, o.severity_name, o.severity_rank, o.department_name,
            o.supervisor_name, o.is_overdue, o.repeat_count
       FROM v_observations o WHERE o.inspection_id = ? ORDER BY o.id`,
    [inspectionId]
  );

  const onSheet = new Set(areas.map((a) => a.unit_id));
  return {
    inspection,
    areas: areas.map((area) => ({
      ...area,
      item_results: results.filter((r) => r.inspection_area_id === area.id).map(parseParameters),
      observations: observations.filter(
        (o) => o.inspection_area_id === area.id || (o.inspection_area_id == null && o.unit_id === area.unit_id)
      ),
      catalogue: catalogue ? itemsForArea(inspection, area) : undefined,
    })),
    // Observations whose area was never put on the sheet (an older record, or one
    // synced from offline) are still part of the inspection and must be visible.
    unplaced_observations: observations.filter(
      (o) => !areas.some((a) => a.id === o.inspection_area_id || a.unit_id === o.unit_id)
    ),
    available_areas: availableAreas(inspection)
      .filter((u) => !onSheet.has(u.id))
      .map((u) => ({ id: u.id, name: u.name, kind: u.kind, sort_order: u.sort_order })),
    coverage: coverageOf(inspection),
  };
}

function parseParameters(row) {
  if (!row.parameters) return { ...row, parameters: [] };
  try {
    return { ...row, parameters: JSON.parse(row.parameters) };
  } catch {
    return { ...row, parameters: [] };
  }
}

/** Coverage counters, read from the view so every report agrees on them. */
export function coverageOf(inspection) {
  return {
    areas_on_sheet: inspection.areas_on_sheet ?? 0,
    areas_covered: inspection.areas_covered ?? 0,
    areas_satisfactory: inspection.areas_satisfactory ?? 0,
    areas_with_deficiencies: inspection.areas_with_deficiencies ?? 0,
    areas_not_inspected: inspection.areas_not_inspected ?? 0,
    areas_not_available: inspection.areas_not_available ?? 0,
    coverage_pct: inspection.coverage_pct ?? null,
    items_checked: inspection.items_checked ?? 0,
    items_ok: inspection.items_ok ?? 0,
    items_deficient: inspection.items_deficient ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Continuity with the previous inspection                                    */
/* -------------------------------------------------------------------------- */

/**
 * The inspection that last covered this place, which is the one whose
 * outstanding items this inspection has to review. Found by location rather than
 * by inspector, because the position at the station is what carries forward.
 */
export function findPreviousInspection(inspection) {
  const where = ['i.id <> ?', "i.status <> 'cancelled'"];
  const params = [inspection.id];
  if (inspection.station_id) {
    where.push('i.station_id = ?');
    params.push(inspection.station_id);
  } else if (inspection.train_id) {
    where.push('i.train_id = ?');
    params.push(inspection.train_id);
  } else if (inspection.section) {
    where.push('i.section = ?');
    params.push(inspection.section);
  } else {
    return null;
  }
  where.push("COALESCE(i.started_at, i.created_at) < ?");
  params.push(inspection.started_at ?? inspection.created_at ?? nowIso());
  return (
    get(
      `SELECT * FROM v_inspections i WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(i.started_at, i.created_at) DESC, i.id DESC LIMIT 1`,
      params
    ) ?? null
  );
}

/** Links an inspection to its predecessor, if it does not already have one. */
export function linkPreviousInspection(inspectionId) {
  const inspection = get('SELECT * FROM inspections WHERE id = ?', [inspectionId]);
  if (!inspection) throw notFound('Inspection');
  if (inspection.previous_inspection_id) return inspection.previous_inspection_id;
  const previous = findPreviousInspection(inspection);
  if (!previous) return null;
  update('inspections', inspectionId, { previous_inspection_id: previous.id, updated_at: nowIso() });
  return previous.id;
}

/**
 * The outstanding observations the previous inspection of this place left behind,
 * each with this inspection's review of it if one has been recorded.
 */
export function previousOutstanding(inspectionId) {
  const inspection = get('SELECT * FROM v_inspections i WHERE i.id = ?', [inspectionId]);
  if (!inspection) throw notFound('Inspection');
  const previousId = inspection.previous_inspection_id ?? findPreviousInspection(inspection)?.id ?? null;
  if (!previousId) return { previous: null, items: [] };
  const previous = get('SELECT * FROM v_inspections i WHERE i.id = ?', [previousId]);
  const reviews = all('SELECT * FROM inspection_previous_reviews WHERE inspection_id = ?', [inspectionId]);
  const items = all(
    `SELECT o.id, o.ref_no, o.unit_name, o.item_name, o.observation, o.status, o.tdc,
            o.severity_name, o.severity_rank, o.department_name, o.supervisor_name,
            o.is_overdue, o.days_to_tdc, o.observed_at
       FROM v_observations o
      WHERE o.inspection_id = ? AND o.status NOT IN ('closed','cancelled')
      ORDER BY o.severity_rank, o.id`,
    [previousId]
  ).map((o) => ({ ...o, review: reviews.find((r) => r.observation_id === o.id) ?? null }));
  return { previous, items };
}

export default {
  AREA_RESULTS,
  ITEM_RESULTS,
  scopeOf,
  availableAreas,
  openSheet,
  setAreaResult,
  markAreaDeficient,
  refreshAreaResult,
  recordItemResults,
  itemsForArea,
  sheetFor,
  coverageOf,
  findPreviousInspection,
  linkPreviousInspection,
  previousOutstanding,
};
