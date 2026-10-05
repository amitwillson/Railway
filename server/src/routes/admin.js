import express from 'express';
import { all, get, getDb, insert, nowIso, run, update } from '../db/index.js';
import { hashPassword, publicUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { authenticate, requireRole, ROLES } from '../middleware/auth.js';
import { asyncRoute } from '../lib/http.js';
import { body, query, z, optionalId, optionalText, optionalBool } from '../lib/validate.js';
import { runReminderSweep } from '../lib/scheduler.js';
import { toCsv } from '../lib/exporters.js';
import config from '../config.js';

const router = express.Router();
router.use(authenticate);

/* -------------------------------------------------------------------------- */
/* Generic master-data CRUD                                                   */
/*                                                                            */
/* Every table below is editable from the Admin Panel, so routine master-data  */
/* changes (a new station, unit, amenity, department, supervisor, TDC rule)    */
/* never need a code change. The whitelist is the security boundary: only      */
/* these tables and these columns can be reached.                             */
/* -------------------------------------------------------------------------- */

const RESOURCES = {
  zones: { table: 'zones', label: 'Zone', columns: ['code', 'name', 'active'], order: 'code' },
  divisions: { table: 'divisions', label: 'Division', columns: ['code', 'name', 'zone_id', 'active'], order: 'name' },
  departments: {
    table: 'departments',
    label: 'Department',
    columns: ['code', 'name', 'is_external', 'sort_order', 'active'],
    order: 'sort_order, name',
  },
  sections: {
    table: 'sections',
    label: 'Section',
    columns: ['code', 'name', 'division_id', 'sort_order', 'active'],
    order: 'sort_order',
    search: ['code', 'name'],
  },
  stations: {
    table: 'stations',
    label: 'Station',
    columns: ['code', 'name', 'division_id', 'zone_id', 'category', 'station_type', 'section', 'platforms', 'state', 'district', 'route', 'km', 'latitude', 'longitude', 'active'],
    order: 'section, km, name',
    search: ['code', 'name', 'section'],
  },
  station_amenity_norms: {
    table: 'station_amenity_norms',
    label: 'Amenity norm (MEA)',
    columns: ['station_id', 'item_id', 'item_label', 'unit', 'provided', 'required', 'source'],
    order: 'station_id, item_label',
    search: ['item_label'],
  },
  trains: {
    table: 'trains',
    label: 'Train',
    columns: ['number', 'name', 'origin_code', 'origin', 'destination_code', 'destination', 'train_type', 'has_pantry', 'active'],
    order: 'number',
    search: ['number', 'name'],
  },
  units: {
    table: 'units',
    label: 'Unit / Area',
    columns: ['name', 'applies_to', 'station_id', 'kind', 'sort_order', 'active'],
    order: 'sort_order, name',
    search: ['name'],
  },
  modules: { table: 'modules', label: 'Module', columns: ['code', 'name', 'tagline', 'description', 'accent', 'sort_order', 'active'], order: 'sort_order' },
  inspection_types: { table: 'inspection_types', label: 'Inspection type', columns: ['name', 'module_id', 'sort_order', 'active'], order: 'sort_order, name' },
  item_groups: { table: 'item_groups', label: 'Item group', columns: ['module_id', 'name', 'applies_to_kinds', 'sort_order', 'active'], order: 'module_id, sort_order' },
  inspection_items: {
    table: 'inspection_items',
    label: 'Inspection item',
    columns: ['group_id', 'module_id', 'name', 'applies_to', 'default_department_id', 'default_category_id', 'default_severity_id', 'rule_reference_id', 'sort_order', 'active'],
    order: 'module_id, sort_order, name',
    search: ['name'],
  },
  item_parameters: { table: 'item_parameters', label: 'Checklist parameter', columns: ['name', 'polarity', 'sort_order', 'active'], order: 'sort_order, name' },
  observation_categories: { table: 'observation_categories', label: 'Observation category', columns: ['name', 'sort_order', 'active'], order: 'sort_order, name' },
  severities: {
    table: 'severities',
    label: 'Severity',
    columns: ['name', 'definition', 'rank', 'default_tdc_days', 'notify_immediately', 'escalate_immediately', 'accent', 'active'],
    order: 'rank',
  },
  supervisors: {
    table: 'supervisors',
    label: 'Supervisor',
    columns: ['employee_id', 'name', 'designation', 'department_id', 'sub_department', 'station_id', 'section', 'area_of_responsibility', 'mobile', 'email', 'reporting_officer_id', 'user_id', 'is_default_for_department', 'active'],
    order: 'name',
    search: ['name', 'employee_id', 'designation'],
  },
  supervisor_stations: {
    table: 'supervisor_stations',
    label: 'Supervisor - station link',
    columns: ['supervisor_id', 'station_id', 'is_primary', 'section', 'priority', 'active'],
    order: 'supervisor_id, is_primary DESC, priority',
  },
  supervisor_departments: {
    table: 'supervisor_departments',
    label: 'Supervisor - department link',
    columns: ['supervisor_id', 'department_id', 'is_primary', 'priority', 'active'],
    order: 'supervisor_id, is_primary DESC, priority',
  },
  supervisor_coverage: {
    table: 'supervisor_coverage',
    label: 'Supervisor coverage',
    columns: ['supervisor_id', 'station_id', 'unit_id', 'unit_kind', 'item_group_id', 'priority', 'active'],
    order: 'priority',
  },
  user_jurisdictions: { table: 'user_jurisdictions', label: 'Officer jurisdiction', columns: ['user_id', 'kind', 'division_id', 'section', 'station_id', 'is_primary', 'source', 'set_by', 'active'], order: 'user_id, kind' },
  // What an officer said about the application is their own statement, attributed
  // to them by name, so this editor triages it and never rewrites it: `suggestion`,
  // `user_id` and `inspection_id` are deliberately not editable here. The office
  // answers it under Admin -> Feedback, which records who replied and when.
  app_feedback: { table: 'app_feedback', label: 'Application feedback', columns: ['kind', 'area', 'status', 'response'], search: ['suggestion', 'response'], order: 'created_at DESC' },
  inspection_areas: { table: 'inspection_areas', label: 'Inspection area (sheet row)', columns: ['inspection_id', 'unit_id', 'unit_name', 'unit_kind', 'coach', 'result', 'remarks', 'sort_order'], order: 'inspection_id DESC, sort_order' },
  inspection_item_results: { table: 'inspection_item_results', label: 'Inspection item result', columns: ['inspection_id', 'inspection_area_id', 'unit_id', 'item_id', 'item_name', 'group_name', 'result', 'remarks', 'observation_id'], order: 'inspection_id DESC, id' },
  inspection_previous_reviews: { table: 'inspection_previous_reviews', label: 'Previous-inspection review', columns: ['inspection_id', 'observation_id', 'finding', 'remarks', 'reviewed_by'], order: 'inspection_id DESC, id' },
  item_deficiencies: {
    table: 'item_deficiencies',
    label: 'Suggested deficiency',
    columns: ['item_id', 'group_id', 'module_id', 'text', 'default_department_id', 'default_severity_id', 'default_category_id', 'suggested_tdc_days', 'sort_order', 'active'],
    order: 'module_id, group_id, item_id, sort_order',
    search: ['text'],
  },
  contractors: {
    table: 'contractors',
    label: 'Contractor / Licensee',
    columns: ['name', 'party_type', 'contract_ref', 'scope', 'station_id', 'department_id', 'contact_person', 'mobile', 'email', 'valid_from', 'valid_to', 'security_deposit', 'licence_fee', 'active'],
    order: 'name',
    search: ['name', 'contract_ref'],
  },
  rule_references: { table: 'rule_references', label: 'Rule / instruction', columns: ['code', 'title', 'authority', 'reference_no', 'issued_on', 'url', 'notes', 'active'], order: 'code', search: ['code', 'title'] },
  tdc_rules: {
    table: 'tdc_rules',
    label: 'TDC rule',
    columns: ['name', 'severity_id', 'remind_before_days', 'remind_on_due_date', 'overdue_repeat_days', 'escalate_after_days', 'escalate_to_role', 'active'],
    order: 'id',
  },
  notification_rules: {
    table: 'notification_rules',
    label: 'Notification rule',
    columns: ['event', 'recipients', 'in_app', 'email', 'sms', 'template_title', 'template_body', 'active'],
    order: 'event',
  },
  escalation_levels: {
    table: 'escalation_levels',
    label: 'Escalation level',
    columns: ['level', 'name', 'after_days', 'target_role', 'target_designation', 'notes', 'active'],
    order: 'level',
  },
  item_parameter_map: {
    table: 'item_parameter_map',
    label: 'Item parameter mapping',
    columns: ['item_id', 'parameter_id', 'sort_order'],
    order: 'item_id, sort_order',
    noId: true,
  },
};

/** Divisional officers may browse the masters; only admins may change them. */
router.get('/resources', requireRole(ROLES.ADMIN, ROLES.OFFICER), (_req, res) => {
  res.json({
    data: Object.entries(RESOURCES).map(([key, def]) => ({
      key,
      label: def.label,
      columns: def.columns,
      count: get(`SELECT COUNT(*) AS n FROM ${def.table}`).n,
      searchable: Boolean(def.search),
    })),
  });
});

const resourceDef = (name) => {
  const def = RESOURCES[name];
  if (!def) throw notFound(`Master "${name}"`);
  return def;
};

/** Keeps only whitelisted columns - anything else is silently dropped. */
const sanitise = (def, payload) =>
  Object.fromEntries(
    Object.entries(payload ?? {}).filter(([k, v]) => def.columns.includes(k) && v !== undefined)
  );

router.get(
  '/masters/:resource',
  requireRole(ROLES.ADMIN, ROLES.OFFICER),
  query(
    z.object({
      q: optionalText,
      active: optionalText,
      limit: z.coerce.number().int().min(1).max(2000).default(500),
      offset: z.coerce.number().int().min(0).default(0),
    })
  ),
  (req, res) => {
    const def = resourceDef(req.params.resource);
    const where = ['1=1'];
    const params = [];
    if (req.validQuery.q && def.search) {
      where.push(`(${def.search.map((c) => `lower(CAST(${c} AS TEXT)) LIKE ?`).join(' OR ')})`);
      params.push(...def.search.map(() => `%${req.validQuery.q.toLowerCase()}%`));
    }
    if (req.validQuery.active === '1' || req.validQuery.active === '0') {
      if (def.columns.includes('active')) {
        where.push('active = ?');
        params.push(Number(req.validQuery.active));
      }
    }
    const total = get(`SELECT COUNT(*) AS n FROM ${def.table} WHERE ${where.join(' AND ')}`, params).n;
    res.json({
      resource: req.params.resource,
      label: def.label,
      columns: def.columns,
      total,
      data: all(
        `SELECT * FROM ${def.table} WHERE ${where.join(' AND ')} ORDER BY ${def.order} LIMIT ? OFFSET ?`,
        [...params, req.validQuery.limit, req.validQuery.offset]
      ),
    });
  }
);

router.post('/masters/:resource', requireRole(ROLES.ADMIN), (req, res) => {
  const def = resourceDef(req.params.resource);
  const data = sanitise(def, req.body);
  if (Object.keys(data).length === 0) throw badRequest('No valid fields supplied');
  const id = insert(def.table, data);
  const created = def.noId ? data : get(`SELECT * FROM ${def.table} WHERE rowid = ?`, [id]);
  audit(req, {
    action: 'MASTER_CREATE',
    entityType: req.params.resource,
    entityId: id,
    next: created,
  });
  res.status(201).json(created);
});

router.patch('/masters/:resource/:id', requireRole(ROLES.ADMIN), (req, res) => {
  const def = resourceDef(req.params.resource);
  if (def.noId) throw badRequest('This master is edited by recreating its rows');
  const before = get(`SELECT * FROM ${def.table} WHERE id = ?`, [req.params.id]);
  if (!before) throw notFound(def.label);
  const data = sanitise(def, req.body);
  if (Object.keys(data).length === 0) throw badRequest('No valid fields supplied');
  if (def.columns.includes('updated_at')) data.updated_at = nowIso();
  update(def.table, before.id, data);
  const after = get(`SELECT * FROM ${def.table} WHERE id = ?`, [before.id]);
  audit(req, {
    action: 'MASTER_UPDATE',
    entityType: req.params.resource,
    entityId: before.id,
    previous: before,
    next: after,
  });
  res.json(after);
});

/**
 * Masters are deactivated rather than deleted so that historical observations
 * keep pointing at a valid row. A hard delete is offered only for mapping
 * tables that carry no history.
 */
router.delete('/masters/:resource/:id', requireRole(ROLES.ADMIN), (req, res) => {
  const def = resourceDef(req.params.resource);
  const before = def.noId
    ? null
    : get(`SELECT * FROM ${def.table} WHERE id = ?`, [req.params.id]);
  if (!def.noId && !before) throw notFound(def.label);
  if (def.columns.includes('active') && req.query.hard !== 'true') {
    update(def.table, before.id, { active: 0 });
    audit(req, {
      action: 'MASTER_DEACTIVATE',
      entityType: req.params.resource,
      entityId: before.id,
      previous: before,
      next: { ...before, active: 0 },
    });
    res.json({ ok: true, deactivated: true, data: get(`SELECT * FROM ${def.table} WHERE id = ?`, [before.id]) });
    return;
  }
  run(`DELETE FROM ${def.table} WHERE id = ?`, [req.params.id]);
  audit(req, {
    action: 'MASTER_DELETE',
    entityType: req.params.resource,
    entityId: req.params.id,
    previous: before,
  });
  res.json({ ok: true, deleted: true });
});

/* -------------------------------------------------------------------------- */
/* Station list import / export                                               */
/*                                                                            */
/* The station master is the one list every division has to replace with its   */
/* own before the system is used in earnest, and editing thirty-odd stations   */
/* one at a time is not a reasonable way to do it. Export gives the current    */
/* list in the exact shape the importer accepts, so the round trip is safe.    */
/* -------------------------------------------------------------------------- */

const STATION_IMPORT_COLUMNS = ['code', 'name', 'division', 'zone', 'category', 'station_type', 'section', 'platforms', 'state', 'district', 'route', 'km', 'latitude', 'longitude', 'active'];

/**
 * Header names a divisional office actually sends. A file prepared in the works
 * office says "Station Code" and "No. of Platforms", not "code" and "platforms",
 * and refusing it over a column heading would be a poor reason to make somebody
 * retype a station list. Headers are lower-cased and spaces become underscores
 * before this map is applied, so one entry covers "Station Code", "STATION CODE"
 * and "station_code" alike.
 */
const STATION_HEADER_ALIASES = {
  station_code: 'code', stn_code: 'code', code_no: 'code', abbreviation: 'code',
  station: 'name', station_name: 'name', stn_name: 'name', name_of_station: 'name',
  div: 'division', division_code: 'division', divn: 'division',
  railway: 'zone', zone_code: 'zone',
  nsg_category: 'category', station_category: 'category', categorisation: 'category',
  type: 'station_type', station_class: 'station_type', class: 'station_type',
  block_section: 'section', line: 'section', route: 'section',
  no_of_platforms: 'platforms', number_of_platforms: 'platforms', pf: 'platforms',
  chainage: 'km', km_: 'km', kilometre: 'km', distance: 'km',
  platform: 'platforms', platforms_available: 'platforms',
  lat: 'latitude', long: 'longitude', lng: 'longitude',
  in_use: 'active', working: 'active',
};

/** Renames the headers an office file uses to the ones the importer reads. */
const normaliseStationHeader = (header) => header.map((h) => STATION_HEADER_ALIASES[h] ?? h);

router.get('/stations/export', requireRole(ROLES.ADMIN, ROLES.OFFICER), (_req, res) => {
  const rows = all(
    `SELECT s.code, s.name, d.code AS division, z.code AS zone, s.category, s.station_type,
            s.section, s.platforms, s.state, s.district, s.route, s.km,
            s.latitude, s.longitude, s.active
       FROM stations s
       JOIN divisions d ON d.id = s.division_id
       JOIN zones z ON z.id = s.zone_id
      ORDER BY s.section, s.km, s.name`
  );
  res.type('text/csv');
  res.setHeader('content-disposition', 'attachment; filename="stations.csv"');
  res.send(toCsv(rows, STATION_IMPORT_COLUMNS.map((key) => ({ key, label: key }))));
});

/**
 * Imports stations from CSV. `code` identifies the station: a code already in the
 * master is updated, a new one is inserted. Nothing is deleted - a station that
 * has to go is deactivated, because historical observations point at it.
 *
 * `dry_run` returns exactly what would change without writing anything, so the
 * file can be checked before it is applied.
 */
router.post(
  '/stations/import',
  requireRole(ROLES.ADMIN),
  body(
    z.object({
      csv: z.string().min(10, 'Paste the CSV, including its header row'),
      dry_run: z.boolean().default(false),
      deactivate_missing: z.boolean().default(false),
    })
  ),
  (req, res) => {
    const parsed = parseCsv(req.body.csv, normaliseStationHeader);
    if (!parsed.rows.length) throw badRequest('No data rows found below the header');
    const missing = ['code', 'name'].filter((c) => !parsed.header.includes(c));
    if (missing.length) {
      throw badRequest(
        `The CSV must have a ${missing.join(' and ')} column. `
          + `Found: ${parsed.header.join(', ')}. `
          + '"Station Code" and "Station Name" are understood as well.'
      );
    }

    const divisions = new Map(all('SELECT id, code FROM divisions').map((d) => [d.code.toUpperCase(), d.id]));
    const zones = new Map(all('SELECT id, code FROM zones').map((z_) => [z_.code.toUpperCase(), z_.id]));
    const defaultDivision = get('SELECT value FROM settings WHERE key = ?', ['app.division_default'])?.value;

    const created = [];
    const updated = [];
    const skipped = [];
    const seen = new Set();

    for (const [index, row] of parsed.rows.entries()) {
      const line = index + 2;
      const code = String(row.code ?? '').trim().toUpperCase();
      const name = String(row.name ?? '').trim();
      if (!code || !name) {
        skipped.push({ line, code, reason: 'code and name are both required' });
        continue;
      }
      const existing = get('SELECT * FROM stations WHERE upper(code) = ?', [code]);
      const divisionCode = String(row.division ?? defaultDivision ?? '').trim().toUpperCase();
      const divisionId = divisions.get(divisionCode) ?? existing?.division_id ?? null;
      if (!divisionId) {
        skipped.push({ line, code, reason: `unknown division "${row.division ?? ''}"` });
        continue;
      }
      const zoneCode = String(row.zone ?? '').trim().toUpperCase();
      const zoneId =
        zones.get(zoneCode) ??
        existing?.zone_id ??
        get('SELECT zone_id FROM divisions WHERE id = ?', [divisionId])?.zone_id ??
        null;
      if (!zoneId) {
        skipped.push({ line, code, reason: `unknown zone "${row.zone ?? ''}"` });
        continue;
      }

      const fields = {
        code,
        name,
        division_id: divisionId,
        zone_id: zoneId,
        category: blankToNull(row.category) ?? existing?.category ?? null,
        station_type: blankToNull(row.station_type) ?? existing?.station_type ?? null,
        section: blankToNull(row.section) ?? existing?.section ?? null,
        platforms: numberOr(row.platforms, existing?.platforms ?? 0),
        state: blankToNull(row.state) ?? existing?.state ?? null,
        district: blankToNull(row.district) ?? existing?.district ?? null,
        route: blankToNull(row.route) ?? existing?.route ?? null,
        km: row.km === undefined || row.km === '' ? existing?.km ?? null : numberOr(row.km, null),
        latitude: row.latitude === undefined || row.latitude === '' ? existing?.latitude ?? null : numberOr(row.latitude, null),
        longitude: row.longitude === undefined || row.longitude === '' ? existing?.longitude ?? null : numberOr(row.longitude, null),
        active: row.active === undefined || row.active === '' ? existing?.active ?? 1 : boolFrom(row.active),
      };
      seen.add(code);

      if (existing) {
        if (!req.body.dry_run) update('stations', existing.id, { ...fields, updated_at: nowIso() });
        updated.push({ line, code, name });
      } else {
        if (!req.body.dry_run) insert('stations', fields);
        created.push({ line, code, name });
      }
    }

    const deactivated = [];
    if (req.body.deactivate_missing) {
      for (const station of all('SELECT id, code, name FROM stations WHERE active = 1')) {
        if (seen.has(String(station.code).toUpperCase())) continue;
        if (!req.body.dry_run) update('stations', station.id, { active: 0, updated_at: nowIso() });
        deactivated.push({ code: station.code, name: station.name });
      }
    }

    if (!req.body.dry_run) {
      audit(req, {
        action: 'STATIONS_IMPORTED',
        entityType: 'stations',
        next: { created: created.length, updated: updated.length, deactivated: deactivated.length },
        remarks: `${created.length} added, ${updated.length} updated, ${deactivated.length} deactivated, ${skipped.length} skipped`,
      });
    }

    res.json({
      ok: true,
      dry_run: req.body.dry_run,
      counts: {
        created: created.length,
        updated: updated.length,
        deactivated: deactivated.length,
        skipped: skipped.length,
      },
      created,
      updated,
      deactivated,
      skipped,
      total_after: req.body.dry_run ? null : get('SELECT COUNT(*) AS n FROM stations').n,
    });
  }
);

const blankToNull = (v) => {
  const s_ = v == null ? '' : String(v).trim();
  return s_ === '' ? null : s_;
};
const numberOr = (v, fallback) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
};
const boolFrom = (v) => (['0', 'false', 'no', 'n', ''].includes(String(v).trim().toLowerCase()) ? 0 : 1);

