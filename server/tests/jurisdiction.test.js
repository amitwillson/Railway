import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { useTempData, cleanup, seedMinimal, seedUsers } from './helpers.js';

const dir = useTempData('jurisdiction');

const db = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/auth.js');
const juris = await import('../src/lib/jurisdiction.js');
const { findSupervisors } = await import('../src/lib/assignment.js');

const PASSWORD = 'Railway@2026';
let app;
let ids;
let users;
let inspectorToken;
let supervisorToken;
let adminToken;
let officerToken;

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

  // Two sections, and a station on each, so a section claim can be told from a
  // station claim.
  db.insert('sections', { code: 'JBP-KTE', name: 'Jabalpur - Katni', division_id: ids.division, sort_order: 10 });
  db.insert('sections', { code: 'KTE-STA', name: 'Katni - Satna', division_id: ids.division, sort_order: 20 });
  db.run('UPDATE stations SET section = ? WHERE id = ?', ['JBP-KTE', ids.station]);
  db.run('UPDATE stations SET section = ? WHERE id = ?', ['KTE-STA', ids.otherStation]);
  ids.thirdStation = db.insert('stations', {
    code: 'STA', name: 'Satna', division_id: ids.division, zone_id: ids.zone,
    category: 'NSG-3', section: 'KTE-STA', platforms: 4,
  });

  app = createApp();
  inspectorToken = await login('INS1');
  supervisorToken = await login('SUP1');
  officerToken = await login('OFF1');
  adminToken = await login('ADM1');
});

after(() => {
  db.closeDb();
  cleanup(dir);
});

/* -------------------------------------------------------------------------- */
/* An officer says where they work                                            */
/* -------------------------------------------------------------------------- */

