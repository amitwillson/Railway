import { all, get, insert, nowIso, run, tx, update } from '../db/index.js';
import { badRequest, notFound } from './errors.js';

/**
 * What an officer covers.
 *
 * Every inspector and every supervisor says for themselves which sections and
 * which stations they work. That is useful on its own - the screens then offer
 * their own patch first instead of all 89 stations of the division - and for a
 * supervisor it also reaches the assignment engine.
 *
 * It does not replace the division's own record. supervisor_stations and
 * supervisor_departments are maintained by an administrator and remain the
 * authority for who answers for what; a self-declared jurisdiction ranks below
 * them, so it can fill a gap without ever outranking the nomination. Every row
 * says whether the officer or an administrator set it, and who.
 */

const KINDS = ['division', 'section', 'station'];

export { KINDS };

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** One officer's jurisdiction, stations and sections together, primary first. */
export function jurisdictionOf(userId, { activeOnly = true } = {}) {
  return all(
    `SELECT j.*,
            s.name AS station_name, s.code AS station_code, s.section AS station_section,
            sec.name AS section_name,
            d.name AS division_name, d.code AS division_code,
            setter.name AS set_by_name
       FROM user_jurisdictions j
       LEFT JOIN stations s ON s.id = j.station_id
       LEFT JOIN sections sec ON sec.code = j.section
       LEFT JOIN divisions d ON d.id = j.division_id
       LEFT JOIN users setter ON setter.id = j.set_by
      WHERE j.user_id = ?${activeOnly ? ' AND j.active = 1' : ''}
      ORDER BY j.is_primary DESC, j.kind, COALESCE(sec.sort_order, 100), s.km, s.name`,
    [userId]
  ).map((row) => ({
    ...row,
    is_primary: Boolean(row.is_primary),
    active: Boolean(row.active),
  }));
}

/** The station ids an officer covers, a section expanding to its stations. */
export function stationsCovered(userId) {
  const rows = jurisdictionOf(userId);
  if (rows.length === 0) return [];
  const direct = rows.filter((r) => r.station_id).map((r) => r.station_id);
  const sections = rows.filter((r) => r.section).map((r) => r.section);
  const divisions = rows.filter((r) => r.kind === 'division' && r.division_id).map((r) => r.division_id);

  const ids = new Set(direct);
  if (sections.length) {
    for (const row of all(
      `SELECT id FROM stations WHERE active = 1 AND section IN (${sections.map(() => '?').join(',')})`,
      sections
    )) {
      ids.add(row.id);
    }
  }
  if (divisions.length) {
    for (const row of all(
      `SELECT id FROM stations WHERE active = 1 AND division_id IN (${divisions.map(() => '?').join(',')})`,
      divisions
    )) {
      ids.add(row.id);
    }
  }
  return [...ids];
}

/** True when this officer has said they cover this station. */
export function coversStation(userId, stationId) {
  if (!userId || !stationId) return false;
  const station = get('SELECT section, division_id FROM stations WHERE id = ?', [stationId]);
  if (!station) return false;
  const row = get(
    `SELECT 1 AS hit FROM user_jurisdictions
      WHERE user_id = ? AND active = 1
        AND (station_id = ?
             OR (section IS NOT NULL AND section = ?)
             OR (kind = 'division' AND division_id = ?))
      LIMIT 1`,
    [userId, stationId, station.section ?? '', station.division_id ?? -1]
  );
  return Boolean(row);
}

/**
 * How this officer covers a station, or null. The caller uses the kind to rank:
 * a station named outright is a closer claim than one inside a whole section.
 */
export function coverageKind(userId, stationId) {
  if (!userId || !stationId) return null;
  const station = get('SELECT section, division_id FROM stations WHERE id = ?', [stationId]);
  if (!station) return null;
  const rows = all(
    `SELECT kind, section, station_id, division_id, is_primary FROM user_jurisdictions
      WHERE user_id = ? AND active = 1`,
    [userId]
  );
  if (rows.some((r) => r.station_id === stationId)) return 'station';
  if (station.section && rows.some((r) => r.section === station.section)) return 'section';
  if (rows.some((r) => r.kind === 'division' && r.division_id === station.division_id)) return 'division';
  return null;
}

