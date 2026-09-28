import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempData, cleanup, seedMinimal, seedInspection, seedUsers } from './helpers.js';

const dir = useTempData('engines');

const db = await import('../src/db/index.js');
const { findSupervisors, autoAssign } = await import('../src/lib/assignment.js');
const { findRepeats, similarity, keywords } = await import('../src/lib/repeats.js');
const { nextRef } = await import('../src/lib/ids.js');

let ids;
let users;
let inspectionId;

before(() => {
  db.getDb();
  ids = seedMinimal(db);
  users = seedUsers(db, ids);
  inspectionId = seedInspection(db, ids, users.inspector);
});

after(() => {
  db.closeDb();
  cleanup(dir);
});

describe('reference numbers', () => {
  test('are sequential and zero padded per year', () => {
    const first = nextRef('observations', 'OBS', 2026);
    assert.match(first, /^OBS-2026-000001$/);
    db.insert('observations', {
      ref_no: first, inspection_id: inspectionId, module_id: ids.module, severity_id: ids.severityMajor,
      action_by_department_id: ids.deptElec, observation: 'seed', created_by: users.inspector,
    });
    assert.equal(nextRef('observations', 'OBS', 2026), 'OBS-2026-000002');
    db.run('DELETE FROM observations');
  });

  test('restart in a new year', () => {
    assert.equal(nextRef('observations', 'OBS', 2027), 'OBS-2027-000001');
  });
});

describe('smart assignment', () => {
  test('prefers the supervisor posted at the station', () => {
    const best = autoAssign({ stationId: ids.station, unitId: ids.unitPf2, departmentId: ids.deptElec });
    assert.ok(best, 'a supervisor should be identified');
    assert.equal(best.name, 'Rajesh Meshram');
    assert.match(best.match_reason, /Jabalpur|Platform|Electrical/);
    assert.equal(best.mobile, '9425100101', 'the mobile number comes from the master');
  });

  test('explicit coverage for a unit wins over posting', () => {
    db.insert('supervisor_coverage', {
      supervisor_id: users.otherSupervisor, station_id: ids.station, unit_id: ids.unitHall, priority: 10,
    });
    const best = autoAssign({ stationId: ids.station, unitId: ids.unitHall, departmentId: ids.deptElec });
    assert.equal(best.name, 'Pooja Tiwari');
    assert.match(best.match_reason, /Booking Hall/);
  });

  test('returns every candidate so the inspector can override', () => {
    const list = findSupervisors({ stationId: ids.station, departmentId: ids.deptElec });
    assert.equal(list.length, 2);
    assert.ok(list[0].match_score <= list[1].match_score, 'candidates are ranked');
  });

  test('returns nothing when the department has no supervisor', () => {
    assert.deepEqual(findSupervisors({ stationId: ids.station, departmentId: ids.deptEngg }), []);
    assert.equal(autoAssign({ stationId: ids.station, departmentId: ids.deptEngg }), null);
  });
});

describe('keyword similarity', () => {
  test('matches wording through simple inflections', () => {
    assert.ok(similarity('Water cooler is not functioning', 'Water cooler not functional') > 0.5);
  });

  test('ignores stop words', () => {
    assert.ok(!keywords('the water is not on the platform').has('the'));
  });

  test('unrelated text does not match', () => {
    assert.ok(similarity('Water cooler is not functioning', 'Parcel weighing machine unstamped') < 0.2);
  });
});

describe('repeated deficiency detection', () => {
  const raise = (text, { unitId = ids.unitPf2, itemId = ids.item, daysAgo = 0, stationId = ids.station } = {}) => {
    const observedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
    return db.insert('observations', {
      ref_no: nextRef('observations', 'OBS', 2026),
      inspection_id: inspectionId, module_id: ids.module, station_id: stationId,
      unit_id: unitId, unit_name: unitId === ids.unitPf2 ? 'Platform No. 2' : 'Booking Hall',
      item_id: itemId, item_name: 'Drinking Water',
      observation: text, category_id: ids.category, severity_id: ids.severityMajor,
      action_by_department_id: ids.deptElec, created_by: users.inspector,
      observed_at: observedAt, status: 'closed',
    });
  };

  test('flags the same item at the same unit', () => {
    raise('Water cooler on Platform No. 2 not working', { daysAgo: 30 });
    raise('Water cooler at PF-2 found switched off', { daysAgo: 60 });
    const result = findRepeats({
      stationId: ids.station, unitId: ids.unitPf2, itemId: ids.item,
      observation: 'Water cooler is not functioning',
    });
    assert.equal(result.count, 2);
    assert.match(result.message, /repeated deficiency observed 3 times in the last 90 days/);
    assert.equal(result.matches[0].match_reason, 'Same item at the same unit');
  });

  test('resolves the item and unit name from ids for the message', () => {
    const result = findRepeats({
      stationId: ids.station, unitId: ids.unitPf2, itemId: ids.item, observation: 'Water cooler is not functioning',
    });
    assert.match(result.message, /^Drinking Water - Platform No\. 2/);
  });

  test('respects the look-back window', () => {
    const result = findRepeats({
      stationId: ids.station, unitId: ids.unitPf2, itemId: ids.item,
      observation: 'Water cooler is not functioning', windowDays: 10,
    });
    assert.equal(result.count, 0);
    assert.equal(result.message, null);
  });

  test('does not match another station', () => {
    const result = findRepeats({
      stationId: ids.otherStation, unitId: ids.unitPf2, itemId: ids.item,
      observation: 'Water cooler is not functioning',
    });
    assert.equal(result.count, 0);
  });

  test('excludes the observation being checked', () => {
    const id = raise('Water cooler is not functioning again', { daysAgo: 1 });
    const result = findRepeats({
      stationId: ids.station, unitId: ids.unitPf2, itemId: ids.item,
      observation: 'Water cooler is not functioning again', excludeObservationId: id,
    });
    assert.ok(!result.matches.some((m) => m.id === id));
  });

  test('needs a station or a train to search', () => {
    assert.equal(findRepeats({ observation: 'anything' }).count, 0);
  });
});
