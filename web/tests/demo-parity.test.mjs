import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The offline build has a second backend.
 *
 * `web/src/demo/router.ts` reimplements the server's engines in the browser so
 * that the single-file demonstration runs the real UI with no server. Two
 * implementations of the same rules drift, and when the demo one is wrong it
 * fails as a toast inside the page - which no server test and no type-check can
 * see. `npm run check:demo` drives it in a browser; this drives it directly, so
 * the rules themselves can be asserted rather than inferred from what the screen
 * happens to show.
 *
 * It bundles the TypeScript with esbuild (a Vite dependency, already present) and
 * calls `handle()` the way the demo transport does.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

let handle;
let DemoError;
let token;
let tmpDir;

/** One request, as web/src/api/transport.demo.ts makes it. */
function call(method, pathname, { body, query, as = token } = {}) {
  const [p, qs] = pathname.split('?');
  return handle({
    method,
    path: p,
    query: new URLSearchParams(qs ?? ''),
    token: as,
    body: body ?? (query ?? null),
  });
}

/** The error a call throws, or null when it succeeds. */
function refusal(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof DemoError || error?.status) return error;
    throw error;
  }
}

const login = (identifier) =>
  handle({
    method: 'POST',
    path: '/auth/login',
    query: new URLSearchParams(),
    token: null,
    body: { identifier, password: 'Railway@2026' },
  }).token;

