/**
 * Seeds master data and a demonstration dataset.
 *
 *   npm run seed --workspace server            # idempotent top-up
 *   npm run seed:reset --workspace server      # wipe and rebuild
 *
 * Master data is inserted idempotently (keyed on its natural unique column),
 * so re-running the script never duplicates rows. Demo transactions are only
 * created when the observation table is empty, or with --reset.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import config from '../config.js';
import { getDb, get, all, insert, run, update, nowIso, closeDb } from './index.js';
import { hashPassword } from '../lib/auth.js';
import { nextRef, randomToken, uuid } from '../lib/ids.js';
import { dispatch } from '../lib/notify.js';
import {
  zones, divisions, departments, stations, trains, stationUnits, trainUnits,
  extraStationUnits, modules, inspectionTypes, itemParameters, observationCategories,
  severities, tdcRules, escalationLevels, notificationRules, settings, ruleReferences,
} from './data/masters.js';
import { catalogue, parameterProfiles, profileForGroup } from './data/catalogue.js';
import {
  genericDeficiencies, moduleDeficiencies, groupDeficiencies, specificDeficiencies,
} from './data/deficiencies.js';
import { users, supervisors, reportingChain, contractors } from './data/people.js';

const RESET = process.argv.includes('--reset');
const QUIET = process.argv.includes('--quiet');
const log = (...args) => {
  if (!QUIET) console.info(...args);
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Inserts a row unless one already exists with the same unique key. */
function upsert(table, keyColumns, row) {
  const where = keyColumns.map((c) => `${c} = ?`).join(' AND ');
  const params = keyColumns.map((c) => row[c]);
  const existing = get(`SELECT * FROM ${table} WHERE ${where}`, params);
  if (existing) return existing.id ?? null;
  return insert(table, row);
}

const daysAgo = (n, hour = 10, minute = 30) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const dateOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Writes a small placeholder PNG so that photographic evidence, the photo
 * comparison view and the PDF report all have something real to show.
 */
function placeholderPng(filePath, { width = 480, height = 320, base = [11, 79, 108], band }) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const wave = Math.sin((x / width) * Math.PI * 2) * 18 + (y / height) * 40;
      const inBand = band && y > height * band[0] && y < height * band[1];
      raw[offset] = clamp((inBand ? 220 : base[0]) + wave);
      raw[offset + 1] = clamp((inBand ? 190 : base[1]) + wave);
      raw[offset + 2] = clamp((inBand ? 90 : base[2]) + wave);
      offset += 3;
    }
  }
  const chunks = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr(width, height)),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat(chunks));
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

function ihdr(width, height) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0);
  b.writeUInt32BE(height, 4);
  b[8] = 8; // bit depth
  b[9] = 2; // colour type: truecolour
  return b;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/* -------------------------------------------------------------------------- */
/* Master data                                                                */
/* -------------------------------------------------------------------------- */

function resetDatabase() {
  const db = getDb();
  const tables = [
    'reminder_log', 'notification_deliveries', 'notifications', 'report_tokens',
    'approvals', 'observation_events', 'attachments', 'compliances', 'observations',
    'inspections', 'item_parameter_map', 'inspection_items', 'item_groups',
    'supervisor_coverage', 'supervisor_stations', 'supervisor_departments',
    'inspection_note_observations', 'inspection_notes', 'item_deficiencies',
    'supervisors', 'otp_codes', 'sessions', 'audit_log',
    'contractors', 'rule_references', 'notification_rules', 'escalation_levels',
    'tdc_rules', 'settings', 'severities', 'observation_categories', 'item_parameters',
    'inspection_types', 'modules', 'units', 'trains', 'stations', 'users',
    'departments', 'divisions', 'zones',
  ];
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN (" + tables.map(() => '?').join(',') + ')').run(tables);
  })();
  db.pragma('foreign_keys = ON');
  // Clear previously generated evidence so the demo set stays consistent.
  if (fs.existsSync(config.uploadDir)) {
    for (const f of fs.readdirSync(config.uploadDir)) {
      if (f.startsWith('seed-')) fs.unlinkSync(path.join(config.uploadDir, f));
    }
  }
  log('  reset: all tables cleared');
}

function seedMasters() {
  const zoneIds = new Map();
  for (const z of zones) zoneIds.set(z.code, upsert('zones', ['code'], z));

  const divisionIds = new Map();
  for (const d of divisions) {
    divisionIds.set(
      d.code,
      upsert('divisions', ['code'], { code: d.code, name: d.name, zone_id: zoneIds.get(d.zone) })
    );
  }

  const deptIds = new Map();
  for (const d of departments) deptIds.set(d.code, upsert('departments', ['code'], d));

  const stationIds = new Map();
  for (const s of stations) {
    const { division, ...rest } = s;
    stationIds.set(
      s.code,
      upsert('stations', ['code'], {
        ...rest,
        division_id: divisionIds.get(division),
        zone_id: zoneIds.get(divisions.find((d) => d.code === division).zone),
      })
    );
  }

  const trainIds = new Map();
  for (const t of trains) trainIds.set(t.number, upsert('trains', ['number'], t));

  const unitIds = new Map();
  for (const u of stationUnits) {
    const id = upsert('units', ['name', 'applies_to', 'station_id'], {
      ...u,
      applies_to: 'station',
      station_id: null,
    });
    unitIds.set(`station|${u.name}`, id);
  }
  for (const u of trainUnits) {
    const id = upsert('units', ['name', 'applies_to', 'station_id'], {
      ...u,
      applies_to: 'train',
      station_id: null,
    });
    unitIds.set(`train|${u.name}`, id);
  }
  for (const u of extraStationUnits) {
    const { station, ...rest } = u;
    const id = upsert('units', ['name', 'applies_to', 'station_id'], {
      ...rest,
      applies_to: 'station',
      station_id: stationIds.get(station),
    });
    unitIds.set(`${station}|${u.name}`, id);
  }

  const moduleIds = new Map();
  for (const m of modules) moduleIds.set(m.code, upsert('modules', ['code'], m));

  const typeIds = new Map();
  for (const t of inspectionTypes) {
    const { module, ...rest } = t;
    typeIds.set(
      t.name,
      upsert('inspection_types', ['name'], { ...rest, module_id: module ? moduleIds.get(module) : null })
    );
  }

  const parameterIds = new Map();
  for (const p of itemParameters) parameterIds.set(p.name, upsert('item_parameters', ['name'], p));

  const categoryIds = new Map();
  observationCategories.forEach((name, index) => {
    categoryIds.set(name, upsert('observation_categories', ['name'], { name, sort_order: (index + 1) * 10 }));
  });

  const severityIds = new Map();
  for (const s of severities) severityIds.set(s.name, upsert('severities', ['name'], s));

  const ruleIds = new Map();
  for (const r of ruleReferences) ruleIds.set(r.code, upsert('rule_references', ['code'], r));

  for (const r of tdcRules) {
    const { severity, ...rest } = r;
    upsert('tdc_rules', ['name'], { ...rest, severity_id: severity ? severityIds.get(severity) : null });
  }
  for (const e of escalationLevels) upsert('escalation_levels', ['level'], e);
  for (const n of notificationRules) {
    upsert('notification_rules', ['event'], { ...n, recipients: JSON.stringify(n.recipients) });
  }
  for (const s of settings) {
    upsert('settings', ['key'], { ...s, value_type: s.value_type ?? 'string', updated_at: nowIso() });
  }

  log(
    `  masters: ${zoneIds.size} zones, ${divisionIds.size} divisions, ${deptIds.size} departments, ` +
      `${stationIds.size} stations, ${trainIds.size} trains, ${unitIds.size} units`
  );

  return { zoneIds, divisionIds, deptIds, stationIds, trainIds, unitIds, moduleIds, typeIds, parameterIds, categoryIds, severityIds, ruleIds };
}

