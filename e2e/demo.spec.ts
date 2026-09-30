import { expect, test } from '@playwright/test';

/** The hero specimen, as written in projects/demo/src/app/sections/hero.ts. */
const HERO_TEXT =
  'This paragraph looks perfectly normal to you. Copy it, search it, or feed it to a scraper, and all you get is gibberish.';

const HERO = 'app-hero p[veneer]';

test.describe('demo site', () => {
  test('ships scrambled text in the prerendered HTML', async ({ request }) => {
    const html = await (await request.get('./')).text();

    expect(html).toContain('data-veneer-ssr');
    expect(html).not.toContain(HERO_TEXT);
  });

  test('runs on the Angular major under test', async ({ page }) => {
    const expected = process.env['ANGULAR_MAJOR'];
    test.skip(!expected, 'set ANGULAR_MAJOR to check the version');

    await page.goto('./');
    const version = await page.locator('[ng-version]').first().getAttribute('ng-version');
    expect(version?.split('.')[0]).toBe(expected);
  });

  test('hydrates, forges the font and keeps the DOM scrambled', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('./');

    const hero = page.locator(HERO);
    // hideUntilReady keeps protected text invisible until the forged font lands.
    await expect(hero).toBeVisible();
    await expect(hero).toHaveCSS('font-family', /^"?Veneer-/);

    const scrambled = (await hero.textContent())?.trim();
    expect(scrambled).toBeTruthy();
    expect(scrambled).not.toBe(HERO_TEXT);
    expect(scrambled).toHaveLength(HERO_TEXT.length);

    expect(errors).toEqual([]);
  });

  test('the forged font draws the scrambled text as the original words', async ({ page }) => {
    await page.goto('./');
    const hero = page.locator(HERO);
    await expect(hero).toBeVisible();

    // Draw each ciphertext character next to the plain character in the base
    // font and count the pixels that differ. Per character, because whole-line
    // metrics drift apart by a pixel or two. The forged font drops hinting, so
    // a working one is close rather than pixel-identical; the control, which
    // draws the ciphertext in the base font as a scraper would see it, shows
    // how far apart wrong glyphs land.
    const { forged, control } = await hero.evaluate(async (el, original) => {
      const family = getComputedStyle(el).fontFamily.split(',')[0].trim();
      const scrambled = (el.textContent ?? '').trim();
      await document.fonts.load(`32px ${family}`);
      await document.fonts.load('32px Roboto');

      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 48;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const draw = (font: string, char: string) => {
        ctx.clearRect(0, 0, 48, 48);
        ctx.font = font;
        ctx.fillText(char, 4, 36);
        return ctx.getImageData(0, 0, 48, 48).data;
      };

      const distance = (font: string) => {
        let differing = 0;
        let inked = 0;
        for (let c = 0; c < original.length; c++) {
          const drawn = draw(font, scrambled[c]);
          const plain = draw('32px Roboto', original[c]);
          for (let i = 3; i < plain.length; i += 4) {
            if (plain[i] > 0) inked++;
            if (Math.abs(drawn[i] - plain[i]) > 64) differing++;
          }
        }
        return differing / inked;
      };

      return { forged: distance(`32px ${family}`), control: distance('32px Roboto') };
    }, HERO_TEXT);

    expect(control).toBeGreaterThan(0.5);
    expect(forged).toBeLessThan(0.15);
  });
});