/**
 * Minimal RFC-4180 CSV reader: quoted fields, doubled quotes inside them, CRLF or
 * LF line endings, and a UTF-8 BOM (which is what Excel writes). Enough for a
 * station list, and one less dependency than a parser library.
 */
function parseCsv(text, renameHeader = (h) => h) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const body = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (rows.length === 0) return { header: [], rows: [] };

  const header = renameHeader(
    rows[0].map((h) => h.trim().toLowerCase().replace(/[.\s]+/g, '_').replace(/_+$/, ''))
  );
  return {
    header,
    rows: rows.slice(1).map((cells) =>
      Object.fromEntries(header.map((key, index) => [key, (cells[index] ?? '').trim()]))
    ),
  };
}

/** Replaces the checklist parameters configured for one inspection item. */
router.put(
  '/items/:id/parameters',
  requireRole(ROLES.ADMIN),
  body(z.object({ parameter_ids: z.array(z.coerce.number().int().positive()) })),
  (req, res) => {
    const item = get('SELECT * FROM inspection_items WHERE id = ?', [req.params.id]);
    if (!item) throw notFound('Inspection item');
    const before = all('SELECT parameter_id FROM item_parameter_map WHERE item_id = ?', [item.id]);
    const database = getDb();
    database.transaction(() => {
      database.prepare('DELETE FROM item_parameter_map WHERE item_id = ?').run(item.id);
      const stmt = database.prepare(
        'INSERT INTO item_parameter_map (item_id, parameter_id, sort_order) VALUES (?, ?, ?)'
      );
      req.body.parameter_ids.forEach((parameterId, index) => stmt.run(item.id, parameterId, index * 10));
    })();
    audit(req, {
      action: 'ITEM_PARAMETERS_SET',
      entityType: 'inspection_items',
      entityId: item.id,
      previous: before.map((b) => b.parameter_id),
      next: req.body.parameter_ids,
    });
    res.json({
      ok: true,
      data: all(
        `SELECT p.* FROM item_parameter_map m JOIN item_parameters p ON p.id = m.parameter_id
          WHERE m.item_id = ? ORDER BY m.sort_order`,
        [item.id]
      ),
    });
  }
);

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

