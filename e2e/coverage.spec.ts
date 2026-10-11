import { expect, test } from '@playwright/test';

/**
 * Charset coverage in a real browser, through the demo's breakage section: an
 * isolated provideVeneer instance whose charset adds ƀ and ƃ, which
 * Roboto-Regular cannot draw.
 */

const SECTION = 'app-breakage';

async function pick(page: import('@playwright/test').Page, label: string) {
  await page.goto('./');
  // Wait for hydration, so the click reaches the component.
  await expect(page.locator('app-hero p[veneer]')).toHaveCSS('font-family', /^"?Veneer-/);
  const section = page.locator(SECTION);
  await section.getByRole('button', { name: label }).click();
  return section.locator('app-specimen-card');
}

test('strictCoverage false: uncovered letters pass through, the rest stays protected', async ({
  page,
}) => {
  const card = await pick(page, 'Characters the font lacks');
  await expect(card.locator('.badge')).toHaveText('protected');

  const protectedText = card.locator('p.text-lg');
  await expect(protectedText).toHaveCSS('font-family', /^"?Veneer-/);
  const dom = (await protectedText.textContent()) ?? '';
  // ƀ and ƃ were dropped from the cipher, so they sit in the DOM as themselves
  // (in the strict instance, which keeps them, they swap with each other)...
  expect(dom.indexOf('ƀ')).toBeGreaterThan(-1);
  expect(dom.indexOf('ƀ')).toBeLessThan(dom.indexOf('ƃ'));
  // ...while everything else is scrambled.
  expect(dom).not.toContain('The page stays usable');

  // The forged font draws the scrambled letters as the original ones: the
  // protected line is exactly as wide as the readable text in the base font.
  const widths = await protectedText.evaluate(async (el) => {
    await document.fonts.ready;
    const plain = document.createElement('span');
    plain.style.cssText = `font: ${getComputedStyle(el).font}; font-family: Roboto, sans-serif; white-space: pre;`;
    plain.textContent =
      'The page stays usable no matter which of these you pick. Even with ƀ and ƃ in it.';
    const shown = plain.cloneNode() as HTMLElement;
    shown.style.fontFamily = getComputedStyle(el).fontFamily;
    shown.textContent = el.textContent;
    document.body.append(plain, shown);
    const result = [plain.getBoundingClientRect().width, shown.getBoundingClientRect().width];
    plain.remove();
    shown.remove();
    return result;
  });
  expect(Math.abs(widths[0] - widths[1])).toBeLessThan(0.5);
});

test('strictCoverage true: one missing glyph fails the instance open with VNR012', async ({
  page,
}) => {
  const card = await pick(page, 'Strict coverage');
  await expect(card.locator('.badge')).toHaveText('unprotected, still readable');
  await expect(card.locator('p.text-lg')).toHaveText(
    'The page stays usable no matter which of these you pick. Even with ƀ and ƃ in it.',
  );
  await expect(card).toContainText('VNR012');
});
