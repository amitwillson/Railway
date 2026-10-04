import express from 'express';
import { all, get } from '../db/index.js';
import { findSupervisors, supervisorLinks } from '../lib/assignment.js';
import { deficienciesForItem } from '../lib/deficiencies.js';
import { notFound } from '../lib/errors.js';
import { unitsFor } from '../lib/units.js';
import { authenticate } from '../middleware/auth.js';
import { query, z, optionalId, optionalText } from '../lib/validate.js';

const router = express.Router();
router.use(authenticate);

const activeOnly = (table, order = 'sort_order, name') =>
  all(`SELECT * FROM ${table} WHERE active = 1 ORDER BY ${order}`);

/** Location types offered on the inspection screen (admin configurable). */
const LOCATION_TYPES = [
  'Station', 'Train', 'Platform', 'Booking Office', 'Reservation Office', 'Parcel Office',
  'Commercial Establishment', 'Circulating Area', 'Waiting Hall', 'On-Train', 'Other',
];

/**
 * Everything the New Inspection screen needs in a single round trip. The PWA
 * caches this payload for offline use.
 */
router.get('/bootstrap', (req, res) => {
  const modules = activeOnly('modules');
  res.json({
    generated_at: new Date().toISOString(),
    modules,
    inspection_types: all(
      `SELECT it.*, m.code AS module_code FROM inspection_types it
        LEFT JOIN modules m ON m.id = it.module_id
       WHERE it.active = 1 ORDER BY it.sort_order, it.name`
    ),
    location_types: LOCATION_TYPES,
    departments: activeOnly('departments'),
    observation_categories: activeOnly('observation_categories'),
    severities: all('SELECT * FROM severities WHERE active = 1 ORDER BY rank'),
    item_parameters: activeOnly('item_parameters'),
    item_groups: all(
      `SELECT g.*, m.code AS module_code FROM item_groups g
        JOIN modules m ON m.id = g.module_id
       WHERE g.active = 1 ORDER BY g.module_id, g.sort_order, g.name`
    ),
    divisions: all(
      `SELECT d.*, z.code AS zone_code, z.name AS zone_name FROM divisions d
         JOIN zones z ON z.id = d.zone_id WHERE d.active = 1 ORDER BY d.name`
    ),
    zones: activeOnly('zones', 'code'),
    rule_references: all('SELECT * FROM rule_references WHERE active = 1 ORDER BY code'),
    settings: Object.fromEntries(
      all("SELECT key, value FROM settings WHERE category IN ('general','workflow')").map((s) => [
        s.key,
        s.value,
      ])
    ),
    counts: {
      stations: get('SELECT COUNT(*) AS n FROM stations WHERE active = 1').n,
      trains: get('SELECT COUNT(*) AS n FROM trains WHERE active = 1').n,
      items: get('SELECT COUNT(*) AS n FROM inspection_items WHERE active = 1').n,
      supervisors: get('SELECT COUNT(*) AS n FROM supervisors WHERE active = 1').n,
    },
  });
});

/* -------------------------------- stations -------------------------------- */

router.get(
  '/stations',
  query(
    z.object({
      q: optionalText,
      division_id: optionalId,
      zone_id: optionalId,
      section: optionalText,
      limit: z.coerce.number().int().min(1).max(500).default(50),
    })
  ),
  (req, res) => {
    const { q, division_id: divisionId, zone_id: zoneId, section, limit } = req.validQuery;
    const where = ['s.active = 1'];
    const params = [];
    if (q) {
      // A section code typed into the search finds the stations on it, which is
      // how an officer looks for "everything on JSG-BSP".
      where.push(`(lower(s.name) LIKE ? OR lower(s.code) LIKE ? OR lower(COALESCE(s.section,'')) LIKE ?)`);
      params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }
    if (section) {
      where.push('s.section = ?');
      params.push(section);
    }
    if (divisionId) {
      where.push('s.division_id = ?');
      params.push(divisionId);
    }
    if (zoneId) {
      where.push('s.zone_id = ?');
      params.push(zoneId);
    }
    res.json({
      data: all(
        `SELECT s.*, d.name AS division_name, d.code AS division_code,
                z.name AS zone_name, z.code AS zone_code,
                sec.name AS section_name
           FROM stations s
           JOIN divisions d ON d.id = s.division_id
           JOIN zones z ON z.id = s.zone_id
           LEFT JOIN sections sec ON sec.code = s.section
          WHERE ${where.join(' AND ')}
          ORDER BY CASE WHEN lower(s.code) = lower(?) THEN 0 ELSE 1 END, s.name
          LIMIT ?`,
        [...params, q ?? '', limit]
      ),
    });
  }
);

