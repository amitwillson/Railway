import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import config from '../config.js';

const SCHEMA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

/** Where the view definitions start in schema.sql. */
const VIEWS_MARKER = 'DROP VIEW IF EXISTS v_observations';

let db;

/** Opens (and on first call, creates + migrates) the SQLite database. */
export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });

  db = new Database(config.dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

/**
 * Columns added to tables that already existed in an earlier version. CREATE
 * TABLE IF NOT EXISTS leaves an existing table alone, so a new column has to be
 * added explicitly for a database that is being upgraded in place.
 */
const ADDED_COLUMNS = [
  { table: 'observations', column: 'deficiency_id', definition: 'INTEGER REFERENCES item_deficiencies(id)' },
  { table: 'observations', column: 'inspection_area_id', definition: 'INTEGER REFERENCES inspection_areas(id)' },
  // The inspection became the unit of record: one visit over many areas.
  { table: 'inspections', column: 'inspection_no', definition: 'TEXT' },
  {
    table: 'inspections',
    column: 'scope',
    definition: "TEXT NOT NULL DEFAULT 'station'",
    // Every existing row would otherwise read as a station inspection, and a
    // train inspection would be offered the platforms. What the row already says
    // about where it happened decides it.
    backfill: `UPDATE inspections SET scope =
                 CASE WHEN train_id IS NOT NULL THEN 'train'
                      WHEN station_id IS NULL AND section IS NOT NULL THEN 'section'
                      ELSE 'station' END`,
  },
  { table: 'inspections', column: 'from_time', definition: 'TEXT' },
  { table: 'inspections', column: 'to_time', definition: 'TEXT' },
  { table: 'inspections', column: 'previous_inspection_id', definition: 'INTEGER REFERENCES inspections(id)' },
  { table: 'inspections', column: 'report_status', definition: "TEXT NOT NULL DEFAULT 'draft'" },
  { table: 'inspections', column: 'report_issued_at', definition: 'TEXT' },
  { table: 'inspections', column: 'report_issued_by', definition: 'INTEGER REFERENCES users(id)' },
  { table: 'inspections', column: 'general_remarks', definition: 'TEXT' },
  { table: 'item_groups', column: 'applies_to_kinds', definition: 'TEXT' },
  { table: 'stations', column: 'section', definition: 'TEXT' },
  { table: 'stations', column: 'state', definition: 'TEXT' },
  { table: 'stations', column: 'district', definition: 'TEXT' },
  { table: 'stations', column: 'route', definition: 'TEXT' },
  { table: 'stations', column: 'km', definition: 'REAL' },
];

/**
 * Applies schema.sql. It is written to be idempotent (CREATE ... IF NOT EXISTS).
 *
 * The order matters for a database being upgraded in place. CREATE TABLE IF NOT
 * EXISTS leaves an existing table alone, so on such a database a new column only
 * arrives through the ALTER statements - while the indexes and the views in the
 * file both name those columns. So the ALTERs run first: on a fresh database the
 * table does not exist yet, the `existing.length` guard skips them, and the
 * CREATE TABLE that follows declares every column anyway.
 */
export function migrate(database = getDb()) {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const viewsAt = sql.indexOf(VIEWS_MARKER);
  const tables = viewsAt >= 0 ? sql.slice(0, viewsAt) : sql;
  const views = viewsAt >= 0 ? sql.slice(viewsAt) : '';

  for (const { table, column, definition, backfill } of ADDED_COLUMNS) {
    const existing = database.prepare(`PRAGMA table_info(${table})`).all();
    if (existing.length && !existing.some((c) => c.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      // A column added with a constant default needs the rows that were already
      // there put right. This runs once, when the column first appears.
      if (backfill) database.exec(backfill);
    }
  }
  database.exec(tables);
  if (views) database.exec(views);
  return database;
}

/** Closes the handle - used by tests. */
export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Small query helpers                                                        */
/* -------------------------------------------------------------------------- */

export const all = (sql, params = []) => getDb().prepare(sql).all(params);
export const get = (sql, params = []) => getDb().prepare(sql).get(params);
export const run = (sql, params = []) => getDb().prepare(sql).run(params);
export const pluck = (sql, params = []) => getDb().prepare(sql).pluck().get(params);

/** Runs `fn` inside an IMMEDIATE transaction. */
export function tx(fn) {
  const database = getDb();
  const wrapped = database.transaction(fn);
  return wrapped.immediate ? wrapped.immediate() : wrapped();
}

export const nowIso = () => new Date().toISOString();

/** Today's date in the configured operating timezone (YYYY-MM-DD). */
export function today(timeZone = config.scheduler.timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Builds `INSERT INTO table (...) VALUES (...)` from a plain object,
 * skipping undefined values. Returns the inserted row id.
 */
export function insert(table, data) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => k);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols
    .map((c) => `@${c}`)
    .join(', ')})`;
  const params = Object.fromEntries(entries.map(([k, v]) => [k, normalise(v)]));
  const info = getDb().prepare(sql).run(params);
  return Number(info.lastInsertRowid);
}

/** Builds `UPDATE table SET ... WHERE id = ?` from a plain object. */
export function update(table, id, data) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 0;
  const sql = `UPDATE ${table} SET ${entries
    .map(([k]) => `${k} = @${k}`)
    .join(', ')} WHERE id = @__id`;
  const params = Object.fromEntries(entries.map(([k, v]) => [k, normalise(v)]));
  params.__id = id;
  return getDb().prepare(sql).run(params).changes;
}

/** SQLite has no boolean type - store 0/1 and let JSON objects be stringified. */
function normalise(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

export default { getDb, migrate, closeDb, all, get, run, pluck, tx, insert, update, today, nowIso };
