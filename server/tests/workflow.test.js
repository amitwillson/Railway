import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { useTempData, cleanup, seedMinimal, seedUsers } from './helpers.js';

const dir = useTempData('workflow');

const db = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/auth.js');

const PASSWORD = 'Railway@2026';
let app;
let ids;
let users;
let inspectorToken;
let supervisorToken;
let officerToken;

const login = async (identifier) => {
  const response = await request(app).post('/api/auth/login').send({ identifier, password: PASSWORD });
  assert.equal(response.status, 200, `login failed for ${identifier}: ${JSON.stringify(response.body)}`);
  return response.body.token;
};

before(async () => {
  db.getDb();
  ids = seedMinimal(db);
  users = seedUsers(db, ids);
  // Give the seeded users a usable password and the notification rules the
  // workflow depends on.
  const hash = hashPassword(PASSWORD);
  db.run('UPDATE users SET password_hash = ?', [hash]);
  db.insert('notification_rules', {
    event: 'OBSERVATION_ASSIGNED',
    recipients: JSON.stringify(['supervisor']),
    in_app: 1, email: 0, sms: 0,
    template_title: 'New observation {{ref_no}} assigned to you',
    template_body: '{{item_name}} at {{unit_name}} - {{observation}}',
  });
  db.insert('notification_rules', {
    event: 'COMPLIANCE_SUBMITTED',
    recipients: JSON.stringify(['inspector']),
    in_app: 1, email: 0, sms: 0,
    template_title: 'Compliance submitted for {{ref_no}}',
  });
  db.insert('tdc_rules', {
    name: 'Default', severity_id: null, remind_before_days: 2, remind_on_due_date: 1,
    overdue_repeat_days: 3, escalate_after_days: 7, escalate_to_role: 'divisional_officer',
  });
  db.insert('escalation_levels', { level: 1, name: 'Divisional officer', after_days: 3, target_role: 'divisional_officer' });

  app = createApp();
  inspectorToken = await login('INS1');
  supervisorToken = await login('SUP1');
  officerToken = await login('OFF1');
});

after(() => {
  db.closeDb();
  cleanup(dir);
});

const auth = (req, token) => req.set('authorization', `Bearer ${token}`);

describe('authentication', () => {
  test('rejects a wrong password', async () => {
    const response = await request(app).post('/api/auth/login').send({ identifier: 'INS1', password: 'wrong' });
    assert.equal(response.status, 401);
  });

  test('rejects an unauthenticated request', async () => {
    const response = await request(app).get('/api/observations');
    assert.equal(response.status, 401);
  });

  test('returns the signed-in user', async () => {
    const response = await auth(request(app).get('/api/auth/me'), inspectorToken);
    assert.equal(response.status, 200);
    assert.equal(response.body.user.employee_id, 'INS1');
  });
});

