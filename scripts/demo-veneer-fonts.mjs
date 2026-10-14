/**
 * The demo is prerendered, so the fonts veneer forges during the build must
 * end up as static files next to the pages that reference them.
 * provideVeneerServer({ emitDir }) writes them to dist/demo-veneer while
 * prerendering (outside dist/demo, which the Angular builder empties
 * afterwards); this copies them into the browser output and checks that every
 * font a page references is there.
 *
 *   node scripts/demo-veneer-fonts.mjs clean               # before ng build
 *   node scripts/demo-veneer-fonts.mjs copy                # after ng build
 *   node scripts/demo-veneer-fonts.mjs keep <url> [dir]    # before deploying
 *
 * `keep` carries the fonts of the deployed site over into the new build. A
 * deploy replaces the whole site, and without VENEER_SECRET every build forges
 * a new font under a new URL, so HTML a browser or the CDN still caches from
 * the previous deploy would reference a font that is gone, and its text would
 * stay unreadable (VNR016). It reads the pages currently live at <url> (the
 * site's base URL), takes the forged font URLs out of their ng-state, and
 * downloads each font that [dir] (default dist/demo/browser) lacks. It never
 * fails the deploy: an unreachable site, or one without veneer fonts (the
 * first deploy), adds nothing.
 *
 * Fonts kept this way are listed in `veneer-fonts.json` with the time they
 * stopped being current, so the next deploy keeps them too while HTML that
 * references them may still be cached (KEEP_FOR), not only for one deploy.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

const EMIT = 'dist/demo-veneer';
const BROWSER = 'dist/demo/browser';
const command = process.argv[2];

/** Every .html file under `dir`, as `/`-separated relative paths. */
function pagesIn(dir) {
  return readdirSync(dir, { recursive: true })
    .map((file) => String(file).split(sep).join('/'))
    .filter((file) => file.endsWith('.html'));
}

/**
 * The forged-font URLs a page's ng-state lists (`"fonts":[...]`): each entry
 * a URL, or `{ url, weight?, style?, stretch? }` for a face with descriptors.
 */
function fontsIn(html) {
  const urls = [];
  for (const [, list] of html.matchAll(/"fonts":\[([^\]]*)\]/g)) {
    try {
      const entries = JSON.parse(`[${list}]`).map((entry) => entry?.url ?? entry);
      urls.push(...entries.filter((url) => typeof url === 'string'));
    } catch {
      // Not ng-state after all.
    }
  }
  return urls;
}

/**
 * A forged font's URL as provideVeneerServer() writes it: relative, plain path
 * segments, a 128-bit hex id. Anything else (`..`, absolute URLs) is skipped,
 * so a page cannot make this write outside the build output.
 */
const FONT_URL = /^(?:[A-Za-z0-9_-]+\/)+[0-9a-f]{32}\.ttf$/;

/** sfnt magic numbers: TrueType, OpenType CFF, Apple TrueType. */
const isFont = (bytes) =>
  bytes.byteLength > 12 &&
  ['00010000', '4f54544f', '74727565'].includes(bytes.subarray(0, 4).toString('hex'));

/** The manifest of kept fonts, at the site root: `{ fonts: { url: retiredAt } }`. */
const MANIFEST = 'veneer-fonts.json';

/**
 * How long a retired font is kept. HTML on GitHub Pages is cacheable for 10
 * minutes; a day also covers a tab left open and a slow CDN edge.
 */
const KEEP_FOR = 24 * 60 * 60 * 1000;

async function get(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    return { status: 0, error: error?.cause?.code ?? error?.message ?? String(error) };
  }
}

