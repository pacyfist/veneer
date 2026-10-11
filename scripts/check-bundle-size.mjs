/**
 * Checks the gzip size of every FESM bundle the library ships.
 *
 *   npm run build:lib && node scripts/check-bundle-size.mjs [dist dir]
 *
 * The entry points come from the built package.json `exports`, so a new
 * secondary entry point (`./core`, `./testing`, ...) is picked up without
 * editing this file. Every entry point needs a budget below; one without a
 * budget fails the check, so it gets a deliberate number.
 *
 * Sizes are what a bundler starts from, before minification and tree-shaking,
 * and peer dependencies (Angular, opentype.js) are not included. That makes
 * them a drift alarm for the library's own code, not an app's bundle cost.
 *
 * Dependency-free on purpose: node:zlib is all it needs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Gzip budgets in bytes, per export subpath. Set about 10% above the measured
 * size when they were introduced, so they catch real growth; lower them when a
 * change makes a bundle smaller.
 *
 * Measured 2026-10-11 (Angular 21 build, gzip level 9): `.` 6,702 B.
 * `./core` and `./testing` did not exist yet; their budgets are provisional
 * copies of the main one until they are measured.
 */
const BUDGETS = {
  '.': 7_400,
  './core': 7_400,
  './testing': 7_400,
};

const dist = process.argv[2] ?? 'dist/pacyfist/veneer';
const pkg = JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'));

/** Resolves an `exports` value to its JavaScript file (the `default` condition). */
function jsTarget(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    for (const key of ['default', 'import', 'module']) {
      if (key in value) return jsTarget(value[key]);
    }
  }
  return undefined;
}

const entries = Object.entries(pkg.exports ?? { '.': pkg.module })
  .map(([subpath, value]) => [subpath, jsTarget(value)])
  .filter(([, file]) => file?.endsWith('.mjs'));

const rows = [];
const problems = [];

for (const [subpath, file] of entries) {
  const bytes = readFileSync(join(dist, file));
  const gzip = gzipSync(bytes, { level: 9 }).length;
  const budget = BUDGETS[subpath];
  const ok = budget !== undefined && gzip <= budget;
  rows.push({ subpath, file, raw: bytes.length, gzip, budget, ok });
  if (budget === undefined) {
    problems.push(`${subpath} (${file}) has no budget; add one to scripts/check-bundle-size.mjs`);
  } else if (!ok) {
    problems.push(`${subpath} is ${gzip} B gzip, over its ${budget} B budget`);
  }
}

// Every FESM file must belong to an entry point, or it would escape the check.
const fesmDir = join(dist, 'fesm2022');
const covered = new Set(entries.map(([, file]) => join(dist, file)));
for (const name of readdirSync(fesmDir).filter((n) => n.endsWith('.mjs'))) {
  const path = join(fesmDir, name);
  if (!covered.has(path)) {
    problems.push(`${relative(dist, path)} is not the target of any export, so it has no budget`);
  }
}

const kb = (n) => (n / 1024).toFixed(2) + ' KiB';
const table = [
  ['entry', 'file', 'raw', 'gzip', 'budget', 'used', 'status'],
  ...rows.map((r) => [
    r.subpath,
    r.file,
    kb(r.raw),
    kb(r.gzip),
    r.budget === undefined ? '-' : kb(r.budget),
    r.budget === undefined ? '-' : Math.round((r.gzip / r.budget) * 100) + '%',
    r.ok ? 'ok' : 'FAIL',
  ]),
];
const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
for (const [i, row] of table.entries()) {
  console.log(
    row
      .map((cell, j) => (j >= 2 && j <= 5 ? cell.padStart(widths[j]) : cell.padEnd(widths[j])))
      .join('  ')
      .trimEnd(),
  );
  if (i === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
}

if (entries.length === 0) problems.push(`no .mjs entry points found in ${dist}/package.json`);

if (problems.length) {
  console.error('\nBundle size check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log('\nAll bundles are within budget.');
