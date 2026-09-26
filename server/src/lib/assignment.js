import { all, get } from '../db/index.js';

/**
 * Smart assignment engine.
 *
 * Given the station / unit / department (and optionally the inspection item)
 * chosen by the inspector, it ranks the supervisors who are responsible for
 * that combination. The inspector never types a mobile number: the top
 * candidate is pre-selected and the rest are offered in a searchable dropdown.
 *
 * Ranking (lower score wins):
 *   10  explicit coverage row for this exact station + unit
 *   20  explicit coverage row for this station + unit kind
 *   30  explicit coverage row for this station (any unit)
 *   40  supervisor posted at this station in this department, area matches unit
 *   50  supervisor posted at this station in this department
 *   60  divisional/default supervisor for this department
 *   70  any active supervisor in this department
 */
export function findSupervisors({ stationId, unitId, departmentId, itemId, limit = 25 } = {}) {
  if (!departmentId) return [];

  const unit = unitId ? get('SELECT id, name, kind FROM units WHERE id = ?', [unitId]) : null;
  const item = itemId ? get('SELECT id, group_id FROM inspection_items WHERE id = ?', [itemId]) : null;

  const rows = all(
    `SELECT s.*, d.name AS department_name, d.code AS department_code,
            st.name AS station_name, st.code AS station_code,
            ro.name AS reporting_officer_name, ro.designation AS reporting_officer_designation
       FROM supervisors s
       JOIN departments d ON d.id = s.department_id
       LEFT JOIN stations st ON st.id = s.station_id
       LEFT JOIN supervisors ro ON ro.id = s.reporting_officer_id
      WHERE s.active = 1 AND s.department_id = ?`,
    [departmentId]
  );

  const coverage = all(
    `SELECT * FROM supervisor_coverage WHERE active = 1 AND supervisor_id IN (
       SELECT id FROM supervisors WHERE active = 1 AND department_id = ?)`,
    [departmentId]
  );

  const scored = rows.map((sup) => {
    const covers = coverage.filter((c) => c.supervisor_id === sup.id);
    let score = 70;
    let reason = `Active ${sup.department_name} supervisor`;

    if (sup.is_default_for_department) {
      score = 60;
      reason = `Nominated ${sup.department_name} supervisor`;
    }
    if (stationId && sup.station_id === stationId) {
      score = 50;
      reason = `Posted at ${sup.station_name} (${sup.department_name})`;
      if (unit && matchesArea(sup.area_of_responsibility, unit.name)) {
        score = 40;
        reason = `Responsible for ${unit.name} at ${sup.station_name}`;
      }
    }
    for (const c of covers) {
      const sameStation = c.station_id != null && c.station_id === stationId;
      const globalStation = c.station_id == null;
      if (!sameStation && !globalStation) continue;
      if (unit && c.unit_id && c.unit_id === unit.id) {
        score = Math.min(score, 10 + c.priority / 1000);
        reason = `Mapped to ${unit.name}${sup.station_name ? ` at ${sup.station_name}` : ''}`;
      } else if (unit && c.unit_kind && unit.kind && c.unit_kind === unit.kind) {
        score = Math.min(score, 20 + c.priority / 1000);
        reason = `Mapped to all ${c.unit_kind} areas`;
      } else if (item && c.item_group_id && item.group_id === c.item_group_id) {
        score = Math.min(score, 25 + c.priority / 1000);
        reason = 'Mapped to this inspection category';
      } else if (sameStation && !c.unit_id && !c.unit_kind && !c.item_group_id) {
        score = Math.min(score, 30 + c.priority / 1000);
        reason = `Mapped to ${sup.station_name ?? 'this station'}`;
      }
    }
    return { ...sup, active: Boolean(sup.active), match_score: score, match_reason: reason };
  });

  return scored
    .sort((a, b) => a.match_score - b.match_score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** The single best supervisor for a station/unit/department combination. */
export function autoAssign(params) {
  const [best] = findSupervisors({ ...params, limit: 1 });
  return best ?? null;
}

function matchesArea(area, unitName) {
  if (!area || !unitName) return false;
  const a = area.toLowerCase();
  const u = unitName.toLowerCase();
  if (a.includes(u) || u.includes(a)) return true;
  const unitWords = u.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  return unitWords.some((w) => a.includes(w));
}

/**
 * Resolves the escalation chain for an observation: the supervisor's reporting
 * officer, then the divisional officers of that department, then admins.
 */
export function escalationTargets(observation, level = 1) {
  const targets = [];
  if (observation.supervisor_id) {
    const sup = get('SELECT * FROM supervisors WHERE id = ?', [observation.supervisor_id]);
    if (sup?.reporting_officer_id) {
      const officer = get('SELECT * FROM supervisors WHERE id = ?', [sup.reporting_officer_id]);
      if (officer?.user_id) targets.push(officer.user_id);
    }
  }
  const levelRow = get('SELECT * FROM escalation_levels WHERE level = ? AND active = 1', [level]);
  const role = levelRow?.target_role ?? 'divisional_officer';
  const officers = all(
    `SELECT id FROM users
      WHERE active = 1 AND role = ?
        AND (department_id IS NULL OR department_id = ?)`,
    [role, observation.action_by_department_id]
  );
  targets.push(...officers.map((o) => o.id));
  return [...new Set(targets)];
}
