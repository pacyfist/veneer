import { expect, test } from '@playwright/test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
// The suite's own static server, started here on a free port so this test
// counts the requests that really reach the network, not cache hits.
import { createStaticServer } from './serve-static.mjs';

/**
 * The demo's page CSS registers `Roboto` from the very file veneer reads its
 * outlines from (fonts/Roboto-Regular.ttf). With one URL for both, the browser
 * downloads the file once: the second use is served from the HTTP cache. A
 * build that rewrites the CSS url() to a hashed copy (media/Roboto-*.ttf)
 * would make every visitor download the font twice.
 */

let server: Server;
let origin: string;
const hits: string[] = [];

test.beforeAll(async () => {
  server = createStaticServer({ onRequest: (path: string) => hits.push(path) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('the base font crosses the network once, shared by the page CSS and veneer', async ({
  page,
}) => {
  hits.length = 0;
  await page.goto(`${origin}/veneer/`);
  await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'active');

  // Both users of the file have it: the page's Roboto face and veneer's
  // forged face (which needs the base font to read the server's cipher).
  await page.evaluate(() => document.fonts.load('16px Roboto'));
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (f) => f.family.replace(/"/g, '') === 'Roboto' && f.status === 'loaded',
      ),
    ),
  ).toBe(true);
  await expect(page.locator('app-hero p[veneer]')).toHaveCSS('font-family', /^"?Veneer-/);

  // The breakage section's second instance fetches the same base font too.
  await expect(page.locator('app-breakage app-specimen-card .badge')).toHaveText('protected');

  const fonts = hits.filter((path) => path.endsWith('.ttf'));
  test.info().annotations.push({ type: 'font requests', description: fonts.join(', ') });
  expect(fonts.filter((path) => path === '/veneer/fonts/Roboto-Regular.ttf')).toHaveLength(1);
  expect(fonts.filter((path) => path.includes('/media/'))).toEqual([]);
});
