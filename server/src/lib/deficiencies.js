import { all, get } from '../db/index.js';

/**
 * Suggested deficiencies - the "what usually fails" dropdown under the
 * observation box.
 *
 * A suggestion is scoped to one inspection item, to a group of items, to a
 * module, or to everything. The narrowest scope is offered first, so the
 * inspector sees "Water cooler is not functioning." before the generic
 * "{item} not functioning", and `{item}` is resolved against the item's name so a
 * single generic row reads correctly under every item in the catalogue.
 *
 * Alongside the curated list it returns the wordings that have actually been used
 * for this item before, most used first. Those come from the observations
 * themselves, so the list gets more useful the longer the system is in service
 * without anyone having to maintain it.
 */

/** Scope rank: the lower it is, the more specific the suggestion. */
const scopeOf = (row) => {
  if (row.item_id != null) return { scope: 'item', rank: 1 };
  if (row.group_id != null) return { scope: 'group', rank: 2 };
  if (row.module_id != null) return { scope: 'module', rank: 3 };
  return { scope: 'generic', rank: 4 };
};

/** "{item} not functioning" -> "Water Cooler not functioning". */
export const resolveText = (text, itemName) =>
  String(text ?? '').replace(/\{item\}/gi, itemName ?? 'the item');

export function deficienciesForItem(item, { stationId = null, limit = 40 } = {}) {
  const rows = all(
    `SELECT d.*, dep.name AS department_name, dep.code AS department_code,
            sev.name AS severity_name, sev.rank AS severity_rank,
            cat.name AS category_name,
            (SELECT COUNT(*) FROM observations o WHERE o.deficiency_id = d.id) AS times_used
       FROM item_deficiencies d
       LEFT JOIN departments dep ON dep.id = d.default_department_id
       LEFT JOIN severities sev ON sev.id = d.default_severity_id
       LEFT JOIN observation_categories cat ON cat.id = d.default_category_id
      WHERE d.active = 1
        AND (d.item_id = ?
             OR (d.item_id IS NULL AND d.group_id = ?)
             OR (d.item_id IS NULL AND d.group_id IS NULL AND d.module_id = ?)
             OR (d.item_id IS NULL AND d.group_id IS NULL AND d.module_id IS NULL))`,
    [item.id, item.group_id, item.module_id]
  );

  const data = rows
    .map((row) => {
      const { scope, rank } = scopeOf(row);
      return {
        id: row.id,
        text: resolveText(row.text, item.name),
        template: row.text,
        scope,
        scope_rank: rank,
        // A suggestion that names no department or severity leaves the item's own
        // defaults in place, which is what the inspector already has selected.
        department_id: row.default_department_id ?? null,
        department_name: row.department_name ?? null,
        department_code: row.department_code ?? null,
        severity_id: row.default_severity_id ?? null,
        severity_name: row.severity_name ?? null,
        category_id: row.default_category_id ?? null,
        category_name: row.category_name ?? null,
        suggested_tdc_days: row.suggested_tdc_days ?? null,
        times_used: row.times_used,
        sort_order: row.sort_order,
      };
    })
    .sort(
      (a, b) =>
        a.scope_rank - b.scope_rank ||
        b.times_used - a.times_used ||
        a.sort_order - b.sort_order ||
        a.text.localeCompare(b.text)
    )
    .slice(0, limit);

  return {
    item: { id: item.id, name: item.name, group_id: item.group_id, module_id: item.module_id },
    data,
    previously_used: previouslyUsed(item.id, stationId),
  };
}

/**
 * Wordings recorded for this item before now, most frequent first. Grouped
 * case-insensitively so "Water cooler not working" and "water cooler not working"
 * are one entry, and restricted to this station when one is given.
 */
function previouslyUsed(itemId, stationId, limit = 5) {
  const params = [itemId];
  let clause = '';
  if (stationId) {
    clause = ' AND o.station_id = ?';
    params.push(stationId);
  }
  return all(
    `SELECT MIN(o.observation) AS text, COUNT(*) AS times_used, MAX(o.observed_at) AS last_used
       FROM observations o
      WHERE o.item_id = ?${clause}
      GROUP BY lower(trim(o.observation))
      HAVING COUNT(*) > 1
      ORDER BY times_used DESC, last_used DESC
      LIMIT ?`,
    [...params, limit]
  );
}

/**
 * Validates a deficiency_id sent with an observation and returns the row, so the
 * observation can record which suggestion it came from (which is what makes
 * "most reported deficiencies" answerable) without trusting the client.
 */
export function deficiencyFor(deficiencyId, item) {
  if (!deficiencyId) return null;
  const row = get('SELECT * FROM item_deficiencies WHERE id = ? AND active = 1', [deficiencyId]);
  if (!row) return null;
  const belongs =
    (row.item_id == null && row.group_id == null && row.module_id == null) ||
    (row.item_id != null && item && row.item_id === item.id) ||
    (row.item_id == null && row.group_id != null && item && row.group_id === item.group_id) ||
    (row.item_id == null && row.group_id == null && row.module_id != null && item && row.module_id === item.module_id);
  return belongs ? row : null;
}
