/**
 * The demo is prerendered, so the fonts veneer forges during the build must
 * end up as static files next to the pages that reference them.
 * provideVeneerServer({ emitDir }) writes them to dist/demo-veneer while
 * prerendering (outside dist/demo, which the Angular builder empties
 * afterwards); this copies them into the browser output and checks that every
 * font a page references is there.
 *
 *   node scripts/demo-veneer-fonts.mjs clean   # before ng build
 *   node scripts/demo-veneer-fonts.mjs copy    # after ng build
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const EMIT = 'dist/demo-veneer';
const BROWSER = 'dist/demo/browser';
const command = process.argv[2];

if (command === 'clean') {
  rmSync(EMIT, { recursive: true, force: true });
} else if (command === 'copy') {
  if (existsSync(EMIT)) cpSync(EMIT, BROWSER, { recursive: true });

  const pages = readdirSync(BROWSER, { recursive: true }).filter((f) => f.endsWith('.html'));
  const missing = [];
  let referenced = 0;
  for (const page of pages) {
    const html = readFileSync(join(BROWSER, page), 'utf8');
    for (const [, list] of html.matchAll(/"fonts":\[([^\]]*)\]/g)) {
      for (const url of JSON.parse(`[${list}]`)) {
        referenced++;
        if (!existsSync(join(BROWSER, url))) missing.push(`${page}: ${url}`);
      }
    }
  }
  if (missing.length) {
    console.error(`veneer: pages reference forged fonts that are not in ${BROWSER}:`);
    for (const line of missing) console.error(`- ${line}`);
    process.exit(1);
  }
  console.log(`veneer: ${referenced} forged font reference(s), all present in ${BROWSER}.`);
} else {
  console.error('usage: node scripts/demo-veneer-fonts.mjs clean|copy');
  process.exit(1);
}
