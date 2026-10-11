import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Per-request server rendering keeps the key out of the HTML (ROADMAP Next
 * #2): the server forges the font and serves it from veneerFontMiddleware(),
 * and the page carries only its URL. Runs against the `ssr` and `zoneless`
 * builds; the `csr` build has no server HTML to leak from.
 */

/** Same text as src/app/app.ts. */
const SECRET = 'The quick brown fox jumps over the lazy dog.';

const APP = process.env['EXAMPLE_APP_DIR'] ?? join(tmpdir(), 'veneer-example-basic-ssr', 'app');
/** The cipher from the installed tarball, as a crawler would get it from npm. */
const CORE = pathToFileURL(
  join(APP, 'node_modules/@pacyfist/veneer/fesm2022/pacyfist-veneer-core.mjs'),
).href;

const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'csr', 'no server-rendered HTML');
});

test('the served HTML carries no seed, and no number in it decodes the text', async ({
  request,
}) => {
  const html = await (await request.get('./')).text();
  expect(html).not.toMatch(/veneerSeed/i);
  const state = JSON.parse(html.match(/<script id="ng-state"[^>]*>([\s\S]*?)<\/script>/)![1]);
  expect(Object.keys(state.veneer).sort()).toEqual(['family', 'fonts']);
  expect(state.veneer.family).toMatch(/^Veneer-[0-9a-f]{16}$/);

  // The seed-regex attack, and its patient cousin: every integer in the page
  // and the family name in every base, tried as a seed.
  const { buildScrambleMap, invertScrambleMap, scrambleText } = await import(CORE);
  const family = state.veneer.family.slice('Veneer-'.length);
  const candidates = new Set<number>(
    [...html.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n <= 0xffffffff),
  );
  for (const radix of [10, 16, 36]) candidates.add(parseInt(family, radix) >>> 0);
  const text = textOf(html);
  for (const seed of candidates) {
    expect(scrambleText(text, invertScrambleMap(buildScrambleMap(seed)))).not.toContain(SECRET);
  }
});

test('one cipher per server start, its font served as immutable font/ttf', async ({ request }) => {
  const fontsOf = async () => {
    const html = await (await request.get('./')).text();
    return JSON.parse(html.match(/<script id="ng-state"[^>]*>([\s\S]*?)<\/script>/)![1]).veneer;
  };
  const first = await fontsOf();
  const second = await fontsOf();
  expect(second).toEqual(first);

  const font = await request.get(first.fonts[0]);
  expect(font.status()).toBe(200);
  expect(font.headers()['content-type']).toBe('font/ttf');
  expect(font.headers()['cache-control']).toContain('immutable');
  expect((await font.body()).byteLength).toBeGreaterThan(50_000);
});

test('fetches the forged font once and never shows text before it is ready', async ({ page }) => {
  // Every change to the protected elements, with whether the forged font was
  // usable at that moment.
  await page.addInitScript(() => {
    const seen: { id: string; visible: boolean; text: string; ready: boolean }[] = [];
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    const record = () => {
      for (const id of ['bound', 'piped']) {
        const el = document.getElementById(id);
        if (!el) continue;
        const family = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/["']/g, '');
        seen.push({
          id,
          visible: getComputedStyle(el).visibility === 'visible',
          text: (el.textContent ?? '').trim(),
          ready: [...document.fonts].some((f) => f.family === family && f.status === 'loaded'),
        });
      }
    };
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
  const fonts: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.ttf')) fonts.push(new URL(request.url()).pathname);
  });

  const response = await page.goto('./');
  const html = await response!.text();
  const forged = JSON.parse(html.match(/<script id="ng-state"[^>]*>([\s\S]*?)<\/script>/)![1])
    .veneer.fonts[0];

  await expect(page.locator('#bound')).toBeVisible();
  await expect(page.locator('#piped')).toBeVisible();
  const final = (await page.locator('#bound').textContent())?.trim();

  const seen = await page.evaluate(
    () =>
      (window as unknown as { __seen: { visible: boolean; text: string; ready: boolean }[] })
        .__seen,
  );
  const shown = seen.filter((s) => s.visible);
  expect(shown.length).toBeGreaterThan(0);
  for (const s of shown) {
    expect(s.ready, 'visible before the forged font was ready').toBe(true);
    expect(s.text).toBe(final);
  }

  expect(fonts.filter((path) => path.endsWith(forged))).toHaveLength(1);
  expect(fonts.filter((path) => path.endsWith('/Roboto-Regular.ttf'))).toHaveLength(1);
});
