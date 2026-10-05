import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempData, cleanup, seedMinimal, seedUsers } from './helpers.js';

const dir = useTempData('sheet');

const db = await import('../src/db/index.js');
const sheet = await import('../src/lib/inspectionSheet.js');
const report = await import('../src/lib/inspectionReport.js');
const { createObservation } = await import('../src/services/observationService.js');

let ids;
let users;
let inspector;

/** An inspection with its sheet already opened, as the route does on create. */
function newInspection(overrides = {}) {
  const id = db.insert('inspections', {
    ref_no: `INSP-T-${Math.floor(Math.random() * 8999999) + 1000000}`,
    module_id: ids.module,
    inspection_type_id: ids.type,
    scope: 'station',
    location_type: 'Station',
    station_id: ids.station,
    inspector_id: inspector.id,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    ...overrides,
  });
  sheet.openSheet(id);
  sheet.linkPreviousInspection(id);
  return id;
}

const areasOf = (id) =>
  db.all('SELECT * FROM inspection_areas WHERE inspection_id = ? ORDER BY sort_order, id', [id]);
const areaNamed = (id, name) => areasOf(id).find((a) => a.unit_name === name);
const view = (id) => db.get('SELECT * FROM v_inspections i WHERE i.id = ?', [id]);

before(() => {
  db.getDb();
  ids = seedMinimal(db);
  users = seedUsers(db, ids);
  inspector = db.get('SELECT * FROM users WHERE id = ?', [users.inspector]);

  // A few more areas, so the sheet has something to be a sheet of.
  ids.unitPf1 = db.insert('units', { name: 'Platform No. 1', applies_to: 'station', kind: 'platform', sort_order: 10 });
  ids.unitPf9 = db.insert('units', { name: 'Platform No. 9', applies_to: 'station', kind: 'platform', sort_order: 90 });
  ids.unitParcel = db.insert('units', { name: 'Parcel Office', applies_to: 'station', kind: 'parcel office', sort_order: 160 });
  ids.unitOther = db.insert('units', { name: 'Other', applies_to: 'station', kind: 'other', sort_order: 990 });

  // A second item group scoped to one kind of area only.
  ids.ticketGroup = db.insert('item_groups', {
    module_id: ids.module,
    name: 'Ticketing',
    applies_to_kinds: 'booking office,reservation office',
    sort_order: 20,
  });
  ids.ticketItem = db.insert('inspection_items', {
    group_id: ids.ticketGroup,
    module_id: ids.module,
    name: 'UTS',
    applies_to: 'station',
    default_department_id: ids.deptEngg,
    default_severity_id: ids.severityMajor,
  });
  ids.secondItem = db.insert('inspection_items', {
    group_id: ids.group,
    module_id: ids.module,
    name: 'Water Cooler',
    applies_to: 'station',
    default_department_id: ids.deptElec,
    default_severity_id: ids.severityMajor,
  });
  db.insert('settings', { key: 'report.number_prefix', value: 'JBP/COM/SI', category: 'report' });
});

after(() => {
  db.closeDb();
  cleanup(dir);
});

/* -------------------------------------------------------------------------- */
/* The sheet: one inspection, many areas                                      */
/* -------------------------------------------------------------------------- */

