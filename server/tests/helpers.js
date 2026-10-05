import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Each test file gets its own throw-away database and upload directory, set up
 * before the application modules are imported so that config picks them up.
 */
export function useTempData(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ri-${name}-`));
  process.env.DATA_DIR = dir;
  process.env.DB_FILE = path.join(dir, 'test.sqlite');
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-value-for-unit-tests-only';
  process.env.SCHEDULER_ENABLED = 'false';
  process.env.EMAIL_ENABLED = 'false';
  process.env.SMS_ENABLED = 'false';
  return dir;
}

export function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** Minimal master data: just enough for the engines under test. */
export function seedMinimal(db) {
  const { insert } = db;
  const zone = insert('zones', { code: 'WCR', name: 'West Central Railway' });
  const division = insert('divisions', { code: 'JBP', name: 'Jabalpur', zone_id: zone });
  const deptElec = insert('departments', { code: 'ELEC', name: 'Electrical', sort_order: 10 });
  const deptEngg = insert('departments', { code: 'ENGG', name: 'Engineering', sort_order: 20 });
  const station = insert('stations', {
    code: 'JBP', name: 'Jabalpur', division_id: division, zone_id: zone,
    category: 'NSG-2', station_type: 'Junction', platforms: 6,
  });
  const otherStation = insert('stations', {
    code: 'KTE', name: 'Katni', division_id: division, zone_id: zone, category: 'NSG-3',
  });
  const unitPf2 = insert('units', { name: 'Platform No. 2', applies_to: 'station', kind: 'platform', sort_order: 20 });
  const unitHall = insert('units', { name: 'Booking Hall', applies_to: 'station', kind: 'booking office', sort_order: 70 });
  const module = insert('modules', { code: 'PA', name: 'Passenger Amenities', accent: 'blue', sort_order: 10 });
  const type = insert('inspection_types', { name: 'Passenger Amenities Inspection', module_id: module });
  const group = insert('item_groups', { module_id: module, name: 'Water & Sanitation', sort_order: 10 });
  const severityMajor = insert('severities', { name: 'Major', rank: 2, default_tdc_days: 7, accent: 'orange' });
  const severityCritical = insert('severities', {
    name: 'Critical', rank: 1, default_tdc_days: 1, notify_immediately: 1, escalate_immediately: 1, accent: 'red',
  });
  const category = insert('observation_categories', { name: 'Passenger Amenity', sort_order: 10 });
  const item = insert('inspection_items', {
    group_id: group, module_id: module, name: 'Drinking Water', applies_to: 'station',
    default_department_id: deptEngg, default_category_id: category, default_severity_id: severityMajor,
  });
  return {
    zone, division, deptElec, deptEngg, station, otherStation,
    unitPf2, unitHall, module, type, group, severityMajor, severityCritical, category, item,
  };
}

export function seedUsers(db, ids) {
  const { insert } = db;
  const hash = '$2a$10$abcdefghijklmnopqrstuv'; // never used for a real login in tests
  const inspector = insert('users', {
    employee_id: 'INS1', name: 'Test Inspector', role: 'inspector',
    password_hash: hash, division_id: ids.division, station_id: ids.station,
  });
  const supervisorUser = insert('users', {
    employee_id: 'SUP1', name: 'Test Supervisor', role: 'supervisor',
    password_hash: hash, department_id: ids.deptElec, station_id: ids.station,
  });
  const officerUser = insert('users', {
    employee_id: 'OFF1', name: 'Test Officer', role: 'divisional_officer',
    password_hash: hash, division_id: ids.division,
  });
  const supervisor = insert('supervisors', {
    employee_id: 'SSE-EL-1', name: 'Rajesh Meshram', designation: 'SSE/Electrical',
    department_id: ids.deptElec, station_id: ids.station, mobile: '9425100101',
    user_id: supervisorUser, is_default_for_department: 1,
    area_of_responsibility: 'Platforms and water coolers',
  });
  const otherSupervisor = insert('supervisors', {
    employee_id: 'JE-EL-2', name: 'Pooja Tiwari', designation: 'JE/Electrical',
    department_id: ids.deptElec, station_id: ids.station, mobile: '9425100102',
  });
  return { inspector, supervisorUser, officerUser, supervisor, otherSupervisor };
}

/** An inspection to hang test observations from (observations require one). */
export function seedInspection(db, ids, inspectorId, overrides = {}) {
  return db.insert('inspections', {
    ref_no: `INSP-2026-${String(Math.floor(Math.random() * 899999) + 100000)}`,
    module_id: ids.module,
    inspection_type_id: ids.type,
    location_type: 'Station',
    station_id: ids.station,
    inspector_id: inspectorId,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    ...overrides,
  });
}
