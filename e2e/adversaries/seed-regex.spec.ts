import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { findVeneerLeaks } from '../../projects/pacyfist/veneer/testing/src/find-veneer-leaks';
import { HERO, ORIGINALS } from '../support/demo-specimens';
import { fetchServedPage, parseHtml, visibleText } from '../support/served-html';
import { recordCost } from './cost';

/**
 * Adversary (b): a veneer-aware crawler. Still one HTTP GET and no
 * JavaScript, but it knows veneer: it regexes a seed out of the served HTML
 * and rebuilds the cipher with the public `buildScrambleMap` from the npm
 * package (here the built `@pacyfist/veneer/core` bundle).
 *
 * Before Next #2 ("Take the key out of the HTML") the seed reached the HTML
 * twice: `"veneerSeed":<n>` in the `<script id="ng-state">` transfer JSON, and
 * the forged family name, `Veneer-<seed in base 36>`, in every protected
 * element's inline `font-family`. Both attacks decoded every server-rendered
 * element. Now the server draws the cipher from the CSPRNG (no seed exists),
 * the family name is random, and the page carries only the forged font's
 * URL, so these attacks must fail. A crawler has to fetch and parse the font
 * instead (adversary (c) is the browser version of that).
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
    const { html } = await fetchServedPage(request);
    const started = performance.now();
    const decoded = await seedAttack(html, ['ng-state', 'font family']);
    recordCost('seed regex', performance.now() - started);

    expect(findVeneerLeaks(decoded ?? '', ORIGINALS)).toEqual([]);
  });

  test('the served HTML carries no seed, only the forged font URL', async ({ request }) => {
    const { html, document } = await fetchServedPage(request);
    expect(html).not.toMatch(/veneerSeed/i);

    const state = JSON.parse(document.querySelector('script#ng-state')?.textContent ?? '{}');
    expect(Object.keys(state.veneer).sort()).toEqual(['family', 'fonts']);
    expect(state.veneer.family).toMatch(/^Veneer-[0-9a-f]{16}$/);
    for (const url of state.veneer.fonts) expect(url).toMatch(/^veneer\/[0-9a-f]{32}\.ttf$/);

    // The protected elements name that random family, nothing else.
    const families = new Set(
      [
        ...html.matchAll(
          /font-family:\s*&quot;(Veneer-[^&]+)&quot;|font-family: "(Veneer-[^"]+)"/g,
        ),
      ].map((m) => m[1] ?? m[2]),
    );
    expect([...families]).toEqual([state.veneer.family]);
  });

  test('no number anywhere in the page is a seed for its ciphertext', async ({ request }) => {
    // A more patient crawler: every integer in the page, and the family name
    // read in every base, tried as a seed. None may decode the hero.
    const { html, document } = await fetchServedPage(request);
    const { buildScrambleMap, invertScrambleMap, scrambleText } = await import(CORE);
    const family = html.match(/Veneer-([0-9a-z]+)/)?.[1] ?? '';
    const candidates = new Set<number>(
      [...html.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n <= 0xffffffff),
    );
    for (const radix of [10, 16, 36]) candidates.add(parseInt(family, radix) >>> 0);
    candidates.add(parseInt(family.slice(0, 8), 16));
    candidates.add(parseInt(family.slice(8), 16));

    const text = visibleText(document.body);
    const hero = (seed: number) =>
      findVeneerLeaks(scrambleText(text, invertScrambleMap(buildScrambleMap(seed))), [HERO.text]);
    expect(candidates.size).toBeGreaterThan(20);
    for (const seed of candidates) expect(hero(seed), `seed ${seed}`).toEqual([]);
  });
});