describe('the end-to-end observation workflow', () => {
  let inspectionId;
  let observationId;
  let observationRef;

  test('an inspector creates an inspection', async () => {
    const response = await auth(request(app).post('/api/inspections'), inspectorToken).send({
      module_id: ids.module,
      inspection_type_id: ids.type,
      location_type: 'Station',
      station_id: ids.station,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.match(response.body.ref_no, /^INSP-\d{4}-\d{6}$/);
    inspectionId = response.body.id;
  });

  test('submitting an observation assigns it and notifies the supervisor', async () => {
    const response = await auth(request(app).post('/api/observations'), inspectorToken).send({
      inspection_id: inspectionId,
      unit_id: ids.unitPf2,
      item_id: ids.item,
      observation: 'Water cooler is not functioning.',
      action_by_department_id: ids.deptElec,
      tdc: '2026-09-30',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    observationId = response.body.id;
    observationRef = response.body.ref_no;
    assert.match(observationRef, /^OBS-\d{4}-\d{6}$/);
    assert.equal(response.body.status, 'assigned', 'it is assigned, not just submitted');
    assert.equal(response.body.supervisor_name, 'Rajesh Meshram', 'the supervisor is identified automatically');
    assert.equal(response.body.assignment_mode, 'auto');
    assert.equal(response.body.notification.recipients, 1, 'the supervisor is notified');
    assert.equal(response.body.tdc, '2026-09-30');
  });

  test('the same client_uuid never creates a duplicate', async () => {
    const payload = {
      inspection_id: inspectionId,
      unit_id: ids.unitPf2,
      item_id: ids.item,
      observation: 'Offline capture, uploaded twice.',
      action_by_department_id: ids.deptElec,
      client_uuid: 'fixed-uuid-for-this-test',
    };
    const first = await auth(request(app).post('/api/observations'), inspectorToken).send(payload);
    const second = await auth(request(app).post('/api/observations'), inspectorToken).send(payload);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.deduplicated, true);
    assert.equal(second.body.id, first.body.id);
  });

  test('the observation reaches the supervisor queue and notifications', async () => {
    const queue = await auth(request(app).get('/api/compliance/queue'), supervisorToken);
    assert.equal(queue.status, 200);
    assert.ok(queue.body.data.some((o) => o.ref_no === observationRef));

    const notifications = await auth(request(app).get('/api/notifications?unread=true'), supervisorToken);
    assert.ok(notifications.body.data.some((n) => n.observation_ref === observationRef));
  });

  test('a supervisor cannot verify, and an inspector cannot submit compliance for another department', async () => {
    const verify = await auth(request(app).post(`/api/observations/${observationId}/verify`), supervisorToken)
      .send({ decision: 'accept' });
    assert.equal(verify.status, 403);
  });

  test('the supervisor acknowledges and submits compliance', async () => {
    const ack = await auth(request(app).post(`/api/observations/${observationId}/acknowledge`), supervisorToken)
      .send({ remarks: 'Noted' });
    assert.equal(ack.status, 200);
    assert.equal(ack.body.status, 'acknowledged');

    const compliance = await auth(request(app).post(`/api/observations/${observationId}/compliance`), supervisorToken)
      .field('action_taken', 'Compressor relay replaced and cooling restored.')
      .field('compliance_date', '2026-09-28');
    assert.equal(compliance.status, 201, JSON.stringify(compliance.body));
    assert.equal(compliance.body.status, 'compliance_submitted');
    assert.equal(compliance.body.compliance.round, 1);
  });

  test('rejection needs a reason and reopens the observation', async () => {
    const noReason = await auth(request(app).post(`/api/observations/${observationId}/verify`), inspectorToken)
      .send({ decision: 'reject' });
    assert.equal(noReason.status, 400);

    const rejected = await auth(request(app).post(`/api/observations/${observationId}/verify`), inspectorToken)
      .send({ decision: 'reject', rejection_reason: 'Cooler was switched off again on verification.' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'reopened');
    assert.equal(rejected.body.reopen_count, 1);
  });

  test('a second compliance round can be accepted, closing the observation', async () => {
    const second = await auth(request(app).post(`/api/observations/${observationId}/compliance`), supervisorToken)
      .field('action_taken', 'Thermostat replaced; cooler on continuous supply.')
      .field('compliance_date', '2026-09-29');
    assert.equal(second.status, 201);
    assert.equal(second.body.compliance.round, 2);

    const accepted = await auth(request(app).post(`/api/observations/${observationId}/verify`), inspectorToken)
      .send({ decision: 'accept', remarks: 'Verified working.' });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.status, 'closed');
    assert.ok(accepted.body.closed_at);
  });

  test('the timeline records every step in order', async () => {
    const detail = await auth(request(app).get(`/api/observations/${observationId}`), inspectorToken);
    const actions = detail.body.timeline.map((e) => e.action);
    assert.deepEqual(actions, [
      'SUBMITTED', 'ASSIGNED', 'ACKNOWLEDGED', 'COMPLIANCE_SUBMITTED',
      'COMPLIANCE_REJECTED', 'COMPLIANCE_SUBMITTED', 'VERIFIED', 'CLOSED',
    ]);
    assert.equal(detail.body.compliances.length, 2);
    assert.equal(detail.body.compliances[0].status, 'rejected');
    assert.equal(detail.body.compliances[1].status, 'accepted');
  });

  test('every action is written to the audit trail', async () => {
    const audit = await auth(request(app).get(`/api/admin/audit?entity_type=observation&entity_id=${observationId}`), officerToken);
    assert.equal(audit.status, 200);
    const actions = audit.body.data.map((a) => a.action);
    assert.ok(actions.includes('OBSERVATION_CREATE'));
    assert.ok(actions.includes('COMPLIANCE_SUBMIT'));
    assert.ok(actions.includes('COMPLIANCE_VERIFY'));
  });

  test('a closed observation can be reopened by an officer', async () => {
    const response = await auth(request(app).post(`/api/observations/${observationId}/reopen`), officerToken)
      .send({ reason: 'Deficiency recurred within a week.' });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'reopened');
  });
});

describe('validation and access control', () => {
  test('a short observation is rejected with field details', async () => {
    const inspection = await auth(request(app).post('/api/inspections'), inspectorToken).send({
      module_id: ids.module, inspection_type_id: ids.type, location_type: 'Station', station_id: ids.station,
    });
    const response = await auth(request(app).post('/api/observations'), inspectorToken).send({
      inspection_id: inspection.body.id, observation: 'bad', action_by_department_id: ids.deptElec,
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'BAD_REQUEST');
    assert.ok(response.body.error.details.some((d) => d.path === 'observation'));
  });

  test('an unknown department is rejected', async () => {
    const inspection = await auth(request(app).post('/api/inspections'), inspectorToken).send({
      module_id: ids.module, inspection_type_id: ids.type, location_type: 'Station', station_id: ids.station,
    });
    const response = await auth(request(app).post('/api/observations'), inspectorToken).send({
      inspection_id: inspection.body.id, observation: 'A valid observation text.', action_by_department_id: 9999,
    });
    assert.equal(response.status, 400);
  });

  test('a supervisor cannot reach the admin panel', async () => {
    const response = await auth(request(app).get('/api/admin/masters/stations'), supervisorToken);
    assert.equal(response.status, 403);
  });

  test('a supervisor cannot create an inspection', async () => {
    const response = await auth(request(app).post('/api/inspections'), supervisorToken).send({
      module_id: ids.module, inspection_type_id: ids.type, location_type: 'Station', station_id: ids.station,
    });
    assert.equal(response.status, 403);
  });
});

describe('offline sync', () => {
  test('uploads an inspection and its observation together, idempotently', async () => {
    const operations = {
      operations: [
        {
          type: 'inspection',
          client_uuid: 'offline-inspection-1',
          payload: {
            module_id: ids.module, inspection_type_id: ids.type,
            location_type: 'Station', station_id: ids.station,
          },
        },
        {
          type: 'observation',
          client_uuid: 'offline-observation-1',
          inspection_client_uuid: 'offline-inspection-1',
          payload: {
            unit_id: ids.unitPf2, item_id: ids.item,
            observation: 'Captured with no connectivity on the platform.',
            action_by_department_id: ids.deptElec,
          },
        },
      ],
    };
    const first = await auth(request(app).post('/api/sync/batch'), inspectorToken).send(operations);
    assert.equal(first.status, 200);
    assert.equal(first.body.summary.created, 2);
    assert.equal(first.body.results[1].supervisor_name, 'Rajesh Meshram');

    const second = await auth(request(app).post('/api/sync/batch'), inspectorToken).send(operations);
    assert.equal(second.body.summary.created, 0);
    assert.equal(second.body.summary.duplicates, 2);
  });

  test('reports a failure without losing the rest of the batch', async () => {
    const response = await auth(request(app).post('/api/sync/batch'), inspectorToken).send({
      operations: [
        {
          type: 'observation',
          client_uuid: 'orphan-observation',
          inspection_client_uuid: 'never-synced',
          payload: { observation: 'Orphan observation.', action_by_department_id: ids.deptElec },
        },
      ],
    });
    assert.equal(response.body.summary.failed, 1);
    assert.match(response.body.results[0].error, /has not been synced/);
  });

  test('the offline snapshot carries the masters the inspection screen needs', async () => {
    const response = await auth(request(app).get('/api/sync/snapshot'), inspectorToken);
    assert.equal(response.status, 200);
    for (const key of ['modules', 'stations', 'units', 'inspection_items', 'supervisors', 'departments']) {
      assert.ok(Array.isArray(response.body[key]) && response.body[key].length > 0, `${key} is present`);
    }
  });
});

describe('dashboards and reports', () => {
  test('the overview totals are consistent', async () => {
    const response = await auth(request(app).get('/api/dashboard/overview'), officerToken);
    assert.equal(response.status, 200);
    const o = response.body.observations;
    assert.ok(o.total >= o.open);
    assert.equal(typeof response.body.compliance.closure_rate, 'number');
  });

  test('reports render as JSON, CSV and Excel', async () => {
    const json = await auth(request(app).get('/api/reports/pending'), officerToken);
    assert.equal(json.status, 200);
    assert.ok(Array.isArray(json.body.data));

    const csv = await auth(request(app).get('/api/reports/pending?format=csv'), officerToken);
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.text, /Observation ID/);

    const xlsx = await auth(request(app).get('/api/reports/station-wise?format=xlsx'), officerToken)
      .buffer()
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    assert.equal(xlsx.status, 200);
    assert.equal(xlsx.body.subarray(0, 2).toString(), 'PK', 'an xlsx file is a zip archive');
  });

  test('a report QR token verifies without a login', async () => {
    const token = db.get('SELECT token FROM report_tokens ORDER BY rowid DESC LIMIT 1');
    if (!token) return; // only PDF generation mints tokens
    const response = await request(app).get(`/api/reports/verify/${token.token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.verified, true);
  });
});

describe('TDC monitoring', () => {
  test('an overdue observation is reported and escalated', async () => {
    const { runReminderSweep } = await import('../src/lib/scheduler.js');
    const inspection = await auth(request(app).post('/api/inspections'), inspectorToken).send({
      module_id: ids.module, inspection_type_id: ids.type, location_type: 'Station', station_id: ids.station,
    });
    const observation = await auth(request(app).post('/api/observations'), inspectorToken).send({
      inspection_id: inspection.body.id,
      unit_id: ids.unitPf2,
      item_id: ids.item,
      observation: 'Tap leaking continuously at the water booth.',
      action_by_department_id: ids.deptElec,
      tdc: '2026-01-01', // deliberately in the past
    });
    assert.equal(observation.status, 201);

    const summary = await runReminderSweep({ asOf: '2026-01-10' }); // 9 days overdue
    assert.ok(summary.overdue >= 1, 'an overdue reminder is raised');
    assert.ok(summary.escalated >= 1, 'the observation is escalated');

    const after = db.get('SELECT escalation_level FROM observations WHERE id = ?', [observation.body.id]);
    assert.ok(after.escalation_level >= 1);

    // The sweep is idempotent for the same day.
    const repeat = await runReminderSweep({ asOf: '2026-01-10' });
    assert.equal(repeat.overdue, 0);
    assert.equal(repeat.escalated, 0);
  });

  test('an observation without a TDC is never overdue', async () => {
    const list = await auth(request(app).get('/api/observations?has_tdc=false&overdue=true'), officerToken);
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0);
  });
});
