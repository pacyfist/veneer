import { expect, test } from '@playwright/test';
import { fetchServedPage } from './support/served-html';

/**
 * The key stays out of the prerendered HTML (ROADMAP Next #2). The build
 * forges the font, writes it next to the page, and the page carries only its
 * URL and a random family name. The browser fetches that font, reads the
 * cipher from its cmap and only then recovers the readable text. Prerendered
 * pages share one cipher per build.
 *
 * The seed-regex attack itself lives in adversaries/seed-regex.spec.ts.
 */

const HERO = 'app-hero p[veneer]';

declare global {
  interface Window {
    __heroSeen: { visible: boolean; text: string; ready: boolean }[];
  }
}

async function servedState(request: Parameters<typeof fetchServedPage>[0]) {
  const { html, document } = await fetchServedPage(request);
  const state = JSON.parse(document.querySelector('script#ng-state')?.textContent ?? '{}');
  return { html, document, veneer: state.veneer as { family: string; fonts: string[] } };
}

test('the forged font the page names is a static file of the build', async ({ request }) => {
  const { veneer } = await servedState(request);
  expect(veneer.fonts).toHaveLength(1);
  const font = await request.get(veneer.fonts[0]);
  expect(font.status()).toBe(200);
  expect((await font.body()).byteLength).toBeGreaterThan(50_000);
});

test('the served hero is ciphertext in the random family, hidden until ready', async ({
  request,
}) => {
  const { document, veneer } = await servedState(request);
  const hero = document.querySelector(HERO) as HTMLElement;
  expect(hero.hasAttribute('data-veneer-ssr')).toBe(true);
  expect(hero.getAttribute('style')).toContain(`"${veneer.family}"`);
  // Hidden by a marker attribute and the inline rule veneer adds to <head>
  // (switched on by its inline script), not by an inline style (Now #7).
  expect(hero.hasAttribute('data-veneer-hidden')).toBe(true);
  expect(hero.getAttribute('style')).not.toContain('visibility');
  expect(document.getElementById('veneer-hide')?.textContent).toContain('[data-veneer-hidden]');
});

test('hydrates to the very ciphertext the server rendered, fetching the forged font once', async ({
  page,
  request,
}) => {
  const { document, veneer } = await servedState(request);
  const served = document.querySelector(HERO)!.textContent!.trim();

  const fonts: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.ttf')) fonts.push(new URL(r.url()).pathname);
  });
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'active');
  const hero = page.locator(HERO);
  await expect(hero).toBeVisible();
  await expect(hero).toHaveCSS('font-family', new RegExp(`^"?${veneer.family}`));

  // Same map as the server, so the client shows the same ciphertext. If the
  // build's cipher ever changes, this page was served from a different build.
  expect((await hero.textContent())?.trim()).toBe(served);

  expect(fonts.filter((p) => p.endsWith(veneer.fonts[0]))).toHaveLength(1);
});

test('shows no protected text before the forged font is ready, however slow it is', async ({
  page,
}) => {
  // Hold the forged font back until the test lets it through, so the window
  // between hydration and the font is wide; record the hero on every DOM
  // change in the meantime.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/veneer/veneer/*.ttf', async (route) => {
    await held;
    await route.continue();
  });
  await page.addInitScript(() => {
    window.__heroSeen = [];
    const record = () => {
      const el = document.querySelector('app-hero p[veneer]');
      if (!el) return;
      const family = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/["']/g, '');
      window.__heroSeen.push({
        visible: getComputedStyle(el).visibility === 'visible',
        text: (el.textContent ?? '').trim(),
        ready: [...document.fonts].some((f) => f.family === family && f.status === 'loaded'),
      });
    };
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });

  await page.goto('./');
  // Hydrated, still waiting for the font: hidden, server text untouched.
  await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'loading');
  await expect(page.locator(HERO)).toBeHidden();
  await page.waitForTimeout(300);
  release();

  await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'active');
  await expect(page.locator(HERO)).toBeVisible();
  const final = (await page.locator(HERO).textContent())?.trim();

  const seen = await page.evaluate(() => window.__heroSeen);
  expect(seen.some((s) => !s.visible)).toBe(true);
  for (const s of seen.filter((s) => s.visible)) {
    expect(s.ready, 'visible before the forged font was ready').toBe(true);
    expect(s.text).toBe(final);
  }
  // While hidden, the hero never held anything but the server's ciphertext.
  expect(new Set(seen.map((s) => s.text))).toEqual(new Set([final]));
});