router.get('/stations/:id', (req, res) => {
  const station = get(
    `SELECT s.*, d.name AS division_name, d.code AS division_code,
            z.name AS zone_name, z.code AS zone_code
       FROM stations s
       JOIN divisions d ON d.id = s.division_id
       JOIN zones z ON z.id = s.zone_id
      WHERE s.id = ?`,
    [req.params.id]
  );
  if (!station) throw notFound('Station');
  res.json({
    ...station,
    section_name: station.section
      ? get('SELECT name FROM sections WHERE code = ?', [station.section])?.name ?? null
      : null,
    units: unitsFor({ stationId: station.id, appliesTo: 'station' }),
    // Every supervisor who answers for this station, whether posted here or
    // covering it as part of a section.
    supervisors: all(
      `SELECT sup.*, dep.name AS department_name,
              CASE WHEN sup.station_id = ? THEN 1 ELSE 0 END AS posted_here
         FROM supervisors sup
         JOIN departments dep ON dep.id = sup.department_id
        WHERE sup.active = 1
          AND (sup.station_id = ?
               OR EXISTS (SELECT 1 FROM supervisor_stations ss
                           WHERE ss.supervisor_id = sup.id AND ss.active = 1
                             AND ss.station_id = ?))
        ORDER BY posted_here DESC, dep.sort_order, sup.name`,
      [station.id, station.id, station.id]
    ),
    facilities: get('SELECT * FROM station_facilities WHERE station_id = ?', [station.id]) ?? null,
    amenity_norms: amenityNorms(station.id),
  });
});

/**
 * Minimum Essential Amenities at one station: what is provided against what the
 * norm requires, worst shortfall first.
 */
function amenityNorms(stationId, itemId = null) {
  const params = [stationId];
  let clause = '';
  if (itemId) {
    clause = ' AND n.item_id = ?';
    params.push(itemId);
  }
  return all(
    `SELECT n.*, i.name AS item_name
       FROM station_amenity_norms n
       LEFT JOIN inspection_items i ON i.id = n.item_id
      WHERE n.station_id = ?${clause}
      ORDER BY (n.required - n.provided) DESC, n.item_label`,
    params
  ).map((n) => ({
    ...n,
    shortfall: Math.max(0, Number(n.required) - Number(n.provided)),
    meets_norm: Number(n.provided) >= Number(n.required),
  }));
}

/** The norm for one item at one station, for the New Inspection screen. */
router.get(
  '/stations/:id/norms',
  query(z.object({ item_id: optionalId })),
  (req, res) => {
    const station = get('SELECT id, name FROM stations WHERE id = ?', [req.params.id]);
    if (!station) throw notFound('Station');
    res.json({ station, data: amenityNorms(station.id, req.validQuery.item_id) });
  }
);

router.get('/sections', (_req, res) =>
  res.json({
    data: all(
      `SELECT sec.*, d.code AS division_code,
              (SELECT COUNT(*) FROM stations st WHERE st.section = sec.code AND st.active = 1) AS station_count
         FROM sections sec
         LEFT JOIN divisions d ON d.id = sec.division_id
        WHERE sec.active = 1
        ORDER BY sec.sort_order, sec.name`
    ),
  })
);

/* --------------------------------- trains --------------------------------- */

