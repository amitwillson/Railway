import { all, get, nowIso, today, update } from '../db/index.js';
import { badRequest, notFound } from './errors.js';
import { coverageOf, linkPreviousInspection, previousOutstanding } from './inspectionSheet.js';

/**
 * The inspection report.
 *
 * One inspector, one visit, many areas - so the report is written around the
 * inspection, not around any one area. It has the parts a commercial inspection
 * report has always had:
 *
 *   Part I    review of the previous inspection of this place
 *   Part II   areas covered, with what was found in each
 *   Part III  the deficiencies noticed, tabulated with responsibility and TDC
 *   Part IV   what was checked and found in order
 *   Part V    general remarks
 *
 * Part IV is the part a deficiency list cannot have, and it is the reason the
 * sheet records areas found satisfactory as carefully as it records the ones that
 * were not.
 *
 * The report is assembled from the inspection on demand, so the status of every
 * item it cites reads live. Issuing it fixes two things only: the running number
 * and the date it went out. The inspection's own observations stay under the
 * normal workflow and are never rewritten here.
 */

const setting = (key, fallback = null) =>
  get('SELECT value FROM settings WHERE key = ?', [key])?.value ?? fallback;

/** The office block for the report, all of it editable in Admin → Settings. */
export function reportDefaults() {
  return {
    letterhead: setting(
      'report.letterhead',
      setting(
        'note.letterhead',
        'SOUTH EAST CENTRAL RAILWAY\nOffice of the Divisional Railway Manager (Commercial)\nBilaspur Division'
      )
    ),
    office: setting('report.office', setting('note.office', 'Sr. Divisional Commercial Manager, Bilaspur')),
    number_prefix: setting('report.number_prefix', 'BSP/COM/SI'),
    submitted_to: setting('report.submitted_to', 'Sr. Divisional Commercial Manager, Bilaspur'),
    copy_to: setting(
      'report.copy_to',
      'Concerned Branch Officers and Supervisors - for necessary action on the observations listed at Part III.'
    ),
    closing: setting(
      'report.closing',
      'The observations at Part III have been advised to the concerned departments through the '
        + 'inspection management system with the target dates shown against each. Compliance may '
        + 'please be advised within the target date.'
    ),
  };
}

/**
 * Financial-year serial for the report: BSP/COM/SI/2026-27/014. Counted per
 * prefix and year so the series restarts each April, as the office series does.
 */
