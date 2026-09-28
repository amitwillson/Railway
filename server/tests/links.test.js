import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempData, cleanup, seedMinimal, seedUsers } from './helpers.js';

const dir = useTempData('links');

const db = await import('../src/db/index.js');
const { findSupervisors, autoAssign, supervisorLinks } = await import('../src/lib/assignment.js');
const { deficienciesForItem, deficiencyFor, resolveText } = await import('../src/lib/deficiencies.js');

let ids;
let users;

before(() => {
  db.getDb();
  ids = seedMinimal(db);
  users = seedUsers(db, ids);
});

after(() => {
  db.closeDb();
  cleanup(dir);
});

/* -------------------------------------------------------------------------- */
/* Supervisor -> station and department links                                 */
/* -------------------------------------------------------------------------- */

describe('supervisor station links', () => {
  test('a supervisor is found at a station they cover but are not posted at', () => {
    // Nothing links anyone to Katni yet, so the best Katni can do is the
    // nominated departmental supervisor.
    const before_ = autoAssign({ stationId: ids.otherStation, departmentId: ids.deptElec });
    assert.equal(before_.match_score, 60, before_.match_reason);

    db.insert('supervisor_stations', {
      supervisor_id: users.otherSupervisor,
      station_id: ids.otherStation,
      is_primary: 0,
      priority: 50,
      active: 1,
    });

    const after_ = autoAssign({ stationId: ids.otherStation, departmentId: ids.deptElec });
    assert.equal(after_.id, users.otherSupervisor);
    assert.equal(after_.match_score, 55);
    assert.match(after_.match_reason, /Covers Katni/);
  });

  test('the posting outranks a covered station', () => {
    // Both supervisors now reach Katni: one is posted at Jabalpur and covers
    // Katni, the other is posted at Katni itself.
    db.insert('supervisor_stations', {
      supervisor_id: users.supervisor, station_id: ids.otherStation, is_primary: 0, priority: 50, active: 1,
    });
    db.update('supervisors', users.otherSupervisor, { station_id: ids.otherStation });

    const ranked = findSupervisors({ stationId: ids.otherStation, departmentId: ids.deptElec });
    assert.equal(ranked[0].id, users.otherSupervisor, 'the person posted there should come first');
    assert.equal(ranked[0].match_score, 50);
    assert.equal(ranked[1].id, users.supervisor);
    assert.equal(ranked[1].match_score, 55);

    db.update('supervisors', users.otherSupervisor, { station_id: ids.station });
    db.run('DELETE FROM supervisor_stations WHERE supervisor_id = ?', [users.supervisor]);
  });

  test('an inactive link is ignored', () => {
    db.run('UPDATE supervisor_stations SET active = 0 WHERE supervisor_id = ?', [users.otherSupervisor]);
    const resolved = autoAssign({ stationId: ids.otherStation, departmentId: ids.deptElec });
    assert.notEqual(resolved.match_score, 55);
    db.run('UPDATE supervisor_stations SET active = 1 WHERE supervisor_id = ?', [users.otherSupervisor]);
  });

  test('links are reported primary first', () => {
    db.insert('supervisor_stations', {
      supervisor_id: users.supervisor, station_id: ids.station, is_primary: 1, priority: 10, active: 1,
    });
    db.insert('supervisor_stations', {
      supervisor_id: users.supervisor, station_id: ids.otherStation, is_primary: 0, priority: 50, active: 1,
    });
    const links = supervisorLinks(users.supervisor);
    assert.equal(links.stations.length, 2);
    assert.equal(links.stations[0].station_code, 'JBP');
    assert.equal(links.stations[0].is_primary, true);
    assert.equal(links.stations[1].station_code, 'KTE');
    assert.equal(links.stations[1].is_primary, false);
  });
});

describe('supervisor department links', () => {
  test('a supervisor is found under a department they also cover', () => {
    // The supervisor belongs to Electrical; nothing in Engineering reaches them.
    const engineering = findSupervisors({ stationId: ids.station, departmentId: ids.deptEngg });
    assert.equal(engineering.length, 0);

    db.insert('supervisor_departments', {
      supervisor_id: users.supervisor, department_id: ids.deptEngg, is_primary: 0, priority: 50, active: 1,
    });

    const found = findSupervisors({ stationId: ids.station, departmentId: ids.deptEngg });
    assert.equal(found.length, 1);
    assert.equal(found[0].id, users.supervisor);
    assert.match(found[0].match_reason, /Engineering/, 'the reason names the department that was asked for');
  });

  test('a secondary department ranks below the department it belongs to', () => {
    const engineerAtStation = db.insert('supervisors', {
      employee_id: 'SSE-EN-1', name: 'Alok Mishra', designation: 'SSE/Works',
      department_id: ids.deptEngg, station_id: ids.station, mobile: '9425100103',
    });
    const ranked = findSupervisors({ stationId: ids.station, departmentId: ids.deptEngg });
    const engineer = ranked.find((r) => r.id === engineerAtStation);
    const electrician = ranked.find((r) => r.id === users.supervisor);
    assert.ok(engineer && electrician);
    assert.equal(engineer.match_score, 50);
    assert.equal(electrician.match_score, 52, 'two points worse for covering it rather than being in it');
    assert.equal(ranked[0].id, engineerAtStation);
    db.run('DELETE FROM supervisors WHERE id = ?', [engineerAtStation]);
  });
});

