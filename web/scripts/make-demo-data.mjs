/**
 * Exports the seeded database into a JSON fixture that the offline demo build
 * embeds, so the single-file HTML runs the real UI against the real data with
 * no server.
 *
 *   npm run seed:reset --workspace server
 *   node web/scripts/make-demo-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const DB_FILE = process.env.DB_FILE ?? path.join(REPO, 'server', 'data', 'railway-inspection.sqlite');
const OUT = path.join(REPO, 'web', 'src', 'demo', 'data.json');

if (!fs.existsSync(DB_FILE)) {
  console.error(`No database at ${DB_FILE}. Run "npm run seed:reset" first.`);
  process.exit(1);
}

const db = new Database(DB_FILE, { readonly: true });
const all = (sql) => db.prepare(sql).all();

const TABLES = [
  'zones', 'divisions', 'sections', 'departments', 'stations', 'station_facilities',
  'station_amenity_norms', 'trains', 'units',
  'modules', 'inspection_types', 'item_groups', 'inspection_items',
  'item_parameters', 'item_parameter_map', 'observation_categories', 'severities',
  'rule_references', 'contractors', 'tdc_rules', 'notification_rules',
  'escalation_levels', 'settings', 'supervisors', 'supervisor_coverage',
  'supervisor_stations', 'supervisor_departments', 'item_deficiencies',
  'inspections', 'observations', 'attachments', 'compliances',
  'inspection_notes', 'inspection_note_observations',
  'observation_events', 'approvals', 'notifications', 'notification_deliveries',
  'audit_log',
];

const data = {};
for (const table of TABLES) data[table] = all(`SELECT * FROM ${table}`);

// 1,412 rows of {item_id, parameter_id, sort_order} compress well as ordered
// pairs; the demo backend expands them back on load.
data.item_parameter_map = all(
  'SELECT item_id, parameter_id FROM item_parameter_map ORDER BY item_id, sort_order'
).map((r) => [r.item_id, r.parameter_id]);

// Users without their password hashes; the demo accepts the seeded password.
data.users = all(
  `SELECT id, employee_id, name, designation, role, email, mobile, department_id,
          division_id, zone_id, station_id, active, last_login_at, created_at,
          must_change_password
     FROM users`
);

/* ---------------------------------------------------------------------------
 * Evidence photographs.
 *
 * The seed writes a placeholder PNG per attachment. For the single-file build
 * they are redrawn much smaller and embedded as data URLs; every attachment is
 * mapped onto one of them by phase, so the photo grids and the photo comparison
 * view have something real to show.
 * ------------------------------------------------------------------------- */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, body) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, body])), 0);
  return Buffer.concat([len, t, body, crc]);
};

/** A small abstract "photograph" - a tinted frame with a band and a marker. */
function photo(width, height, base, band) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < height; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      const vignette = 1 - 0.25 * Math.hypot(u - 0.5, v - 0.5);
      const inBand = v > band[0] && v < band[1];
      const edge = u < 0.04 || u > 0.96 || v < 0.05 || v > 0.95;
      const tone = edge ? [235, 240, 244] : inBand ? [222, 196, 120] : base;
      const ripple = Math.sin(u * 9 + v * 4) * 9;
      raw[o] = clamp(tone[0] * vignette + ripple);
      raw[o + 1] = clamp(tone[1] * vignette + ripple);
      raw[o + 2] = clamp(tone[2] * vignette + ripple);
      o += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

data.images = {
  observation: photo(200, 134, [88, 104, 118], [0.42, 0.58]),
  observation_alt: photo(200, 134, [72, 92, 110], [0.3, 0.44]),
  compliance: photo(200, 134, [70, 112, 96], [0.5, 0.68]),
  compliance_alt: photo(200, 134, [64, 104, 92], [0.36, 0.52]),
};

data.meta = {
  generated_at: new Date().toISOString(),
  seed_password: process.env.SEED_PASSWORD ?? 'Railway@2026',
  counts: Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.info(`Demo fixture written to ${path.relative(REPO, OUT)} (${kb} KB)`);
console.info(
  Object.entries(data.meta.counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
);
