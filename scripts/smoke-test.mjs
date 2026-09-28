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

const { data: stations } = await call('GET', '/masters/stations', { token: inspector, params: { q: 'bilaspur' } });
const station = stations.data.find((s) => s.code === 'BSP');
check('station search returns the divisional headquarters with its details', station?.code === 'BSP',
  `${station?.name} | ${station?.division_name} Division | ${station?.category} | ${station?.station_type} | ${station?.section_name}`);

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

heading('11. Suggested deficiencies');
const { data: suggestions } = await call('GET', `/masters/items/${item.id}/deficiencies`, {
  token: inspector, params: { station_id: station.id },
});
check('the item offers suggested deficiencies', suggestions.data.length > 0,
  `${suggestions.data.length} offered, narrowest first: "${suggestions.data[0]?.text}"`);
check('the narrowest scope comes first', suggestions.data[0]?.scope === 'item' || suggestions.data[0]?.scope === 'group',
  `scope ${suggestions.data[0]?.scope}`);
check('a generic suggestion is worded for this item',
  suggestions.data.some((d) => d.scope === 'generic' && d.text.startsWith(item.name)),
  suggestions.data.find((d) => d.scope === 'generic')?.text ?? '');
check('wordings already used here are offered too', Array.isArray(suggestions.previously_used));

const picked = suggestions.data[0];
const { status: pickedStatus, data: fromSuggestion } = await call('POST', '/observations', {
  token: inspector,
  body: {
    inspection_id: inspection.id,
    unit_id: unit.id,
    item_id: item.id,
    deficiency_id: picked.id,
    observation: `${picked.text} Noticed again during this inspection.`,
    action_by_department_id: picked.department_id ?? electrical.id,
  },
});
check('an observation records the suggestion it came from', pickedStatus === 201, fromSuggestion.ref_no ?? '');
const { data: topDeficiencies } = await call('GET', '/dashboard/deficiencies', { token: officer });
check('it is counted in the most-reported list',
  topDeficiencies.data.some((d) => d.deficiency_id === picked.id),
  topDeficiencies.data[0] ? `top: "${topDeficiencies.data[0].text}" x${topDeficiencies.data[0].occurrences}` : '');

heading('12. Supervisors linked to stations and departments');
const { data: supervisorList } = await call('GET', '/masters/supervisors', {
  token: inspector, params: { department_id: electrical.id, limit: 50 },
});
const sectionMan = supervisorList.data.find((s) => (s.stations?.length ?? 0) > 1);
check('a supervisor can answer for more than one station', Boolean(sectionMan),
  sectionMan ? `${sectionMan.name}: ${sectionMan.stations.map((l) => l.station_code).join(', ')}` : '');
const covered = sectionMan?.stations.find((l) => !l.is_primary);
if (covered) {
  const { data: elsewhere } = await call('GET', '/masters/supervisors/resolve', {
    token: inspector, params: { station_id: covered.station_id, department_id: electrical.id },
  });
  check('the engine finds them at a station they only cover',
    elsewhere.data.some((c) => c.id === sectionMan.id),
    `${covered.station_name}: ${elsewhere.auto_selected?.name} (${elsewhere.auto_selected?.match_reason})`);
}
const { data: multiDept } = await call('GET', '/masters/supervisors', { token: inspector, params: { limit: 300 } });
const twoDepartments = multiDept.data.find((s) => (s.departments?.length ?? 0) > 1);
check('a supervisor can answer for more than one department', Boolean(twoDepartments),
  twoDepartments ? `${twoDepartments.name}: ${twoDepartments.departments.map((d) => d.department_code).join(', ')}` : '');

heading('13. Inspection note');
const { data: draft } = await call('GET', '/notes/draft', {
  token: inspector, params: { inspection_id: inspection.id },
});
check('a draft compiles the observations of the inspection', draft.observations.length >= 2,
  `${draft.observations.length} items, no. ${draft.note_no}`);
check('the office wording is offered', Boolean(draft.letterhead && draft.preamble && draft.addressee));

const { status: noteStatus, data: note } = await call('POST', '/notes', {
  token: inspector,
  body: { inspection_id: inspection.id, status: 'issued' },
});
check('the note is issued with a running number', noteStatus === 201 && note.status === 'issued',
  `${note.note_no} | ${note.observations?.length} items`);
check('it is grouped by the department that has to act', (note.by_department?.length ?? 0) >= 1,
  note.by_department?.map((g) => `${g.department}:${g.observations.length}`).join(' '));

const noteRes = await fetch(`${BASE}/notes/${note.id}/print?format=pdf&group_by_department=1`, {
  headers: { authorization: `Bearer ${inspector}` },
});
const pdf = Buffer.from(await noteRes.arrayBuffer());
check('it prints as a PDF letter', noteRes.status === 200 && pdf.subarray(0, 5).toString() === '%PDF-',
  `${(pdf.length / 1024).toFixed(1)} KB`);