describe('the inspection sheet', () => {
  test('starting an inspection puts every area of the station on the sheet', () => {
    const id = newInspection();
    const areas = areasOf(id);
    assert.ok(areas.length >= 4, `expected the station's areas on the sheet, got ${areas.length}`);
    // Every one starts as not inspected: the record must never imply that an area
    // was found in order simply because nobody has said otherwise.
    assert.ok(areas.every((a) => a.result === 'not_inspected'));
    assert.equal(view(id).areas_covered, 0);
  });

  test('a platform the station does not have is not on the sheet', () => {
    // The station has 6 platforms, so Platform No. 9 is not one of its areas.
    const names = areasOf(newInspection()).map((a) => a.unit_name);
    assert.ok(names.includes('Platform No. 1'));
    assert.ok(!names.includes('Platform No. 9'), names.join(', '));
  });

  test('the catch-all "Other" area is kept off the sheet but can be added by name', () => {
    const id = newInspection();
    assert.ok(!areasOf(id).some((a) => a.unit_name === 'Other'));
    sheet.openSheet(id, { unitIds: [ids.unitOther] });
    assert.ok(areasOf(id).some((a) => a.unit_name === 'Other'));
  });

  test('opening the sheet again adds nothing and loses nothing', () => {
    const id = newInspection();
    const area = areaNamed(id, 'Platform No. 2');
    sheet.setAreaResult(area.id, { result: 'satisfactory', remarks: 'All in order' });
    const before_ = areasOf(id).length;

    const again = sheet.openSheet(id);
    assert.equal(again.added, 0);
    assert.equal(areasOf(id).length, before_);
    assert.equal(areaNamed(id, 'Platform No. 2').result, 'satisfactory');
    assert.equal(areaNamed(id, 'Platform No. 2').remarks, 'All in order');
  });

  test('coverage counts areas, and an area that does not exist is left out of the percentage', () => {
    const id = newInspection();
    const areas = areasOf(id);
    sheet.setAreaResult(areas[0].id, { result: 'satisfactory' });
    sheet.setAreaResult(areas[1].id, { result: 'satisfactory' });
    sheet.setAreaResult(areas[2].id, { result: 'not_available', remarks: 'No subway here' });

    const v = view(id);
    assert.equal(v.areas_satisfactory, 2);
    assert.equal(v.areas_not_available, 1);
    // 2 of (total - 1 absent) areas were attended to.
    const expected = Math.round((2 / (areas.length - 1)) * 100);
    assert.equal(v.coverage_pct, expected);
  });
});

/* -------------------------------------------------------------------------- */
/* Item results: the record of what was found in order                        */
/* -------------------------------------------------------------------------- */

describe('item results', () => {
  test('recording items in an untouched area marks it satisfactory', () => {
    const id = newInspection();
    const area = areaNamed(id, 'Platform No. 2');
    sheet.recordItemResults(id, area.id, [
      { item_id: ids.item, result: 'ok' },
      { item_id: ids.secondItem, result: 'ok' },
    ]);
    assert.equal(areaNamed(id, 'Platform No. 2').result, 'satisfactory');
    const v = view(id);
    assert.equal(v.items_checked, 2);
    assert.equal(v.items_ok, 2);
  });

  test('a deficient item marks the area as having deficiencies', () => {
    const id = newInspection();
    const area = areaNamed(id, 'Platform No. 2');
    sheet.recordItemResults(id, area.id, [{ item_id: ids.item, result: 'deficient' }]);
    assert.equal(areaNamed(id, 'Platform No. 2').result, 'deficiencies');
  });

  test('re-recording an item replaces that item and nothing else', () => {
    const id = newInspection();
    const area = areaNamed(id, 'Platform No. 2');
    sheet.recordItemResults(id, area.id, [
      { item_id: ids.item, result: 'ok' },
      { item_id: ids.secondItem, result: 'ok' },
    ]);
    sheet.recordItemResults(id, area.id, [{ item_id: ids.item, result: 'not_applicable', remarks: 'Removed' }]);

    const rows = db.all('SELECT * FROM inspection_item_results WHERE inspection_area_id = ?', [area.id]);
    assert.equal(rows.length, 2, 'the second item must not be duplicated or dropped');
    assert.equal(rows.find((r) => r.item_id === ids.item).result, 'not_applicable');
    assert.equal(rows.find((r) => r.item_id === ids.secondItem).result, 'ok');
  });

  test('the catalogue offered in an area is scoped to that kind of area', () => {
    const id = newInspection();
    const inspection = view(id);
    const platform = areaNamed(id, 'Platform No. 2');
    const hall = areaNamed(id, 'Booking Hall');

    const names = (area) =>
      sheet.itemsForArea(inspection, area).flatMap((g) => g.items.map((i) => i.name));
    // Ticketing is scoped to the booking office; water is scoped to nothing and so
    // applies everywhere.
    assert.ok(!names(platform).includes('UTS'), 'a platform must not be offered the ticketing checks');
    assert.ok(names(hall).includes('UTS'));
    assert.ok(names(platform).includes('Drinking Water'));
    assert.ok(names(hall).includes('Drinking Water'));
  });
});

/* -------------------------------------------------------------------------- */
/* Observations and the sheet                                                 */
/* -------------------------------------------------------------------------- */

