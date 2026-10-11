import { expect, test } from '@playwright/test';

/**
 * The Angular service's loading path in a real browser: the font URL, the
 * per-page font cache and the status it reports.
 */

const FONT_PATH = '/veneer/fonts/Roboto-Regular.ttf';

test('resolves the relative font path against <base href> and fetches it once', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/Roboto-Regular.ttf')) {
      requests.push(new URL(request.url()).pathname);
    }
  });

  await page.goto('./');
  await expect(page.locator('app-hero p[veneer]')).toHaveCSS('font-family', /^"?Veneer-/);

  // The breakage section runs a second provideVeneer instance with the same
  // relative URL. Once it is protecting, both instances have their font.
  const card = page.locator('app-breakage app-specimen-card');
  await expect(card.locator('.badge')).toHaveText('protected');
  await page.waitForLoadState('networkidle');

  expect(requests.filter((path) => path === FONT_PATH)).toHaveLength(1);
});

test('mirrors the shell status on <html data-veneer-status>', async ({ request, page }) => {
  // Prerendered: the server never loads the font, so it records "loading".
  const html = await (await request.get('./')).text();
  expect(html).toMatch(/<html[^>]*data-veneer-status="loading"/);

  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'active');
});

test('keeps the font forge out of the initial bundle and loads it lazily', async ({
  request,
  page,
}) => {
  const html = await (await request.get('./')).text();
  const initial = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1]);
  expect(initial.length).toBeGreaterThan(0);
  for (const file of initial) {
    const source = await (await request.get(file)).text();
    // WOFF decoding is part of the forge and nothing else uses it.
    expect(source, file).not.toContain('DecompressionStream');
  }

  const lazy: string[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.endsWith('.js') && !initial.some((file) => url.endsWith(file))) {
      if ((await response.text()).includes('DecompressionStream')) lazy.push(url);
    }
  });
  await page.goto('./');
  await expect(page.locator('app-hero p[veneer]')).toHaveCSS('font-family', /^"?Veneer-/);
  expect(lazy).toHaveLength(1);
});
