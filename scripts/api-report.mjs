/**
 * Checks the public API of every entry point against the reports checked in
 * under projects/pacyfist/veneer/api/ (API Extractor).
 *
 *   npm run api:check     # fails when the API differs from the reports
 *   npm run api:update    # rewrites the reports; commit them with the change
 *
 * The declarations come from plain `tsc` over the library source
 * (projects/pacyfist/veneer/api/tsconfig.json), not from the ng-packagr build.
 * That keeps the reports identical on every supported Angular major: the
 * built typings carry compiler-generated members (`ɵfac`, `ɵdir` and their
 * generic arguments) whose shape belongs to the Angular version that built
 * them, and ng-packagr's output layout differs between majors too. What the
 * reports cover is what consumers write code against: exported names, their
 * signatures, and which members are `@internal`. Directive selectors and
 * input aliases live in the `ɵdir` metadata and are not in the reports.
 *
 * A failed check leaves the new report in out-tsc/api/reports/ for diffing.
 */
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const update = process.argv.includes('--update');

const LIB = resolve('projects/pacyfist/veneer');
const OUT = resolve('out-tsc/api');
/** Where tsc writes the declarations; each report starts from its entry here. */
const DTS = `${OUT}/dts`;
/**
 * A copy that imports between entry points resolve to. It sits under a
 * node_modules folder on purpose: TypeScript flags a module resolved there as
 * an external library, so each report lists the other entry points as imports
 * (`export * from '@pacyfist/veneer/core'`) instead of inlining them, the way
 * consumers see them.
 */
const PKG = `${OUT}/node_modules/@pacyfist/veneer`;

/** Every entry point: its report name, import path and emitted declarations. */
const ENTRIES = [
  { name: 'veneer', specifier: '@pacyfist/veneer', dts: 'src/public-api.d.ts' },
  { name: 'veneer-core', specifier: '@pacyfist/veneer/core', dts: 'core/src/public-api.d.ts' },
  { name: 'veneer-forge', specifier: '@pacyfist/veneer/forge', dts: 'forge/src/public-api.d.ts' },
  {
    name: 'veneer-server',
    specifier: '@pacyfist/veneer/server',
    dts: 'server/src/public-api.d.ts',
  },
  {
    name: 'veneer-testing',
    specifier: '@pacyfist/veneer/testing',
    dts: 'testing/src/public-api.d.ts',
  },
];

rmSync(OUT, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', `${LIB}/api/tsconfig.json`],
  { stdio: 'inherit' },
);
cpSync(DTS, PKG, { recursive: true });
mkdirSync(`${OUT}/reports`, { recursive: true });

const failed = [];
for (const { name, dts } of ENTRIES) {
  const config = ExtractorConfig.prepare({
    configObjectFullPath: undefined,
    packageJsonFullPath: `${LIB}/package.json`,
    configObject: {
      projectFolder: LIB,
      mainEntryPointFilePath: `${DTS}/${dts}`,
      compiler: {
        overrideTsconfig: {
          compilerOptions: {
            target: 'ES2022',
            module: 'preserve',
            moduleResolution: 'bundler',
            strict: true,
            skipLibCheck: true,
            types: [],
            paths: Object.fromEntries(ENTRIES.map((e) => [e.specifier, [`${PKG}/${e.dts}`]])),
          },
          include: [`${DTS}/**/*.d.ts`],
        },
      },
      apiReport: {
        enabled: true,
        reportFileName: `${name}.api.md`,
        reportFolder: `${LIB}/api/`,
        reportTempFolder: `${OUT}/reports/`,
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      newlineKind: 'lf',
      messages: {
        compilerMessageReporting: { default: { logLevel: 'warning' } },
        extractorMessageReporting: {
          default: { logLevel: 'warning', addToApiReportFile: true },
          // Release tags are not used; internals are marked `@internal` and
          // exported under a `ɵ` name instead of a leading underscore.
          'ae-missing-release-tag': { logLevel: 'none' },
          'ae-internal-missing-underscore': { logLevel: 'none' },
          // Doc coverage is not what this check is for, and these messages
          // carry absolute paths that would differ on every machine.
          'ae-undocumented': { logLevel: 'none' },
        },
        // The doc comments are written for people, not for TSDoc tooling.
        tsdocMessageReporting: { default: { logLevel: 'none' } },
      },
    },
  });

  const result = Extractor.invoke(config, { localBuild: update, showVerboseMessages: false });
  if (!result.succeeded) failed.push(name);
  else if (result.apiReportChanged) console.log(`api: updated ${name}.api.md`);
}

if (failed.length) {
  console.error(
    `\nThe public API of ${failed.join(', ')} differs from projects/pacyfist/veneer/api/.\n` +
      'If the change is intended, run `npm run api:update` and commit the reports.\n' +
      'The new reports are in out-tsc/api/reports/.',
  );
  process.exit(1);
}
console.log('\nThe public API matches the checked-in reports.');
