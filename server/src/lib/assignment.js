import { all, get } from '../db/index.js';

/**
 * Smart assignment engine.
 *
 * Given the station / unit / department (and optionally the inspection item)
 * chosen by the inspector, it ranks the supervisors who are responsible for
 * that combination. The inspector never types a mobile number: the top
 * candidate is pre-selected and the rest are offered in a searchable dropdown.
 *
 * A supervisor is linked to stations and to departments (see the
 * supervisor_stations and supervisor_departments tables). The primary posting on
 * the supervisor row counts as one such link, so a supervisor who covers a whole
 * section is found at every station on it, and a Station Manager who answers for
 * both Commercial and Operating is found under either department.
 *
 * Ranking (lower score wins):
 *   10  explicit coverage row for this exact station + unit
 *   20  explicit coverage row for this station + unit kind
 *   25  explicit coverage row for this item's group
 *   30  explicit coverage row for this station (any unit)
 *   40  linked to this station in this department, area matches the unit
 *   50  linked to this station in this department (primary posting)
 *   55  linked to this station in this department (additional station)
 *   57  the supervisor has named this station in their own jurisdiction
 *   58  the supervisor has named the section this station is on
 *   60  divisional/default supervisor for this department
 *   70  any active supervisor in this department
 *
 * A supervisor who only covers the department as an additional link scores two
 * points worse than one whose primary department it is, so the person whose
 * department it actually is always wins a tie.
 *
 * The two jurisdiction scores sit deliberately between the links an administrator
 * set and the departmental nomination. A supervisor says for themselves which
 * sections and stations they look after (see lib/jurisdiction.js), which lets the
 * routing find the right person where the division's record has a gap - but it
 * can never outrank that record, so a self-declared claim cannot take work away
 * from the officer the division actually nominated.
 */
const SECONDARY_DEPARTMENT_PENALTY = 2;