function seedCatalogue(ref) {
  let groupCount = 0;
  let itemCount = 0;
  let mapCount = 0;
  const itemIds = new Map();
  const groupIds = new Map();

  for (const [moduleCode, groups] of Object.entries(catalogue)) {
    const moduleId = ref.moduleIds.get(moduleCode);
    groups.forEach((group, groupIndex) => {
      const groupId = upsert('item_groups', ['module_id', 'name'], {
        module_id: moduleId,
        name: group.group,
        sort_order: (groupIndex + 1) * 10,
      });
      groupIds.set(`${moduleCode}|${group.group}`, groupId);
      groupCount += 1;
      const profile = parameterProfiles[profileForGroup(moduleCode, group.group)];

      group.items.forEach((item, itemIndex) => {
        const itemId = upsert('inspection_items', ['group_id', 'name'], {
          group_id: groupId,
          module_id: moduleId,
          name: item.name,
          applies_to: item.applies ?? (moduleCode === 'PA' ? 'station' : 'both'),
          default_department_id: ref.deptIds.get(item.dept) ?? null,
          default_category_id: item.category ? ref.categoryIds.get(item.category) ?? null : null,
          default_severity_id: ref.severityIds.get(item.severity ?? 'Moderate') ?? null,
          rule_reference_id: item.rule ? ref.ruleIds.get(item.rule) ?? null : null,
          sort_order: (itemIndex + 1) * 10,
        });
        itemIds.set(`${moduleCode}|${item.name}`, itemId);
        itemCount += 1;

        for (const [index, parameterName] of profile.entries()) {
          const parameterId = ref.parameterIds.get(parameterName);
          if (!parameterId) continue;
          const exists = get('SELECT 1 FROM item_parameter_map WHERE item_id = ? AND parameter_id = ?', [
            itemId,
            parameterId,
          ]);
          if (!exists) {
            insert('item_parameter_map', { item_id: itemId, parameter_id: parameterId, sort_order: index * 10 });
            mapCount += 1;
          }
        }
      });
    });
  }

  // Link a few items to the instruction library so rule linking is visible.
  const links = [
    ['PA|Drinking Water', 'RB-CML-2023-01'],
    ['PA|Water Cooler', 'RB-CML-2023-01'],
    ['PA|Cleanliness', 'RB-CLN-2023-09'],
    ['PA|Accessible Toilet', 'RB-DIV-2022-04'],
    ['PA|Divyangjan Toilet', 'RB-DIV-2022-04'],
    ['CI|Rate List', 'RB-CTG-2022-07'],
    ['CI|Licence', 'RB-CTG-2022-07'],
    ['CI|FSSAI compliance', 'RB-CTG-2022-07'],
    ['CI|Parcel Booking', 'IRCA-CM-22'],
    ['SR|Crowd management', 'RB-SAF-2021-03'],
    ['SR|Unauthorised vending near coach doors', 'WCR-CML-2024-11'],
    ['SR|Unauthorised vendors', 'WCR-CML-2024-11'],
  ];
  for (const [itemKey, ruleCode] of links) {
    const itemId = itemIds.get(itemKey);
    const ruleId = ref.ruleIds.get(ruleCode);
    if (itemId && ruleId) update('inspection_items', itemId, { rule_reference_id: ruleId });
  }

  log(`  catalogue: ${groupCount} groups, ${itemCount} inspection items, ${mapCount} parameter mappings`);
  return { itemIds, groupIds };
}

/**
 * Suggested deficiencies - the dropdown of common failures under the observation
 * box. A suggestion is scoped to one item, to a group, to a module, or to
 * everything; the narrowest scope is offered first.
 */
function seedDeficiencies(ref, itemIds, groupIds) {
  let count = 0;
  const add = (scope, row) => {
    const exists = get(
      `SELECT 1 FROM item_deficiencies
        WHERE text = ? AND IFNULL(item_id,0) = IFNULL(?,0)
          AND IFNULL(group_id,0) = IFNULL(?,0) AND IFNULL(module_id,0) = IFNULL(?,0)`,
      [row.text, scope.item_id ?? null, scope.group_id ?? null, scope.module_id ?? null]
    );
    if (exists) return;
    insert('item_deficiencies', {
      item_id: scope.item_id ?? null,
      group_id: scope.group_id ?? null,
      module_id: scope.module_id ?? null,
      text: row.text,
      default_department_id: row.dept ? ref.deptIds.get(row.dept) ?? null : null,
      default_severity_id: row.severity ? ref.severityIds.get(row.severity) ?? null : null,
      default_category_id: row.category ? ref.categoryIds.get(row.category) ?? null : null,
      suggested_tdc_days: row.tdc ?? null,
      sort_order: row.sort_order ?? 100,
      active: 1,
    });
    count += 1;
  };

  genericDeficiencies.forEach((d) => add({}, d));
  moduleDeficiencies.forEach((d) => add({ module_id: ref.moduleIds.get(d.module) ?? null }, d));
  for (const block of groupDeficiencies) {
    const groupId = groupIds.get(`${block.module}|${block.group}`);
    if (!groupId) {
      log(`  ! deficiency group not found: ${block.module} / ${block.group}`);
      continue;
    }
    block.items.forEach((d, index) => add({ group_id: groupId }, { ...d, sort_order: (index + 1) * 10 }));
  }
  for (const block of specificDeficiencies) {
    const itemId = itemIds.get(`${block.module}|${block.item}`);
    if (!itemId) {
      log(`  ! deficiency item not found: ${block.module} / ${block.item}`);
      continue;
    }
    block.items.forEach((d, index) => add({ item_id: itemId }, { ...d, sort_order: (index + 1) * 10 }));
  }

  log(`  deficiency suggestions: ${count} added`);
  return count;
}

