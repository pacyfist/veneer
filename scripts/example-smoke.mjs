/**
 * Consumer smoke test: installs examples/basic-ssr from the packed library
 * tarball, builds it, and runs its Playwright check.
 *
 *   npm run build:lib && npm run check:package
 *   node scripts/example-smoke.mjs [--angular 20|21|22] [--no-test] [--strict-types]
 *
 * The example is copied OUTSIDE the repository first (EXAMPLE_WORK_DIR, by
 * default <tmpdir>/veneer-example-basic-ssr). Inside the repository, Node and
 * esbuild would walk up into the workspace node_modules and quietly find
 * anything the tarball forgot to declare. Out there, the app sees only what a
 * real `npm install @pacyfist/veneer` gives it, with strict peer dependencies
 * (examples/basic-ssr/.npmrc).
 *
 * --angular switches the copy to another major with scripts/use-angular.mjs,
 * the same script CI uses for the workspace.
 *
 * The build itself uses skipLibCheck, like a new Angular app. A second type
 * check without it shows what a consumer with stricter settings hits in the
 * published .d.ts files. It only warns, unless --strict-types is passed.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const major = args.includes('--angular') ? args[args.indexOf('--angular') + 1] : undefined;
const test = !args.includes('--no-test');
const strictTypes = args.includes('--strict-types');

const work = resolve(process.env['EXAMPLE_WORK_DIR'] ?? join(tmpdir(), 'veneer-example-basic-ssr'));
const app = join(work, 'app');
if (work === repo || work.startsWith(repo + '/')) {
  console.error(`EXAMPLE_WORK_DIR must be outside the repository (${repo})`);
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const env = { ...process.env, NG_CLI_ANALYTICS: 'false' };
const run = (cmd, argv, cwd) => {
  console.log(`\n$ ${[cmd, ...argv].join(' ')}   (in ${cwd})`);
  execFileSync(cmd, argv, { cwd, env, stdio: 'inherit' });
};

// 1. The tarball check:package produced, or a fresh one.
const packDir = join(repo, 'dist/pack');
let tarballs = existsSync(packDir) ? readdirSync(packDir).filter((f) => f.endsWith('.tgz')) : [];
if (tarballs.length === 0) {
  mkdirSync(packDir, { recursive: true });
  run(npm, ['pack', join(repo, 'dist/pacyfist/veneer'), '--pack-destination', packDir], repo);
  tarballs = readdirSync(packDir).filter((f) => f.endsWith('.tgz'));
}
if (tarballs.length !== 1) {
  console.error(`expected one tarball in ${packDir}, found: ${tarballs.join(', ') || 'none'}`);
  process.exit(1);
}
const tarball = join(packDir, tarballs[0]);
console.log(`using ${tarball}`);

// 2. A clean copy of the example next to the tarball (package.json points at
// file:../veneer.tgz).
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
cpSync(tarball, join(work, 'veneer.tgz'));
cpSync(join(repo, 'examples/basic-ssr'), app, {
  recursive: true,
  filter: (src) => !['node_modules', 'dist', '.angular'].includes(basename(src)),
});

// 3. Install, optionally on another Angular major, and build all three variants.
if (major) {
  run('node', [join(repo, 'scripts/use-angular.mjs'), major], app);
} else {
  run(npm, ['install', '--no-audit', '--no-fund'], app);
}
run(npm, ['ls', '@angular/core', '@pacyfist/veneer', 'opentype.js', 'typescript'], app);
run(npm, ['run', 'build'], app);

// 4. Type check the published typings without skipLibCheck.
try {
  run(npx, ['tsc', '-p', 'tsconfig.json', '--noEmit', '--skipLibCheck', 'false'], app);
} catch {
  const message = 'type check without skipLibCheck failed (see the errors above)';
  if (strictTypes) {
    console.error(message);
    process.exit(1);
  }
  console.log(process.env['GITHUB_ACTIONS'] ? `::warning::${message}` : `warning: ${message}`);
}

// 5. Serve each build and check it in a browser.
if (test) {
  execFileSync(npx, ['playwright', 'test', '-c', 'examples/basic-ssr'], {
    cwd: repo,
    env: { ...env, EXAMPLE_APP_DIR: app, ...(major ? { ANGULAR_MAJOR: major } : {}) },
    stdio: 'inherit',
  });
}