const userSchema = z.object({
  employee_id: z.string().trim().min(2),
  name: z.string().trim().min(2),
  designation: optionalText,
  role: z.enum(['admin', 'divisional_officer', 'inspector', 'supervisor', 'viewer']),
  email: z.string().email().optional(),
  mobile: z.string().trim().min(6).optional(),
  password: z.string().min(8).optional(),
  department_id: optionalId,
  division_id: optionalId,
  zone_id: optionalId,
  station_id: optionalId,
  active: optionalBool,
});

router.get(
  '/users',
  requireRole(ROLES.ADMIN, ROLES.OFFICER),
  query(z.object({ q: optionalText, role: optionalText, limit: z.coerce.number().int().min(1).max(500).default(200) })),
  (req, res) => {
    const where = ['1=1'];
    const params = [];
    if (req.validQuery.q) {
      where.push('(lower(u.name) LIKE ? OR lower(u.employee_id) LIKE ?)');
      params.push(`%${req.validQuery.q.toLowerCase()}%`, `%${req.validQuery.q.toLowerCase()}%`);
    }
    if (req.validQuery.role) {
      where.push('u.role = ?');
      params.push(req.validQuery.role);
    }
    res.json({
      data: all(
        `SELECT u.id, u.employee_id, u.name, u.designation, u.role, u.email, u.mobile,
                u.active, u.last_login_at, u.created_at, u.must_change_password,
                d.name AS department_name, dv.name AS division_name, s.name AS station_name,
                (SELECT COUNT(*) FROM supervisors sup WHERE sup.user_id = u.id) AS supervisor_records
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
           LEFT JOIN divisions dv ON dv.id = u.division_id
           LEFT JOIN stations s ON s.id = u.station_id
          WHERE ${where.join(' AND ')}
          ORDER BY u.name LIMIT ?`,
        [...params, req.validQuery.limit]
      ),
    });
  }
);