function seedPeople(ref) {
  const password = hashPassword(config.seed.defaultPassword);
  const userIds = new Map();

  for (const u of users) {
    const id = upsert('users', ['employee_id'], {
      employee_id: u.employee_id,
      name: u.name,
      designation: u.designation,
      role: u.role,
      email: u.email ?? null,
      mobile: u.mobile ?? null,
      password_hash: password,
      department_id: ref.deptIds.get(u.department) ?? null,
      division_id: ref.divisionIds.get(u.division) ?? null,
      zone_id: ref.zoneIds.get(u.zone) ?? null,
      station_id: u.station ? ref.stationIds.get(u.station) : null,
      active: 1,
    });
    userIds.set(u.employee_id, id);
  }

  const supervisorIds = new Map();
  for (const s of supervisors) {
    let userId = null;
    if (s.user) {
      userId = upsert('users', ['employee_id'], {
        employee_id: s.user.employee_id,
        name: s.name,
        designation: s.designation,
        role: s.user.role ?? 'supervisor',
        email: s.email ?? null,
        mobile: s.mobile ?? null,
        password_hash: password,
        department_id: ref.deptIds.get(s.department) ?? null,
        division_id: ref.divisionIds.get('JBP') ?? null,
        zone_id: ref.zoneIds.get('WCR') ?? null,
        station_id: s.station ? ref.stationIds.get(s.station) : null,
        active: 1,
      });
      userIds.set(s.user.employee_id, userId);
    }
    const id = upsert('supervisors', ['employee_id'], {
      employee_id: s.employee_id,
      name: s.name,
      designation: s.designation,
      department_id: ref.deptIds.get(s.department),
      sub_department: s.sub_department ?? null,
      station_id: s.station ? ref.stationIds.get(s.station) : null,
      section: s.section ?? null,
      area_of_responsibility: s.area_of_responsibility ?? null,
      mobile: s.mobile ?? null,
      email: s.email ?? null,
      user_id: userId,
      is_default_for_department: s.is_default_for_department ?? 0,
      active: 1,
    });
    supervisorIds.set(s.employee_id, id);
  }

  // Reporting chain, then coverage (both need every supervisor to exist first).
  for (const [child, parent] of Object.entries(reportingChain)) {
    const childId = supervisorIds.get(child);
    const parentId = supervisorIds.get(parent);
    if (childId && parentId) update('supervisors', childId, { reporting_officer_id: parentId });
  }

  let coverageCount = 0;
  for (const s of supervisors) {
    for (const c of s.coverage ?? []) {
      const row = {
        supervisor_id: supervisorIds.get(s.employee_id),
        station_id: c.station ? ref.stationIds.get(c.station) ?? null : null,
        unit_id: c.unit ? ref.unitIds.get(`station|${c.unit}`) ?? null : null,
        unit_kind: c.unit_kind ?? null,
        item_group_id: null,
        priority: c.priority ?? 100,
        active: 1,
      };
      const exists = get(
        `SELECT 1 FROM supervisor_coverage
          WHERE supervisor_id = ? AND IFNULL(station_id,0) = IFNULL(?,0)
            AND IFNULL(unit_id,0) = IFNULL(?,0) AND IFNULL(unit_kind,'') = IFNULL(?,'')`,
        [row.supervisor_id, row.station_id, row.unit_id, row.unit_kind]
      );
      if (!exists) {
        insert('supervisor_coverage', row);
        coverageCount += 1;
      }
    }
  }

  // Station and department links. The primary posting is stored as a link too
  // (is_primary = 1) so that one query answers "who covers this station?".
  let linkCount = 0;
  const link = (table, keyColumn, row) => {
    const exists = get(
      `SELECT 1 FROM ${table} WHERE supervisor_id = ? AND ${keyColumn} = ?`,
      [row.supervisor_id, row[keyColumn]]
    );
    if (!exists) {
      insert(table, row);
      linkCount += 1;
    }
  };
  for (const s of supervisors) {
    const supervisorId = supervisorIds.get(s.employee_id);
    if (!supervisorId) continue;

    const primaryStation = s.station ? ref.stationIds.get(s.station) : null;
    if (primaryStation) {
      link('supervisor_stations', 'station_id', {
        supervisor_id: supervisorId,
        station_id: primaryStation,
        is_primary: 1,
        section: s.section ?? null,
        priority: 10,
        active: 1,
      });
    }
    for (const code of s.stations ?? []) {
      const stationId = ref.stationIds.get(code);
      if (!stationId || stationId === primaryStation) continue;
      link('supervisor_stations', 'station_id', {
        supervisor_id: supervisorId,
        station_id: stationId,
        is_primary: 0,
        section: s.section ?? null,
        priority: 50,
        active: 1,
      });
    }

    const primaryDepartment = ref.deptIds.get(s.department);
    if (primaryDepartment) {
      link('supervisor_departments', 'department_id', {
        supervisor_id: supervisorId,
        department_id: primaryDepartment,
        is_primary: 1,
        priority: 10,
        active: 1,
      });
    }
    for (const code of s.departments ?? []) {
      const departmentId = ref.deptIds.get(code);
      if (!departmentId || departmentId === primaryDepartment) continue;
      link('supervisor_departments', 'department_id', {
        supervisor_id: supervisorId,
        department_id: departmentId,
        is_primary: 0,
        priority: 50,
        active: 1,
      });
    }
  }

  for (const c of contractors) {
    const { station, department, ...rest } = c;
    upsert('contractors', ['name', 'contract_ref'], {
      ...rest,
      station_id: station ? ref.stationIds.get(station) ?? null : null,
      department_id: department ? ref.deptIds.get(department) ?? null : null,
    });
  }

  log(
    `  people: ${userIds.size} user accounts, ${supervisorIds.size} supervisors, ` +
      `${linkCount} station/department links, ${coverageCount} coverage mappings, ` +
      `${contractors.length} contractors/licensees`
  );
  return { userIds, supervisorIds };
}

/* -------------------------------------------------------------------------- */
/* Demonstration transactions                                                 */
/*                                                                            */
/* The dataset below exercises every state of the workflow: newly assigned,    */
/* acknowledged, action in progress, compliance submitted and awaiting         */
/* verification, rejected and reopened, closed after verification, overdue     */
/* and escalated, cancelled, with and without a TDC, at stations and on        */
/* trains, across all three inspection modules.                               */
/* -------------------------------------------------------------------------- */

/**
 * The reference scenario from the specification: Jabalpur, Platform No. 2,
 * Drinking Water, "Water cooler is not functioning", Action By Electrical,
 * supervisor identified automatically, TDC four days out, photograph attached.
 */
