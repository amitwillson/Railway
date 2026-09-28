import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { useTempData, cleanup, seedMinimal, seedUsers } from './helpers.js';

const dir = useTempData('notes');

const db = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/auth.js');
const { nextNoteNo } = await import('../src/lib/notes.js');

const PASSWORD = 'Railway@2026';
let app;
let ids;
let users;
let inspectorToken;
let supervisorToken;
let adminToken;
let inspectionId;
let observationIds = [];
let deficiencyId;

const auth = (req, token) => req.set('authorization', `Bearer ${token}`);

const login = async (identifier) => {
  const response = await request(app).post('/api/auth/login').send({ identifier, password: PASSWORD });
  assert.equal(response.status, 200, `login failed for ${identifier}: ${JSON.stringify(response.body)}`);
  return response.body.token;
};

before(async () => {
  db.getDb();
  ids = seedMinimal(db);
  users = seedUsers(db, ids);
  db.insert('users', {
    employee_id: 'ADM1', name: 'Test Admin', role: 'admin', password_hash: 'x', division_id: ids.division,
  });
  db.run('UPDATE users SET password_hash = ?', [hashPassword(PASSWORD)]);

  // The office wording the letter is built from.
  for (const [key, value] of Object.entries({
    'note.letterhead': 'WEST CENTRAL RAILWAY\nJabalpur Division',
    'note.office': 'Sr. Divisional Commercial Manager, Jabalpur',
    'note.number_prefix': 'JBP/COM/INSP',
    'note.addressee': 'The Concerned Supervisors',
    'app.division_default': 'JBP',
  })) {
    db.insert('settings', { key, value, value_type: 'string' });
  }
  deficiencyId = db.insert('item_deficiencies', {
    item_id: ids.item, text: 'Water cooler is not functioning.',
    default_department_id: ids.deptElec, suggested_tdc_days: 3, sort_order: 10, active: 1,
  });

  app = createApp();
  inspectorToken = await login('INS1');
  supervisorToken = await login('SUP1');
  adminToken = await login('ADM1');

  const inspection = await auth(request(app).post('/api/inspections'), inspectorToken).send({
    module_id: ids.module,
    inspection_type_id: ids.type,
    location_type: 'Station',
    station_id: ids.station,
  });
  assert.equal(inspection.status, 201, JSON.stringify(inspection.body));
  inspectionId = inspection.body.id;

  for (const [index, text] of [
    'Water cooler is not functioning.',
    'Toilet on Platform No. 2 not cleaned since last evening.',
    'Tap near the water booth is leaking continuously.',
  ].entries()) {
    const response = await auth(request(app).post('/api/observations'), inspectorToken).send({
      inspection_id: inspectionId,
      unit_id: ids.unitPf2,
      item_id: ids.item,
      observation: text,
      action_by_department_id: index === 1 ? ids.deptEngg : ids.deptElec,
      deficiency_id: index === 0 ? deficiencyId : undefined,
      tdc: index === 2 ? undefined : '2026-09-30',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    observationIds.push(response.body.id);
  }
});

after(() => {
  db.closeDb();
  cleanup(dir);
});

describe('the suggested deficiency an observation came from', () => {
  test('is recorded on the observation', () => {
    const row = db.get('SELECT deficiency_id FROM observations WHERE id = ?', [observationIds[0]]);
    assert.equal(row.deficiency_id, deficiencyId);
  });

  test('and counts towards the most-reported list', async () => {
    const response = await auth(request(app).get('/api/dashboard/deficiencies'), inspectorToken);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const entry = response.body.data.find((d) => d.deficiency_id === deficiencyId);
    assert.ok(entry, 'the suggestion appears in the analytics');
    assert.equal(entry.occurrences, 1);
    assert.equal(entry.text, 'Water cooler is not functioning.');
  });

  test('a suggestion belonging to another item is not recorded', async () => {
    const otherGroup = db.insert('item_groups', { module_id: ids.module, name: 'Seating', sort_order: 40 });
    const otherItem = db.insert('inspection_items', {
      group_id: otherGroup, module_id: ids.module, name: 'Benches', applies_to: 'station',
    });
    const stranger = db.insert('item_deficiencies', {
      item_id: otherItem, text: 'Benches broken', sort_order: 10, active: 1,
    });
    const response = await auth(request(app).post('/api/observations'), inspectorToken).send({
      inspection_id: inspectionId,
      item_id: ids.item,
      observation: 'A deficiency quoting the wrong suggestion.',
      action_by_department_id: ids.deptElec,
      deficiency_id: stranger,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const row = db.get('SELECT deficiency_id FROM observations WHERE id = ?', [response.body.id]);
    assert.equal(row.deficiency_id, null, 'the mismatched suggestion is dropped, the observation still stands');
    db.run('DELETE FROM observations WHERE id = ?', [response.body.id]);
  });

  test('the dropdown is served for an item', async () => {
    const response = await auth(request(app).get(`/api/masters/items/${ids.item}/deficiencies`), inspectorToken);
    assert.equal(response.status, 200);
    assert.equal(response.body.data[0].id, deficiencyId);
    assert.equal(response.body.data[0].scope, 'item');
  });

  test('an unknown item is a 404', async () => {
    const response = await auth(request(app).get('/api/masters/items/99999/deficiencies'), inspectorToken);
    assert.equal(response.status, 404);
  });
});

describe('inspection notes', () => {
  let noteId;

  test('the draft carries every observation of the inspection', async () => {
    const response = await auth(
      request(app).get(`/api/notes/draft?inspection_id=${inspectionId}`),
      inspectorToken
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.observations.length, 3);
    assert.match(response.body.note_no, /^JBP\/COM\/INSP\/\d{4}-\d{2}\/001$/);
    assert.match(response.body.subject, /Jabalpur/);
    assert.equal(response.body.addressee, 'The Concerned Supervisors');
    assert.ok(response.body.preamble.length > 20, 'the standing opening paragraph is offered');
  });

  test('a draft needs something to compile', async () => {
    const response = await auth(request(app).get('/api/notes/draft'), inspectorToken);
    assert.equal(response.status, 400);
  });

  test('an inspector compiles the observations into one numbered note', async () => {
    const response = await auth(request(app).post('/api/notes'), inspectorToken).send({
      inspection_id: inspectionId,
      subject: 'Deficiencies noticed during inspection of Jabalpur station',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    noteId = response.body.id;
    assert.match(response.body.note_no, /^JBP\/COM\/INSP\/\d{4}-\d{2}\/001$/);
    assert.equal(response.body.status, 'draft');
    assert.equal(response.body.observations.length, 3);
    assert.deepEqual(response.body.observations.map((o) => o.sl_no), [1, 2, 3]);
    assert.equal(response.body.signatory_name, 'Test Inspector', 'signed by whoever raised it');
    assert.deepEqual(
      response.body.by_department.map((g) => [g.department, g.observations.length]),
      [['Electrical', 2], ['Engineering', 1]],
      'the letter is grouped the way each department reads it'
    );
  });

  test('the note numbers run on within the financial year', () => {
    assert.match(nextNoteNo('JBP/COM/INSP', '2026-09-28'), /^JBP\/COM\/INSP\/2026-27\/002$/);
    assert.match(nextNoteNo('JBP/COM/INSP', '2026-03-31'), /^JBP\/COM\/INSP\/2025-26\/001$/);
    assert.match(nextNoteNo('JBP/COM/INSP', '2026-04-01'), /^JBP\/COM\/INSP\/2026-27\/002$/);
  });

  test('a supervisor may read a note but not raise one', async () => {
    const read = await auth(request(app).get(`/api/notes/${noteId}`), supervisorToken);
    assert.equal(read.status, 200);
    const write = await auth(request(app).post('/api/notes'), supervisorToken).send({ inspection_id: inspectionId });
    assert.equal(write.status, 403);
  });

  test('the wording can be corrected while it is a draft', async () => {
    const response = await auth(request(app).patch(`/api/notes/${noteId}`), inspectorToken).send({
      preamble: 'The deficiencies listed below were noticed during the inspection.',
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.preamble, 'The deficiencies listed below were noticed during the inspection.');
  });

  test('once issued it cannot be reworded', async () => {
    const issue = await auth(request(app).patch(`/api/notes/${noteId}`), inspectorToken).send({ status: 'issued' });
    assert.equal(issue.status, 200);
    assert.equal(issue.body.status, 'issued');
    assert.ok(issue.body.issued_at);

    const reword = await auth(request(app).patch(`/api/notes/${noteId}`), inspectorToken).send({
      subject: 'A different subject',
    });
    assert.equal(reword.status, 400, 'an issued letter is a record, not a draft');
    const unchanged = await auth(request(app).get(`/api/notes/${noteId}`), inspectorToken);
    assert.equal(unchanged.body.subject, 'Deficiencies noticed during inspection of Jabalpur station');
  });

  test('it can still be cancelled', async () => {
    const note = await auth(request(app).post('/api/notes'), inspectorToken).send({
      inspection_id: inspectionId, status: 'issued',
    });
    const cancelled = await auth(request(app).patch(`/api/notes/${note.body.id}`), inspectorToken).send({
      status: 'cancelled',
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, 'cancelled');
  });

  test('observations from different inspections compile into one note', async () => {
    const second = await auth(request(app).post('/api/inspections'), inspectorToken).send({
      module_id: ids.module, inspection_type_id: ids.type, location_type: 'Station', station_id: ids.otherStation,
    });
    const extra = await auth(request(app).post('/api/observations'), inspectorToken).send({
      inspection_id: second.body.id,
      item_id: ids.item,
      observation: 'Water booth at Katni is dry.',
      action_by_department_id: ids.deptEngg,
    });
    const response = await auth(request(app).post('/api/notes'), inspectorToken).send({
      observation_ids: [observationIds[0], extra.body.id],
      subject: 'Drinking water arrangements - Jabalpur and Katni',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.observations.length, 2);
    assert.deepEqual(
      response.body.observations.map((o) => o.station_name),
      ['Jabalpur', 'Katni'],
      'the order asked for is the order numbered'
    );
    assert.equal(response.body.inspection_id, null, 'a compiled note belongs to no single inspection');
  });

  test('a note needs at least one observation', async () => {
    const response = await auth(request(app).post('/api/notes'), inspectorToken).send({
      observation_ids: [999999],
    });
    assert.equal(response.status, 400);
  });

  test('it prints as a PDF letter', async () => {
    const response = await auth(
      request(app).get(`/api/notes/${noteId}/print?format=pdf&group_by_department=1`),
      inspectorToken
    ).buffer(true);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/pdf');
    assert.match(response.headers['content-disposition'], /\.pdf"$/);
    assert.ok(response.body.length > 3000, `expected a real PDF, got ${response.body.length} bytes`);
    assert.equal(response.body.subarray(0, 5).toString(), '%PDF-');
  });

  test('and as a CSV for a spreadsheet', async () => {
    const response = await auth(request(app).get(`/api/notes/${noteId}/print?format=csv`), inspectorToken);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/csv/);
    const lines = response.text.trim().split('\r\n');
    assert.equal(lines.length, 4, 'a header and three observations');
    assert.match(lines[0].replace(/^\ufeff/, ''), /^Sl\. No\.,Observation,/);
    assert.match(lines[1], /Water cooler is not functioning/);
  });

  test('anyone holding the printed letter can verify it without signing in', async () => {
    const note = await auth(request(app).get(`/api/notes/${noteId}`), inspectorToken);
    const response = await request(app).get(`/api/notes/verify/${note.body.qr_token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.verified, true);
    assert.equal(response.body.note_no, note.body.note_no);
    assert.equal(response.body.observations.length, 3);
    assert.equal(response.body.signed_by.name, 'Test Inspector');
  });

  test('an unknown token verifies nothing', async () => {
    const response = await request(app).get('/api/notes/verify/not-a-real-token');
    assert.equal(response.status, 404);
  });

  test('the note list can be filtered to one inspection', async () => {
    const response = await auth(
      request(app).get(`/api/notes?inspection_id=${inspectionId}`),
      inspectorToken
    );
    assert.equal(response.status, 200);
    assert.ok(response.body.total >= 2);
    assert.ok(response.body.data.every((n) => n.inspection_ref));
  });
});

describe('the station list', () => {
  const csv = [
    'code,name,division,zone,category,station_type,section,platforms',
    'JBP,Jabalpur,JBP,WCR,NSG-2,Junction,Katni - Itarsi,6',
    'PPI,Pipariya,JBP,WCR,NSG-4,Station,Katni - Itarsi,3',
    '"SGP","Sohagpur, wayside",JBP,WCR,,Station,Katni - Itarsi,2',
    ',No code here,JBP,WCR,,,,1',
    'ZZZ,Unknown division,QQQ,WCR,,,,1',
  ].join('\n');

  test('imports from CSV, adding and updating by code', async () => {
    const dryRun = await auth(request(app).post('/api/admin/stations/import'), adminToken).send({
      csv, dry_run: true,
    });
    assert.equal(dryRun.status, 200, JSON.stringify(dryRun.body));
    assert.deepEqual(dryRun.body.counts, { created: 2, updated: 1, deactivated: 0, skipped: 2 });
    assert.equal(db.get('SELECT COUNT(*) AS n FROM stations').n, 2, 'a dry run writes nothing');

    const applied = await auth(request(app).post('/api/admin/stations/import'), adminToken).send({ csv });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.deepEqual(applied.body.counts, { created: 2, updated: 1, deactivated: 0, skipped: 2 });
    assert.equal(applied.body.total_after, 4);
    assert.equal(
      db.get("SELECT name FROM stations WHERE code = 'SGP'").name,
      'Sohagpur, wayside',
      'a quoted field keeps its comma'
    );
    assert.equal(db.get("SELECT section FROM stations WHERE code = 'PPI'").section, 'Katni - Itarsi');
  });

  test('says why a row was skipped', async () => {
    const response = await auth(request(app).post('/api/admin/stations/import'), adminToken).send({ csv });
    assert.deepEqual(
      response.body.skipped.map((s) => s.reason),
      ['code and name are both required', 'unknown division "QQQ"']
    );
  });

  test('a station left out of the file is deactivated, never deleted', async () => {
    const response = await auth(request(app).post('/api/admin/stations/import'), adminToken).send({
      csv: 'code,name,division,zone\nJBP,Jabalpur,JBP,WCR',
      deactivate_missing: true,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.counts.deactivated, 3);
    assert.equal(db.get("SELECT active FROM stations WHERE code = 'PPI'").active, 0);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM stations').n, 4, 'the rows are still there');
    db.run('UPDATE stations SET active = 1');
  });

  test('reads the column headings an office file actually carries', async () => {
    // A file prepared in the works office does not say "code" and "platforms".
    const office = [
      'Station Code,Station Name,Division,Zone,NSG Category,Station Type,Block Section,No. of Platforms',
      'NU,Narsinghpur,JBP,WCR,NSG-5,Station,Katni - Itarsi,3',
      'GAR,Gadarwara,JBP,WCR,NSG-5,Station,Katni - Itarsi,3',
    ].join('\n');
    const response = await auth(request(app).post('/api/admin/stations/import'), adminToken).send({ csv: office });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.counts.skipped, 0, JSON.stringify(response.body.skipped));
    assert.equal(response.body.counts.created, 2);
    const station = db.get("SELECT * FROM stations WHERE code = 'NU'");
    assert.equal(station.name, 'Narsinghpur');
    assert.equal(station.category, 'NSG-5');
    assert.equal(station.section, 'Katni - Itarsi');
    assert.equal(station.platforms, 3);
  });

  test('says which headings it found when the required ones are missing', async () => {
    const response = await auth(request(app).post('/api/admin/stations/import'), adminToken).send({
      csv: 'Serial,Place,Remarks\n1,Somewhere,none',
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /must have a code and name column/);
    assert.match(response.body.error.message, /Found: serial, place, remarks/);
  });

  test('only an administrator may import', async () => {
    const response = await auth(request(app).post('/api/admin/stations/import'), inspectorToken).send({ csv });
    assert.equal(response.status, 403);
  });

  test('exports in the shape the importer accepts', async () => {
    const response = await auth(request(app).get('/api/admin/stations/export'), adminToken);
    assert.equal(response.status, 200);
    const [header] = response.text.trim().split('\r\n');
    assert.equal(
      header.replace(/^\ufeff/, ''),
      'code,name,division,zone,category,station_type,section,platforms,state,district,route,km,latitude,longitude,active'
    );
    assert.ok(response.text.startsWith('\ufeff'), 'the byte order mark keeps Excel on UTF-8');
  });

  test('the unit list offers only the platforms a station has', async () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      if (n === 2) continue; // Platform No. 2 is seeded already
      db.insert('units', { name: `Platform No. ${n}`, applies_to: 'station', kind: 'platform', sort_order: n * 10 });
    }
    const jabalpur = db.get("SELECT id FROM stations WHERE code = 'JBP'").id;
    const pipariya = db.get("SELECT id FROM stations WHERE code = 'PPI'").id;

    const big = await auth(request(app).get(`/api/masters/units?station_id=${jabalpur}`), inspectorToken);
    const small = await auth(request(app).get(`/api/masters/units?station_id=${pipariya}`), inspectorToken);
    const platforms = (r) => r.body.data.filter((u) => u.kind === 'platform').map((u) => u.name);
    assert.equal(platforms(big).length, 6, 'Jabalpur has six platforms');
    assert.deepEqual(platforms(small), ['Platform No. 1', 'Platform No. 2', 'Platform No. 3']);
  });
});
