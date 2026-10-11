import { type Browser, type APIRequestContext, expect, test } from '@playwright/test';
import { findVeneerLeaks } from '../projects/pacyfist/veneer/testing/src/find-veneer-leaks';
import { HERO, SPECIMENS } from './support/demo-specimens';
import { DEMO_HTML_LEAKS } from './support/known-leaks';
import { fetchServedPage, htmlChannels } from './support/served-html';

/**
 * Side channels (ROADMAP Now #11). veneer rewrites only the text of the
 * elements it protects. These checks look for every demo specimen everywhere
 * else a scraper can read: each part of the served HTML (title, meta and OG
 * tags, JSON-LD, alt/aria-label/title attributes, form values, the ng-state
 * transfer JSON, the document text) and every JavaScript file the page loads.
 *
 * A specimen counts as leaked when it appears whole or as a run of 4
 * consecutive words (findVeneerLeaks from @pacyfist/veneer/testing).
 */

let bundles: Promise<Record<string, string>> | undefined;

/** Every script the page loads, by file name, plus any the HTML links but the page skipped. */
function loadBundles(browser: Browser, request: APIRequestContext) {
  bundles ??= (async () => {
    const page = await browser.newPage();
    const scripts: Record<string, string> = {};
    page.on('response', async (response) => {
      if (response.request().resourceType() !== 'script') return;
      scripts[new URL(response.url()).pathname] = await response.text();
    });
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    await page.close();

    const { document } = await fetchServedPage(request);
    for (const el of document.querySelectorAll('script[src], link[rel="modulepreload"]')) {
      const src = el.getAttribute('src') ?? el.getAttribute('href')!;
      const url = new URL(src, 'http://host/veneer/');
      scripts[url.pathname] ??= await (await request.get(url.pathname.slice(1))).text();
    }
    return scripts;
  })();
  return bundles;
}

test.describe('side channels', () => {
  test('specimens are collected from the demo source', () => {
    expect(HERO?.text).toMatch(/^This paragraph looks perfectly normal/);
    expect(new Set(SPECIMENS.map((s) => s.form))).toEqual(new Set(['element', 'bound', 'pipe']));
  });

  test('ng-state holds only hydration data and the seed, no HttpClient transfer cache', async ({
    request,
  }) => {
    const { document } = await fetchServedPage(request);
    const state = JSON.parse(document.querySelector('script#ng-state')?.textContent ?? '{}');

    // A new key here is most likely a cached HttpClient response, serialized
    // with its body. See withHttpTransferCacheOptions({ filter }) in the docs.
    // `veneerSeed` goes away with Next #2.
    expect(Object.keys(state).filter((k) => k !== '__nghData__' && k !== 'veneerSeed')).toEqual([]);
  });

  for (const specimen of SPECIMENS) {
    const known = DEMO_HTML_LEAKS[specimen.text];
    const title = known
      ? `${specimen.id}: reaches the served HTML only through ${known.channel} (demo copy)`
      : `${specimen.id}: absent from every part of the served HTML`;

    test(title, async ({ request }) => {
      if (known) test.info().annotations.push({ type: 'demo leak', description: known.why });
      const { document } = await fetchServedPage(request);

      const leaking = Object.entries(htmlChannels(document))
        .filter(([, text]) => findVeneerLeaks(text, [specimen.text]).length > 0)
        .map(([channel]) => channel);

      expect(leaking).toEqual(known ? [known.channel] : []);
    });

    test(`${specimen.id}: absent from every JS bundle`, async ({ browser, request }) => {
      // Every specimen in the demo is a string in the source, so the compiler
      // puts it into main-*.js: element content (`<p veneer>Text</p>`) as a
      // template text node, bound text (`signal('Text')`) as a literal. The
      // prerendered HTML hides it; the bundle next to it does not. Only text
      // that arrives at runtime (an API response, a CMS) stays out of the JS.
      test.fail(true, 'compile-time string: ships in plain form in the bundle');

      const found = Object.entries(await loadBundles(browser, request)).flatMap(([file, js]) =>
        findVeneerLeaks(js, [specimen.text]).map((l) => `${file}: "${l.fragment}"`),
      );
      test.info().annotations.push({ type: 'bundle leak', description: found.join('; ') });

      expect(found).toEqual([]);
    });
  }
});