router.get(
  '/trains',
  query(z.object({ q: optionalText, limit: z.coerce.number().int().min(1).max(500).default(50) })),
  (req, res) => {
    const { q, limit } = req.validQuery;
    const where = ['active = 1'];
    const params = [];
    if (q) {
      where.push('(lower(name) LIKE ? OR number LIKE ? OR lower(origin) LIKE ? OR lower(destination) LIKE ?)');
      params.push(`%${q.toLowerCase()}%`, `%${q}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }
    res.json({
      data: all(`SELECT * FROM trains WHERE ${where.join(' AND ')} ORDER BY number LIMIT ?`, [
        ...params,
        limit,
      ]),
    });
  }
);

router.get('/trains/:id', (req, res) => {
  const train = get('SELECT * FROM trains WHERE id = ?', [req.params.id]);
  if (!train) throw notFound('Train');
  res.json({ ...train, units: unitsFor({ appliesTo: 'train' }) });
});

/* ---------------------------------- units --------------------------------- */

router.get(
  '/units',
  query(
    z.object({
      station_id: optionalId,
      location_type: optionalText,
      applies_to: z.enum(['station', 'train', 'both']).optional(),
    })
  ),
  (req, res) => {
    const { station_id: stationId, location_type: locationType, applies_to: appliesTo } = req.validQuery;
    const resolved =
      appliesTo ??
      (locationType && /train/i.test(locationType) ? 'train' : 'station');
    let data = unitsFor({ stationId, appliesTo: resolved });
    // When the inspector picked a specific location type, surface the matching
    // areas first so the Unit dropdown is already narrowed down.
    if (locationType && !/^(station|train|other)$/i.test(locationType)) {
      const needle = locationType.toLowerCase();
      data = [
        ...data.filter((u) => u.name.toLowerCase().includes(needle) || (u.kind ?? '').toLowerCase() === needle),
        ...data.filter((u) => !(u.name.toLowerCase().includes(needle) || (u.kind ?? '').toLowerCase() === needle)),
      ];
    }
    res.json({ data });
  }
);

/* ------------------------- inspection items / amenities ------------------- */

router.get(
  '/items',
  query(
    z.object({
      module_id: optionalId,
      module_code: optionalText,
      group_id: optionalId,
      applies_to: z.enum(['station', 'train', 'both']).optional(),
      q: optionalText,
      limit: z.coerce.number().int().min(1).max(1000).default(400),
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    const where = ['i.active = 1', 'g.active = 1'];
    const params = [];
    if (f.module_id) {
      where.push('i.module_id = ?');
      params.push(f.module_id);
    }
    if (f.module_code) {
      where.push('m.code = ?');
      params.push(f.module_code);
    }
    if (f.group_id) {
      where.push('i.group_id = ?');
      params.push(f.group_id);
    }
    if (f.applies_to && f.applies_to !== 'both') {
      where.push("(i.applies_to = ? OR i.applies_to = 'both')");
      params.push(f.applies_to);
    }
    if (f.q) {
      where.push('(lower(i.name) LIKE ? OR lower(g.name) LIKE ?)');
      params.push(`%${f.q.toLowerCase()}%`, `%${f.q.toLowerCase()}%`);
    }
    const rows = all(
      `SELECT i.*, g.name AS group_name, g.sort_order AS group_sort, m.code AS module_code,
              dep.name AS default_department_name
         FROM inspection_items i
         JOIN item_groups g ON g.id = i.group_id
         JOIN modules m ON m.id = i.module_id
         LEFT JOIN departments dep ON dep.id = i.default_department_id
        WHERE ${where.join(' AND ')}
        ORDER BY g.sort_order, g.name, i.sort_order, i.name
        LIMIT ?`,
      [...params, f.limit]
    );
    const groups = [];
    for (const row of rows) {
      let group = groups.find((g) => g.group_id === row.group_id);
      if (!group) {
        group = { group_id: row.group_id, group_name: row.group_name, items: [] };
        groups.push(group);
      }
      group.items.push(row);
    }
    res.json({ data: rows, groups });
  }
);

router.get('/items/:id', (req, res) => {
  const item = get(
    `SELECT i.*, g.name AS group_name, m.code AS module_code, m.name AS module_name,
            dep.name AS default_department_name, r.code AS rule_code, r.title AS rule_title
       FROM inspection_items i
       JOIN item_groups g ON g.id = i.group_id
       JOIN modules m ON m.id = i.module_id
       LEFT JOIN departments dep ON dep.id = i.default_department_id
       LEFT JOIN rule_references r ON r.id = i.rule_reference_id
      WHERE i.id = ?`,
    [req.params.id]
  );
  if (!item) throw notFound('Inspection item');
  const parameters = all(
    `SELECT p.*, map.sort_order AS map_sort FROM item_parameter_map map
       JOIN item_parameters p ON p.id = map.parameter_id
      WHERE map.item_id = ? AND p.active = 1
      ORDER BY map.sort_order, p.sort_order, p.name`,
    [item.id]
  );
  res.json({
    ...item,
    parameters: parameters.length
      ? parameters
      : all('SELECT * FROM item_parameters WHERE active = 1 ORDER BY sort_order, name'),
    parameters_are_defaults: parameters.length === 0,
  });
});

/* ------------------------------- supervisors ------------------------------- */

router.get(
  '/supervisors',
  query(
    z.object({
      q: optionalText,
      department_id: optionalId,
      station_id: optionalId,
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    const where = ['s.active = 1'];
    const params = [];
    // A supervisor is linked to stations and departments, so both filters have to
    // look through the link tables as well as the primary posting on the row.
    if (f.department_id) {
      where.push(`(s.department_id = ?
                   OR EXISTS (SELECT 1 FROM supervisor_departments sd
                               WHERE sd.supervisor_id = s.id AND sd.active = 1
                                 AND sd.department_id = ?))`);
      params.push(f.department_id, f.department_id);
    }
    if (f.station_id) {
      where.push(`(s.station_id = ? OR s.station_id IS NULL
                   OR EXISTS (SELECT 1 FROM supervisor_stations ss
                               WHERE ss.supervisor_id = s.id AND ss.active = 1
                                 AND ss.station_id = ?))`);
      params.push(f.station_id, f.station_id);
    }
    if (f.q) {
      where.push(
        `(lower(s.name) LIKE ? OR lower(s.employee_id) LIKE ? OR lower(COALESCE(s.designation,'')) LIKE ?)`
      );
      params.push(`%${f.q.toLowerCase()}%`, `%${f.q.toLowerCase()}%`, `%${f.q.toLowerCase()}%`);
    }
    const rows = all(
      `SELECT s.*, dep.name AS department_name, dep.code AS department_code,
              st.name AS station_name, st.code AS station_code,
              ro.name AS reporting_officer_name,
              (SELECT COUNT(*) FROM supervisor_stations ss
                WHERE ss.supervisor_id = s.id AND ss.active = 1) AS station_count,
              (SELECT COUNT(*) FROM supervisor_departments sd
                WHERE sd.supervisor_id = s.id AND sd.active = 1) AS department_count
         FROM supervisors s
         JOIN departments dep ON dep.id = s.department_id
         LEFT JOIN stations st ON st.id = s.station_id
         LEFT JOIN supervisors ro ON ro.id = s.reporting_officer_id
        WHERE ${where.join(' AND ')}
        ORDER BY dep.sort_order, s.name
        LIMIT ?`,
      [...params, f.limit]
    );
    res.json({ data: rows.map((r) => ({ ...r, ...supervisorLinks(r.id) })) });
  }
);

/**
 * Smart assignment endpoint. Station + Unit + Action By -> the supervisor(s)
 * responsible, best match first, with the reason for the match.
 */
router.get(
  '/supervisors/resolve',
  query(
    z.object({
      station_id: optionalId,
      unit_id: optionalId,
      department_id: z.coerce.number().int().positive(),
      item_id: optionalId,
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    const candidates = findSupervisors({
      stationId: f.station_id,
      unitId: f.unit_id,
      departmentId: f.department_id,
      itemId: f.item_id,
    });
    res.json({
      data: candidates,
      auto_selected: candidates[0] ?? null,
      requires_choice: candidates.length > 1,
    });
  }
);

/** One supervisor, with every station and department they are linked to. */
router.get('/supervisors/:id', (req, res) => {
  const row = get(
    `SELECT s.*, dep.name AS department_name, dep.code AS department_code,
            st.name AS station_name, st.code AS station_code,
            ro.name AS reporting_officer_name, ro.designation AS reporting_officer_designation
       FROM supervisors s
       JOIN departments dep ON dep.id = s.department_id
       LEFT JOIN stations st ON st.id = s.station_id
       LEFT JOIN supervisors ro ON ro.id = s.reporting_officer_id
      WHERE s.id = ?`,
    [req.params.id]
  );
  if (!row) throw notFound('Supervisor');
  res.json({
    ...row,
    ...supervisorLinks(row.id),
    coverage: all(
      `SELECT c.*, st.name AS station_name, u.name AS unit_name, g.name AS item_group_name
         FROM supervisor_coverage c
         LEFT JOIN stations st ON st.id = c.station_id
         LEFT JOIN units u ON u.id = c.unit_id
         LEFT JOIN item_groups g ON g.id = c.item_group_id
        WHERE c.supervisor_id = ? AND c.active = 1
        ORDER BY c.priority`,
      [row.id]
    ),
  });
});

/* ------------------------ suggested deficiencies --------------------------- */

/**
 * The "what usually fails" dropdown for one inspection item: the suggestions
 * mapped to the item, then to its group, then to its module, then the generic
 * ones, followed by the wordings actually used for this item before now.
 */
router.get(
  '/items/:id/deficiencies',
  query(z.object({ station_id: optionalId, limit: z.coerce.number().int().min(1).max(100).default(40) })),
  (req, res) => {
    const item = get('SELECT * FROM inspection_items WHERE id = ?', [req.params.id]);
    if (!item) throw notFound('Inspection item');
    res.json(deficienciesForItem(item, req.validQuery));
  }
);

/* --------------------------- small reference lists ------------------------- */

router.get('/departments', (_req, res) => res.json({ data: activeOnly('departments') }));
router.get('/severities', (_req, res) =>
  res.json({ data: all('SELECT * FROM severities WHERE active = 1 ORDER BY rank') })
);
router.get('/categories', (_req, res) => res.json({ data: activeOnly('observation_categories') }));
router.get('/inspection-types', (_req, res) => res.json({ data: activeOnly('inspection_types') }));
router.get('/parameters', (_req, res) => res.json({ data: activeOnly('item_parameters') }));
router.get('/rule-references', (_req, res) =>
  res.json({ data: all('SELECT * FROM rule_references WHERE active = 1 ORDER BY code') })
);
router.get('/modules', (_req, res) => res.json({ data: activeOnly('modules') }));
router.get(
  '/contractors',
  query(z.object({ station_id: optionalId, q: optionalText, party_type: optionalText })),
  (req, res) => {
    const f = req.validQuery;
    const where = ['c.active = 1'];
    const params = [];
    if (f.station_id) {
      where.push('(c.station_id = ? OR c.station_id IS NULL)');
      params.push(f.station_id);
    }
    if (f.party_type) {
      where.push('c.party_type = ?');
      params.push(f.party_type);
    }
    if (f.q) {
      where.push(`(lower(c.name) LIKE ? OR lower(COALESCE(c.contract_ref,'')) LIKE ?)`);
      params.push(`%${f.q.toLowerCase()}%`, `%${f.q.toLowerCase()}%`);
    }
    res.json({
      data: all(
        `SELECT c.*, st.name AS station_name, dep.name AS department_name
           FROM contractors c
           LEFT JOIN stations st ON st.id = c.station_id
           LEFT JOIN departments dep ON dep.id = c.department_id
          WHERE ${where.join(' AND ')} ORDER BY c.name LIMIT 200`,
        params
      ),
    });
  }
);

export default router;