export function nextInspectionNo(prefix = reportDefaults().number_prefix, date = today()) {
  const [y, m] = date.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  const like = `${prefix}/${fy}/%`;
  const row = get(
    `SELECT inspection_no FROM inspections WHERE inspection_no LIKE ?
      ORDER BY length(inspection_no) DESC, inspection_no DESC LIMIT 1`,
    [like]
  );
  const last = row ? Number.parseInt(String(row.inspection_no).split('/').pop(), 10) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}/${fy}/${String(next).padStart(3, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

const AREA_RESULT_LABELS = {
  satisfactory: 'Found in order',
  deficiencies: 'Deficiencies noticed',
  not_inspected: 'Not inspected',
  not_available: 'Not available / closed',
};

const FINDING_LABELS = {
  complied: 'Complied',
  partially_complied: 'Partially complied',
  not_complied: 'Not complied',
  dropped: 'Dropped',
};

export { AREA_RESULT_LABELS, FINDING_LABELS };

/** Where the inspection took place, with the right preposition for it. */
export function placeOf(inspection) {
  if (inspection.station_name) {
    return { preposition: 'at', name: `${inspection.station_name} (${inspection.station_code})` };
  }
  if (inspection.train_number) {
    return {
      preposition: 'on',
      name: `Train ${inspection.train_number}${inspection.train_name ? ` ${inspection.train_name}` : ''}`,
    };
  }
  if (inspection.section) return { preposition: 'on', name: `${inspection.section} section` };
  return { preposition: 'at', name: '-' };
}

/**
 * The whole report model. Everything a renderer - PDF, CSV or the browser - needs,
 * with no rendering decisions taken here.
 */
export function reportFor(inspectionId) {
  const inspection = get('SELECT * FROM v_inspections i WHERE i.id = ?', [inspectionId]);
  if (!inspection) throw notFound('Inspection');

  const areas = all(
    'SELECT * FROM inspection_areas WHERE inspection_id = ? ORDER BY sort_order, unit_name, id',
    [inspectionId]
  );
  const itemResults = all(
    'SELECT * FROM inspection_item_results WHERE inspection_id = ? ORDER BY inspection_area_id, id',
    [inspectionId]
  );
  const observations = all(
    `SELECT * FROM v_observations o WHERE o.inspection_id = ? AND o.status <> 'cancelled'
      ORDER BY o.severity_rank, o.id`,
    [inspectionId]
  );
  const approvals = all(
    `SELECT * FROM approvals WHERE entity_type = 'inspection' AND entity_id = ? ORDER BY signed_at`,
    [inspectionId]
  );
  const previous = previousOutstanding(inspectionId);

  // Part II: every area, with its items and its deficiencies folded in, so the
  // report reads area by area the way the inspector walked the station.
  const byArea = areas.map((area) => {
    const items = itemResults.filter((r) => r.inspection_area_id === area.id);
    const found = observations.filter(
      (o) => o.inspection_area_id === area.id || (o.inspection_area_id == null && o.unit_id === area.unit_id)
    );
    return {
      ...area,
      result_label: AREA_RESULT_LABELS[area.result] ?? area.result,
      items,
      items_ok: items.filter((r) => r.result === 'ok'),
      items_deficient: items.filter((r) => r.result === 'deficient'),
      items_na: items.filter((r) => r.result === 'not_applicable'),
      observations: found,
    };
  });

  const placed = new Set(byArea.flatMap((a) => a.observations.map((o) => o.id)));
  const unplaced = observations.filter((o) => !placed.has(o.id));

  return {
    inspection,
    defaults: reportDefaults(),
    place: placeOf(inspection),
    coverage: coverageOf(inspection),
    previous_inspection: previous.previous,
    previous_items: previous.items.map((item) => ({
      ...item,
      finding_label: item.review ? FINDING_LABELS[item.review.finding] ?? item.review.finding : 'Not reviewed',
    })),
    areas: byArea,
    // Areas attended to, which is what Part II prints. An area nobody looked at
    // is listed separately rather than quietly dropped.
    areas_covered: byArea.filter((a) => a.result === 'satisfactory' || a.result === 'deficiencies'),
    areas_not_covered: byArea.filter((a) => a.result === 'not_inspected' || a.result === 'not_available'),
    observations,
    unplaced_observations: unplaced,
    items_in_order: itemResults.filter((r) => r.result === 'ok'),
    approvals,
    narrative: narrativeFor({ inspection, byArea, observations, previous }),
    statistics: statisticsFor({ inspection, observations, previous }),
  };
}

/**
 * The report's opening paragraph, written from the coverage rather than from the
 * deficiency count - so an inspection that found a station in good order reads as
 * an inspection and not as an empty page.
 */
export function narrativeFor({ inspection, byArea, observations, previous }) {
  const place = placeOf(inspection);
  const coverage = coverageOf(inspection);
  const date = (inspection.started_at ?? inspection.created_at ?? '').slice(0, 10);
  const time =
    inspection.from_time && inspection.to_time
      ? ` from ${inspection.from_time} to ${inspection.to_time} hrs`
      : inspection.from_time
        ? ` at ${inspection.from_time} hrs`
        : '';

  const parts = [
    `${inspection.inspection_type_name} ${place.preposition} ${place.name} was carried out by `
      + `${inspection.inspector_name}`
      + `${inspection.inspector_designation ? `, ${inspection.inspector_designation}` : ''}`
      + ` on ${date}${time}.`,
  ];
  if (inspection.joint_with) parts.push(`Accompanied by ${inspection.joint_with}.`);

  if (coverage.areas_covered > 0) {
    const denominator = coverage.areas_on_sheet - coverage.areas_not_available;
    parts.push(
      `${coverage.areas_covered} of ${denominator} area(s) were attended to`
        + `${coverage.coverage_pct != null ? ` (${coverage.coverage_pct}% of the station)` : ''}: `
        + `${coverage.areas_satisfactory} found in order and `
        + `${coverage.areas_with_deficiencies} with deficiencies.`
    );
    if (coverage.areas_not_inspected > 0) {
      parts.push(`${coverage.areas_not_inspected} area(s) could not be attended to on this visit.`);
    }
  }
  if (coverage.items_checked > 0) {
    parts.push(
      `${coverage.items_checked} item(s) were checked, of which ${coverage.items_ok} were found in order.`
    );
  }

  if (observations.length === 0) {
    parts.push('No deficiency was noticed during this inspection.');
  } else {
    const bySeverity = {};
    const byDepartment = {};
    for (const o of observations) {
      bySeverity[o.severity_name] = (bySeverity[o.severity_name] ?? 0) + 1;
      byDepartment[o.department_name] = (byDepartment[o.department_name] ?? 0) + 1;
    }
    parts.push(
      `${observations.length} deficiency(ies) were recorded `
        + `(${Object.entries(bySeverity).map(([k, v]) => `${v} ${k}`).join(', ')}), `
        + `with action advised to ${Object.entries(byDepartment)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} (${v})`)
          .join(', ')}.`
    );
    const repeated = observations.filter((o) => o.repeat_count > 0);
    if (repeated.length) {
      parts.push(
        repeated.length === 1
          ? 'One of them is a repeated deficiency and needs sustained attention by the concerned department.'
          : `${repeated.length} of them are repeated deficiencies and need sustained attention by the concerned department.`
      );
    }
    const areasWith = byArea.filter((a) => a.observations.length > 0).map((a) => a.unit_name);
    if (areasWith.length) parts.push(`Deficiencies were noticed in: ${areasWith.join(', ')}.`);
  }

  if (previous?.previous) {
    const reviewed = previous.items.filter((i) => i.review);
    const complied = reviewed.filter((i) => i.review.finding === 'complied');
    const n = previous.items.length;
    const cite = `The previous inspection (${previous.previous.ref_no}, `
      + `${(previous.previous.started_at ?? previous.previous.created_at ?? '').slice(0, 10)})`;
    if (n === 0) {
      parts.push(`${cite} left nothing outstanding.`);
    } else {
      parts.push(
        `${cite} left ${n} item${n === 1 ? '' : 's'} outstanding`
          + (reviewed.length
            ? `; ${complied.length} of the ${reviewed.length} reviewed ${complied.length === 1 ? 'has' : 'have'} since been complied with.`
            : `, which ${n === 1 ? 'is' : 'are'} listed at Part I for review.`)
      );
    }
  }
  return parts.join(' ');
}

/** Counters the report prints and the inspection-wise dashboards reuse. */
export function statisticsFor({ inspection, observations, previous }) {
  const bySeverity = {};
  const byDepartment = {};
  let withTdc = 0;
  let overdue = 0;
  let repeated = 0;
  let closed = 0;
  for (const o of observations) {
    bySeverity[o.severity_name] = (bySeverity[o.severity_name] ?? 0) + 1;
    byDepartment[o.department_name] = (byDepartment[o.department_name] ?? 0) + 1;
    if (o.tdc) withTdc += 1;
    if (o.is_overdue) overdue += 1;
    if (o.repeat_count > 0) repeated += 1;
    if (o.status === 'closed') closed += 1;
  }
  return {
    observations: observations.length,
    by_severity: bySeverity,
    by_department: byDepartment,
    with_tdc: withTdc,
    overdue,
    repeated,
    closed,
    open: observations.length - closed,
    critical: observations.filter((o) => o.severity_rank === 1).length,
    coverage: coverageOf(inspection),
    previous_outstanding: previous?.items?.length ?? 0,
    previous_reviewed: previous?.items?.filter((i) => i.review).length ?? 0,
    previous_complied: previous?.items?.filter((i) => i.review?.finding === 'complied').length ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Issues the report: gives it its office running number and the date it went out.
 * The inspection must be completed first, because a report of a visit still in
 * progress would be a report of nothing in particular. Issuing twice is refused -
 * the number is a record.
 */
export function issueReport(inspectionId, userId) {
  const inspection = get('SELECT * FROM inspections WHERE id = ?', [inspectionId]);
  if (!inspection) throw notFound('Inspection');
  if (inspection.status !== 'completed') {
    throw badRequest('Complete the inspection before issuing its report');
  }
  if (inspection.report_status === 'issued') {
    throw badRequest(`This report has already been issued as ${inspection.inspection_no}`);
  }
  const inspectionNo = inspection.inspection_no ?? nextInspectionNo();
  update('inspections', inspectionId, {
    inspection_no: inspectionNo,
    report_status: 'issued',
    report_issued_at: nowIso(),
    report_issued_by: userId ?? null,
    updated_at: nowIso(),
  });
  return get('SELECT * FROM v_inspections i WHERE i.id = ?', [inspectionId]);
}

export default {
  reportDefaults,
  nextInspectionNo,
  reportFor,
  narrativeFor,
  statisticsFor,
  issueReport,
  placeOf,
  linkPreviousInspection,
  AREA_RESULT_LABELS,
  FINDING_LABELS,
};
