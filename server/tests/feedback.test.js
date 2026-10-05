import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { useTempData, cleanup, seedMinimal, seedUsers, seedInspection } from './helpers.js';

const dir = useTempData('feedback');

const db = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/auth.js');

const PASSWORD = 'Railway@2026';
let app;
let ids;
let users;
let inspectionId;
let inspectorToken;
let supervisorToken;
let officerToken;
let adminToken;

const auth = (req, token) => req.set('authorization', `Bearer ${token}`);
const login = async (identifier) => {
  const response = await request(app).post('/api/auth/login').send({ identifier, password: PASSWORD });
  assert.equal(response.status, 200, `login failed for ${identifier}`);
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
  inspectionId = seedInspection(db, ids, users.inspector);

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

describe('saying what would make the application easier', () => {
  test('an inspector finishing an inspection can say what slowed them down', async () => {
    const response = await auth(request(app).post('/api/profile/feedback'), inspectorToken).send({
      suggestion: 'The area sheet collapses every time I record a deficiency, and I lose my place.',
      kind: 'suggestion',
      area: 'Inspection sheet',
      inspection_id: inspectionId,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.status, 'new');
    assert.equal(response.body.user_name, 'Test Inspector');
    // It is tied to the inspection it came out of, which is what makes it useful.
    assert.equal(response.body.inspection_id, inspectionId);
    assert.ok(response.body.inspection_ref);
  });

  test('a supervisor who never runs an inspection can still say something', async () => {
    const response = await auth(request(app).post('/api/profile/feedback'), supervisorToken).send({
      suggestion: 'A daily digest at 08:00 would suit me better than a message for each observation.',
      kind: 'suggestion',
      area: 'Notifications',
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.inspection_id, null);
  });

  test('a one-word answer is refused', async () => {
    const response = await auth(request(app).post('/api/profile/feedback'), inspectorToken)
      .send({ suggestion: 'ok' });
    assert.equal(response.status, 400);
  });

  test('an unknown inspection is refused', async () => {
    const response = await auth(request(app).post('/api/profile/feedback'), inspectorToken)
      .send({ suggestion: 'Something useful about the application.', inspection_id: 999999 });
    assert.equal(response.status, 400);
  });
});

describe('who sees what', () => {
  test('an inspector sees only their own', async () => {
    const response = await auth(request(app).get('/api/profile/feedback'), inspectorToken);
    assert.equal(response.status, 200);
    assert.ok(response.body.data.length > 0);
    assert.ok(
      response.body.data.every((f) => f.user_id === users.inspector),
      'an officer must not read what their colleagues said'
    );
    assert.equal(response.body.summary, undefined, 'and must not get the office\'s counters');
  });

  test('the office sees everybody\'s, with a count of where they stand', async () => {
    const response = await auth(request(app).get('/api/profile/feedback'), officerToken);
    assert.equal(response.status, 200);
    const authors = new Set(response.body.data.map((f) => f.user_id));
    assert.ok(authors.size > 1, 'the office sees more than one officer\'s');
    // Two have been accepted so far; the two refused ones wrote nothing.
    assert.equal(response.body.summary.total, 2);
    assert.equal(response.body.summary.by_status.new, 2);
    assert.equal(response.body.summary.open, 2);
  });

  test('the office can ask for its own suggestions alone', async () => {
    const response = await auth(request(app).get('/api/profile/feedback?mine=1'), officerToken);
    assert.equal(response.body.data.length, 0, 'this officer has said nothing yet');
  });
});

describe('answering', () => {
  test('the office replies, which moves the status and never edits what was said', async () => {
    const mine = (await auth(request(app).get('/api/profile/feedback'), inspectorToken)).body.data[0];
    const original = mine.suggestion;

    const response = await auth(request(app).patch(`/api/profile/feedback/${mine.id}`), officerToken).send({
      status: 'planned',
      response: 'Agreed. The sheet will keep the area open after a deficiency is recorded.',
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.status, 'planned');
    assert.equal(response.body.suggestion, original, 'the officer\'s own words are not rewritten');
    assert.equal(response.body.responded_by_name, 'Test Officer');
    assert.ok(response.body.responded_at);
  });

  test('an inspector cannot answer their own, or anybody else\'s', async () => {
    const mine = (await auth(request(app).get('/api/profile/feedback'), inspectorToken)).body.data[0];
    const response = await auth(request(app).patch(`/api/profile/feedback/${mine.id}`), inspectorToken)
      .send({ status: 'done' });
    assert.equal(response.status, 403);
  });

  test('the author may withdraw what they said, until it has been answered', async () => {
    const fresh = await auth(request(app).post('/api/profile/feedback'), inspectorToken)
      .send({ suggestion: 'On reflection this one was not worth raising at all.' });
    const withdrawn = await auth(request(app).delete(`/api/profile/feedback/${fresh.body.id}`), inspectorToken);
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.status, 'declined');

    // One the office has already answered stays on the record.
    const answered = (await auth(request(app).get('/api/profile/feedback'), inspectorToken)).body.data.find(
      (f) => f.response
    );
    const refused = await auth(request(app).delete(`/api/profile/feedback/${answered.id}`), inspectorToken);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /already been answered/i);
  });

  test('one officer cannot withdraw another officer\'s', async () => {
    const theirs = (await auth(request(app).get('/api/profile/feedback'), supervisorToken)).body.data[0];
    const response = await auth(request(app).delete(`/api/profile/feedback/${theirs.id}`), inspectorToken);
    assert.equal(response.status, 403);
  });
});

describe('what an officer said is not master data', () => {
  test('the generic master editor cannot rewrite the words, or reattribute them', async () => {
    const mine = (await auth(request(app).get('/api/profile/feedback'), inspectorToken)).body.data[0];
    const original = mine.suggestion;

    // An administrator triaging through Admin -> Master data may correct where it
    // was filed, but the officer's own sentence is not a field they can edit.
    const response = await auth(
      request(app).patch(`/api/admin/masters/app_feedback/${mine.id}`),
      adminToken
    ).send({
      area: 'The report',
      suggestion: 'Something the officer never said.',
      user_id: users.supervisorUser,
    });

    const after = (await auth(request(app).get('/api/profile/feedback'), inspectorToken)).body.data
      .find((f) => f.id === mine.id);
    assert.ok(after, 'it must still belong to the officer who said it');
    assert.equal(after.suggestion, original, 'the officer\'s own words are not rewritten');
    assert.equal(after.user_id, users.inspector, 'and not reattributed to somebody else');
    if (response.status === 200) assert.equal(response.body.area, 'The report', 'filing can still be corrected');
  });
});
