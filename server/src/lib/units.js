import { all, get } from '../db/index.js';

/**
 * The areas available at a station (or on a train).
 *
 * The platform areas are one set of master rows shared by every station, so a
 * two-platform halt would otherwise offer Platform No. 6. Platforms above the
 * station's own count are hidden; a platform mapped to the station explicitly is
 * always kept.
 */
export function unitsFor({ stationId, appliesTo = 'station' }) {
  const params = [appliesTo];
  let stationClause = 'u.station_id IS NULL';
  if (stationId) {
    stationClause = '(u.station_id IS NULL OR u.station_id = ?)';
    params.push(stationId);
  }
  const rows = all(
    `SELECT u.* FROM units u
      WHERE u.active = 1
        AND (u.applies_to = ? OR u.applies_to = 'both')
        AND ${stationClause}
      ORDER BY u.sort_order, u.name`,
    params
  ).map((u) => ({ ...u, station_specific: u.station_id != null }));

  const platforms = stationId
    ? get('SELECT platforms FROM stations WHERE id = ?', [stationId])?.platforms ?? 0
    : 0;
  if (!platforms) return rows;
  return rows.filter((u) => {
    if (u.station_specific || u.kind !== 'platform') return true;
    const n = Number(/(\d+)\s*$/.exec(u.name)?.[1]);
    return !Number.isFinite(n) || n <= platforms;
  });
}

export default { unitsFor };