const demoInspections = [
  {
    module: 'PA',
    type: 'Passenger Amenities Inspection',
    location_type: 'Station',
    station: 'JBP',
    inspector: 'CMI01',
    days_ago: 0,
    status: 'in_progress',
    title: 'Passenger amenities inspection - Jabalpur',
    observations: [
      {
        unit: 'Platform No. 2',
        item: 'Drinking Water',
        text: 'Water cooler is not functioning. Passengers on Platform No. 2 are without cold drinking water since morning.',
        deficiency: 'Drinking water not available at this location',
        dept: 'ELEC',
        severity: 'Major',
        category: 'Passenger Amenity',
        tdc: dateOffset(4),
        parameters: ['Not functional', 'Requires repair'],
        photos: 2,
        flow: 'assigned',
        flagship: true,
      },
      {
        unit: 'Platform No. 4',
        item: 'Toilet',
        text: 'Gents toilet on Platform No. 4 is not cleaned since last evening, foul smell and water not available in the flushing tank.',
        deficiency: 'Toilet found in unhygienic condition; cleaning not done',
        dept: 'ENGG',
        severity: 'Major',
        category: 'Cleanliness',
        tdc: dateOffset(2),
        parameters: ['Available', 'Requires repair'],
        photos: 1,
        flow: 'acknowledged',
      },
      {
        unit: 'Platform No. 1',
        item: 'Coach Guidance',
        text: 'Coach guidance display at the middle of Platform No. 1 is blank. Passengers are unable to locate coach positions for train 12189.',
        deficiency: 'Coach guidance display not working at this platform',
        dept: 'SNT',
        severity: 'Major',
        category: 'Passenger Information',
        tdc: dateOffset(3),
        photos: 1,
        flow: 'assigned',
      },
      {
        unit: 'Circulating Area',
        item: 'Dustbin',
        text: 'Two dustbins in the circulating area are broken and need replacement. No TDC fixed, to be attended during routine upkeep.',
        deficiency: 'Dustbins not provided at the prescribed interval',
        dept: 'ENGG',
        severity: 'Minor',
        category: 'Cleanliness',
        tdc: null,
        flow: 'assigned',
      },
    ],
  },
  {
    module: 'PA',
    type: 'Routine Inspection',
    location_type: 'Station',
    station: 'JBP',
    inspector: 'ACM01',
    days_ago: 34,
    status: 'completed',
    title: 'Routine amenities inspection - Jabalpur',
    observations: [
      {
        unit: 'Platform No. 2',
        item: 'Drinking Water',
        text: 'Water cooler on Platform No. 2 found not working. Cooling unit tripped.',
        deficiency: 'Drinking water not available at this location',
        dept: 'ELEC',
        severity: 'Major',
        category: 'Passenger Amenity',
        tdc_offset_from_observation: 7,
        photos: 1,
        flow: 'closed',
        compliance: {
          after_days: 4,
          action: 'Compressor relay replaced and cooling unit restored. Water temperature checked and found satisfactory.',
          remarks: 'Tested in the presence of the Station Manager.',
          photos: 1,
        },
        verify: { after_days: 5, decision: 'accept', remarks: 'Verified during follow-up round. Cooler working.' },
      },
      {
        unit: 'Waiting Hall',
        item: 'Fan',
        text: 'Two ceiling fans in the upper class waiting hall are not working.',
        deficiency: 'Fans not working at this location',
        dept: 'ELEC',
        severity: 'Moderate',
        category: 'Passenger Amenity',
        tdc_offset_from_observation: 10,
        flow: 'closed',
        compliance: {
          after_days: 6,
          action: 'Both fans repaired, capacitors replaced.',
          photos: 1,
        },
        verify: { after_days: 8, decision: 'accept' },
      },
    ],
  },
  {
    module: 'PA',
    type: 'Surprise Inspection',
    location_type: 'Platform',
    station: 'JBP',
    inspector: 'CMI01',
    days_ago: 74,
    status: 'completed',
    title: 'Surprise inspection of platform amenities - Jabalpur',
    observations: [
      {
        unit: 'Platform No. 2',
        item: 'Drinking Water',
        text: 'Water cooler at Platform No. 2 is again not functioning. Water tap adjacent to it is also leaking.',
        deficiency: 'Drinking water not available at this location',
        dept: 'ELEC',
        severity: 'Major',
        category: 'Passenger Amenity',
        tdc_offset_from_observation: 5,
        photos: 1,
        flow: 'closed_after_reject',
        compliance: {
          after_days: 3,
          action: 'Cooler switched on. Leakage informed to Engineering.',
          photos: 1,
        },
        verify: { after_days: 4, decision: 'reject', reason: 'Cooler was found switched off again on verification and the leaking tap has not been attended.' },
        compliance2: {
          after_days: 9,
          action: 'Faulty thermostat replaced and leaking tap washer changed jointly with Engineering staff.',
          remarks: 'Joint attention with SSE/Works.',
          photos: 1,
        },
        verify2: { after_days: 11, decision: 'accept', remarks: 'Rectified and verified.' },
      },
      {
        unit: 'Platform No. 6',
        item: 'Platform Shelter',
        text: 'Platform shelter sheets over the rear portion of Platform No. 6 are damaged, rain water enters the seating area.',
        deficiency: 'Shelter sheets damaged; water dripping during rain',
        dept: 'ENGG',
        severity: 'Moderate',
        category: 'Passenger Amenity',
        tdc_offset_from_observation: 30,
        flow: 'closed',
        compliance: { after_days: 22, action: 'Damaged sheets replaced over 12 metres of the shelter.', photos: 1 },
        verify: { after_days: 25, decision: 'accept' },
      },
    ],
  },
  {
    module: 'CI',
    type: 'Commercial Inspection',
    location_type: 'Station',
    station: 'JBP',
    inspector: 'ACM01',
    days_ago: 9,
    status: 'completed',
    title: 'Commercial inspection - Jabalpur',
    observations: [
      {
        unit: 'Catering Area',
        item: 'Overcharging',
        text: 'Tea stall on Platform No. 1 was charging Rs. 15 against the approved rate of Rs. 10 for a cup of tea. No rate list was displayed at the counter.',
        deficiency: 'Overcharging detected; excess amount refunded to the passenger',
        dept: 'COM',
        severity: 'Major',
        category: 'Revenue',
        tdc_offset_from_observation: 3,
        photos: 1,
        flow: 'compliance_submitted',
        compliance: {
          after_days: 2,
          action: 'Penalty of Rs. 5,000 imposed on the licensee and recovered. Approved rate list displayed at both counters. Written warning issued.',
          remarks: 'Copy of the penalty memo and photograph of the displayed rate list enclosed.',
          photos: 2,
        },
      },
      {
        unit: 'Catering Area',
        item: 'Licence Validity',
        text: 'Licence of the milk stall on Platform No. 3 expired last month. The unit is still working without a valid licence.',
        deficiency: 'Licence has expired; renewal not on record',
        dept: 'COM',
        severity: 'Major',
        category: 'Licensing',
        tdc_offset_from_observation: 4,
        flow: 'in_progress',
        overdue: true,
      },
      {
        unit: 'Booking Hall',
        item: 'Ticket Accountal',
        text: 'UTS daily cash accountal of counter no. 3 for 2 days is not reconciled with the shift closing report.',
        dept: 'COM',
        severity: 'Major',
        category: 'Revenue',
        tdc_offset_from_observation: 7,
        flow: 'acknowledged',
      },
      {
        unit: 'Parking Area',
        item: 'Parking Contract',
        text: 'Parking contractor is not issuing printed receipts to two-wheeler users and the approved rate board is not displayed at the entry gate.',
        deficiency: 'Printed receipt not issued to the vehicle owner',
        dept: 'COM',
        severity: 'Moderate',
        category: 'Contract',
        tdc_offset_from_observation: 10,
        photos: 1,
        flow: 'assigned',
      },
      {
        unit: 'Parcel Office',
        item: 'Weighment',
        text: 'Weighing machine in the parcel office has not been stamped by the Legal Metrology department for the current period.',
        dept: 'COM',
        severity: 'Moderate',
        category: 'Parcel',
        tdc_offset_from_observation: 15,
        flow: 'closed',
        compliance: { after_days: 6, action: 'Weighing machine stamped and certificate displayed in the parcel office.', photos: 1 },
        verify: { after_days: 7, decision: 'accept' },
      },
    ],
  },
  {
    module: 'SR',
    type: 'Safe Running - Commercial Inspection',
    location_type: 'Platform',
    station: 'JBP',
    inspector: 'CMI01',
    days_ago: 4,
    status: 'completed',
    title: 'Safe running (commercial) inspection - Jabalpur platforms',
    observations: [
      {
        unit: 'Platform No. 3',
        item: 'Unauthorised vending near coach doors',
        text: 'Four unauthorised vendors were selling eatables right at the coach doors of train 11265 while passengers were boarding, obstructing entry and creating a risk of passengers falling.',
        deficiency: 'Unauthorised vendors operating at the coach doors during boarding',
        dept: 'RPF',
        severity: 'Critical',
        category: 'Safe Running - Commercial',
        tdc_offset_from_observation: 1,
        photos: 2,
        flow: 'in_progress',
      },
      {
        unit: 'Platform No. 3',
        item: 'Obstruction near coach doors',
        text: 'Trolleys of the catering licensee were parked in front of coach S-4 door area during boarding time.',
        deficiency: 'Material kept near the coach door obstructing boarding',
        dept: 'COM',
        severity: 'Major',
        category: 'Safe Running - Commercial',
        tdc_offset_from_observation: 2,
        photos: 1,
        flow: 'compliance_submitted',
        compliance: {
          after_days: 1,
          action: 'Licensee instructed in writing to keep trolleys behind the yellow line. Trolley parking position marked on the platform.',
          photos: 1,
        },
      },
      {
        unit: 'Platform No. 1',
        item: 'Reservation chart/display',
        text: 'Reservation charts of train 12189 were not pasted on the coach as well as on the platform chart display board at the scheduled time.',
        dept: 'COM',
        severity: 'Major',
        category: 'Passenger Information',
        tdc_offset_from_observation: 2,
        flow: 'closed',
        compliance: {
          after_days: 1,
          action: 'Chart pasting schedule revised and the concerned commercial staff counselled. Charts now pasted 60 minutes before departure.',
        },
        verify: { after_days: 2, decision: 'accept', remarks: 'Checked on two subsequent days, charts found pasted in time.' },
      },
    ],
  },
  {
    module: 'SR',
    type: 'Train Inspection',
    location_type: 'On-Train',
    train: '12189',
    inspector: 'TI01',
    days_ago: 2,
    status: 'completed',
    title: 'On-train commercial inspection - 12189 Mahakaushal Express',
    observations: [
      {
        unit: 'Gangway',
        coach: 'S-5',
        item: 'Obstruction of gangway',
        text: 'Unbooked luggage of a vendor was kept in the gangway of coach S-5, obstructing passenger movement and emergency access.',
        deficiency: 'Gangway / emergency access obstructed by material',
        dept: 'COM',
        severity: 'Critical',
        category: 'Safe Running - Commercial',
        tdc_offset_from_observation: 1,
        photos: 1,
        flow: 'compliance_submitted',
        compliance: {
          after_days: 1,
          action: 'Luggage removed at the next stoppage and penalty realised. Escorting staff instructed to keep gangways clear.',
          photos: 1,
        },
      },
      {
        unit: 'Pantry Car',
        coach: 'PC',
        item: 'Non-compliance with commercial instructions',
        text: 'Approved rate list was not displayed in the pantry car and one staff member was without uniform and identity card.',
        deficiency: 'Commercial instructions not being followed by the staff on duty',
        dept: 'COM',
        severity: 'Major',
        category: 'Catering',
        tdc_offset_from_observation: 3,
        flow: 'acknowledged',
      },
      {
        unit: 'Coach',
        coach: 'B-2',
        item: 'Missing coach identification',
        text: 'Coach number sticker on the exterior of coach B-2 is peeled off and not legible from the platform.',
        dept: 'MECH',
        severity: 'Major',
        category: 'Train Working',
        tdc_offset_from_observation: 5,
        photos: 1,
        flow: 'assigned',
      },
    ],
  },
  {
    module: 'PA',
    type: 'Station Inspection',
    location_type: 'Station',
    station: 'KTE',
    inspector: 'CMI02',
    days_ago: 19,
    status: 'completed',
    title: 'Station inspection - Katni',
    observations: [
      {
        unit: 'Platform No. 2',
        item: 'Lighting',
        text: 'Six light fittings on the Varanasi end of Platform No. 2 are not working. The area remains dark during night train arrivals.',
        deficiency: 'Lights not working at this location',
        dept: 'ELEC',
        severity: 'Major',
        category: 'Passenger Amenity',
        tdc_offset_from_observation: 5,
        photos: 1,
        flow: 'assigned',
        overdue: true,
        escalation_level: 2,
      },
      {
        unit: 'Booking Hall',
        item: 'Queue Management',
        text: 'Queue barricading at the booking hall is damaged, passengers are crowding at the counter without a proper queue.',
        dept: 'COM',
        severity: 'Moderate',
        category: 'Passenger Service',
        tdc_offset_from_observation: 10,
        flow: 'closed',
        compliance: { after_days: 7, action: 'Queue barricades repaired and repositioned at both counters.', photos: 1 },
        verify: { after_days: 9, decision: 'accept' },
      },
      {
        unit: 'Pay & Use Toilet',
        item: 'Pay & Use Toilet',
        text: 'Pay & use toilet on Platform No. 1 is charging Rs. 5 for urinal use, which is free as per the agreement. Rate board not displayed.',
        deficiency: 'Charges collected in excess of the approved rate',
        dept: 'COM',
        severity: 'Major',
        category: 'Contract',
        tdc_offset_from_observation: 3,
        flow: 'reopened',
        compliance: {
          after_days: 2,
          action: 'Licensee verbally instructed not to charge for urinal use.',
        },
        verify: { after_days: 3, decision: 'reject', reason: 'On re-check the licensee was again charging for urinal use. Written notice and penalty required, verbal instruction is not sufficient.' },
      },
    ],
  },
  {
    module: 'CI',
    type: 'Commercial Inspection',
    location_type: 'Parcel Office',
    station: 'STA',
    inspector: 'CMI02',
    days_ago: 44,
    status: 'completed',
    title: 'Parcel office inspection - Satna',
    observations: [
      {
        unit: 'Parcel Office',
        item: 'Accountal',
        text: 'Parcel way bills of three consignments were not entered in the delivery register on the date of delivery.',
        dept: 'COM',
        severity: 'Major',
        category: 'Revenue',
        tdc_offset_from_observation: 7,
        flow: 'closed',
        compliance: {
          after_days: 5,
          action: 'All pending entries completed and the delivery clerk counselled. Daily verification by the CMI introduced.',
        },
        verify: { after_days: 6, decision: 'accept' },
      },
      {
        unit: 'Parcel Office',
        item: 'Storage',
        text: 'Parcels were stacked against the emergency exit of the parcel godown.',
        deficiency: 'Parcel stacked so as to obstruct passenger movement',
        dept: 'COM',
        severity: 'Major',
        category: 'Parcel',
        tdc_offset_from_observation: 2,
        photos: 1,
        flow: 'cancelled',
        cancel_reason: 'Duplicate of observation raised the same day by the Station Manager during the joint round.',
      },
    ],
  },
];