describe('an observation and its area', () => {
  test('recording a deficiency marks its area and its item without being told twice', async () => {
    const id = newInspection();
    const { observation } = await createObservation({
      payload: {
        inspection_id: id,
        unit_id: ids.unitPf2,
        item_id: ids.item,
        observation: 'Water cooler is not functioning on this platform.',
        action_by_department_id: ids.deptElec,
      },
      user: inspector,
    });

    const area = areaNamed(id, 'Platform No. 2');
    assert.equal(area.result, 'deficiencies');
    assert.equal(observation.inspection_area_id ?? area.id, area.id);
    const itemRow = db.get(
      'SELECT * FROM inspection_item_results WHERE inspection_area_id = ? AND item_id = ?',
      [area.id, ids.item]
    );
    assert.equal(itemRow.result, 'deficient');
    assert.equal(itemRow.observation_id, observation.id);
  });

  test('an area carrying a live observation cannot be marked satisfactory', async () => {
    const id = newInspection();
    await createObservation({
      payload: {
        inspection_id: id,
        unit_id: ids.unitPf2,
        item_id: ids.item,
        observation: 'Water cooler is not functioning on this platform.',
        action_by_department_id: ids.deptElec,
      },
      user: inspector,
    });
    const area = areaNamed(id, 'Platform No. 2');
    assert.throws(
      () => sheet.setAreaResult(area.id, { result: 'satisfactory' }),
      /observation/i,
      'the evidence on the record must not be marked away'
    );
    // The remark alone can still be edited.
    sheet.setAreaResult(area.id, { remarks: 'Cooler under repair' });
    assert.equal(areaNamed(id, 'Platform No. 2').remarks, 'Cooler under repair');
  });

  test('cancelling the only observation puts the area back to what it is', async () => {
    const id = newInspection();
    const { observation } = await createObservation({
      payload: {
        inspection_id: id,
        unit_id: ids.unitPf2,
        item_id: ids.item,
        observation: 'Water cooler is not functioning on this platform.',
        action_by_department_id: ids.deptElec,
      },
      user: inspector,
    });
    const area = areaNamed(id, 'Platform No. 2');
    assert.equal(area.result, 'deficiencies');

    db.update('observations', observation.id, { status: 'cancelled', cancel_reason: 'Raised in error' });
    const next = sheet.refreshAreaResult(area.id);
    // The only thing recorded in that area was the item the observation itself
    // marked deficient. Cancel the observation and nothing was checked there, so
    // the area is untouched again - not "found in order", which would be a claim
    // nobody made.
    assert.equal(next, 'not_inspected');
    assert.equal(areaNamed(id, 'Platform No. 2').result, 'not_inspected');
    assert.equal(
      db.get('SELECT COUNT(*) AS n FROM inspection_item_results WHERE inspection_area_id = ?', [area.id]).n,
      0,
      'the item must not be left reading deficient against an observation that no longer stands'
    );
  });

  test('an area the inspector did check stays satisfactory when a deficiency is cancelled', async () => {
    const id = newInspection();
    const area = areaNamed(id, 'Platform No. 2');
    // The inspector ticked two items off here themselves.
    sheet.recordItemResults(id, area.id, [
      { item_id: ids.secondItem, result: 'ok' },
    ]);
    const { observation } = await createObservation({
      payload: {
        inspection_id: id,
        unit_id: ids.unitPf2,
        item_id: ids.item,
        observation: 'A third item here was found wanting, and the finding is later withdrawn.',
        action_by_department_id: ids.deptElec,
      },
      user: inspector,
    });
    assert.equal(areaNamed(id, 'Platform No. 2').result, 'deficiencies');

    db.update('observations', observation.id, { status: 'cancelled', cancel_reason: 'Raised in error' });
    assert.equal(sheet.refreshAreaResult(area.id), 'satisfactory');
    // The inspector's own tick survives; only the withdrawn deficiency goes.
    const rows = db.all('SELECT * FROM inspection_item_results WHERE inspection_area_id = ?', [area.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].item_id, ids.secondItem);
  });

  test('an observation in an area that was never on the sheet puts that area on it', async () => {
    const id = newInspection({ scope: 'station' });
    db.run('DELETE FROM inspection_areas WHERE inspection_id = ? AND unit_id = ?', [id, ids.unitParcel]);
    const { observation } = await createObservation({
      payload: {
        inspection_id: id,
        unit_id: ids.unitParcel,
        item_id: ids.item,
        observation: 'Parcel scale is not stamped and the licence board is missing.',
        action_by_department_id: ids.deptEngg,
      },
      user: inspector,
    });
    const area = areaNamed(id, 'Parcel Office');
    assert.ok(area, 'the area must join the sheet rather than the deficiency being lost');
    assert.equal(area.result, 'deficiencies');
    assert.equal(
      db.get('SELECT inspection_area_id FROM observations WHERE id = ?', [observation.id]).inspection_area_id,
      area.id
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Part I: the previous inspection                                            */
/* -------------------------------------------------------------------------- */

describe('continuity with the previous inspection', () => {
  test('the previous inspection is the last one at that place, whoever carried it out', () => {
    const older = newInspection({ started_at: '2026-01-10T10:00:00.000Z' });
    const other = newInspection({
      started_at: '2026-01-12T10:00:00.000Z',
      station_id: ids.otherStation,
    });
    const current = newInspection({ started_at: '2026-01-20T10:00:00.000Z' });

    const found = sheet.findPreviousInspection(db.get('SELECT * FROM inspections WHERE id = ?', [current]));
    assert.equal(found.id, older, 'an inspection of a different station is not the predecessor');
    assert.notEqual(found.id, other);
  });

  test('only what the previous inspection left open is carried forward', async () => {
    const previous = newInspection({ started_at: '2026-02-01T10:00:00.000Z' });
    const open = await createObservation({
      payload: {
        inspection_id: previous,
        unit_id: ids.unitPf2,
        item_id: ids.item,
        observation: 'Drinking water is not available at this platform.',
        action_by_department_id: ids.deptEngg,
      },
      user: inspector,
    });
    const done = await createObservation({
      payload: {
        inspection_id: previous,
        unit_id: ids.unitHall,
        item_id: ids.item,
        observation: 'The booking hall fans are not working.',
        action_by_department_id: ids.deptElec,
      },
      user: inspector,
    });
    db.update('observations', done.observation.id, { status: 'closed', closed_at: new Date().toISOString() });

    const current = newInspection({ started_at: '2026-02-20T10:00:00.000Z' });
    const outstanding = sheet.previousOutstanding(current);
    assert.equal(outstanding.previous.id, previous);
    const refs = outstanding.items.map((i) => i.ref_no);
    assert.ok(refs.includes(open.observation.ref_no));
    assert.ok(!refs.includes(done.observation.ref_no), 'a closed item is not outstanding');
  });
});

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

describe('the inspection report', () => {
  test('it reports what was found in order, not only what was wrong', async () => {
    const id = newInspection();
    const areas = areasOf(id);
    sheet.recordItemResults(id, areas[0].id, [
      { item_id: ids.item, result: 'ok' },
      { item_id: ids.secondItem, result: 'ok' },
    ]);
    sheet.recordItemResults(id, areas[1].id, [{ item_id: ids.item, result: 'ok' }]);
    await createObservation({
      payload: {
        inspection_id: id,
        unit_id: areas[2].unit_id,
        item_id: ids.item,
        observation: 'Dustbins have not been emptied since yesterday.',
        action_by_department_id: ids.deptEngg,
      },
      user: inspector,
    });

    const model = report.reportFor(id);
    assert.equal(model.observations.length, 1);
    assert.equal(model.items_in_order.length, 3, 'Part IV must carry the items found in order');
    assert.equal(model.areas_covered.length, 3);
    assert.ok(model.areas_not_covered.length > 0, 'areas nobody looked at are listed, not dropped');
    // The narrative leads with the coverage, which is what makes it a report of an
    // inspection rather than a list of complaints.
    assert.match(model.narrative, /area\(s\) were attended to/);
    assert.match(model.narrative, /item\(s\) were checked/);
  });

  test('an inspection that found everything in order still reads as an inspection', () => {
    const id = newInspection();
    for (const area of areasOf(id)) {
      sheet.recordItemResults(id, area.id, [{ item_id: ids.item, result: 'ok' }]);
    }
    const model = report.reportFor(id);
    assert.equal(model.observations.length, 0);
    assert.match(model.narrative, /No deficiency was noticed/);
    assert.match(model.narrative, /found in order/);
    assert.equal(model.statistics.coverage.coverage_pct, 100);
  });

  test('issuing gives the report a financial-year number, and it cannot be issued twice', () => {
    const id = newInspection();
    db.update('inspections', id, { status: 'completed', completed_at: new Date().toISOString() });
    const issued = report.issueReport(id, inspector.id);
    assert.match(issued.inspection_no, /^JBP\/COM\/SI\/\d{4}-\d{2}\/\d{3}$/);
    assert.equal(issued.report_status, 'issued');
    assert.throws(() => report.issueReport(id, inspector.id), /already been issued/);
  });

  test('a report cannot be issued before the inspection is completed', () => {
    const id = newInspection();
    assert.throws(() => report.issueReport(id, inspector.id), /Complete the inspection/);
  });

  test('the running number restarts each financial year', () => {
    // April starts the series; March belongs to the year before.
    const april = report.nextInspectionNo('TEST/SI', '2027-04-02');
    const march = report.nextInspectionNo('TEST/SI', '2027-03-31');
    assert.match(april, /\/2027-28\/001$/);
    assert.match(march, /\/2026-27\/001$/);
  });
});

/* -------------------------------------------------------------------------- */
/* Upgrading a database that was written before the sheet existed             */
/* -------------------------------------------------------------------------- */

describe('migrating an older database', () => {
  test('an inspection written before `scope` existed is read from where it happened', () => {
    // The column arrives with a constant default, so every row would otherwise
    // read as a station inspection and a train inspection would be offered the
    // platforms. The backfill in migrate() is what puts them right; this asserts
    // the rule it applies.
    const train = db.insert('trains', { number: '20001', name: 'Backfill Express' });
    const rows = [
      { ref_no: 'MIG-TRAIN', train_id: train, station_id: null, section: null, expected: 'train' },
      { ref_no: 'MIG-SECTION', train_id: null, station_id: null, section: 'JSG-BSP', expected: 'section' },
      { ref_no: 'MIG-STATION', train_id: null, station_id: ids.station, section: null, expected: 'station' },
    ];
    for (const row of rows) {
      db.insert('inspections', {
        ref_no: row.ref_no,
        module_id: ids.module,
        inspection_type_id: ids.type,
        location_type: 'Other',
        scope: 'station', // what ALTER TABLE's default would have left
        station_id: row.station_id,
        train_id: row.train_id,
        section: row.section,
        inspector_id: inspector.id,
        status: 'completed',
      });
    }
    db.getDb().exec(
      `UPDATE inspections SET scope =
         CASE WHEN train_id IS NOT NULL THEN 'train'
              WHEN station_id IS NULL AND section IS NOT NULL THEN 'section'
              ELSE 'station' END
       WHERE ref_no LIKE 'MIG-%'`
    );
    for (const row of rows) {
      assert.equal(
        db.get('SELECT scope FROM inspections WHERE ref_no = ?', [row.ref_no]).scope,
        row.expected,
        row.ref_no
      );
    }
  });

  test('an inspection with no sheet at all reads as covering nothing, not as complete', () => {
    const id = db.insert('inspections', {
      ref_no: 'MIG-NOSHEET',
      module_id: ids.module,
      inspection_type_id: ids.type,
      location_type: 'Station',
      station_id: ids.station,
      inspector_id: inspector.id,
      status: 'completed',
    });
    const view = db.get('SELECT * FROM v_inspections i WHERE i.id = ?', [id]);
    assert.equal(view.areas_on_sheet, 0);
    assert.equal(view.areas_covered, 0);
    // Not 0% and not 100%: with nothing on the sheet there is no coverage to state.
    assert.equal(view.coverage_pct, null);
    const model = report.reportFor(id);
    assert.equal(model.areas.length, 0);
    assert.match(model.narrative, /was carried out by/);
  });
});

/* -------------------------------------------------------------------------- */
/* Reading the whole sheet                                                    */
/* -------------------------------------------------------------------------- */

describe('reading the sheet', () => {
  test('it returns every area with its items, its deficiencies and what is left to add', async () => {
    const id = newInspection();
    const area = areaNamed(id, 'Platform No. 2');
    sheet.recordItemResults(id, area.id, [{ item_id: ids.secondItem, result: 'ok' }]);
    await createObservation({
      payload: {
        inspection_id: id,
        unit_id: ids.unitPf2,
        item_id: ids.item,
        observation: 'Water cooler is not functioning on this platform.',
        action_by_department_id: ids.deptElec,
      },
      user: inspector,
    });

    const full = sheet.sheetFor(id);
    const pf2 = full.areas.find((a) => a.unit_name === 'Platform No. 2');
    assert.equal(pf2.result, 'deficiencies');
    assert.equal(pf2.observations.length, 1);
    assert.equal(pf2.item_results.length, 2, 'the ok item and the deficient one');
    assert.ok(pf2.catalogue.length > 0);
    // "Other" is off the sheet, so it is offered as an area that can still be added.
    assert.ok(full.available_areas.some((u) => u.name === 'Other'));
    assert.equal(full.coverage.areas_with_deficiencies, 1);
  });
});