before(async () => {
  const esbuild = await import('esbuild');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-parity-'));
  const outfile = path.join(tmpDir, 'router.mjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'web', 'src', 'demo', 'router.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    loader: { '.json': 'json' },
    outfile,
    logLevel: 'silent',
  });
  ({ handle, DemoError } = await import(`file://${outfile}`));
  token = login('CMI01');
  assert.ok(token, 'the demonstration accounts must sign in');
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** A station inspection, with its sheet opened as the real route opens it. */
function startInspection(over = {}) {
  const masters = call('GET', '/masters/bootstrap');
  const station = call('GET', '/masters/stations?q=pendra').data[0];
  return call('POST', '/inspections', {
    body: {
      module_id: masters.modules.find((m) => m.code === 'PA').id,
      inspection_type_id: masters.inspection_types[0].id,
      scope: 'station',
      station_id: station.id,
      ...over,
    },
  });
}

const sheetOf = (id) => call('GET', `/inspections/${id}/sheet`);

/* -------------------------------------------------------------------------- */
/* The sheet                                                                  */
/* -------------------------------------------------------------------------- */

describe('the offline backend keeps the sheet', () => {
  test('starting an inspection opens the whole station, every area not inspected', () => {
    const created = startInspection();
    assert.ok(created.sheet_opened > 3, `expected the areas on the sheet, got ${created.sheet_opened}`);
    const sheet = sheetOf(created.id);
    assert.equal(sheet.areas.length, created.sheet_opened);
    assert.ok(sheet.areas.every((a) => a.result === 'not_inspected'));
    assert.ok(sheet.areas[0].catalogue.length > 0);
    // "Other" is the catch-all, not an area of the station.
    assert.ok(!sheet.areas.some((a) => a.unit_name === 'Other'));
    assert.ok(sheet.available_areas.some((u) => u.name === 'Other'));
  });

  test('every route the sheet needs is reachable', () => {
    // The route patterns are built from the path, and a parameter name the matcher
    // does not understand makes a route silently unreachable.
    const created = startInspection();
    const area = sheetOf(created.id).areas[0];
    for (const [method, p, body] of [
      ['GET', `/inspections/${created.id}/sheet`, null],
      ['GET', `/inspections/${created.id}/areas/available`, null],
      ['POST', `/inspections/${created.id}/sheet`, { unit_ids: [] }],
      ['PATCH', `/inspections/${created.id}/areas/${area.id}`, { remarks: 'reachable' }],
      ['POST', `/inspections/${created.id}/areas/${area.id}/items`, { results: [{ item_id: null, result: 'ok' }] }],
      ['GET', `/inspections/${created.id}/previous`, null],
      ['GET', `/inspections/${created.id}/report`, null],
    ]) {
      const error = refusal(() => call(method, p, { body }));
      assert.notEqual(error?.code, 'NOT_FOUND', `${method} ${p} is not routed: ${error?.message}`);
    }
  });

  test('items marked in order turn the area satisfactory and move the coverage', () => {
    const created = startInspection();
    const area = sheetOf(created.id).areas[0];
    const items = area.catalogue[0].items.slice(0, 2);
    call('POST', `/inspections/${created.id}/areas/${area.id}/items`, {
      body: { results: items.map((i) => ({ item_id: i.id, result: 'ok' })) },
    });
    const after = sheetOf(created.id);
    assert.equal(after.areas.find((a) => a.id === area.id).result, 'satisfactory');
    assert.equal(after.coverage.items_ok, items.length);
    assert.equal(after.coverage.areas_satisfactory, 1);
  });

  test('a deficiency marks its area, and the area cannot then be marked in order', () => {
    const created = startInspection();
    const area = sheetOf(created.id).areas[1];
    const observation = call('POST', '/observations', {
      body: {
        inspection_id: created.id,
        inspection_area_id: area.id,
        unit_id: area.unit_id,
        item_id: area.catalogue[0].items[0].id,
        observation: 'Parity check: this amenity was found not working.',
        action_by_department_id: call('GET', '/masters/departments').data[0].id,
      },
    });
    assert.ok(observation.ref_no);
    assert.equal(sheetOf(created.id).areas.find((a) => a.id === area.id).result, 'deficiencies');

    const error = refusal(() =>
      call('PATCH', `/inspections/${created.id}/areas/${area.id}`, { body: { result: 'satisfactory' } })
    );
    assert.equal(error?.status, 400);
    assert.match(error.message, /observation/i);
  });
});

/* -------------------------------------------------------------------------- */
/* What must not be possible - the same refusals the server makes             */
/* -------------------------------------------------------------------------- */

describe('the offline backend refuses what the server refuses', () => {
  test('the previous-inspection review only accepts items carried forward', () => {
    // An observation from an inspection of a different station, which can never be
    // this inspection's predecessor.
    const elsewhere = call('GET', '/observations?page_size=50').data.find(
      (o) => o.station_code && o.station_code !== 'PND' && o.status !== 'closed'
    );
    assert.ok(elsewhere, 'the demonstration data must carry an open observation elsewhere');

    const current = startInspection();
    const error = refusal(() =>
      call('POST', `/inspections/${current.id}/previous/${elsewhere.id}`, { body: { finding: 'complied' } })
    );
    assert.equal(error?.status, 400, 'an unrelated observation must not be closeable here');
    assert.match(error.message, /not one of the items carried forward/i);
    assert.notEqual(call('GET', `/observations/${elsewhere.id}`).status, 'closed');
  });

  test('an issued report cannot be reworded', () => {
    const created = startInspection();
    call('POST', `/inspections/${created.id}/complete`, { body: {} });
    const issued = call('POST', `/inspections/${created.id}/issue`, { body: {} });
    assert.match(issued.inspection_no, /\/\d{4}-\d{2}\/\d{3}$/);

    const error = refusal(() =>
      call('PATCH', `/inspections/${created.id}`, { body: { general_remarks: 'added after issue' } })
    );
    assert.equal(error?.status, 400);
    assert.match(error.message, /can no longer be changed/i);
  });

  test('an issued report freezes the sheet behind it', () => {
    const created = startInspection();
    const area = sheetOf(created.id).areas[0];
    call('POST', `/inspections/${created.id}/complete`, { body: {} });
    call('POST', `/inspections/${created.id}/issue`, { body: {} });
    const error = refusal(() =>
      call('PATCH', `/inspections/${created.id}/areas/${area.id}`, { body: { result: 'satisfactory' } })
    );
    assert.equal(error?.status, 400);
    assert.match(error.message, /has been issued/i);
  });

  test('a cancelled inspection takes no more sheet writes', () => {
    const created = startInspection();
    const area = sheetOf(created.id).areas[0];
    call('PATCH', `/inspections/${created.id}`, { body: { status: 'cancelled' } });
    const error = refusal(() =>
      call('PATCH', `/inspections/${created.id}/areas/${area.id}`, { body: { result: 'satisfactory' } })
    );
    assert.equal(error?.status, 400);
    assert.match(error.message, /cancelled/i);
  });

  test('a report cannot be issued before the inspection is completed, or issued twice', () => {
    const created = startInspection();
    assert.match(refusal(() => call('POST', `/inspections/${created.id}/issue`, { body: {} })).message,
      /Complete the inspection/i);
    call('POST', `/inspections/${created.id}/complete`, { body: {} });
    call('POST', `/inspections/${created.id}/issue`, { body: {} });
    assert.match(refusal(() => call('POST', `/inspections/${created.id}/issue`, { body: {} })).message,
      /already been issued/i);
  });

  test('the inspection list filters by scope', () => {
    const all = call('GET', '/inspections?page_size=100');
    const trains = call('GET', '/inspections?scope=train&page_size=100');
    assert.ok(all.total > trains.total, 'the scope filter must narrow the list');
    assert.ok(trains.data.every((i) => i.scope === 'train'));
  });
});

/* -------------------------------------------------------------------------- */
/* The report reads the same as the server's                                  */
/* -------------------------------------------------------------------------- */

describe('the offline report', () => {
  test('it carries the parts, the coverage and the items found in order', () => {
    // The seeded flagship inspection, which the demonstration walkthrough opens.
    const report = call('GET', '/inspections/1/report');
    assert.ok(report.coverage.areas_on_sheet > 0);
    assert.equal(report.coverage.areas_covered + report.coverage.areas_not_inspected
      + report.coverage.areas_not_available, report.coverage.areas_on_sheet);
    assert.ok(report.items_in_order.length > 0, 'Part IV must carry the items found in order');
    assert.ok(report.areas_covered.length > 0 && report.areas_not_covered.length >= 0);
    assert.ok(report.defaults.letterhead && report.defaults.number_prefix);
    assert.match(report.narrative, /area\(s\) were attended to/);
    assert.match(report.narrative, /item\(s\) were checked/);
    assert.equal(report.previous_items.length, report.previous_items.filter((i) => i.finding_label).length);
  });

  test('coverage counters agree with the rows behind them', () => {
    const report = call('GET', '/inspections/1/report');
    const counted = {
      satisfactory: report.areas.filter((a) => a.result === 'satisfactory').length,
      deficiencies: report.areas.filter((a) => a.result === 'deficiencies').length,
      not_inspected: report.areas.filter((a) => a.result === 'not_inspected').length,
      not_available: report.areas.filter((a) => a.result === 'not_available').length,
    };
    assert.equal(report.coverage.areas_satisfactory, counted.satisfactory);
    assert.equal(report.coverage.areas_with_deficiencies, counted.deficiencies);
    assert.equal(report.coverage.areas_not_inspected, counted.not_inspected);
    assert.equal(report.coverage.areas_not_available, counted.not_available);
  });

  test('the inspection-based reports count visits, not areas', () => {
    const register = call('GET', '/reports/inspection-register?format=json');
    const inspections = call('GET', '/inspections?page_size=200');
    assert.equal(register.data.length, inspections.total, 'one row per inspection');
    assert.ok('attended_to' in register.data[0] && 'items_checked' in register.data[0]);

    const inspectorWise = call('GET', '/reports/inspector-wise?format=json');
    assert.equal(
      inspectorWise.data.reduce((n, r) => n + r.inspections, 0),
      inspections.total
    );

    const dashboard = call('GET', '/dashboard/inspections');
    assert.equal(dashboard.totals.inspections, inspections.total);
    assert.ok(dashboard.totals.areas_on_sheet >= dashboard.totals.areas_covered);
  });
});