/** Walks one observation through the workflow states its spec asks for. */
async function createDemoObservation({ inspection, spec, ref, itemIds, ids, baseDate }) {
  const observedAt = baseDate;
  const stationId = inspection.station ? ref.stationIds.get(inspection.station) : null;
  const trainId = inspection.train ? ref.trainIds.get(inspection.train) : null;
  const unitKey = inspection.train ? `train|${spec.unit}` : `station|${spec.unit}`;
  const unitId = ref.unitIds.get(unitKey) ?? null;
  const itemId = itemIds.get(`${inspection.module}|${spec.item}`) ?? null;
  // An item named here but absent from the module's catalogue would silently
  // produce an observation with no item link, which the repeat engine and the
  // item analytics both depend on. Say so rather than seeding a half-linked row.
  if (!itemId) {
    throw new Error(
      `Demo data: inspection item "${spec.item}" does not exist in module ${inspection.module}`
    );
  }
  const supervisorId = spec.supervisor
    ? ids.supervisorIds.get(spec.supervisor)
    : resolveSupervisor({ stationId, unitId, departmentId: ref.deptIds.get(spec.dept), itemId });
  const severityId = ref.severityIds.get(spec.severity ?? 'Moderate');
  const inspectorUserId = ids.userIds.get(inspection.inspector);

  const tdc =
    spec.tdc !== undefined
      ? spec.tdc
      : spec.tdc_offset_from_observation
        ? addDaysToIso(observedAt, spec.tdc_offset_from_observation).slice(0, 10)
        : null;

  const parameters = (spec.parameters ?? []).map((name) => ({
    parameter_id: ref.parameterIds.get(name) ?? null,
    name,
    value: true,
  }));

  // The suggestion the inspector started from, then edited - which is what the
  // New Inspection screen records, and what the deficiency analytics count.
  const deficiencyId = spec.deficiency
    ? get(
        `SELECT id FROM item_deficiencies
          WHERE text = ? AND active = 1
            AND (item_id IS NULL OR item_id = ?)
            AND (group_id IS NULL OR group_id = (SELECT group_id FROM inspection_items WHERE id = ?))
          ORDER BY item_id IS NULL, group_id IS NULL LIMIT 1`,
        [spec.deficiency, itemId, itemId]
      )?.id ?? null
    : null;
  if (spec.deficiency && !deficiencyId) log(`  ! demo deficiency not matched: ${spec.deficiency}`);

  const observationId = insert('observations', {
    ref_no: nextRef('observations', 'OBS', new Date(observedAt).getFullYear()),
    inspection_id: inspection.id,
    module_id: ref.moduleIds.get(inspection.module),
    station_id: stationId,
    train_id: trainId,
    coach: spec.coach ?? null,
    unit_id: unitId,
    unit_name: spec.unit,
    item_id: itemId,
    item_name: spec.item,
    deficiency_id: deficiencyId,
    parameters: parameters.length ? JSON.stringify(parameters) : null,
    observation: spec.text,
    category_id: spec.category ? ref.categoryIds.get(spec.category) ?? null : null,
    severity_id: severityId,
    action_by_department_id: ref.deptIds.get(spec.dept),
    supervisor_id: supervisorId,
    assignment_mode: spec.supervisor ? 'manual' : 'auto',
    rule_reference_id: itemId ? get('SELECT rule_reference_id FROM inspection_items WHERE id = ?', [itemId])?.rule_reference_id ?? null : null,
    tdc,
    status: 'assigned',
    repeat_count: 0,
    escalation_level: spec.escalation_level ?? 0,
    created_by: inspectorUserId,
    observed_at: observedAt,
    assigned_at: observedAt,
    client_uuid: uuid(),
    created_at: observedAt,
  });

  const inspector = get('SELECT id, name, role FROM users WHERE id = ?', [inspectorUserId]);
  const supervisor = supervisorId ? get('SELECT * FROM supervisors WHERE id = ?', [supervisorId]) : null;
  const supervisorUser = supervisor?.user_id
    ? get('SELECT id, name, role FROM users WHERE id = ?', [supervisor.user_id])
    : null;

  event(observationId, {
    action: 'SUBMITTED',
    to: 'submitted',
    actor: inspector,
    remarks: `Observation recorded during ${inspection.ref_no}`,
    at: observedAt,
  });
  if (supervisor) {
    event(observationId, {
      action: 'ASSIGNED',
      from: 'submitted',
      to: 'assigned',
      actor: inspector,
      remarks: `Assigned to ${supervisor.name}, ${supervisor.designation}`,
      at: observedAt,
    });
  }
  auditRow({
    action: 'OBSERVATION_CREATE',
    entity: 'observation',
    entityId: observationId,
    user: inspector,
    next: { ref_no: get('SELECT ref_no FROM observations WHERE id = ?', [observationId]).ref_no, status: 'assigned' },
    at: observedAt,
  });

  for (let i = 0; i < (spec.photos ?? 0); i += 1) {
    addPhoto(observationId, null, {
      phase: 'observation',
      caption: `${spec.item} - ${spec.unit}`,
      uploadedBy: inspectorUserId,
      at: observedAt,
      tone: [11, 79, 108],
    });
  }

  await dispatchAt('OBSERVATION_ASSIGNED', observationId, observedAt, inspectorUserId);
  if (spec.severity === 'Critical') {
    await dispatchAt('CRITICAL_OBSERVATION', observationId, observedAt, inspectorUserId);
  }

  const flow = spec.flow ?? 'assigned';
  if (flow === 'assigned') return observationId;

  if (flow === 'cancelled') {
    const at = addDaysToIso(observedAt, 1);
    update('observations', observationId, { status: 'cancelled', cancel_reason: spec.cancel_reason, updated_at: at });
    const officer = get("SELECT id, name, role FROM users WHERE employee_id = 'SRDCM01'");
    event(observationId, { action: 'CANCELLED', from: 'assigned', to: 'cancelled', actor: officer, remarks: spec.cancel_reason, at });
    auditRow({ action: 'OBSERVATION_CANCEL', entity: 'observation', entityId: observationId, user: officer, next: { status: 'cancelled' }, remarks: spec.cancel_reason, at });
    return observationId;
  }

  // Acknowledge
  const ackAt = addDaysToIso(observedAt, 1, 9, 15);
  update('observations', observationId, { status: 'acknowledged', acknowledged_at: ackAt, updated_at: ackAt });
  event(observationId, {
    action: 'ACKNOWLEDGED',
    from: 'assigned',
    to: 'acknowledged',
    actor: supervisorUser ?? { name: supervisor?.name, role: 'supervisor' },
    remarks: 'Observation noted, action being taken.',
    at: ackAt,
  });
  await dispatchAt('OBSERVATION_ACKNOWLEDGED', observationId, ackAt, supervisorUser?.id);
  if (flow === 'acknowledged') return observationId;

  if (flow === 'in_progress') {
    const at = addDaysToIso(observedAt, 2, 11, 0);
    update('observations', observationId, { status: 'in_progress', updated_at: at });
    event(observationId, {
      action: 'ACTION_IN_PROGRESS',
      from: 'acknowledged',
      to: 'in_progress',
      actor: supervisorUser ?? { name: supervisor?.name, role: 'supervisor' },
      remarks: spec.progress_remarks ?? 'Action has been initiated, compliance will be submitted shortly.',
      at,
    });
    return observationId;
  }

  // Compliance round 1
  const round1 = await submitCompliance({
    observationId,
    observedAt,
    spec: spec.compliance,
    supervisor,
    supervisorUser,
    round: 1,
  });
  if (flow === 'compliance_submitted') return observationId;

  // Verification of round 1
  const verify1 = spec.verify ?? { after_days: (spec.compliance?.after_days ?? 2) + 1, decision: 'accept' };
  await verifyCompliance({
    observationId,
    complianceId: round1,
    observedAt,
    spec: verify1,
    inspector,
    supervisorId,
  });
  if (flow === 'closed' || (flow === 'reopened' && verify1.decision === 'accept')) return observationId;
  if (flow === 'reopened') return observationId;

  // Second round after rejection
  const round2 = await submitCompliance({
    observationId,
    observedAt,
    spec: spec.compliance2,
    supervisor,
    supervisorUser,
    round: 2,
  });
  await verifyCompliance({
    observationId,
    complianceId: round2,
    observedAt,
    spec: spec.verify2 ?? { after_days: (spec.compliance2?.after_days ?? 9) + 1, decision: 'accept' },
    inspector,
    supervisorId,
  });
  return observationId;
}

