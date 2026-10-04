/**
 * Makes sure web/src/demo/data.json exists.
 *
 * The offline demonstration's data is a fixture exported from the seeded SQLite
 * database, so it is generated rather than committed - there is no point keeping
 * a second copy of the seed in the repository, and it would go stale.
 *
 * But `web/src/demo/store.ts` imports it, so without it the client does not
 * type-check and does not build: a fresh clone could not run `npm run build` at
 * all, and the failure was an unhelpful "Cannot find module './data.json'".
 *
 * So the build, the type-check and the demo tests run this first. It does nothing
 * when the fixture is already there, seeds the database when that is missing too,
 * and otherwise just exports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const FIXTURE = path.join(REPO, 'web', 'src', 'demo', 'data.json');
const DB_FILE = process.env.DB_FILE ?? path.join(REPO, 'server', 'data', 'railway-inspection.sqlite');

if (fs.existsSync(FIXTURE) && !process.env.FORCE_DEMO_DATA) {
  process.exit(0);
}

const run = (label, command, args) => {
  console.log(`  ${label}`);
  const result = spawnSync(command, args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`\n  Could not ${label.toLowerCase()}.\n`);
    process.exit(result.status ?? 1);
  }
};

console.log('\n  The offline demonstration fixture is missing; building it.');
if (!fs.existsSync(DB_FILE)) {
  run('Seeding the database', 'npm', ['run', 'seed:reset', '--workspace', 'server']);
}
run('Exporting the fixture', 'node', [path.join('web', 'scripts', 'make-demo-data.mjs')]);
