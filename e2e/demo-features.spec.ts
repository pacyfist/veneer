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
