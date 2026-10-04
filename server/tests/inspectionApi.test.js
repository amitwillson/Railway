import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { useTempData, cleanup, seedMinimal, seedUsers } from './helpers.js';

const dir = useTempData('inspection-api');

const db = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/auth.js');

const PASSWORD = 'Railway@2026';
let app;
let ids;
let users;
let inspectorToken;
let officerToken;

const auth = (req, token) => req.set('authorization', `Bearer ${token}`);

const login = async (identifier) => {
  const response = await request(app).post('/api/auth/login').send({ identifier, password: PASSWORD });
  assert.equal(response.status, 200, `login failed for ${identifier}: ${JSON.stringify(response.body)}`);
  return response.body.token;
};

/** Starts an inspection through the API, which is what opens its sheet. */
async function startInspection(overrides = {}) {
  const response = await auth(request(app).post('/api/inspections'), inspectorToken).send({
    module_id: ids.module,
    inspection_type_id: ids.type,
    scope: 'station',
    station_id: ids.station,
    from_time: '10:15',
    to_time: '13:40',
    joint_with: 'Station Manager',
    ...overrides,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

const sheetOf = async (id, token = inspectorToken) => {
  const response = await auth(request(app).get(`/api/inspections/${id}/sheet`), token);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
};

before(async () => {
  db.getDb();
  ids = seedMinimal(db);
  users = seedUsers(db, ids);
  db.insert('users', {
    employee_id: 'ADM1', name: 'Test Admin', role: 'admin', password_hash: 'x', division_id: ids.division,
  });
  db.run('UPDATE users SET password_hash = ?', [hashPassword(PASSWORD)]);

  db.insert('units', { name: 'Platform No. 1', applies_to: 'station', kind: 'platform', sort_order: 10 });
  db.insert('units', { name: 'Parcel Office', applies_to: 'station', kind: 'parcel office', sort_order: 160 });
  db.insert('units', { name: 'Other', applies_to: 'station', kind: 'other', sort_order: 990 });
  db.insert('settings', { key: 'report.number_prefix', value: 'JBP/COM/SI', category: 'report' });

  app = createApp();
  inspectorToken = await login('INS1');
  officerToken = await login('OFF1');
});

after(() => {
  db.closeDb();
  cleanup(dir);
});

/* -------------------------------------------------------------------------- */
/* One inspection over many areas                                             */
/* -------------------------------------------------------------------------- */

describe('starting an inspection', () => {
  test('the sheet opens with the whole station on it', async () => {
    const created = await startInspection();
    assert.ok(created.sheet_opened >= 3, `expected the areas on the sheet, got ${created.sheet_opened}`);
    assert.equal(created.scope, 'station');

    const sheet = await sheetOf(created.id);
    assert.equal(sheet.areas.length, created.sheet_opened);
    assert.ok(sheet.areas.every((a) => a.result === 'not_inspected'));
    assert.ok(sheet.areas[0].catalogue.length > 0, 'each area carries the items it can be checked against');
  });

  test('an inspector can choose to put only part of the station on the sheet', async () => {
    const created = await startInspection({ open_sheet: false });
    assert.equal(created.sheet_opened, 0);

    const units = await auth(request(app).get(`/api/inspections/${created.id}/areas/available`), inspectorToken);
    assert.equal(units.status, 200);
    const platforms = units.body.data.filter((u) => u.kind === 'platform').slice(0, 2);

    const opened = await auth(request(app).post(`/api/inspections/${created.id}/sheet`), inspectorToken).send({
      unit_ids: platforms.map((u) => u.id),
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.equal(opened.body.added, 2);
    assert.equal((await sheetOf(created.id)).areas.length, 2);
  });

  test('an area of another station cannot be put on the sheet', async () => {
    const created = await startInspection({ open_sheet: false });
    const foreign = db.insert('units', {
      name: 'Katni Only Area', applies_to: 'station', station_id: ids.otherStation, kind: 'hall',
    });
    const response = await auth(request(app).post(`/api/inspections/${created.id}/sheet`), inspectorToken).send({
      unit_ids: [foreign],
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /do not belong/i);
  });
});

describe('working through the areas', () => {
  test('an area is marked, and the coverage follows from the markings', async () => {
    const created = await startInspection();
    const sheet = await sheetOf(created.id);
    const [first, second, third] = sheet.areas;

    for (const [area, result] of [[first, 'satisfactory'], [second, 'satisfactory'], [third, 'not_available']]) {
      const response = await auth(
        request(app).patch(`/api/inspections/${created.id}/areas/${area.id}`),
        inspectorToken
      ).send({ result, remarks: result === 'not_available' ? 'Does not exist here' : 'In order' });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.result, result);
    }

    const after_ = await sheetOf(created.id);
    assert.equal(after_.coverage.areas_satisfactory, 2);
    assert.equal(after_.coverage.areas_not_available, 1);
  });

  test('items checked in an area are recorded, and the area becomes satisfactory', async () => {
    const created = await startInspection();
    const sheet = await sheetOf(created.id);
    const area = sheet.areas[0];

    const response = await auth(
      request(app).post(`/api/inspections/${created.id}/areas/${area.id}/items`),
      inspectorToken
    ).send({ results: [{ item_id: ids.item, result: 'ok', remarks: 'Supply normal' }] });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data[0].result, 'ok');

    const after_ = await sheetOf(created.id);
    assert.equal(after_.areas.find((a) => a.id === area.id).result, 'satisfactory');
    assert.equal(after_.coverage.items_ok, 1);
  });

  test('a deficiency recorded in an area marks that area on the sheet', async () => {
    const created = await startInspection();
    const sheet = await sheetOf(created.id);
    const area = sheet.areas.find((a) => a.unit_name === 'Platform No. 2');

    const observation = await auth(request(app).post('/api/observations'), inspectorToken).send({
      inspection_id: created.id,
      inspection_area_id: area.id,
      unit_id: area.unit_id,
      item_id: ids.item,
      observation: 'Water cooler is not functioning on this platform.',
      action_by_department_id: ids.deptElec,
    });
    assert.equal(observation.status, 201, JSON.stringify(observation.body));

    const after_ = await sheetOf(created.id);
    const marked = after_.areas.find((a) => a.id === area.id);
    assert.equal(marked.result, 'deficiencies');
    assert.equal(marked.observations.length, 1);
    assert.equal(marked.observations[0].ref_no, observation.body.ref_no);
  });

  test('another inspector cannot write on this inspection', async () => {
    const created = await startInspection();
    const sheet = await sheetOf(created.id);
    const stranger = db.insert('users', {
      employee_id: 'INS9', name: 'Other Inspector', role: 'inspector',
      password_hash: hashPassword(PASSWORD), division_id: ids.division,
    });
    assert.ok(stranger);
    const token = await login('INS9');
    const response = await auth(
      request(app).patch(`/api/inspections/${created.id}/areas/${sheet.areas[0].id}`),
      token
    ).send({ result: 'satisfactory' });
    assert.equal(response.status, 403);
  });
});

/* -------------------------------------------------------------------------- */
/* Part I and the report                                                      */
/* -------------------------------------------------------------------------- */

describe('the previous inspection', () => {
  test('its outstanding items are offered, reviewed, and the review moves the workflow', async () => {
    const previous = await startInspection();
    const sheet = await sheetOf(previous.id);
    const area = sheet.areas[0];
    const observation = await auth(request(app).post('/api/observations'), inspectorToken).send({
      inspection_id: previous.id,
      inspection_area_id: area.id,
      unit_id: area.unit_id,
      item_id: ids.item,
      observation: 'Drinking water is not available at this location.',
      action_by_department_id: ids.deptEngg,
      tdc: '2026-12-31',
    });
    assert.equal(observation.status, 201);
    await auth(request(app).patch(`/api/inspections/${previous.id}`), inspectorToken).send({ status: 'completed' });

    const current = await startInspection();
    const outstanding = await auth(request(app).get(`/api/inspections/${current.id}/previous`), inspectorToken);
    assert.equal(outstanding.status, 200);
    assert.equal(outstanding.body.previous.id, previous.id);
    const carried = outstanding.body.items.find((i) => i.ref_no === observation.body.ref_no);
    assert.ok(carried, 'the open item must be carried forward');
    assert.equal(carried.review, null);

    const reviewed = await auth(
      request(app).post(`/api/inspections/${current.id}/previous/${observation.body.id}`),
      inspectorToken
    ).send({ finding: 'complied', remarks: 'Attended to; found in order at this inspection.' });
    assert.equal(reviewed.status, 201, JSON.stringify(reviewed.body));
    // Verified on the ground is exactly the verification the workflow waits for.
    assert.equal(reviewed.body.moved, 'closed');
    assert.equal(reviewed.body.observation.status, 'closed');
    // The wording of a submitted observation is never touched by a review.
    assert.equal(reviewed.body.observation.observation, 'Drinking water is not available at this location.');

    const detail = await auth(request(app).get(`/api/observations/${observation.body.id}`), inspectorToken);
    assert.ok(
      detail.body.timeline.some((e) => e.action === 'REVIEWED_AT_INSPECTION'),
      'the review belongs on the observation timeline'
    );
  });
});

describe('the report', () => {
  test('it carries the coverage, the parts and the items found in order', async () => {
    const created = await startInspection();
    const sheet = await sheetOf(created.id);
    await auth(
      request(app).post(`/api/inspections/${created.id}/areas/${sheet.areas[0].id}/items`),
      inspectorToken
    ).send({ results: [{ item_id: ids.item, result: 'ok' }] });

    const response = await auth(request(app).get(`/api/inspections/${created.id}/report`), inspectorToken);
    assert.equal(response.status, 200);
    const model = response.body;
    assert.equal(model.inspection.id, created.id);
    assert.equal(model.items_in_order.length, 1);
    assert.ok(model.areas.length >= 3);
    assert.ok(model.defaults.letterhead);
    assert.match(model.narrative, /was carried out by/);
  });

  test('issuing numbers the report and then freezes the sheet', async () => {
    const created = await startInspection();
    const sheet = await sheetOf(created.id);

    const early = await auth(request(app).post(`/api/inspections/${created.id}/issue`), inspectorToken).send({});
    assert.equal(early.status, 400, 'a report cannot be issued before the inspection is completed');

    await auth(request(app).post(`/api/inspections/${created.id}/complete`), inspectorToken).send({});
    const issued = await auth(request(app).post(`/api/inspections/${created.id}/issue`), inspectorToken).send({});
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.match(issued.body.inspection_no, /^JBP\/COM\/SI\/\d{4}-\d{2}\/\d{3}$/);

    // Once issued the report is a record, so the sheet behind it stops moving.
    const late = await auth(
      request(app).patch(`/api/inspections/${created.id}/areas/${sheet.areas[0].id}`),
      inspectorToken
    ).send({ result: 'satisfactory' });
    assert.equal(late.status, 400);
    assert.match(late.body.error.message, /has been issued/i);
  });

  test('the report downloads as a PDF and as a CSV carrying every part', async () => {
    const created = await startInspection();
    const pdf = await auth(
      request(app).get(`/api/reports/inspection/${created.id}?format=pdf`),
      inspectorToken
    ).buffer().parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');

    const csv = await auth(request(app).get(`/api/reports/inspection/${created.id}?format=csv`), inspectorToken);
    assert.equal(csv.status, 200);
    for (const part of ['PART I', 'PART II', 'PART III', 'PART IV']) {
      assert.ok(csv.text.includes(part), `the CSV must carry ${part}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Reports built on the inspection rather than on the area                    */
/* -------------------------------------------------------------------------- */

describe('inspection-based reports', () => {
  test('the register has one row per inspection, with its coverage', async () => {
    const response = await auth(request(app).get('/api/reports/inspection-register'), officerToken);
    assert.equal(response.status, 200);
    const total = db.get('SELECT COUNT(*) AS n FROM inspections').n;
    assert.equal(response.body.count, total, 'one row per inspection, never one per area');

    const row = response.body.data[0];
    for (const key of ['areas_on_sheet', 'areas_covered', 'coverage_pct', 'items_checked', 'observation_count']) {
      assert.ok(key in row, `the register must carry ${key}`);
    }
    assert.ok(response.body.summary.some((s) => s.metric === 'Areas attended to'));
  });

  test('inspector-wise sums the visits by the officer who made them', async () => {
    const response = await auth(request(app).get('/api/reports/inspector-wise'), officerToken);
    assert.equal(response.status, 200);
    const mine = response.body.data.find((r) => r.inspector_id === users.inspector);
    assert.ok(mine, 'the inspecting officer must appear');
    assert.equal(
      mine.inspections,
      db.get('SELECT COUNT(*) AS n FROM inspections WHERE inspector_id = ?', [users.inspector]).n
    );
    assert.ok(mine.areas_covered >= 0 && mine.items_checked >= 0);
  });

  test('the inspection dashboard counts visits and coverage, not observations', async () => {
    const response = await auth(request(app).get('/api/dashboard/inspections'), officerToken);
    assert.equal(response.status, 200);
    const { totals } = response.body;
    assert.equal(totals.inspections, db.get('SELECT COUNT(*) AS n FROM inspections').n);
    assert.ok(totals.areas_on_sheet > totals.areas_covered, 'areas nobody looked at are counted too');
    assert.ok(Array.isArray(response.body.by_inspector));
    assert.ok(response.body.recent.length > 0);
  });

  test('the report catalogue offers the two inspection-based reports', async () => {
    const response = await auth(request(app).get('/api/reports/catalogue'), inspectorToken);
    const keys = response.body.data.map((r) => r.key);
    assert.ok(keys.includes('inspection-register'));
    assert.ok(keys.includes('inspector-wise'));
  });
});
