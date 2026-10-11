import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { findVeneerLeaks } from '../../projects/pacyfist/veneer/testing/src/find-veneer-leaks';
import { HERO, ORIGINALS } from '../support/demo-specimens';
import { fetchServedPage, parseHtml, visibleText } from '../support/served-html';
import { recordCost } from './cost';

/**
 * Adversary (b): a veneer-aware crawler. Still one HTTP GET and no
 * JavaScript, but it knows veneer: it regexes the seed out of the served HTML
 * and rebuilds the cipher with the public `buildScrambleMap` from the npm
 * package (here the built `@pacyfist/veneer/core` bundle).
 *
 * The seed reaches the HTML twice today:
 * - `"veneerSeed":<n>` in the `<script id="ng-state">` transfer JSON, and
 * - the forged family name, `Veneer-<seed in base 36>`, in every protected
 *   element's inline `font-family`.
 *
 * Why two tests rather than one: `test.fail()` passes for ANY failure, a
 * typo or a 404 included, so the property test alone could stay green for the
 * wrong reason. The KNOWN LEAK tests pin the reason: they prove, per channel,
 * that the attack really decodes the hero today. When Next #2 ("Take the key
 * out of the HTML") lands, the property test reports "expected to fail, but
 * passed" and the KNOWN LEAK tests fail; that change deletes the KNOWN LEAK
 * tests and the `test.fail()` line, and the property test becomes the
 * regression guard.
 */

const CORE = pathToFileURL(resolve('dist/pacyfist/veneer/fesm2022/pacyfist-veneer-core.mjs')).href;

type SeedChannel = 'ng-state' | 'font family';

// attack:begin
const SEED_PATTERNS: Record<SeedChannel, [RegExp, number]> = {
  'ng-state': [/"veneerSeed":(\d+)/, 10],
  'font family': [/Veneer-([0-9a-z]+)/, 36],
};

/** Readable text of the page, or null when no seed was found. */
async function seedAttack(html: string, channels: SeedChannel[]): Promise<string | null> {
  for (const channel of channels) {
    const [pattern, radix] = SEED_PATTERNS[channel];
    const match = html.match(pattern);
    if (!match) continue;
    const { buildScrambleMap, invertScrambleMap, scrambleText } = await import(CORE);
    const inverse = invertScrambleMap(buildScrambleMap(parseInt(match[1], radix)));
    return scrambleText(visibleText(parseHtml(html).body), inverse);
  }
  return null;
}
// attack:end

test.describe('adversary (b): seed regex on the served HTML', () => {
  test('a regex crawler cannot recover plaintext from the served HTML', async ({ request }) => {
    // Fails today: the seed is in the HTML. Next #2 removes it; delete this line then.
    test.fail();

    const { html } = await fetchServedPage(request);
    const started = performance.now();
    const decoded = await seedAttack(html, ['ng-state', 'font family']);
    recordCost('seed regex', performance.now() - started);

    expect(findVeneerLeaks(decoded ?? '', ORIGINALS)).toEqual([]);
  });

  for (const channel of ['ng-state', 'font family'] as const) {
    // KNOWN LEAK - remove with Next #2. Documents that the attack works today.
    test(`KNOWN LEAK (remove with Next #2): the ${channel} seed decodes the hero`, async ({
      request,
    }) => {
      const { html } = await fetchServedPage(request);
      const decoded = await seedAttack(html, [channel]);

      expect(decoded, `no seed in the ${channel}`).not.toBeNull();
      const leaks = findVeneerLeaks(decoded!, [HERO.text]);
      expect(leaks.some((l) => l.whole)).toBe(true);
    });
  }
});
