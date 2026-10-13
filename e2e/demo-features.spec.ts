import { type Page, expect, test } from '@playwright/test';
import { HERO } from './support/demo-specimens';

/**
 * The demo's live evidence for the features added during the roadmap work.
 * Each panel must produce its evidence in the visitor's browser: these checks
 * click what a visitor clicks and read what the panel then shows.
 */

async function openDemo(page: Page) {
  await page.goto('./');
  // Hydrated and the shell's font settled, so clicks reach the components.
  await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'active');
}

test.describe('the key is not in the page', () => {
  test('ng-state holds no seed, the seed hunt fails, and the fonts decode after a click', async ({
    page,
  }) => {
    await openDemo(page);
    await page.locator('app-try-it').getByRole('tab', { name: 'Is the key in it?' }).click();
    const panel = page.locator('app-keyless');

    const state = panel.getByTestId('ng-state');
    await expect(state).toContainText(/"family": "Veneer-[0-9a-f]{16}"/);
    await expect(state).toContainText(/veneer\/[0-9a-f]{32}\.ttf/);
    await expect(state).not.toContainText(/seed/i);

    const hunt = panel.getByTestId('seed-hunt');
    await expect(hunt).toContainText('not found');
    await expect(hunt).toContainText(/\b0 of \d{2,}\b/);

    // The plaintext appears only after the visitor asks for it.
    await expect(panel.getByTestId('decoded')).toHaveCount(0);
    await expect(panel).not.toContainText(HERO.text);
    await panel.getByRole('button', { name: 'Decode it like an attacker' }).click();
    const decoded = panel.getByTestId('decoded');
    await expect(decoded).toContainText(HERO.text);
    await expect(decoded).toContainText('Matches the paragraph you can read.');
  });
});

test.describe('cipher table', () => {
  test("shows the page's own cipher by class, with no seed", async ({ page }) => {
    await openDemo(page);
    await page.locator('summary', { hasText: 'The full cipher table' }).click();
    const table = page.getByTestId('cipher-table');
    await expect(table).toContainText('Letters');
    await expect(table).not.toContainText(/seed/i);
    await expect(page.locator('app-cipher-table')).not.toContainText(/seed|shuffle/i);
    await expect(table).toContainText('space ! - / ? | }');
    await expect(table).toContainText(`" $ ' <`);

    // The table is the cipher the hero is scrambled with.
    const pairs = await table
      .locator('span.rounded-field')
      .evaluateAll((spans) =>
        spans.map((s) => [s.childNodes[0].textContent!.trim(), s.lastElementChild!.textContent!]),
      );
    expect(pairs.length).toBe(84);
    const forward = new Map(pairs as [string, string][]);
    const scrambled = [...HERO.text].map((ch) => forward.get(ch) ?? ch).join('');
    const hero = (await page.locator('app-hero p[veneer]').textContent())!.replace(/\s+/g, ' ');
    expect(hero.trim()).toBe(scrambled);
  });
});

test.describe('Latin presets and NFC on the test bench', () => {
  const SAMPLE =
    'Rendered with the settings on the left: Zażółć gęślą jaźń, Größe, façade, naïve. And a decomposed café.';

  test('accents scramble in the DOM yet draw as the original letters', async ({ page }) => {
    await openDemo(page);
    await page.locator('summary', { hasText: 'Every setting, on a test bench' }).click();
    const card = page.locator('app-bench app-specimen-card');
    await expect(card.locator('.badge')).toHaveText('protected');
    const sample = card.locator('p.leading-relaxed');
    await expect(sample).toHaveCSS('font-family', /^"?Veneer-/);

    const dom = (await sample.textContent())!;
    const expected = SAMPLE.normalize('NFC');
    expect([...dom]).toHaveLength([...expected].length);
    for (const word of ['Zażółć', 'gęślą', 'Größe', 'façade', 'naïve', 'café']) {
      expect(dom).not.toContain(word);
    }
    // Each accented letter became another accented (non-ASCII) letter.
    [...expected].forEach((ch, i) => {
      if (ch.codePointAt(0)! > 0x7f) {
        expect([...dom][i]).not.toBe(ch);
        expect([...dom][i].codePointAt(0)!).toBeGreaterThan(0x7f);
      }
    });
    // NFC: e + U+0301 is one letter in the page.
    await expect(card.getByTestId('codepoints')).toHaveText(
      `${[...SAMPLE].length} code points in the text, ${[...expected].length} in the page.`,
    );

    // Drawn as the original: as wide as the readable text in the base font.
    const widths = await sample.evaluate(async (el, plainText) => {
      await document.fonts.ready;
      const plain = document.createElement('span');
      plain.style.cssText = `font: ${getComputedStyle(el).font}; font-family: Roboto, sans-serif; white-space: pre;`;
      plain.textContent = plainText;
      const shown = plain.cloneNode() as HTMLElement;
      shown.style.fontFamily = getComputedStyle(el).fontFamily;
      shown.textContent = el.textContent;
      document.body.append(plain, shown);
      const result = [plain.getBoundingClientRect().width, shown.getBoundingClientRect().width];
      plain.remove();
      shown.remove();
      return result;
    }, expected);
    expect(Math.abs(widths[0] - widths[1])).toBeLessThan(0.5);

    // DEFAULT_CHARSET alone leaves the accented letters as they are.
    await page.locator('app-bench select').first().selectOption('ascii');
    await expect(sample).toHaveCSS('font-family', /^"?Veneer-/);
    await expect(card.locator('.badge')).toHaveText('protected');
    await expect(sample).toContainText('ż');
    await expect(sample).toContainText('é');
  });
});
