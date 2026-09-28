/**
 * In-browser data store for the offline demonstration build.
 *
 * It holds the seeded records in plain arrays and provides the few primitives
 * the demo request handlers need: lookups, reference numbers, timestamps and
 * the derived fields the server computes in its SQL views. Everything lives in
 * memory, so a reload restores the original dataset.
 */
import fixture from './data.json';

export type Row = Record<string, any>;

interface Fixture {
  [table: string]: any;
  images: Record<string, string>;
  meta: { generated_at: string; seed_password: string; counts: Record<string, number> };
}

const source = fixture as unknown as Fixture;

/** A deep copy, so a reload of the page always starts from the seeded state. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const TABLES = [
  'zones', 'divisions', 'sections', 'departments', 'stations', 'station_facilities',
  'station_amenity_norms', 'trains', 'units',
  'modules', 'inspection_types', 'item_groups', 'inspection_items',
  'item_parameters', 'observation_categories', 'severities', 'rule_references',
  'contractors', 'tdc_rules', 'notification_rules', 'escalation_levels',
  'settings', 'supervisors', 'supervisor_coverage', 'supervisor_stations',
  'supervisor_departments', 'item_deficiencies', 'users',
  'inspections', 'observations', 'attachments', 'compliances',
  'inspection_notes', 'inspection_note_observations',
  'observation_events', 'approvals', 'notifications', 'notification_deliveries',
  'audit_log',
] as const;

export type TableName = (typeof TABLES)[number] | 'item_parameter_map';

export const db: Record<string, Row[]> = {};
for (const table of TABLES) db[table] = clone(source[table] ?? []);

// The fixture stores the item/parameter mapping as ordered pairs.
db.item_parameter_map = (source.item_parameter_map as [number, number][]).map(
  ([item_id, parameter_id], index) => ({ item_id, parameter_id, sort_order: index })
);

export const images = source.images;
export const meta = source.meta;

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const table = (name: string): Row[] => db[name] ?? [];

export const byId = (name: string, id: number | string | null | undefined): Row | undefined =>
  id == null ? undefined : table(name).find((row) => row.id === Number(id));

export const where = (name: string, predicate: (row: Row) => boolean): Row[] =>
  table(name).filter(predicate);

const nextId = (name: string): number =>
  table(name).reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;

export function insert(name: string, values: Row): Row {
  const row = { id: nextId(name), ...values };
  table(name).push(row);
  return row;
}

export function update(name: string, id: number, changes: Row): Row | undefined {
  const row = byId(name, id);
  if (row) Object.assign(row, changes);
  return row;
}

export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** INSP-2026-000009 / OBS-2026-000031, continuing the seeded sequence. */
export function nextRef(name: string, prefix: string): string {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-`;
  const last = table(name)
    .map((row) => String(row.ref_no ?? ''))
    .filter((ref) => ref.startsWith(like))
    .map((ref) => Number.parseInt(ref.split('-').pop() ?? '0', 10))
    .reduce((max, n) => Math.max(max, Number.isFinite(n) ? n : 0), 0);
  return `${like}${String(last + 1).padStart(6, '0')}`;
}

export const uuid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `demo-${Math.random().toString(16).slice(2)}-${Date.now()}`);

export const dateOnly = (value?: string | null) => (value ? String(value).slice(0, 10) : null);

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${dateOnly(from)}T00:00:00Z`);
  const b = Date.parse(`${dateOnly(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Derived views - the browser equivalents of v_observations and v_inspections */
/* -------------------------------------------------------------------------- */

const OPEN_STATUSES = ['submitted', 'assigned', 'acknowledged', 'in_progress', 'rejected', 'reopened'];
const NOT_OVERDUE = ['closed', 'cancelled', 'verified', 'compliance_submitted'];

const parseParameters = (value: unknown) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return [];
  }
};

/** Joins an observation with its reference data and computes the derived fields. */
export function viewObservation(o: Row): Row {
  const module = byId('modules', o.module_id);
  const station = byId('stations', o.station_id);
  const division = station ? byId('divisions', station.division_id) : undefined;
  const zone = station ? byId('zones', station.zone_id) : undefined;
  const train = byId('trains', o.train_id);
  const severity = byId('severities', o.severity_id);
  const category = byId('observation_categories', o.category_id);
  const department = byId('departments', o.action_by_department_id);
  const supervisor = byId('supervisors', o.supervisor_id);
  const inspector = byId('users', o.created_by);
  const inspection = byId('inspections', o.inspection_id);
  const inspectionType = inspection ? byId('inspection_types', inspection.inspection_type_id) : undefined;

  const tdc = dateOnly(o.tdc);
  const daysToTdc = tdc ? daysBetween(todayIso(), tdc) : null;
  const isOverdue = Boolean(tdc && daysToTdc !== null && daysToTdc < 0 && !NOT_OVERDUE.includes(o.status));

  return {
    ...o,
    parameters: parseParameters(o.parameters),
    module_code: module?.code ?? '',
    module_name: module?.name ?? '',
    module_accent: module?.accent ?? null,
    station_name: station?.name ?? null,
    station_code: station?.code ?? null,
    station_section: station?.section ?? null,
    division_id: station?.division_id ?? null,
    division_name: division?.name ?? null,
    zone_code: zone?.code ?? null,
    train_number: train?.number ?? null,
    train_name: train?.name ?? null,
    severity_name: severity?.name ?? '',
    severity_rank: severity?.rank ?? 9,
    severity_accent: severity?.accent ?? null,
    category_name: category?.name ?? null,
    department_name: department?.name ?? '',
    department_code: department?.code ?? '',
    supervisor_name: supervisor?.name ?? null,
    supervisor_designation: supervisor?.designation ?? null,
    supervisor_mobile: supervisor?.mobile ?? null,
    supervisor_email: supervisor?.email ?? null,
    inspector_name: inspector?.name ?? '',
    inspector_designation: inspector?.designation ?? null,
    inspection_ref: inspection?.ref_no ?? '',
    inspection_type_name: inspectionType?.name ?? '',
    tdc,
    days_to_tdc: daysToTdc,
    is_overdue: isOverdue,
    is_open: !['closed', 'cancelled'].includes(o.status),
    requires_physical_verification: Boolean(o.requires_physical_verification),
    attachment_count: where('attachments', (a) => a.observation_id === o.id).length,
    location_label: station
      ? `${station.name} (${station.code})`
      : [train?.number, train?.name].filter(Boolean).join(' - ') || '-',
  };
}

export function viewInspection(i: Row): Row {
  const module = byId('modules', i.module_id);
  const type = byId('inspection_types', i.inspection_type_id);
  const station = byId('stations', i.station_id);
  const division = station ? byId('divisions', station.division_id) : undefined;
  const train = byId('trains', i.train_id);
  const inspector = byId('users', i.inspector_id);
  const observations = where('observations', (o) => o.inspection_id === i.id);
  return {
    ...i,
    module_code: module?.code ?? '',
    module_name: module?.name ?? '',
    module_accent: module?.accent ?? null,
    inspection_type_name: type?.name ?? '',
    station_name: station?.name ?? null,
    station_code: station?.code ?? null,
    station_category: station?.category ?? null,
    division_name: division?.name ?? null,
    train_number: train?.number ?? null,
    train_name: train?.name ?? null,
    inspector_name: inspector?.name ?? '',
    inspector_designation: inspector?.designation ?? null,
    observation_count: observations.length,
    open_count: observations.filter((o) => !['closed', 'cancelled'].includes(o.status)).length,
    closed_count: observations.filter((o) => o.status === 'closed').length,
    critical_count: observations.filter((o) => byId('severities', o.severity_id)?.rank === 1).length,
  };
}

export const observations = () => table('observations').map(viewObservation);
export const inspections = () => table('inspections').map(viewInspection);

export const isOpenStatus = (status: string) => OPEN_STATUSES.includes(status);

/** Strips fields the API never returns and adds the linked supervisor record. */
export function publicUser(user: Row | undefined): Row | null {
  if (!user) return null;
  const department = byId('departments', user.department_id);
  const division = byId('divisions', user.division_id);
  const station = byId('stations', user.station_id);
  const supervisor = table('supervisors').find((s) => s.user_id === user.id && s.active);
  return {
    ...user,
    active: Boolean(user.active),
    must_change_password: Boolean(user.must_change_password),
    department_name: department?.name ?? null,
    department_code: department?.code ?? null,
    division_name: division?.name ?? null,
    station_name: station?.name ?? null,
    station_code: station?.code ?? null,
    supervisor_id: supervisor?.id ?? null,
  };
}
