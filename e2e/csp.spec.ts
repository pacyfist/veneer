import { type Page, expect, test } from '@playwright/test';
import { HERO } from './support/demo-specimens';

/**
 * Hiding server-rendered text until the forged font is ready (ROADMAP Now #7).
 *
 * The served HTML carries no inline `visibility:hidden`: a marker attribute,
 * an inline `<style>` rule and an inline `<script>` that switches the rule on.
 * Under a strict CSP, style attributes in markup are ignored, so an inline
 * style would leave the text showing as gibberish in the fallback font until
 * hydration. Here the page is served with a nonce-based CSP and every frame
 * is sampled from the first one: the hero must never be visible unless it is
 * drawn with the forged font, loaded, and holding ciphertext.
 */

const NONCE = 'e2e-nonce-3f9a';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${NONCE}' 'report-sample'`,
  `style-src 'self' 'nonce-${NONCE}' 'report-sample'`,
].join('; ');

/** What a frame showed of the hero paragraph. */
interface Frame {
  visible: boolean;
  family: string;
  loaded: boolean;
  plaintext: boolean;
}

declare global {
  interface Window {
    __frames: Frame[];
    __violations: { directive: string; sample: string }[];
  }
}

/**
 * Serves the prerendered page with a CSP header. With `nonceVeneer`, every
 * inline `<script>` and `<style>` gets the nonce, as a server providing
 * Angular's CSP_NONCE would emit it; without, veneer's two are left without.
 */
async function serveWithCsp(page: Page, nonceVeneer: boolean) {
  await page.route(
    (url) => url.pathname === '/veneer/',
    async (route) => {
      const response = await route.fetch();
      let html = await response.text();
      html = html
        .replace(/<(script|style)(?=[\s>])/g, `<$1 nonce="${NONCE}"`)
        .replace('<app-root', `<app-root ngCspNonce="${NONCE}"`);
      if (!nonceVeneer) {
        html = html
          .replace(`<style nonce="${NONCE}" id="veneer-hide">`, '<style id="veneer-hide">')
          .replace(`<script nonce="${NONCE}" id="veneer-js">`, '<script id="veneer-js">');
      }
      await route.fulfill({
        response,
        body: html,
        headers: { ...response.headers(), 'content-security-policy': CSP },
      });
    },
  );

  // A slow app bundle, so the browser paints the server's HTML well before
  // Angular runs: that window is where a flash would show.
  await page.route(/\/main-[\w-]+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });

  await page.addInitScript((plain: string) => {
    window.__frames = [];
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__violations.push({ directive: e.violatedDirective, sample: e.sample }),
    );
    const sample = () => {
      const el = document.querySelector('app-hero p[veneer]');
      if (el) {
        const style = getComputedStyle(el);
        const family = style.fontFamily.split(',')[0].trim().replace(/["']/g, '');
        window.__frames.push({
          visible: style.visibility === 'visible' && style.display !== 'none',
          family,
          loaded: [...document.fonts].some(
            (f) => f.family.replace(/["']/g, '') === family && f.status === 'loaded',
          ),
          plaintext: (el.textContent ?? '').replace(/\s+/g, ' ').trim() === plain,
        });
      }
      if (window.__frames.length < 3000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, HERO.text);
}

async function framesUntilActive(page: Page): Promise<Frame[]> {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'active');
  await expect(page.locator('app-hero p[veneer]')).toBeVisible();
  // A few more frames after the reveal.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return page.evaluate(() => window.__frames);
}

test.describe('strict CSP', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'measured in Chromium');

  test('protected text never shows readable or in the fallback font', async ({ page }) => {
    await serveWithCsp(page, true);
    const frames = await framesUntilActive(page);
    const violations = await page.evaluate(() => window.__violations);

    // Frames painted before hydration, with the text hidden by the rule.
    expect(frames.filter((f) => !f.visible).length).toBeGreaterThan(5);
    const bad = frames.filter(
      (f) => f.visible && (!f.family.startsWith('Veneer-') || !f.loaded || f.plaintext),
    );
    test.info().annotations.push({
      type: 'frames',
      description: `${frames.length} sampled, ${frames.filter((f) => !f.visible).length} hidden, ${bad.length} wrong`,
    });
    expect(bad).toEqual([]);
    expect(frames.at(-1)).toMatchObject({ visible: true, loaded: true, plaintext: false });

    // The policy really is enforced (the async stylesheet's onload handler is
    // blocked), and veneer's inline style and script are not what it blocks.
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.filter((v) => /veneer/.test(v.sample))).toEqual([]);
    await expect(page.locator('html')).toHaveClass(/veneer-js/);
  });

  test('control: without the nonce the text flashes in the fallback font', async ({ page }) => {
    await serveWithCsp(page, false);
    const frames = await framesUntilActive(page);
    const violations = await page.evaluate(() => window.__violations);

    // The CSP blocks veneer's script, so nothing is hidden: the server's
    // ciphertext is on screen before the forged font exists. This is the
    // fail-visible direction; nothing readable leaks.
    expect(violations.some((v) => /veneer-js/.test(v.sample))).toBe(true);
    expect(frames.some((f) => f.visible && !f.loaded)).toBe(true);
    expect(frames.some((f) => f.visible && f.plaintext)).toBe(false);
  });
});

test.describe('readers without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('see the scrambled text instead of blank space', async ({ page }) => {
    await page.goto('./');
    const hero = page.locator('app-hero p[veneer]');

    await expect(hero).toBeVisible();
    await expect(hero).toHaveCSS('visibility', 'visible');
    const text = ((await hero.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toHaveLength(HERO.text.length);
    expect(text).not.toBe(HERO.text);
    await expect(hero).toHaveAttribute('translate', 'no');
  });
});
