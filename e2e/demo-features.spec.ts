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
