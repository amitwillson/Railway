/**
 * Drives the offline demonstration build in a real browser, from file://.
 *
 *   node scripts/demo-check.mjs            (after npm run demo:build)
 *
 * It exists because the single-file build has its own backend - the in-browser
 * router in web/src/demo - and a route that the server has but the demo does not
 * fails as a toast inside the page, not as a console error or a failed request.
 * Nothing in a type-check or a unit test sees that. So this walks the inspection
 * through to its report and fails on three things:
 *
 *   * any error toast (a demo route that is missing, or disagrees with the server)
 *   * any page or console error
 *   * any network request at all - the file must work with no server
 *
 * Playwright is not a dependency of this repository - it is a few hundred
 * megabytes for a check most contributors never run - so the script resolves it
 * if it is there and says how to get it if it is not:
 *
 *   npm i -D playwright && npx playwright install chromium
 *
 * CHROMIUM_PATH points at an existing browser instead, and NODE_PATH at an
 * existing Playwright install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const FILE = process.env.DEMO_FILE ?? path.join(REPO, 'demo', 'railway-inspection-demo.html');
const PASSWORD = process.env.SEED_PASSWORD ?? 'Railway@2026';

if (!fs.existsSync(FILE)) {
  console.error(`No demonstration build at ${FILE}. Run "npm run demo:build" first.`);
  process.exit(1);
}

/**
 * Resolves Playwright from the repository, or from wherever NODE_PATH points -
 * ESM `import` ignores NODE_PATH, so the CommonJS resolver is asked as well.
 */
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // Playwright is CommonJS, so the require it came from is what carries its
    // exports; importing the resolved file gives a namespace without `chromium`.
    const { createRequire } = await import('node:module');
    return createRequire(import.meta.url)('playwright');
  }
}

let chromium;
try {
  ({ chromium } = await loadPlaywright());
} catch {
  console.log(
    '\n  SKIPPED - this check drives a real browser and Playwright is not installed.\n'
      + '  Install it with:  npm i -D playwright && npx playwright install chromium\n'
      + '  Then:             npm run check:demo\n'
  );
  process.exit(0);
}

const failures = [];
let checks = 0;
const check = (label, condition, detail = '') => {
  checks += 1;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? `  ${detail}` : ''}`);
  if (!condition) failures.push(label);
};
const heading = (text) => console.log(`\n${'='.repeat(74)}\n${text}\n${'='.repeat(74)}`);

const launch = { executablePath: process.env.CHROMIUM_PATH || undefined };
const browser = await chromium.launch(launch);
const context = await browser.newContext({ viewport: { width: 430, height: 940 } });
const page = await context.newPage();

const pageErrors = [];
const requests = [];
const errorToasts = [];

page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
});
page.on('request', (r) => {
  const url = r.url();
  if (!/^(file|data|blob):/.test(url)) requests.push(url);
});

/**
 * A failed demo call is reported to the user as a toast and nowhere else, so the
 * toasts are sampled after every step rather than only at the end - they fade.
 */
async function sampleToasts() {
  const found = await page
    .locator('[class*="toast"]')
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => /danger|error|critical/.test(n.className))
        .map((n) => n.textContent?.trim() ?? '')
    )
    .catch(() => []);
  for (const text of found) if (text && !errorToasts.includes(text)) errorToasts.push(text);
}

const settle = async (ms = 900) => {
  await page.waitForTimeout(ms);
  await sampleToasts();
};

heading('1. The file opens and signs in with no server');
await page.goto(`file://${FILE}`);
await settle(2000);
await page.fill('#identifier', 'CMI01');
await page.fill('#password', PASSWORD);
await page.locator('button[type="submit"]').click();
await settle(2500);
check('the demonstration build signs in from file://', await page.locator('h1').first().isVisible());

heading('2. An inspection is one visit over many areas');
await page.goto(`file://${FILE}#/inspections/new`);
await settle(1300);
await page
  .locator('.field', { has: page.locator('.field__label', { hasText: /^Station\*?$/ }) })
  .locator('.combo__value')
  .first()
  .click();
await page.waitForTimeout(350);
await page.keyboard.type('Pendra');
await settle(800);
await page.locator('[role="option"]').filter({ hasText: /Pendra/i }).first().click();
await page.locator('input[type="time"]').first().fill('10:15');
await page.locator('input[type="time"]').nth(1).fill('13:40');
await page.getByRole('button', { name: /START INSPECTION/i }).click();
await settle(1800);

const areaCount = await page.locator('.sheet-area').count();
check('starting an inspection puts the whole station on its sheet', areaCount > 3, `${areaCount} areas`);
const notInspected = await page.locator('.sheet-area__head', { hasText: 'Not inspected' }).count();
check('every area starts as not inspected', notInspected === areaCount);

heading('3. Working through the areas');
await page.locator('.sheet-area__head').first().click();
await settle(600);
await page.locator('.sheet-group > summary').first().click();
await settle(500);
const inOrder = page.locator('.sheet-item__actions .chip', { hasText: 'In order' });
await inOrder.nth(0).click();
await settle(900);
await inOrder.nth(1).click();
await settle(900);
check(
  'marking items in order records them and turns the area satisfactory',
  await page.locator('.sheet-area__head', { hasText: 'Found in order' }).first().isVisible()
);

await page.locator('.sheet-area__head').nth(1).click();
await settle(600);
await page.getByRole('button', { name: /Whole area in order/i }).click();
await settle(1000);
check(
  'a whole area can be marked in order in one tap',
  (await page.locator('.sheet-area__head', { hasText: 'Found in order' }).count()) >= 2
);

