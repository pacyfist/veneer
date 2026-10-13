import { expect, test } from '@playwright/test';
import opentype from 'opentype.js';
import { findVeneerLeaks } from '../../projects/pacyfist/veneer/testing/src/find-veneer-leaks';
import { HERO, ORIGINALS, SPECIMENS } from '../support/demo-specimens';
import { recordCost } from './cost';

/**
 * Adversary (c): a headless browser with one hook. It runs the page's
 * JavaScript, wraps the `FontFace` constructor to keep a copy of every font
 * the page builds, and inverts each forged cmap against the base font's cmap
 * by glyph id. The forged font is the base font with only the cmap replaced,
 * so glyph ids line up and the inversion is exact.
 *
 * This attack is EXPECTED TO SUCCEED, before and after Next #2. Once
 * JavaScript runs, the forged font is the key. Since Next #2 the page fetches
 * the forged font the server rendered with from a URL and hands its bytes to
 * `FontFace`, so the same hook still captures it. That is the documented limit of the
 * technique; the test exists to record what the attack costs, and to notice if
 * it ever stops working (which would mean the font no longer decodes either).
 */

declare global {
  interface Window {
    __veneerFonts: { family: string; source: unknown }[];
  }
}

const toArrayBuffer = (bytes: Buffer): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

test.describe('adversary (c): FontFace hook in a real browser', () => {
  test('recovers the plaintext from the forged font', async ({ page }) => {
    const started = performance.now();
    // attack:begin
    // 1. Keep every font source the page hands to FontFace.
    await page.addInitScript(() => {
      window.__veneerFonts = [];
      window.FontFace = new Proxy(window.FontFace, {
        construct(target, args: ConstructorParameters<typeof FontFace>) {
          window.__veneerFonts.push({ family: args[0], source: args[1] });
          return Reflect.construct(target, args);
        },
      });
    });
    // 2. The base font crosses the network; keep it too. (So does the forged
    // font the server rendered with, which the hook captures anyway.)
    const baseFont = page
      .waitForResponse((r) => r.url().endsWith('/Roboto-Regular.ttf'))
      .then((r) => r.body());

    await page.goto('./');
    await page.waitForFunction(() => window.__veneerFonts.length > 0);
    await expect(page.locator('html')).toHaveAttribute('data-veneer-status', /^(active|failed)$/);

    // 3. Each captured font's bytes, and the text of the elements drawn in it.
    const { fonts, texts } = await page.evaluate(async () => {
      const bytes = async (source: unknown) => {
        if (typeof source === 'string') {
          const url = source.match(/url\(["']?([^"')]+)/)?.[1] ?? source;
          return new Uint8Array(await (await fetch(url)).arrayBuffer());
        }
        if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer);
        return new Uint8Array(source as ArrayBuffer);
      };
      const fonts: Record<string, string> = {};
      for (const { family, source } of window.__veneerFonts) {
        let binary = '';
        for (const b of await bytes(source)) binary += String.fromCharCode(b);
        fonts[family] = btoa(binary);
      }
      const texts = [...document.querySelectorAll('body *')].flatMap((el) => {
        const family = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/["']/g, '');
        const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE);
        const text = own.map((n) => n.textContent).join('');
        return family in fonts && text.trim() ? [{ family, text }] : [];
      });
      return { fonts, texts };
    });

    // 4. Invert: ciphertext codepoint -> forged glyph id -> base codepoint.
    const cmap = (bytes: Buffer): Record<number, number> =>
      opentype.parse(toArrayBuffer(bytes)).tables['cmap'].glyphIndexMap;
    const baseByGlyph = new Map<number, number>();
    for (const [cp, glyph] of Object.entries(cmap(await baseFont))) {
      if (!baseByGlyph.has(glyph)) baseByGlyph.set(glyph, Number(cp));
    }
    const decoders = new Map(
      Object.entries(fonts).map(([family, base64]) => {
        const forged = cmap(Buffer.from(base64, 'base64'));
        return [family, (cp: number) => baseByGlyph.get(forged[cp]) ?? cp];
      }),
    );
    const plaintext = texts
      .map(({ family, text }) => {
        const decode = decoders.get(family)!;
        return String.fromCodePoint(...Array.from(text, (ch) => decode(ch.codePointAt(0)!)));
      })
      .join('\n');
    // attack:end
    recordCost('FontFace hook', performance.now() - started);

    const leaks = findVeneerLeaks(plaintext, ORIGINALS);
    const recovered = SPECIMENS.filter((s) => leaks.some((l) => l.original === s.text));
    test.info().annotations.push({
      type: 'recovered',
      description: `${Object.keys(fonts).length} fonts; ${recovered.map((s) => s.id).join(', ')}`,
    });

    // The hero decodes whole, and so does every specimen on screen at load:
    // all element-content ones except those behind a button. (Bound ones in
    // inactive tabs are not in the DOM.)
    expect(leaks.some((l) => l.original === HERO.text && l.whole)).toBe(true);
    for (const specimen of SPECIMENS.filter((s) => s.form === 'element' && !s.onDemand)) {
      expect(recovered, specimen.id).toContainEqual(specimen);
    }
  });
});