async function keep(live, target) {
  let base;
  try {
    base = new URL(live.endsWith('/') ? live : `${live}/`);
    if (!/^https?:$/.test(base.protocol)) throw new Error();
  } catch {
    console.error('usage: node scripts/demo-veneer-fonts.mjs keep <http(s) base URL> [dir]');
    process.exit(1);
  }

  // The live site has the same pages as this build, give or take: ask for
  // each, plus the SPA fallback that deploy.yml adds.
  const pages = [...new Set(['index.html', '404.html', ...pagesIn(target)])];
  const fonts = new Set();
  let reached = 0;
  for (const page of pages) {
    const { status, body } = await get(new URL(page, base));
    if (!body) continue;
    reached++;
    // GitHub Pages answers a missing page with 404 and our 404.html, which
    // carries fonts too, so the body counts whatever the status.
    if (status >= 500) continue;
    for (const url of fontsIn(body.toString('utf8'))) if (FONT_URL.test(url)) fonts.add(url);
  }
  if (reached === 0) {
    console.log(`veneer: ${base} is unreachable; no fonts to keep.`);
    return;
  }

  // The live pages' fonts retire now. Fonts the live site was itself still
  // keeping stay until KEEP_FOR has passed since they retired.
  const now = Date.now();
  const retired = new Map([...fonts].map((url) => [url, new Date(now).toISOString()]));
  const previous = await get(new URL(MANIFEST, base));
  if (previous.status === 200 && previous.body) {
    try {
      const listed = JSON.parse(previous.body.toString('utf8'))?.fonts ?? {};
      for (const [url, when] of Object.entries(listed)) {
        const at = Date.parse(String(when));
        if (!FONT_URL.test(url) || !(now - at < KEEP_FOR) || retired.has(url)) continue;
        retired.set(url, new Date(at).toISOString());
        fonts.add(url);
      }
    } catch {
      // Not our manifest; keep what the pages reference.
    }
  }

  const missing = [...fonts].filter((url) => !existsSync(join(target, url)));
  let kept = 0;
  for (const url of missing) {
    const { status, body } = await get(new URL(url, base));
    if (status !== 200 || !body || !isFont(body)) {
      console.log(`veneer: could not keep ${url} (HTTP ${status || 'error'}).`);
      continue;
    }
    mkdirSync(dirname(join(target, url)), { recursive: true });
    await writeFile(join(target, url), body);
    kept++;
  }

  // Record every retired font now in the build, for the next deploy's `keep`.
  // The new build's own fonts are current, not retired: its pages list them.
  const current = new Set(
    pagesIn(target).flatMap((page) => fontsIn(readFileSync(join(target, page), 'utf8'))),
  );
  const listed = Object.fromEntries(
    [...retired].filter(([url]) => !current.has(url) && existsSync(join(target, url))).sort(),
  );
  await writeFile(join(target, MANIFEST), `${JSON.stringify({ fonts: listed }, null, 2)}\n`);
  console.log(
    fonts.size === 0
      ? `veneer: ${base} references no forged fonts; nothing to keep.`
      : `veneer: kept ${kept} forged font(s) from ${base} (${fonts.size - missing.length} already in ${target}).`,
  );
}

if (command === 'clean') {
  rmSync(EMIT, { recursive: true, force: true });
} else if (command === 'copy') {
  if (existsSync(EMIT)) cpSync(EMIT, BROWSER, { recursive: true });

  const missing = [];
  let referenced = 0;
  for (const page of pagesIn(BROWSER)) {
    for (const url of fontsIn(readFileSync(join(BROWSER, page), 'utf8'))) {
      referenced++;
      if (!existsSync(join(BROWSER, url))) missing.push(`${page}: ${url}`);
    }
  }
  if (missing.length) {
    console.error(`veneer: pages reference forged fonts that are not in ${BROWSER}:`);
    for (const line of missing) console.error(`- ${line}`);
    process.exit(1);
  }
  console.log(`veneer: ${referenced} forged font reference(s), all present in ${BROWSER}.`);
} else if (command === 'keep' && process.argv[3]) {
  await keep(process.argv[3], process.argv[4] ?? BROWSER);
} else {
  console.error('usage: node scripts/demo-veneer-fonts.mjs clean|copy|keep <url> [dir]');
  process.exit(1);
}