router.post('/users', requireRole(ROLES.ADMIN), body(userSchema), (req, res) => {
  const { password, ...rest } = req.body;
  const generated = password ?? `Rail@${Math.floor(100000 + Math.random() * 899999)}`;
  const id = insert('users', {
    ...rest,
    active: rest.active === undefined ? 1 : rest.active,
    password_hash: hashPassword(generated),
    must_change_password: 1,
  });
  const created = get('SELECT * FROM users WHERE id = ?', [id]);
  audit(req, {
    action: 'USER_CREATE',
    entityType: 'user',
    entityId: id,
    next: { ...rest, password: '***' },
  });
  res.status(201).json({
    ...publicUser(created),
    ...(password ? {} : { temporary_password: generated }),
  });
});

router.patch(
  '/users/:id',
  requireRole(ROLES.ADMIN),
  body(userSchema.partial().omit({ password: true })),
  (req, res) => {
    const before = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!before) throw notFound('User');
    if (before.role === 'admin' && req.body.active === false) {
      const admins = get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n;
      if (admins <= 1) throw badRequest('At least one active administrator must remain');
    }
    update('users', before.id, { ...req.body, updated_at: nowIso() });
    const after = get('SELECT * FROM users WHERE id = ?', [before.id]);
    audit(req, {
      action: 'USER_UPDATE',
      entityType: 'user',
      entityId: before.id,
      previous: publicUser(before),
      next: publicUser(after),
    });
    res.json(publicUser(after));
  }
);