async function submitCompliance({ observationId, observedAt, spec, supervisor, supervisorUser, round }) {
  const at = addDaysToIso(observedAt, spec?.after_days ?? 3, 16, 20);
  const complianceId = insert('compliances', {
    observation_id: observationId,
    round,
    supervisor_id: supervisor?.id ?? null,
    submitted_by: supervisorUser?.id ?? supervisor?.user_id ?? 1,
    action_taken: spec?.action ?? 'Action taken and deficiency rectified.',
    remarks: spec?.remarks ?? null,
    compliance_date: at.slice(0, 10),
    status: 'submitted',
    submitted_at: at,
  });
  for (let i = 0; i < (spec?.photos ?? 0); i += 1) {
    addPhoto(observationId, complianceId, {
      phase: 'compliance',
      caption: 'Compliance evidence',
      uploadedBy: supervisorUser?.id ?? null,
      at,
      tone: [20, 110, 70],
      band: [0.35, 0.6],
    });
  }
  const current = get('SELECT status FROM observations WHERE id = ?', [observationId]).status;
  update('observations', observationId, {
    status: 'compliance_submitted',
    compliance_submitted_at: at,
    updated_at: at,
  });
  event(observationId, {
    action: 'COMPLIANCE_SUBMITTED',
    from: current,
    to: 'compliance_submitted',
    actor: supervisorUser ?? { name: supervisor?.name, role: 'supervisor' },
    remarks: spec?.action ?? null,
    at,
    metadata: { round },
  });
  auditRow({
    action: 'COMPLIANCE_SUBMIT',
    entity: 'observation',
    entityId: observationId,
    user: supervisorUser,
    previous: { status: current },
    next: { status: 'compliance_submitted', round },
    at,
  });
  await dispatchAt('COMPLIANCE_SUBMITTED', observationId, at, supervisorUser?.id, {
    action_taken: spec?.action ?? '',
    round,
  });
  return complianceId;
}