const { status: verifyStatus, data: verified } = await call('GET', `/notes/verify/${note.qr_token}`);
check('the printed letter verifies without a login', verifyStatus === 200 && verified.verified === true,
  `${verified.note_no} signed by ${verified.signed_by?.name}`);

const { status: rewordStatus } = await call('PATCH', `/notes/${note.id}`, {
  token: inspector, body: { subject: 'A different subject' },
});
check('an issued note cannot be reworded', rewordStatus === 400);

const others = await call('GET', '/observations', { token: inspector, params: { page_size: 3 } });
const { status: compiledStatus, data: compiled } = await call('POST', '/notes', {
  token: inspector,
  body: {
    observation_ids: others.data.data.map((o) => o.id),
    subject: 'Observations compiled from more than one inspection',
  },
});
check('observations from several inspections compile into one letter',
  compiledStatus === 201 && compiled.observations.length === others.data.data.length,
  `${compiled.note_no} | ${compiled.observations?.length} items`);

heading('14. Replacing the station list');
const admin = await login('ADMIN01');
const exportRes = await call('GET', '/admin/stations/export', { token: admin });
check('the current station list exports as CSV', exportRes.status === 200);
const { data: dryRun } = await call('POST', '/admin/stations/import', {
  token: admin,
  body: {
    csv: 'Station Code,Station Name,Division,Zone,Category,Station Type,Section,No. of Platforms\n'
      + 'BSP,Bilaspur,BSP,SECR,NSG-2,Junction,JSG-BSP,8\n'
      + 'SMOKE,Smoke Test Halt,BSP,SECR,HG-3,Halt,JSG-BSP,1\n'
      + 'BAD,Unknown division,QQQ,SECR,,,,1',
    dry_run: true,
  },
});
check('a dry run reports what would change and writes nothing',
  dryRun.counts.created === 1 && dryRun.counts.updated === 1 && dryRun.counts.skipped === 1,
  JSON.stringify(dryRun.counts));
const { data: before } = await call('GET', '/masters/stations', { token: admin, params: { q: 'Smoke', limit: 5 } });
check('the dry run left the master alone', before.data.length === 0);

heading('15. The divisional record');
const { data: sectionList } = await call('GET', '/masters/sections', { token: inspector });
check('the division is laid out by section', sectionList.data.length > 0,
  sectionList.data.map((x) => `${x.code}:${x.station_count}`).join(' '));
const onSection = await call('GET', '/masters/stations', {
  token: inspector, params: { section: sectionList.data[0].code, limit: 200 },
});
check('stations can be listed by section',
  onSection.data.data.length === sectionList.data[0].station_count,
  `${sectionList.data[0].code}: ${onSection.data.data.length} stations`);

const { data: stationRecord } = await call('GET', `/masters/stations/${station.id}`, { token: inspector });
check('the station carries its divisional details',
  Boolean(stationRecord.section && stationRecord.state && stationRecord.km),
  `${stationRecord.section_name} | ${stationRecord.state} | km ${stationRecord.km} | ${stationRecord.platforms} platforms`);
check('the PAMS facility record is served with it', Boolean(stationRecord.facilities),
  stationRecord.facilities
    ? `${stationRecord.facilities.passengers_per_day} passengers a day, ${stationRecord.facilities.booking_windows} booking windows, IOW ${stationRecord.facilities.iow_unit}`
    : 'missing');
check('the unit list matches the platforms the station actually has',
  stationRecord.units.filter((u) => u.kind === 'platform').length === stationRecord.platforms,
  `${stationRecord.units.filter((u) => u.kind === 'platform').length} platform areas for ${stationRecord.platforms} platforms`);
check('every supervisor who answers for the station is listed', stationRecord.supervisors.length > 1,
  `${stationRecord.supervisors.length} posts, ${stationRecord.supervisors.filter((x) => x.posted_here).length} posted here`);

check('the minimum essential amenities are recorded', stationRecord.amenity_norms.length > 0,
  `${stationRecord.amenity_norms.length} norm items, ${stationRecord.amenity_norms.filter((n) => !n.meets_norm).length} below the norm`);
// The norm the New Inspection screen asks for, against the item it is recorded
// under: "Water Coolers" is a norm item, and it maps to the Water Cooler item.
const normItemId = stationRecord.amenity_norms.find((n) => n.item_id)?.item_id;
const { data: itemNorm } = await call('GET', `/masters/stations/${station.id}/norms`, {
  token: inspector, params: { item_id: normItemId },
});
check('the norm for one item is served to the inspection screen', itemNorm.data.length > 0,
  itemNorm.data.map((n) => `${n.item_label}: ${n.provided} provided / ${n.required} required ${n.unit}`).join(', '));

console.log(`\n${failures.length ? `${failures.length} of ${checks} checks FAILED:\n - ${failures.join('\n - ')}` : `All ${checks} checks passed.`}\n`);
process.exit(failures.length ? 1 : 0);