export function findSupervisors({ stationId, unitId, departmentId, itemId, limit = 25 } = {}) {
  if (!departmentId) return [];

  const unit = unitId ? get('SELECT id, name, kind FROM units WHERE id = ?', [unitId]) : null;
  const item = itemId ? get('SELECT id, group_id FROM inspection_items WHERE id = ?', [itemId]) : null;

  // Eligible = primary department, or an additional department link.
  const rows = all(
    `SELECT s.*, d.name AS department_name, d.code AS department_code,
            st.name AS station_name, st.code AS station_code,
            ro.name AS reporting_officer_name, ro.designation AS reporting_officer_designation
       FROM supervisors s
       JOIN departments d ON d.id = s.department_id
       LEFT JOIN stations st ON st.id = s.station_id
       LEFT JOIN supervisors ro ON ro.id = s.reporting_officer_id
      WHERE s.active = 1
        AND (s.department_id = ?
             OR EXISTS (SELECT 1 FROM supervisor_departments sd
                         WHERE sd.supervisor_id = s.id AND sd.active = 1
                           AND sd.department_id = ?))`,
    [departmentId, departmentId]
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(', ');
  const coverage = all(
    `SELECT * FROM supervisor_coverage
      WHERE active = 1 AND supervisor_id IN (${placeholders})`,
    ids
  );
  const stationLinks = all(
    `SELECT ss.*, st.name AS station_name, st.code AS station_code
       FROM supervisor_stations ss
       JOIN stations st ON st.id = ss.station_id
      WHERE ss.active = 1 AND ss.supervisor_id IN (${placeholders})
      ORDER BY ss.is_primary DESC, ss.priority, st.name`,
    ids
  );
  const departmentLinks = all(
    `SELECT sd.*, d.name AS department_name, d.code AS department_code
       FROM supervisor_departments sd
       JOIN departments d ON d.id = sd.department_id
      WHERE sd.active = 1 AND sd.supervisor_id IN (${placeholders})
      ORDER BY sd.is_primary DESC, sd.priority, d.sort_order`,
    ids
  );

  // What each candidate has said they cover, read once for the whole ranking.
  const userIds = rows.map((r) => r.user_id).filter(Boolean);
  const declared = userIds.length
    ? all(
        `SELECT user_id, kind, section, station_id, division_id FROM user_jurisdictions
          WHERE active = 1 AND user_id IN (${userIds.map(() => '?').join(',')})`,
        userIds
      )
    : [];
  const station = stationId
    ? get('SELECT id, name, section, division_id FROM stations WHERE id = ?', [stationId])
    : null;

  const scored = rows.map((sup) => {
    const covers = coverage.filter((c) => c.supervisor_id === sup.id);
    const stations = stationLinks.filter((l) => l.supervisor_id === sup.id);
    const departments = departmentLinks.filter((l) => l.supervisor_id === sup.id);

    // The primary posting on the supervisor row is a station link too.
    const linkedStations = stations.some((l) => l.station_id === sup.station_id) || !sup.station_id
      ? stations
      : [
          {
            station_id: sup.station_id,
            station_name: sup.station_name,
            station_code: sup.station_code,
            is_primary: 1,
            priority: 100,
          },
          ...stations,
        ];
    const stationLink = stationId ? linkedStations.find((l) => l.station_id === stationId) : null;
    const isPrimaryDepartment =
      sup.department_id === departmentId || departments.some((l) => l.department_id === departmentId && l.is_primary);
    const penalty = isPrimaryDepartment ? 0 : SECONDARY_DEPARTMENT_PENALTY;
    const departmentLabel = isPrimaryDepartment
      ? sup.department_name
      : departments.find((l) => l.department_id === departmentId)?.department_name ?? sup.department_name;

    let score = 70;
    let reason = `Active ${departmentLabel} supervisor`;

    if (sup.is_default_for_department) {
      score = 60;
      reason = `Nominated ${departmentLabel} supervisor`;
    }
    if (stationLink) {
      const where = stationLink.station_name ?? 'this station';
      const isPosting = Boolean(stationLink.is_primary) || stationLink.station_id === sup.station_id;
      score = isPosting ? 50 : 55;
      reason = isPosting
        ? `Posted at ${where} (${departmentLabel})`
        : `Covers ${where} (${departmentLabel})`;
      if (unit && matchesArea(sup.area_of_responsibility, unit.name)) {
        score = 40;
        reason = `Responsible for ${unit.name} at ${where}`;
      }
    }
    // The supervisor's own statement of where they work. It only helps when the
    // administrative record has nothing to say about this station.
    if (station && sup.user_id && score > 55) {
      const mine = declared.filter((d) => d.user_id === sup.user_id);
      if (mine.some((d) => d.station_id === station.id)) {
        score = 57;
        reason = `Covers ${station.name} by their own jurisdiction (${departmentLabel})`;
      } else if (station.section && mine.some((d) => d.section === station.section)) {
        score = 58;
        reason = `Covers the ${station.section} section by their own jurisdiction (${departmentLabel})`;
      }
    }

    for (const c of covers) {
      const sameStation = c.station_id != null && c.station_id === stationId;
      const globalStation = c.station_id == null;
      if (!sameStation && !globalStation) continue;
      const at = stationLink?.station_name ?? sup.station_name;
      if (unit && c.unit_id && c.unit_id === unit.id) {
        score = Math.min(score, 10 + c.priority / 1000);
        reason = `Mapped to ${unit.name}${at ? ` at ${at}` : ''}`;
      } else if (unit && c.unit_kind && unit.kind && c.unit_kind === unit.kind) {
        score = Math.min(score, 20 + c.priority / 1000);
        reason = `Mapped to all ${c.unit_kind} areas`;
      } else if (item && c.item_group_id && item.group_id === c.item_group_id) {
        score = Math.min(score, 25 + c.priority / 1000);
        reason = 'Mapped to this inspection category';
      } else if (sameStation && !c.unit_id && !c.unit_kind && !c.item_group_id) {
        score = Math.min(score, 30 + c.priority / 1000);
        reason = `Mapped to ${at ?? 'this station'}`;
      }
    }
    return {
      ...sup,
      active: Boolean(sup.active),
      station_links: linkedStations.map((l) => ({
        station_id: l.station_id,
        station_name: l.station_name,
        station_code: l.station_code,
        is_primary: Boolean(l.is_primary),
        section: l.section ?? null,
      })),
      department_links: departments.map((l) => ({
        department_id: l.department_id,
        department_name: l.department_name,
        department_code: l.department_code,
        is_primary: Boolean(l.is_primary),
      })),
      match_score: score + penalty,
      match_reason: reason,
    };
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

/** The stations and departments a supervisor is linked to, primary link first. */
export function supervisorLinks(supervisorId) {
  return {
    stations: all(
      `SELECT ss.id, ss.station_id, ss.is_primary, ss.section, ss.priority, ss.active,
              st.name AS station_name, st.code AS station_code
         FROM supervisor_stations ss
         JOIN stations st ON st.id = ss.station_id
        WHERE ss.supervisor_id = ?
        ORDER BY ss.is_primary DESC, ss.priority, st.name`,
      [supervisorId]
    ).map((r) => ({ ...r, is_primary: Boolean(r.is_primary), active: Boolean(r.active) })),
    departments: all(
      `SELECT sd.id, sd.department_id, sd.is_primary, sd.priority, sd.active,
              d.name AS department_name, d.code AS department_code
         FROM supervisor_departments sd
         JOIN departments d ON d.id = sd.department_id
        WHERE sd.supervisor_id = ?
        ORDER BY sd.is_primary DESC, sd.priority, d.sort_order`,
      [supervisorId]
    ).map((r) => ({ ...r, is_primary: Boolean(r.is_primary), active: Boolean(r.active) })),
  };
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
