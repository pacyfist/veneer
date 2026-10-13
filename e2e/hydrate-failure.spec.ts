import { expect, test, type Page } from '@playwright/test';
import { fetchServedPage } from './support/served-html';

/**
 * A prerendered page holds only ciphertext. The browser learns the cipher
 * from the forged font, read against the base font, so when either cannot be
 * fetched the server's text stays scrambled. That must not be silent: the
 * failure is VNR016 whatever the cause, so monitoring can alert on one code,
 * and the text is shown rather than left hidden. A request that fails once is
 * retried before giving up.
 */

const HERO = 'app-hero p[veneer]';
const BASE_FONT = '**/fonts/Roboto-Regular.ttf';
const FORGED_FONT = '**/veneer/veneer/*.ttf';

/** Collect `[veneer] disabled (...)` console errors. */
function disabledErrors(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('[veneer] disabled')) {
      seen.push(message.text());
    }
  });
  return seen;
}

for (const [what, pattern] of [
  ['base font', BASE_FONT],
  ['forged font', FORGED_FONT],
] as const) {
  test(`reports VNR016 and shows the server text when the ${what} is blocked`, async ({
    page,
    request,
  }) => {
    const { document } = await fetchServedPage(request);
    const served = document.querySelector(HERO)!.textContent!.trim();

    let fetches = 0;
    await page.route(pattern, (route) => {
      if (route.request().resourceType() === 'fetch') fetches++;
      return route.abort('blockedbyclient');
    });
    const errors = disabledErrors(page);

    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'failed');
    await expect.poll(() => errors.some((e) => e.includes('disabled (VNR016)'))).toBe(true);

    // Not hidden: the visitor sees what the server rendered, which stays
    // ciphertext because the cipher never arrived.
    const hero = page.locator(HERO);
    await expect(hero).toBeVisible();
    expect((await hero.textContent())?.trim()).toBe(served);
    // Tried twice before giving up.
    expect(fetches).toBeGreaterThanOrEqual(2);
  });

  test(`recovers when the ${what} fails once`, async ({ page }) => {
    let failed = false;
    await page.route(pattern, (route) => {
      if (!failed && route.request().resourceType() === 'fetch') {
        failed = true;
        return route.abort('connectionreset');
      }
      return route.continue();
    });
    const errors = disabledErrors(page);

    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'active');
    expect(failed).toBe(true);
    expect(errors).toEqual([]);
  });
}
