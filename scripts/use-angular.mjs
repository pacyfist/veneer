/**
 * Switches the workspace to another supported Angular major.
 *
 *   node scripts/use-angular.mjs 20
 *
 * Rewrites the Angular toolchain versions in package.json, along with the
 * TypeScript and Vitest ranges that major needs, then reinstalls. CI uses it to
 * build and test the library and demo on every major in `peerDependencies`.
 *
 * It edits package.json and package-lock.json in place. Locally, put them back
 * afterwards with `git checkout package.json package-lock.json && npm ci`.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** What each major needs besides Angular itself, from its peer dependencies. */
const TOOLCHAIN = {
  20: { typescript: '~5.8.3', vitest: '^3.2.4' },
  21: { typescript: '~5.9.2', vitest: '^4.0.8' },
  22: { typescript: '~6.0.2', vitest: '^4.0.8' },
};

const ANGULAR = [
  '@angular/build',
  '@angular/cli',
  '@angular/common',
  '@angular/compiler',
  '@angular/compiler-cli',
  '@angular/core',
  '@angular/forms',
  '@angular/platform-browser',
  '@angular/platform-server',
  '@angular/router',
  '@angular/ssr',
  'ng-packagr',
];

const major = process.argv[2];
const toolchain = TOOLCHAIN[major];
if (!toolchain) {
  console.error(`usage: node scripts/use-angular.mjs <${Object.keys(TOOLCHAIN).join('|')}>`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const versions = {
  ...Object.fromEntries(ANGULAR.map((name) => [name, `^${major}.0.0`])),
  ...toolchain,
};

for (const deps of [pkg.dependencies, pkg.devDependencies]) {
  for (const name of Object.keys(deps)) {
    if (name in versions) deps[name] = versions[name];
  }
}

writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
execSync('npm install --no-audit --no-fund', { stdio: 'inherit' });