describe('choosing a jurisdiction', () => {
  test('the screen offers the division\'s own sections and stations', async () => {
    const response = await auth(request(app).get('/api/profile/jurisdiction'), inspectorToken);
    assert.equal(response.status, 200);
    assert.ok(response.body.choices.sections.length >= 2);
    assert.ok(response.body.choices.stations.length >= 3);
    // A section says how many stations it carries, so the choice is informed.
    const section = response.body.choices.sections.find((s) => s.code === 'JBP-KTE');
    assert.equal(section.station_count, 1);
  });

  test('a section expands to its stations, and a station can be added on its own', async () => {
    const response = await auth(request(app).put('/api/profile/jurisdiction'), inspectorToken).send({
      sections: ['KTE-STA'],
      stations: [ids.station],
      primary: { kind: 'section', value: 'KTE-STA' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    // KTE-STA carries Katni and Satna; Jabalpur was named outright.
    assert.equal(response.body.stations_covered, 3);
    assert.equal(juris.stationsCovered(users.inspector).length, 3);

    const primary = response.body.data.find((r) => r.is_primary);
    assert.equal(primary.section, 'KTE-STA');
    assert.ok(response.body.data.every((r) => r.source === 'self'));
  });

  test('re-choosing stands down what was dropped rather than deleting it', async () => {
    await auth(request(app).put('/api/profile/jurisdiction'), inspectorToken).send({
      sections: ['JBP-KTE', 'KTE-STA'],
    });
    await auth(request(app).put('/api/profile/jurisdiction'), inspectorToken).send({ sections: ['JBP-KTE'] });

    const live = juris.jurisdictionOf(users.inspector);
    assert.equal(live.length, 1);
    assert.equal(live[0].section, 'JBP-KTE');
    // The dropped one is still on the record, inactive - so an observation routed
    // under it still points at something that can be read.
    const everything = juris.jurisdictionOf(users.inspector, { activeOnly: false });
    const dropped = everything.find((r) => r.section === 'KTE-STA');
    assert.ok(dropped, 'the dropped section must still be on the record');
    assert.equal(dropped.active, false);
  });

  test('a section or station that does not exist is refused', async () => {
    const section = await auth(request(app).put('/api/profile/jurisdiction'), inspectorToken)
      .send({ sections: ['NOT-A-SECTION'] });
    assert.equal(section.status, 400);
    assert.match(section.body.error.message, /Unknown section/i);

    const station = await auth(request(app).put('/api/profile/jurisdiction'), inspectorToken)
      .send({ stations: [999999] });
    assert.equal(station.status, 400);
    assert.match(station.body.error.message, /Unknown station/i);
  });

  test('a supervisor chooses their own, and it is marked as theirs', async () => {
    const response = await auth(request(app).put('/api/profile/jurisdiction'), supervisorToken)
      .send({ sections: ['KTE-STA'] });
    assert.equal(response.status, 200);
    assert.equal(response.body.data[0].source, 'self');
  });
});

describe('who may set whose', () => {
  test('one officer cannot set another officer\'s jurisdiction', async () => {
    const response = await auth(
      request(app).put(`/api/profile/jurisdiction/${users.supervisorUser}`),
      inspectorToken
    ).send({ sections: ['JBP-KTE'] });
    assert.equal(response.status, 403);
  });

  test('an administrator can, and it is recorded as administrator-set', async () => {
    const response = await auth(
      request(app).put(`/api/profile/jurisdiction/${users.inspector}`),
      adminToken
    ).send({ sections: ['JBP-KTE', 'KTE-STA'] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(response.body.data.every((r) => r.source === 'admin'));
    assert.ok(response.body.data.every((r) => r.set_by_name === 'Test Admin'));
  });

  test('a divisional officer can read another officer\'s jurisdiction but not set it', async () => {
    const read = await auth(request(app).get(`/api/profile/jurisdiction/${users.inspector}`), officerToken);
    assert.equal(read.status, 200);
    assert.ok(read.body.data.length > 0);

    const write = await auth(request(app).put(`/api/profile/jurisdiction/${users.inspector}`), officerToken)
      .send({ sections: ['JBP-KTE'] });
    assert.equal(write.status, 403);
  });

  test('an inspector cannot read another officer\'s jurisdiction', async () => {
    const response = await auth(
      request(app).get(`/api/profile/jurisdiction/${users.supervisorUser}`),
      inspectorToken
    );
    assert.equal(response.status, 403);
  });
});

/* -------------------------------------------------------------------------- */
/* What it does to the routing                                                */
/* -------------------------------------------------------------------------- */

describe('a jurisdiction and the assignment engine', () => {
  // The tests above leave claims behind, so this suite starts from a clean slate:
  // what is being measured here is the ranking, not what happened earlier.
  before(() => {
    db.run('UPDATE user_jurisdictions SET active = 0');
  });

  test('a supervisor who names a station is found there, below anyone the division linked', () => {
    // The nominated departmental supervisor is the only candidate at Satna.
    const before_ = findSupervisors({ stationId: ids.thirdStation, departmentId: ids.deptElec });
    assert.equal(before_[0].id, users.supervisor, before_[0].match_reason);
    assert.equal(before_[0].match_score, 60, 'nomination is the only thing speaking');

    // The other supervisor says for themselves that they cover Satna.
    const otherUser = db.insert('users', {
      employee_id: 'SUP2', name: 'Second Supervisor', role: 'supervisor',
      password_hash: 'x', department_id: ids.deptElec,
    });
    db.update('supervisors', users.otherSupervisor, { user_id: otherUser });
    juris.setJurisdiction(otherUser, { stations: [ids.thirdStation] }, { id: otherUser });

    const after_ = findSupervisors({ stationId: ids.thirdStation, departmentId: ids.deptElec });
    const declared = after_.find((s) => s.id === users.otherSupervisor);
    assert.equal(declared.match_score, 57, declared.match_reason);
    assert.match(declared.match_reason, /their own jurisdiction/i);
    // 57 beats the bare nomination at 60, which is the point: it fills a gap.
    assert.equal(after_[0].id, users.otherSupervisor);
  });

  test('a station named outright is a closer claim than the section it sits on', () => {
    const sectionOnly = db.insert('users', {
      employee_id: 'SUP3', name: 'Section Supervisor', role: 'supervisor',
      password_hash: 'x', department_id: ids.deptElec,
    });
    const supervisor = db.insert('supervisors', {
      employee_id: 'SSE-EL-3', name: 'Section SSE', designation: 'SSE/Electrical',
      department_id: ids.deptElec, user_id: sectionOnly, active: 1,
    });
    juris.setJurisdiction(sectionOnly, { sections: ['KTE-STA'] }, { id: sectionOnly });

    const ranked = findSupervisors({ stationId: ids.thirdStation, departmentId: ids.deptElec });
    const bySection = ranked.find((s) => s.id === supervisor);
    const byStation = ranked.find((s) => s.id === users.otherSupervisor);
    assert.equal(bySection.match_score, 58, bySection.match_reason);
    assert.ok(byStation.match_score < bySection.match_score, 'the station claim is the closer one');
  });

  test('a self-declared claim never outranks a link the division recorded', () => {
    // The division records that the first supervisor covers Satna.
    db.insert('supervisor_stations', {
      supervisor_id: users.supervisor, station_id: ids.thirdStation, is_primary: 0, priority: 50, active: 1,
    });
    const ranked = findSupervisors({ stationId: ids.thirdStation, departmentId: ids.deptElec });
    const recorded = ranked.find((s) => s.id === users.supervisor);
    const declared = ranked.find((s) => s.id === users.otherSupervisor);

    assert.equal(recorded.match_score, 55, recorded.match_reason);
    assert.ok(
      recorded.match_score < declared.match_score,
      `the division's own record (${recorded.match_score}) must win over a self-declared claim (${declared.match_score})`
    );
    assert.equal(ranked[0].id, users.supervisor);
  });

  test('coverage is readable directly, and says how it is covered', () => {
    const otherUser = db.get('SELECT user_id FROM supervisors WHERE id = ?', [users.otherSupervisor]).user_id;
    assert.equal(juris.coversStation(otherUser, ids.thirdStation), true);
    assert.equal(juris.coverageKind(otherUser, ids.thirdStation), 'station');
    assert.equal(juris.coversStation(otherUser, ids.station), false);
  });
});