heading('4. A deficiency marks its own area');
await page.locator('.sheet-area__head').nth(1).click();
await settle(400);
await page.locator('.sheet-area__head').nth(2).click();
await settle(600);
await page.locator('.sheet-group > summary').first().click();
await settle(500);
await page.locator('.sheet-item__actions .chip', { hasText: 'Deficiency' }).first().click();
await settle(1000);
await page
  .locator('textarea')
  .first()
  .fill('Offline check: this amenity was found not working during the inspection.');
await page.getByRole('button', { name: /SUBMIT OBSERVATION/i }).click();
await settle(2000);
check(
  'recording a deficiency marks its area on the sheet',
  await page.locator('.sheet-area__head', { hasText: 'Deficiencies noticed' }).first().isVisible()
);

heading('5. The report');
page.on('dialog', (d) => d.accept());
await page.getByRole('button', { name: /^Finish$/ }).click();
await settle(2400);
check('finishing opens the report', await page.getByRole('tab', { name: /Report/i }).isVisible());

const issue = page.getByRole('button', { name: /Issue the report/i });
check('a completed inspection offers its report for issue', (await issue.count()) > 0);
if (await issue.count()) {
  await issue.click();
  await settle(1600);
  const body = await page.locator('body').textContent();
  check(
    'issuing gives the report a financial-year office number',
    /\/\d{4}-\d{2}\/\d{3}/.test(body ?? ''),
    (body ?? '').match(/[A-Z]+\/[A-Z]+\/[A-Z]+\/\d{4}-\d{2}\/\d{3}/)?.[0] ?? ''
  );
}

await page.getByRole('tab', { name: /Areas/i }).click();
await settle(900);
check('the areas tab lists every area with its result', (await page.locator('table.data tbody tr').count()) > 3);

heading('6. The inspection-based views');
await page.goto(`file://${FILE}#/dashboard`);
await settle(2000);
await page.getByRole('tab', { name: /Inspection-wise/i }).click();
await settle(1000);
check(
  'the dashboard counts visits and coverage, not observations',
  (await page.locator('body').textContent())?.includes('Areas attended to') ?? false
);

await page.goto(`file://${FILE}#/reports`);
await settle(1600);
const reportsText = (await page.locator('body').textContent()) ?? '';
check('the reports built on the inspection are offered', reportsText.includes('Inspection Register'));
check('they are separated from those built on the observations', reportsText.includes('Based on the observations'));

heading('7. Where the officer works, and what they think of the app');
await page.goto(`file://${FILE}#/profile`);
await settle(2000);
const profileText = (await page.locator('body').textContent()) ?? '';
check('the profile offers a jurisdiction to choose', profileText.includes('My jurisdiction'));
check('and says the division\'s own record still decides', profileText.includes('kept separately by the office'));

// Narrowing from the whole division down to one section, which is the flow an
// inspector covering everything actually uses.
const divisionChip = page.locator('.chip--on').filter({ hasText: /division$/ });
if (await divisionChip.count()) {
  await divisionChip.first().click();
  await settle(500);
}
const sectionChip = page.locator('.sheet-group .chip').filter({ hasText: /^[A-Z]{3,4}-[A-Z]{3,4}$/ }).first();
const sectionCode = (await sectionChip.textContent())?.trim();
await sectionChip.click();
await settle(500);
check('a section can be picked', (await sectionChip.getAttribute('class'))?.includes('chip--on') ?? false, sectionCode);

// The stations the section brings in read as covered, not as individually picked.
await page.locator('.chart__toggle').filter({ hasText: 'Stations' }).first().click();
await settle(600);
const coveredCount = await page.locator('.sheet-group .chip--covered').count();
check('its stations read as covered rather than as picked', coveredCount > 0, `${coveredCount} stations`);

// But one can still be named outright, which is what makes it available as a default.
const firstCovered = page.locator('.sheet-group .chip--covered').first();
const stationName = (await firstCovered.textContent())?.trim();
await firstCovered.click();
await settle(500);
check('a covered station can still be named outright',
  (await page.locator('.sheet-group .chip--xs.chip--on').count()) > 0, stationName);

await page.getByRole('button', { name: /Save jurisdiction/i }).click();
await settle(1500);
await sampleToasts();
check('saving it goes through', errorToasts.length === 0, errorToasts.slice(0, 2).join(' | '));

// What the officer thinks of the application.
await page.locator('textarea').first().fill('The station list should start with my own section instead of all 89.');
await settle(400);
await page.getByRole('button', { name: /Send to the office/i }).click();
await settle(1500);
check('a suggestion can be sent',
  ((await page.locator('body').textContent()) ?? '').includes('Sent to the divisional office'));

// And the same box at the end of an inspection, which is where it is really asked.
await page.goto(`file://${FILE}#/inspections/1`);
await settle(2000);
const finish = page.getByRole('button', { name: /Complete inspection/i });
if (await finish.count()) {
  await finish.click();
  await settle(1200);
  const suggest = page.getByRole('button', { name: /Suggest an improvement/i });
  check('finishing an inspection asks what would make it easier', (await suggest.count()) > 0);
  if (await suggest.count()) {
    await suggest.click();
    await settle(600);
    check('and the box opens in place',
      ((await page.locator('body').textContent()) ?? '').includes('Which part of the app'));
  }
}

heading('8. Nothing left the machine');
await sampleToasts();
check('no error toast was raised', errorToasts.length === 0, errorToasts.slice(0, 3).join(' | '));
check('no page or console error', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
check('zero network requests from file://', requests.length === 0, requests.slice(0, 3).join(' | '));

await browser.close();

console.log(
  `\n${failures.length ? `${failures.length} of ${checks} checks FAILED:\n - ${failures.join('\n - ')}` : `All ${checks} checks passed.`}\n`
);
process.exit(failures.length ? 1 : 0);