router.post('/users/:id/reset-password', requireRole(ROLES.ADMIN), (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) throw notFound('User');
  const generated = `Rail@${Math.floor(100000 + Math.random() * 899999)}`;
  update('users', user.id, {
    password_hash: hashPassword(generated),
    must_change_password: 1,
    failed_logins: 0,
    locked_until: null,
    updated_at: nowIso(),
  });
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), user.id]);
  audit(req, { action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: user.id });
  res.json({ ok: true, temporary_password: generated });
});

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

router.get('/settings', requireRole(ROLES.ADMIN, ROLES.OFFICER), (_req, res) => {
  res.json({ data: all('SELECT * FROM settings ORDER BY category, key') });
});

router.put(
  '/settings',
  requireRole(ROLES.ADMIN),
  body(z.object({ values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) })),
  (req, res) => {
    const changed = [];
    for (const [key, value] of Object.entries(req.body.values)) {
      const before = get('SELECT * FROM settings WHERE key = ?', [key]);
      const stored = value === null ? null : String(value);
      if (before) {
        run('UPDATE settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?', [
          stored, nowIso(), req.user.id, key,
        ]);
      } else {
        insert('settings', { key, value: stored, updated_at: nowIso(), updated_by: req.user.id });
      }
      changed.push({ key, from: before?.value ?? null, to: stored });
    }
    audit(req, { action: 'SETTINGS_UPDATE', entityType: 'settings', next: changed });
    res.json({ ok: true, data: all('SELECT * FROM settings ORDER BY category, key') });
  }
);