/* -------------------------------------------------------------------------- */
/* Suggested deficiencies                                                     */
/* -------------------------------------------------------------------------- */

describe('suggested deficiencies', () => {
  let item;
  let generic;
  let groupScoped;
  let itemScoped;

  before(() => {
    item = db.get('SELECT * FROM inspection_items WHERE id = ?', [ids.item]);
    generic = db.insert('item_deficiencies', { text: '{item} not available', sort_order: 10, active: 1 });
    db.insert('item_deficiencies', { module_id: ids.module, text: 'Amenity unusable', sort_order: 10, active: 1 });
    groupScoped = db.insert('item_deficiencies', {
      group_id: ids.group, text: 'Water supply not available', default_department_id: ids.deptEngg,
      suggested_tdc_days: 3, sort_order: 10, active: 1,
    });
    itemScoped = db.insert('item_deficiencies', {
      item_id: ids.item, text: 'Water cooler is not functioning.', default_department_id: ids.deptElec,
      default_severity_id: ids.severityMajor, suggested_tdc_days: 3, sort_order: 10, active: 1,
    });
  });

  test('are offered narrowest scope first', () => {
    const { data } = deficienciesForItem(item);
    assert.deepEqual(data.map((d) => d.scope), ['item', 'group', 'module', 'generic']);
    assert.equal(data[0].text, 'Water cooler is not functioning.');
    assert.equal(data[0].department_code, 'ELEC');
    assert.equal(data[0].suggested_tdc_days, 3);
  });

  test('{item} is resolved against the item name', () => {
    const { data } = deficienciesForItem(item);
    assert.equal(data.at(-1).text, 'Drinking Water not available');
    assert.equal(data.at(-1).template, '{item} not available');
    assert.equal(resolveText('{item} broken', 'Lift'), 'Lift broken');
  });

  test('a suggestion for another item is not offered', () => {
    const otherGroup = db.insert('item_groups', { module_id: ids.module, name: 'Lighting', sort_order: 20 });
    const otherItem = db.insert('inspection_items', {
      group_id: otherGroup, module_id: ids.module, name: 'Fan', applies_to: 'station',
    });
    const { data } = deficienciesForItem(db.get('SELECT * FROM inspection_items WHERE id = ?', [otherItem]));
    assert.ok(!data.some((d) => d.text.startsWith('Water')), 'water suggestions belong to the water group only');
    assert.ok(data.some((d) => d.text === 'Fan not available'));
  });

  test('an inactive suggestion disappears', () => {
    db.update('item_deficiencies', itemScoped, { active: 0 });
    const { data } = deficienciesForItem(item);
    assert.ok(!data.some((d) => d.id === itemScoped));
    db.update('item_deficiencies', itemScoped, { active: 1 });
  });

  test('a deficiency is only accepted for an item it belongs to', () => {
    assert.equal(deficiencyFor(itemScoped, item)?.id, itemScoped, 'own item');
    assert.equal(deficiencyFor(groupScoped, item)?.id, groupScoped, 'own group');
    assert.equal(deficiencyFor(generic, item)?.id, generic, 'generic');

    const strangerGroup = db.insert('item_groups', { module_id: ids.module, name: 'Ticketing', sort_order: 30 });
    const stranger = db.insert('inspection_items', {
      group_id: strangerGroup, module_id: ids.module, name: 'Booking Counter', applies_to: 'station',
    });
    const strangerItem = db.get('SELECT * FROM inspection_items WHERE id = ?', [stranger]);
    assert.equal(deficiencyFor(itemScoped, strangerItem), null, 'another item\'s suggestion is refused');
    assert.equal(deficiencyFor(groupScoped, strangerItem), null, 'another group\'s suggestion is refused');
    assert.equal(deficiencyFor(999999, item), null, 'an unknown id is refused');
    assert.equal(deficiencyFor(null, item), null);
  });

  test('wordings already used for the item are offered alongside', () => {
    const inspection = db.insert('inspections', {
      ref_no: 'INSP-2026-000900', module_id: ids.module, inspection_type_id: ids.type,
      location_type: 'Station', station_id: ids.station, inspector_id: users.inspector, status: 'in_progress',
    });
    const text = 'Water cooler on Platform No. 2 found not working.';
    for (const ref of ['OBS-2026-000901', 'OBS-2026-000902']) {
      db.insert('observations', {
        ref_no: ref, inspection_id: inspection, module_id: ids.module, station_id: ids.station,
        item_id: ids.item, item_name: 'Drinking Water', observation: text,
        severity_id: ids.severityMajor, action_by_department_id: ids.deptElec, created_by: users.inspector,
      });
    }
    const { previously_used: used } = deficienciesForItem(item);
    assert.equal(used.length, 1, 'only wordings seen more than once are worth suggesting');
    assert.equal(used[0].text, text);
    assert.equal(used[0].times_used, 2);
    db.run('DELETE FROM observations');
    db.run('DELETE FROM inspections WHERE id = ?', [inspection]);
  });
});