async function verifyCompliance({ observationId, complianceId, observedAt, spec, inspector, supervisorId }) {
  const at = addDaysToIso(observedAt, spec.after_days ?? 4, 12, 40);
  if (spec.decision === 'accept') {
    update('compliances', complianceId, {
      status: 'accepted',
      verified_by: inspector.id,
      verified_at: at,
      verification_remarks: spec.remarks ?? 'Compliance accepted.',
    });
    update('observations', observationId, {
      status: 'closed',
      verified_at: at,
      closed_at: at,
      closed_by: inspector.id,
      updated_at: at,
    });
    event(observationId, { action: 'VERIFIED', from: 'compliance_submitted', to: 'verified', actor: inspector, remarks: spec.remarks ?? 'Compliance accepted.', at });
    event(observationId, { action: 'CLOSED', from: 'verified', to: 'closed', actor: inspector, remarks: 'Observation closed after verification of compliance.', at });
    insert('approvals', {
      entity_type: 'observation',
      entity_id: observationId,
      approval_role: 'inspector',
      user_id: inspector.id,
      user_name: inspector.name,
      remarks: spec.remarks ?? null,
      signed_at: at,
    });
    auditRow({ action: 'COMPLIANCE_VERIFY', entity: 'observation', entityId: observationId, user: inspector, next: { status: 'closed', decision: 'accept' }, at });
    await dispatchAt('OBSERVATION_CLOSED', observationId, at, inspector.id);
    return;
  }
  update('compliances', complianceId, {
    status: 'rejected',
    verified_by: inspector.id,
    verified_at: at,
    rejection_reason: spec.reason,
    verification_remarks: spec.remarks ?? null,
  });
  const reopenCount = (get('SELECT reopen_count FROM observations WHERE id = ?', [observationId]).reopen_count ?? 0) + 1;
  update('observations', observationId, {
    status: 'reopened',
    reopen_count: reopenCount,
    compliance_submitted_at: null,
    updated_at: at,
  });
  event(observationId, {
    action: 'COMPLIANCE_REJECTED',
    from: 'compliance_submitted',
    to: 'reopened',
    actor: inspector,
    remarks: spec.reason,
    at,
  });
  auditRow({
    action: 'COMPLIANCE_VERIFY',
    entity: 'observation',
    entityId: observationId,
    user: inspector,
    next: { status: 'reopened', decision: 'reject' },
    remarks: spec.reason,
    at,
  });
  await dispatchAt('COMPLIANCE_REJECTED', observationId, at, inspector.id, { rejection_reason: spec.reason });
}

/* ------------------------------ small writers ----------------------------- */

function event(observationId, { action, from, to, actor, remarks, at, metadata }) {
  return insert('observation_events', {
    observation_id: observationId,
    action,
    from_status: from ?? null,
    to_status: to ?? null,
    actor_id: actor?.id ?? null,
    actor_name: actor?.name ?? 'System',
    actor_role: actor?.role ?? 'system',
    remarks: remarks ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    created_at: at,
  });
}

function auditRow({ action, entity, entityId, user, previous, next, remarks, at }) {
  return insert('audit_log', {
    user_id: user?.id ?? null,
    user_name: user?.name ?? 'system',
    role: user?.role ?? 'system',
    action,
    entity_type: entity,
    entity_id: String(entityId),
    previous_value: previous ? JSON.stringify(previous) : null,
    new_value: next ? JSON.stringify(next) : null,
    remarks: remarks ?? null,
    created_at: at,
  });
}

let photoSeq = 0;
function addPhoto(observationId, complianceId, { phase, caption, uploadedBy, at, tone, band }) {
  photoSeq += 1;
  const storedName = `seed-${String(photoSeq).padStart(4, '0')}.png`;
  placeholderPng(path.join(config.uploadDir, storedName), { base: tone, band });
  return insert('attachments', {
    observation_id: observationId,
    compliance_id: complianceId,
    kind: 'photo',
    phase,
    file_name: `${phase}-${photoSeq}.png`,
    stored_name: storedName,
    mime_type: 'image/png',
    size_bytes: fs.statSync(path.join(config.uploadDir, storedName)).size,
    caption,
    uploaded_by: uploadedBy,
    created_at: at,
  });
}

/**
 * Sends a real notification through the dispatcher and then backdates the rows
 * so the notification history reads like the workflow actually happened.
 */
async function dispatchAt(event_, observationId, at, actorId, extraVars = {}) {
  const before = get('SELECT IFNULL(MAX(id),0) AS id FROM notifications').id;
  const observation = get('SELECT * FROM v_observations o WHERE o.id = ?', [observationId]);
  await dispatch({ event: event_, observation, actorId, extraVars }).catch(() => {});
  run('UPDATE notifications SET created_at = ? WHERE id > ?', [at, before]);
  run(
    `UPDATE notification_deliveries SET created_at = ?, sent_at = CASE WHEN status = 'sent' THEN ? ELSE NULL END
      WHERE notification_id > ?`,
    [at, at, before]
  );
}

function addDaysToIso(iso, days, hour, minute) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  if (hour !== undefined) d.setHours(hour, minute ?? 0, 0, 0);
  return d.toISOString();
}

/** Mirrors the production assignment engine for seeded rows. */
function resolveSupervisor({ stationId, unitId, departmentId, itemId }) {
  const candidates = all(
    `SELECT s.id, s.station_id, s.is_default_for_department,
            (SELECT MIN(c.priority) FROM supervisor_coverage c
              WHERE c.supervisor_id = s.id AND c.active = 1
                AND (c.station_id IS NULL OR c.station_id = ?)
                AND (c.unit_id IS NULL OR c.unit_id = ?)) AS coverage_priority
       FROM supervisors s
      WHERE s.active = 1 AND s.department_id = ?`,
    [stationId, unitId, departmentId]
  );
  if (candidates.length === 0) return null;
  const scored = candidates.map((c) => ({
    id: c.id,
    score:
      (c.coverage_priority ?? 500) +
      (c.station_id === stationId ? 0 : 200) +
      (c.is_default_for_department ? -10 : 0),
  }));
  scored.sort((a, b) => a.score - b.score);
  return scored[0].id;
}