/* -------------------------------------------------------------------------- */
/* Audit trail, scheduler, health                                             */
/* -------------------------------------------------------------------------- */

router.get(
  '/audit',
  requireRole(ROLES.ADMIN, ROLES.OFFICER),
  query(
    z.object({
      entity_type: optionalText,
      entity_id: optionalText,
      user_id: optionalId,
      action: optionalText,
      q: optionalText,
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(200).default(50),
    })
  ),
  (req, res) => {
    const f = req.validQuery;
    const where = ['1=1'];
    const params = [];
    for (const [col, val] of [
      ['entity_type', f.entity_type],
      ['entity_id', f.entity_id],
      ['user_id', f.user_id],
      ['action', f.action],
    ]) {
      if (val !== undefined) {
        where.push(`a.${col} = ?`);
        params.push(val);
      }
    }
    if (f.q) {
      where.push('(lower(a.user_name) LIKE ? OR lower(a.action) LIKE ? OR lower(COALESCE(a.remarks,\'\')) LIKE ?)');
      const like = `%${f.q.toLowerCase()}%`;
      params.push(like, like, like);
    }
    const total = get(`SELECT COUNT(*) AS n FROM audit_log a WHERE ${where.join(' AND ')}`, params).n;
    res.json({
      data: all(
        `SELECT a.* FROM audit_log a WHERE ${where.join(' AND ')}
          ORDER BY a.id DESC LIMIT ? OFFSET ?`,
        [...params, f.page_size, (f.page - 1) * f.page_size]
      ).map((row) => ({
        ...row,
        previous_value: safeJson(row.previous_value),
        new_value: safeJson(row.new_value),
      })),
      page: f.page,
      page_size: f.page_size,
      total,
      total_pages: Math.max(1, Math.ceil(total / f.page_size)),
      actions: all('SELECT DISTINCT action FROM audit_log ORDER BY action').map((a) => a.action),
    });
  }
);

const safeJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Runs the TDC reminder + escalation sweep on demand. */
router.post(
  '/scheduler/run',
  requireRole(ROLES.ADMIN),
  body(z.object({ as_of: optionalText, dry_run: optionalBool.default(false) })),
  asyncRoute(async (req, res) => {
    const summary = await runReminderSweep({
      asOf: req.body.as_of ?? undefined,
      dryRun: req.body.dry_run,
    });
    audit(req, { action: 'SCHEDULER_RUN', entityType: 'scheduler', next: summary });
    res.json(summary);
  })
);

router.get('/stats', requireRole(ROLES.ADMIN, ROLES.OFFICER), (_req, res) => {
  const tables = [
    'users', 'stations', 'trains', 'units', 'supervisors', 'inspection_items',
    'inspections', 'observations', 'compliances', 'attachments', 'notifications',
    'notification_deliveries', 'audit_log', 'observation_events',
  ];
  res.json({
    environment: config.env,
    scheduler: { enabled: config.scheduler.enabled, cron: config.scheduler.cron, timezone: config.scheduler.timezone },
    notifications: {
      email_enabled: config.notifications.emailEnabled,
      sms_enabled: config.notifications.smsEnabled,
    },
    session_timeout_minutes: config.jwt.accessTtlMinutes,
    counts: Object.fromEntries(tables.map((t) => [t, get(`SELECT COUNT(*) AS n FROM ${t}`).n])),
    delivery_status: all(
      'SELECT channel, status, COUNT(*) AS n FROM notification_deliveries GROUP BY channel, status'
    ),
    database_file: config.dbFile,
  });
});

/** Point-in-time backup of the SQLite database (admin only). */
router.post('/backup', requireRole(ROLES.ADMIN), asyncRoute(async (req, res) => {
  const fileName = `backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sqlite`;
  const target = `${config.dataDir}/${fileName}`;
  await getDb().backup(target);
  audit(req, { action: 'DATABASE_BACKUP', entityType: 'database', next: { file: target } });
  res.json({ ok: true, file: target, message: 'Backup written to the server data directory' });
}));

/** Impersonation is deliberately not offered; this guard documents that. */
router.post('/impersonate', (_req, _res) => {
  throw forbidden('Impersonation is not supported. Use role-based access instead.');
});

export default router;