/** The sections and stations an officer can choose from, for the picker. */
export function choicesFor(user) {
  const divisionId = user.division_id ?? null;
  const sections = all(
    `SELECT sec.code, sec.name, sec.division_id,
            (SELECT COUNT(*) FROM stations st WHERE st.active = 1 AND st.section = sec.code) AS station_count
       FROM sections sec
      WHERE sec.active = 1${divisionId ? ' AND (sec.division_id IS NULL OR sec.division_id = ?)' : ''}
      ORDER BY sec.sort_order, sec.name`,
    divisionId ? [divisionId] : []
  );
  const stations = all(
    `SELECT id, code, name, section, category, station_type, km
       FROM stations
      WHERE active = 1${divisionId ? ' AND division_id = ?' : ''}
      ORDER BY section, km, name`,
    divisionId ? [divisionId] : []
  );
  const divisions = all(
    `SELECT id, code, name FROM divisions WHERE active = 1${divisionId ? ' AND id = ?' : ''} ORDER BY name`,
    divisionId ? [divisionId] : []
  );
  return { sections, stations, divisions };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Replaces an officer's jurisdiction with the one they have just chosen.
 *
 * Rows are deactivated rather than deleted, the same rule the rest of the master
 * data follows, so what an officer used to cover stays readable against the
 * observations that were routed to them at the time.
 */
export function setJurisdiction(userId, { sections = [], stations = [], divisions = [], primary = null }, actor) {
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw notFound('User');

  const sectionCodes = [...new Set(sections.filter(Boolean).map(String))];
  const stationIds = [...new Set(stations.filter(Boolean).map(Number))];
  const divisionIds = [...new Set(divisions.filter(Boolean).map(Number))];

  if (sectionCodes.length) {
    const known = all(
      `SELECT code FROM sections WHERE active = 1 AND code IN (${sectionCodes.map(() => '?').join(',')})`,
      sectionCodes
    ).map((r) => r.code);
    const unknown = sectionCodes.filter((c) => !known.includes(c));
    if (unknown.length) throw badRequest(`Unknown section: ${unknown.join(', ')}`);
  }
  if (stationIds.length) {
    const known = all(
      `SELECT id FROM stations WHERE active = 1 AND id IN (${stationIds.map(() => '?').join(',')})`,
      stationIds
    ).map((r) => r.id);
    const unknown = stationIds.filter((id) => !known.includes(id));
    if (unknown.length) throw badRequest(`Unknown station: ${unknown.join(', ')}`);
  }

  const source = actor && actor.id !== userId ? 'admin' : 'self';
  const now = nowIso();

  tx(() => {
    // Everything the officer has not re-chosen is stood down, not deleted.
    run('UPDATE user_jurisdictions SET active = 0, updated_at = ? WHERE user_id = ? AND active = 1', [now, userId]);

    const upsert = (row) => {
      const existing = get(
        `SELECT id FROM user_jurisdictions
          WHERE user_id = ? AND kind = ?
            AND COALESCE(section, '') = COALESCE(?, '')
            AND COALESCE(station_id, 0) = COALESCE(?, 0)
            AND COALESCE(division_id, 0) = COALESCE(?, 0)`,
        [userId, row.kind, row.section ?? null, row.station_id ?? null, row.division_id ?? null]
      );
      const values = {
        ...row,
        user_id: userId,
        source,
        set_by: actor?.id ?? null,
        active: 1,
        updated_at: now,
      };
      if (existing) update('user_jurisdictions', existing.id, values);
      else insert('user_jurisdictions', values);
    };

    for (const code of sectionCodes) {
      upsert({
        kind: 'section',
        section: code,
        station_id: null,
        division_id: user.division_id ?? null,
        is_primary: primary?.kind === 'section' && primary.value === code ? 1 : 0,
      });
    }
    for (const id of stationIds) {
      upsert({
        kind: 'station',
        section: null,
        station_id: id,
        division_id: null,
        is_primary: primary?.kind === 'station' && Number(primary.value) === id ? 1 : 0,
      });
    }
    for (const id of divisionIds) {
      upsert({
        kind: 'division',
        section: null,
        station_id: null,
        division_id: id,
        is_primary: primary?.kind === 'division' && Number(primary.value) === id ? 1 : 0,
      });
    }
  });

  return jurisdictionOf(userId);
}

export default {
  KINDS,
  jurisdictionOf,
  stationsCovered,
  coversStation,
  coverageKind,
  choicesFor,
  setJurisdiction,
};