async function seedDemo(ref, itemIds, ids) {
  let observationCount = 0;
  for (const spec of demoInspections) {
    const baseDate = daysAgo(spec.days_ago, 10, 15);
    const inspectionId = insert('inspections', {
      ref_no: nextRef('inspections', 'INSP', new Date(baseDate).getFullYear()),
      module_id: ref.moduleIds.get(spec.module),
      inspection_type_id: ref.typeIds.get(spec.type),
      location_type: spec.location_type,
      station_id: spec.station ? ref.stationIds.get(spec.station) : null,
      train_id: spec.train ? ref.trainIds.get(spec.train) : null,
      title: spec.title,
      inspector_id: ids.userIds.get(spec.inspector),
      planned_date: baseDate.slice(0, 10),
      started_at: baseDate,
      status: spec.status,
      completed_at: spec.status === 'completed' ? addDaysToIso(baseDate, 0, 13, 45) : null,
      qr_token: randomToken(10),
      client_uuid: uuid(),
      created_at: baseDate,
    });
    const inspection = { ...spec, id: inspectionId, ref_no: get('SELECT ref_no FROM inspections WHERE id = ?', [inspectionId]).ref_no };
    auditRow({
      action: 'INSPECTION_CREATE',
      entity: 'inspection',
      entityId: inspectionId,
      user: get('SELECT id, name, role FROM users WHERE id = ?', [ids.userIds.get(spec.inspector)]),
      next: { ref_no: inspection.ref_no, module: spec.module },
      at: baseDate,
    });

    for (const observation of spec.observations) {
      await createDemoObservation({ inspection, spec: observation, ref, itemIds, ids, baseDate });
      observationCount += 1;
    }

    if (spec.status === 'completed') {
      const { buildAutoSummary } = await import('../routes/inspections.js');
      const auto = buildAutoSummary(inspectionId);
      update('inspections', inspectionId, { summary: auto?.text ?? null, auto_summary: auto?.text ?? null });
      insert('approvals', {
        entity_type: 'inspection',
        entity_id: inspectionId,
        approval_role: 'inspector',
        user_id: ids.userIds.get(spec.inspector),
        user_name: get('SELECT name FROM users WHERE id = ?', [ids.userIds.get(spec.inspector)]).name,
        remarks: 'Inspection completed and observations advised to the concerned departments.',
        signed_at: addDaysToIso(baseDate, 0, 13, 45),
      });
    }
  }

  // Recompute repeated-deficiency counters exactly as the live engine does.
  const { findRepeats } = await import('../lib/repeats.js');
  let repeatFlagged = 0;
  for (const o of all('SELECT * FROM observations ORDER BY observed_at')) {
    const repeats = findRepeats({
      stationId: o.station_id,
      trainId: o.train_id,
      unitId: o.unit_id,
      unitName: o.unit_name,
      itemId: o.item_id,
      itemName: o.item_name,
      categoryId: o.category_id,
      observation: o.observation,
      excludeObservationId: o.id,
      windowDays: 90,
    });
    const earlier = repeats.matches.filter((m) => m.observed_at < o.observed_at);
    if (earlier.length) {
      update('observations', o.id, { repeat_count: earlier.length, repeat_of_id: earlier[0].id });
      repeatFlagged += 1;
    }
  }

  log(`  demo: ${demoInspections.length} inspections, ${observationCount} observations, ${repeatFlagged} flagged as repeated`);
  await seedNotes(ids);
}

/**
 * One issued inspection note, so the letter format is visible without anyone
 * having to compile one first. It is built through the same code the application
 * uses, so it cannot drift from what the screen produces.
 */
async function seedNotes(ids) {
  const { createNote } = await import('../lib/notes.js');
  const completed = get(
    `SELECT i.* FROM inspections i
      WHERE i.status = 'completed'
        AND (SELECT COUNT(*) FROM observations o WHERE o.inspection_id = i.id) > 1
      ORDER BY i.completed_at DESC LIMIT 1`
  );
  if (!completed) return;
  const inspector = get('SELECT * FROM users WHERE id = ?', [completed.inspector_id]);
  const note = createNote({
    payload: { inspection_id: completed.id, letter_date: String(completed.completed_at).slice(0, 10), status: 'issued' },
    user: inspector,
  });
  update('inspection_notes', note.id, { created_at: completed.completed_at, issued_at: completed.completed_at });
  log(`  inspection note: ${note.note_no} (${note.observations.length} items)`);
}

/** Runs the TDC sweep so reminders, overdue notices and escalations exist. */
async function seedReminders() {
  const { runReminderSweep } = await import('../lib/scheduler.js');
  const summary = await runReminderSweep();
  log(
    `  reminders: ${summary.before_due} pre-due, ${summary.on_due} due today, ` +
      `${summary.overdue} overdue, ${summary.escalated} escalated`
  );
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

async function main() {
  getDb();
  log('\n  Seeding the Railway Inspection & Compliance Management System');
  if (RESET) resetDatabase();

  const ref = seedMasters();
  const { itemIds, groupIds } = seedCatalogue(ref);
  seedDeficiencies(ref, itemIds, groupIds);
  const ids = seedPeople(ref);

  const existingObservations = get('SELECT COUNT(*) AS n FROM observations').n;
  if (existingObservations === 0) {
    await seedDemo(ref, itemIds, ids);
    await seedReminders();
  } else {
    log(`  demo: skipped (${existingObservations} observations already present - use --reset to rebuild)`);
  }

  const counts = get(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM supervisors) AS supervisors,
            (SELECT COUNT(*) FROM stations) AS stations,
            (SELECT COUNT(*) FROM inspection_items) AS items,
            (SELECT COUNT(*) FROM inspections) AS inspections,
            (SELECT COUNT(*) FROM observations) AS observations,
            (SELECT COUNT(*) FROM compliances) AS compliances,
            (SELECT COUNT(*) FROM notifications) AS notifications,
            (SELECT COUNT(*) FROM attachments) AS attachments`
  );
  log('\n  Ready.');
  log(`  ${counts.users} users | ${counts.supervisors} supervisors | ${counts.stations} stations | ${counts.items} inspection items`);
  log(`  ${counts.inspections} inspections | ${counts.observations} observations | ${counts.compliances} compliance records`);
  log(`  ${counts.notifications} notifications | ${counts.attachments} evidence files`);
  log(`\n  Sign in with employee ID and password "${config.seed.defaultPassword}":`);
  for (const u of all(
    `SELECT employee_id, name, role, designation FROM users
      WHERE role IN ('admin','divisional_officer','inspector','supervisor','viewer')
      ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'divisional_officer' THEN 2
                         WHEN 'inspector' THEN 3 WHEN 'supervisor' THEN 4 ELSE 5 END, employee_id
      LIMIT 8`
  )) {
    log(`    ${u.employee_id.padEnd(10)} ${u.role.padEnd(19)} ${u.name} (${u.designation ?? '-'})`);
  }
  log('');
  closeDb();
}

main().catch((err) => {
  console.error('\n  Seeding failed:', err);
  process.exitCode = 1;
  closeDb();
});
