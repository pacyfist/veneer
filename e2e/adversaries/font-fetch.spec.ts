import { expect, test } from '@playwright/test';
import opentype from 'opentype.js';
import { findVeneerLeaks } from '../../projects/pacyfist/veneer/testing/src/find-veneer-leaks';
import { HERO, ORIGINALS, SPECIMENS } from '../support/demo-specimens';
import { fetchServedPage, visibleText } from '../support/served-html';
import { recordCost } from './cost';

/**
 * Adversary (d): a font-aware crawler. No browser and no JavaScript, but it
 * knows veneer and has a font parser. It reads the forged font's URL from the
 * page's transfer state, downloads that font and the base font (whose URL is
 * a string in the app's JS bundle), and inverts the forged cmap against the
 * base cmap by glyph id, exactly as the browser does.
 *
 * EXPECTED TO SUCCEED. This is the bar Next #2 sets: with the key out of the
 * HTML, decoding takes two more downloads and a font parser per cipher, not a
 * regex. On the prerendered demo one forged font serves every visitor until
 * the next build, so it is fetched and parsed once.
 */

const toArrayBuffer = (bytes: Buffer): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

test.describe('adversary (d): fetch the forged font, no JavaScript', () => {
  test('recovers the plaintext by parsing the forged and base fonts', async ({ request }) => {
    const started = performance.now();
    // attack:begin
    const { document } = await fetchServedPage(request);
    const state = JSON.parse(document.querySelector('script#ng-state')!.textContent!);
    const bundle = document.querySelector<HTMLScriptElement>('script[src*="main-"]')!.src;
    const baseUrl = (await (await request.get(bundle)).text()).match(/["']([^"']+\.ttf)["']/)![1];
    const font = async (url: string) =>
      opentype.parse(toArrayBuffer(await (await request.get(url)).body())).tables['cmap']
        .glyphIndexMap as Record<number, number>;
    const base = await font(baseUrl);
    const forged = await font(state.veneer.fonts[0]);
    const byGlyph = new Map<number, number>();
    for (const [cp, glyph] of Object.entries(base)) {
      if (forged[Number(cp)] !== glyph) byGlyph.set(glyph, Number(cp));
    }
    const decode = (ch: string) => byGlyph.get(forged[ch.codePointAt(0)!]) ?? ch.codePointAt(0)!;
    const plaintext = String.fromCodePoint(...Array.from(visibleText(document.body), decode));
    // attack:end
    recordCost('font fetch', performance.now() - started);

    const leaks = findVeneerLeaks(plaintext, ORIGINALS);
    const recovered = SPECIMENS.filter((s) => leaks.some((l) => l.original === s.text));
    test.info().annotations.push({
      type: 'recovered',
      description: recovered.map((s) => s.id).join(', '),
    });
    expect(leaks.some((l) => l.original === HERO.text && l.whole)).toBe(true);
  });
});
