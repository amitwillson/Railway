import { all, get } from '../db/index.js';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'not', 'with', 'this', 'that', 'from', 'has',
  'have', 'had', 'but', 'its', 'been', 'being', 'at', 'in', 'on', 'of', 'to', 'is', 'a', 'an',
  'be', 'by', 'as', 'it', 'no', 'or', 'so', 'if', 'do', 'does', 'did', 'observed', 'found',
  'noticed', 'seen', 'during', 'inspection', 'please', 'also', 'there', 'their', 'which',
]);

/** Normalises free text into a comparable keyword set. */
export function keywords(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(stem)
  );
}

/** Very small suffix stemmer - enough to match "functioning" with "functional". */
function stem(word) {
  return word
    .replace(/(ing|ings)$/, '')
    .replace(/(tions|tion)$/, 't')
    .replace(/(ally|ally)$/, 'al')
    .replace(/(ies)$/, 'y')
    .replace(/(es|s)$/, '')
    .replace(/(ed)$/, '');
}

/** Overlap coefficient: shared keywords over the smaller set. */
export function similarity(a, b) {
  const setA = a instanceof Set ? a : keywords(a);
  const setB = b instanceof Set ? b : keywords(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared += 1;
  return shared / Math.min(setA.size, setB.size);
}

const TEXT_THRESHOLD = 0.45;

/**
 * Repeated deficiency detection.
 *
 * An observation is treated as a repeat when, within the look-back window and
 * at the same station, a previous observation matches on:
 *   - the same unit AND the same inspection item   (strongest signal), or
 *   - the same inspection item elsewhere at the station, or
 *   - the same observation category with strongly overlapping wording.
 *
 * Returns the matches with the reason and similarity so the inspecting officer
 * and management can see *why* something is flagged.
 */
export function findRepeats({
  stationId,
  trainId,
  unitId,
  unitName,
  itemId,
  itemName,
  categoryId,
  observation,
  windowDays = 90,
  excludeObservationId,
  limit = 10,
} = {}) {
  if (!stationId && !trainId) return { count: 0, matches: [], window_days: windowDays };

  // Callers may pass only ids (the inspection screen does); resolve the names so
  // the message shown to the officer always says what is recurring and where.
  const itemLabel =
    itemName ?? (itemId ? get('SELECT name FROM inspection_items WHERE id = ?', [itemId])?.name : null);
  const unitLabel =
    unitName ?? (unitId ? get('SELECT name FROM units WHERE id = ?', [unitId])?.name : null);

  const params = [];
  let scope = '';
  if (stationId) {
    scope = 'o.station_id = ?';
    params.push(stationId);
  } else {
    scope = 'o.train_id = ?';
    params.push(trainId);
  }
  params.push(windowDays);

  const candidates = all(
    `SELECT o.id, o.ref_no, o.observation, o.unit_id, o.unit_name, o.item_id, o.item_name,
            o.category_id, o.status, o.observed_at, o.tdc, o.closed_at,
            o.severity_id, sev.name AS severity_name, sev.rank AS severity_rank,
            i.ref_no AS inspection_ref, u.name AS inspector_name,
            (SELECT COUNT(*) FROM attachments a
               WHERE a.observation_id = o.id AND a.kind = 'photo') AS photo_count
       FROM observations o
       JOIN severities sev ON sev.id = o.severity_id
       JOIN inspections i ON i.id = o.inspection_id
       JOIN users u ON u.id = o.created_by
      WHERE ${scope}
        AND o.status <> 'cancelled'
        AND julianday('now') - julianday(o.observed_at) <= ?
      ORDER BY o.observed_at DESC
      LIMIT 400`,
    params
  );

  const target = keywords(observation);
  const matches = [];

  for (const row of candidates) {
    if (excludeObservationId && row.id === excludeObservationId) continue;
    const sameUnit =
      (unitId && row.unit_id === unitId) ||
      (!!unitLabel && !!row.unit_name && row.unit_name.toLowerCase() === unitLabel.toLowerCase());
    const sameItem =
      (itemId && row.item_id === itemId) ||
      (!!itemLabel && !!row.item_name && row.item_name.toLowerCase() === itemLabel.toLowerCase());
    const sim = similarity(target, row.observation);

    let reason = null;
    let strength = 0;
    if (sameUnit && sameItem) {
      reason = 'Same item at the same unit';
      strength = 3;
    } else if (sameItem) {
      reason = 'Same item at this location';
      strength = 2;
    } else if (sameUnit && sim >= TEXT_THRESHOLD) {
      reason = 'Similar wording at the same unit';
      strength = 2;
    } else if (categoryId && row.category_id === categoryId && sim >= TEXT_THRESHOLD) {
      reason = 'Similar observation in the same category';
      strength = 1;
    } else if (sim >= 0.65) {
      reason = 'Very similar wording';
      strength = 1;
    }
    if (!reason) continue;

    matches.push({
      ...row,
      match_reason: reason,
      match_strength: strength,
      similarity: Math.round(sim * 100) / 100,
    });
  }

  matches.sort(
    (a, b) =>
      b.match_strength - a.match_strength ||
      b.similarity - a.similarity ||
      String(b.observed_at).localeCompare(String(a.observed_at))
  );

  const top = matches.slice(0, limit);
  return {
    count: matches.length,
    window_days: windowDays,
    matches: top,
    item_name: itemLabel,
    unit_name: unitLabel,
    message: top.length
      ? buildMessage({ itemName: itemLabel, unitName: unitLabel, count: matches.length, windowDays })
      : null,
  };
}

function buildMessage({ itemName, unitName, count, windowDays }) {
  const where = [itemName, unitName].filter(Boolean).join(' - ');
  const times = count + 1;
  return `${where || 'This deficiency'} - repeated deficiency observed ${times} time${
    times === 1 ? '' : 's'
  } in the last ${windowDays} days.`;
}
