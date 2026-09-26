#!/usr/bin/env node
/**
 * End-to-end smoke test against a running server.
 *
 *   npm run seed:reset && npm start          # in one terminal
 *   node scripts/smoke-test.mjs              # in another
 *
 * It walks the reference scenario from the specification - Jabalpur, Platform
 * No. 2, Drinking Water - through the whole workflow, and checks the pieces
 * that are easy to break: smart assignment, repeated-deficiency detection,
 * notification, compliance, rejection, closure, offline sync and access
 * control. Exits non-zero on the first failing expectation.
 */
const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Railway@2026';

const failures = [];
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail ? `  ${detail}` : ''}`);
  if (!condition) failures.push(label);
}

const heading = (text) => console.log(`\n${'='.repeat(74)}\n${text}\n${'='.repeat(74)}`);

async function call(method, path, { token, body, form, params } = {}) {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(url, { method, headers, body: payload });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: response.status, data };
}

const login = async (identifier) => {
  const { status, data } = await call('POST', '/auth/login', { body: { identifier, password: PASSWORD } });
  if (status !== 200) throw new Error(`login failed for ${identifier}: ${JSON.stringify(data)}`);
  return data.token;
};

/* -------------------------------------------------------------------------- */

heading('1. Sign in');
const inspector = await login('CMI01');
const supervisor = await login('SSEEL01');
const officer = await login('SRDCM01');
check('inspector, supervisor and officer can sign in', Boolean(inspector && supervisor && officer));

heading('2. Master data for the inspection screen');
const { data: masters } = await call('GET', '/masters/bootstrap', { token: inspector });
check('three inspection modules', masters.modules?.length === 3, masters.modules?.map((m) => m.code).join(', '));
check('inspection items are loaded', masters.counts?.items > 100, `${masters.counts?.items} items`);

const { data: stations } = await call('GET', '/masters/stations', { token: inspector, params: { q: 'jabal' } });
const station = stations.data[0];
check('station search returns Jabalpur with its details', station?.code === 'JBP',
  `${station?.name} | ${station?.division_name} Division | ${station?.category} | ${station?.station_type}`);

const { data: units } = await call('GET', '/masters/units', { token: inspector, params: { station_id: station.id } });
const unit = units.data.find((u) => u.name === 'Platform No. 2');
check('units are populated for that station', Boolean(unit), `${units.data.length} areas`);

const { data: items } = await call('GET', '/masters/items', {
  token: inspector, params: { module_code: 'PA', q: 'drinking' },
});
const item = items.data[0];
check('amenity master is searchable', item?.name === 'Drinking Water');

heading('3. Smart assignment');
const electrical = masters.departments.find((d) => d.code === 'ELEC');
const { data: resolved } = await call('GET', '/masters/supervisors/resolve', {
  token: inspector,
  params: { station_id: station.id, unit_id: unit.id, department_id: electrical.id, item_id: item.id },
});
check('a supervisor is identified automatically', Boolean(resolved.auto_selected),
  `${resolved.auto_selected?.name} | ${resolved.auto_selected?.mobile} | ${resolved.auto_selected?.match_reason}`);
check('alternatives are offered', resolved.data.length > 1, `${resolved.data.length} candidates`);

heading('4. Repeated deficiency detection');
const { data: repeats } = await call('GET', '/observations/repeat-check', {
  token: inspector,
  params: { station_id: station.id, unit_id: unit.id, item_id: item.id, observation: 'Water cooler is not functioning' },
});
check('earlier occurrences are found', repeats.count >= 2, repeats.message ?? '');

heading('5. Record the observation');
const { data: inspection } = await call('POST', '/inspections', {
  token: inspector,
  body: {
    module_id: masters.modules.find((m) => m.code === 'PA').id,
    inspection_type_id: masters.inspection_types.find((t) => t.name === 'Passenger Amenities Inspection').id,
    location_type: 'Station',
    station_id: station.id,
    client_uuid: crypto.randomUUID(),
  },
});
check('inspection created', Boolean(inspection.ref_no), inspection.ref_no);

const clientUuid = crypto.randomUUID();
const observationBody = {
  inspection_id: inspection.id,
  unit_id: unit.id,
  item_id: item.id,
  observation: 'Water cooler is not functioning.',
  action_by_department_id: electrical.id,
  tdc: '2026-09-30',
  client_uuid: clientUuid,
};
const { status: createStatus, data: observation } = await call('POST', '/observations', {
  token: inspector, body: observationBody,
});
check('observation submitted', createStatus === 201, observation.ref_no);
check('supervisor identified and assigned', observation.supervisor_name === resolved.auto_selected.name,
  `${observation.supervisor_name} (${observation.department_name})`);
check('notification sent', observation.notification?.recipients >= 1,
  observation.notification?.deliveries?.map((d) => `${d.channel}=${d.status}`).join(', '));
check('TDC monitoring started', observation.tdc === '2026-09-30');
check('flagged as a repeated deficiency', observation.repeat_count >= 2, observation.repeats?.message ?? '');

const { status: dedupeStatus, data: dedupe } = await call('POST', '/observations', {
  token: inspector, body: observationBody,
});
check('re-submitting the same client_uuid is idempotent', dedupeStatus === 200 && dedupe.deduplicated === true);

heading('6. Supervisor acts on it');
const { data: queue } = await call('GET', '/compliance/queue', { token: supervisor });
check('it appears in the supervisor queue', queue.data.some((o) => o.ref_no === observation.ref_no));

const { data: inbox } = await call('GET', '/notifications', { token: supervisor, params: { unread: true } });
check('the supervisor is notified', inbox.data.some((n) => n.observation_ref === observation.ref_no));

const { data: acknowledged } = await call('POST', `/observations/${observation.id}/acknowledge`, {
  token: supervisor, body: { remarks: 'Noted, mechanic deputed.' },
});
check('acknowledged', acknowledged.status === 'acknowledged');

const compliance = new FormData();
compliance.append('action_taken', 'Compressor relay replaced and cooling restored.');
compliance.append('compliance_date', new Date().toISOString().slice(0, 10));
const { status: complianceStatus, data: complied } = await call('POST', `/observations/${observation.id}/compliance`, {
  token: supervisor, form: compliance,
});
check('compliance submitted', complianceStatus === 201 && complied.status === 'compliance_submitted');

heading('7. Inspector verifies');
const { status: rejectStatus } = await call('POST', `/observations/${observation.id}/verify`, {
  token: inspector, body: { decision: 'reject' },
});
check('a rejection without a reason is refused', rejectStatus === 400);

const { data: rejected } = await call('POST', `/observations/${observation.id}/verify`, {
  token: inspector, body: { decision: 'reject', rejection_reason: 'Cooler found switched off on verification.' },
});
check('rejected observations reopen', rejected.status === 'reopened');

const second = new FormData();
second.append('action_taken', 'Thermostat replaced and cooler kept on continuous supply.');
second.append('compliance_date', new Date().toISOString().slice(0, 10));
await call('POST', `/observations/${observation.id}/compliance`, { token: supervisor, form: second });

const { data: closed } = await call('POST', `/observations/${observation.id}/verify`, {
  token: inspector, body: { decision: 'accept', remarks: 'Verified working.' },
});
check('accepted compliance closes the observation', closed.status === 'closed');

const { data: detail } = await call('GET', `/observations/${observation.id}`, { token: inspector });
check('both compliance rounds are retained', detail.compliances.length === 2,
  detail.compliances.map((c) => `round ${c.round}: ${c.status}`).join(', '));
check('the timeline records every step', detail.timeline.length >= 8,
  [...new Set(detail.timeline.map((e) => e.to_status))].join(' -> '));

heading('8. Offline sync');
const offlineInspection = crypto.randomUUID();
const offlineObservation = crypto.randomUUID();
const operations = {
  operations: [
    {
      type: 'inspection',
      client_uuid: offlineInspection,
      payload: {
        module_id: masters.modules.find((m) => m.code === 'PA').id,
        inspection_type_id: masters.inspection_types.find((t) => t.module_code === 'PA').id,
        location_type: 'Station',
        station_id: station.id,
      },
    },
    {
      type: 'observation',
      client_uuid: offlineObservation,
      inspection_client_uuid: offlineInspection,
      payload: {
        unit_id: unit.id,
        item_id: item.id,
        observation: 'Recorded with no connectivity on the platform.',
        action_by_department_id: electrical.id,
      },
    },
  ],
};
const { data: synced } = await call('POST', '/sync/batch', { token: inspector, body: operations });
check('offline batch synced', synced.summary.created === 2, JSON.stringify(synced.summary));
const { data: resynced } = await call('POST', '/sync/batch', { token: inspector, body: operations });
check('re-syncing creates no duplicates', resynced.summary.duplicates === 2);

heading('9. Access control');
const { status: supervisorVerify } = await call('POST', `/observations/${observation.id}/verify`, {
  token: supervisor, body: { decision: 'accept' },
});
check('a supervisor cannot verify compliance', supervisorVerify === 403);
const { status: adminReach } = await call('GET', '/admin/masters/stations', { token: supervisor });
check('a supervisor cannot reach the admin panel', adminReach === 403);

heading('10. Dashboards and reports');
const { data: overview } = await call('GET', '/dashboard/overview', { token: officer });
check('dashboard metrics are computed', overview.observations.total > 0,
  `total ${overview.observations.total}, open ${overview.observations.open}, overdue ${overview.observations.overdue}`);
const { data: modules } = await call('GET', '/dashboard/modules', { token: officer });
check('all three modules are reported', modules.data.length === 3,
  modules.data.map((m) => `${m.module.code}:${m.total}`).join(' '));
const { status: csvStatus } = await call('GET', '/reports/pending', { token: officer, params: { format: 'csv' } });
check('reports export', csvStatus === 200);

console.log(`\n${failures.length ? `${failures.length} of ${checks} checks FAILED:\n - ${failures.join('\n - ')}` : `All ${checks} checks passed.`}\n`);
process.exit(failures.length ? 1 : 0);
