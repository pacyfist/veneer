/**
 * Packs the built library exactly as npm would publish it and lints the tarball.
 *
 *   npm run build:lib && node scripts/check-package.mjs [dist dir]
 *
 * - `npm pack` writes dist/pack/pacyfist-veneer-<version>.tgz. The example app
 *   (examples/basic-ssr) installs that same file.
 * - publint checks package.json against the files that are really in the
 *   tarball (exports, types, module format). Warnings fail the check.
 * - arethetypeswrong checks that TypeScript resolves types for every export
 *   under each module resolution mode. It runs with the `esm-only` profile:
 *   Angular libraries ship ESM only, like Angular itself, so `require()` from
 *   CommonJS resolving to ESM is expected and not reported.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist/pacyfist/veneer');
const out = resolve('dist/pack');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const [packed] = JSON.parse(
  execFileSync(npm, ['pack', dist, '--pack-destination', out, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }),
);
const tarball = join(out, packed.filename);
console.log(`packed ${packed.files.length} files into ${tarball}:`);
for (const file of packed.files) console.log(`  ${file.path}`);

let failed = false;
const run = (title, args) => {
  console.log(`\n== ${title}`);
  try {
    execFileSync(npx, args, { stdio: 'inherit' });
  } catch {
    failed = true;
  }
};

run('publint', ['publint', 'run', tarball, '--strict']);
// internal-resolution-error: the main entry's types import its own `./core`
// subpath. Only the legacy node10 resolver (already ignored by the esm-only
// profile) cannot follow a package self-reference, but attw does not filter
// this rule by profile. Angular's own packages have the same shape.
run('arethetypeswrong', [
  'attw',
  tarball,
  '--profile',
  'esm-only',
  '--ignore-rules',
  'internal-resolution-error',
]);

if (failed) {
  console.error('\nPackage check failed.');
  process.exit(1);
}
