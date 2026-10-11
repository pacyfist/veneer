import { expect, test } from '@playwright/test';

/**
 * Per-request `shouldProtect` (ROADMAP Next #12): a request the server counts
 * as a verified crawler gets readable server HTML with no forged font, and the
 * page hydrates without protection; every other request is protected.
 *
 * The crawler is faked with a TEST-ONLY header that src/server.ts honours only
 * when playwright.config.ts sets VENEER_EXAMPLE_TEST_CRAWLER=1. Real apps
 * decide with verifyCrawler() (reverse and forward DNS).
 */

/** Same text as src/app/app.ts. */
const SECRET = 'The quick brown fox jumps over the lazy dog.';
const CRAWLER = { 'x-veneer-test-crawler': '1' };
/** A forged font URL, as written in the HTML or JSON-escaped in ng-state. */
const FORGED_FONT = /veneer(?:\/|\\u002F)[0-9a-f]{32}\.ttf/i;
const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/130.0.0.0';

const stateOf = (html: string) =>
  JSON.parse(html.match(/<script id="ng-state"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '{}');

const decode = (text: string) => text.replace(/&#39;/g, "'").replace(/\s+/g, ' ');

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'csr', 'no server, so no per-request decision');
});

test('a verified crawler gets readable server HTML with no forged font', async ({ request }) => {
  const html = await (await request.get('./', { headers: CRAWLER })).text();

  expect(decode(html)).toContain(SECRET);
  expect(html).not.toMatch(FORGED_FONT);
  expect(html).not.toContain('data-veneer-ssr');
  expect(html).not.toContain('data-veneer-hidden');
  expect(html).not.toMatch(/Veneer-[0-9a-f]{16}/);
  // Only the note that keeps the hydrating client unprotected; no font, no family.
  expect(stateOf(html).veneer).toEqual({ protect: false });
});

test('a normal request, in between, is still protected', async ({ request }) => {
  await request.get('./', { headers: CRAWLER });
  const html = await (await request.get('./')).text();

  expect(decode(html)).not.toContain(SECRET);
  expect(html).toMatch(FORGED_FONT);
  expect(html).toContain('data-veneer-ssr');
  expect(Object.keys(stateOf(html).veneer).sort()).toEqual(['family', 'fonts']);
});

test('a Googlebot user-agent alone is not trusted', async ({ request }) => {
  // 127.0.0.1 does not reverse-resolve to googlebot.com, so this stays protected.
  const html = await (await request.get('./', { headers: { 'user-agent': GOOGLEBOT_UA } })).text();
  expect(decode(html)).not.toContain(SECRET);
  expect(html).toMatch(FORGED_FONT);
});

test('the crawler page hydrates readable, with no font fetch, no hiding and no errors', async ({
  page,
}) => {
  await page.setExtraHTTPHeaders(CRAWLER);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const fetched: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'fetch') fetched.push(new URL(request.url()).pathname);
  });
  // Every state the protected elements pass through, from the first parse on.
  await page.addInitScript(() => {
    const seen: { text: string; visible: boolean; family: string }[] = [];
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    new MutationObserver(() => {
      for (const id of ['bound', 'piped']) {
        const el = document.getElementById(id);
        if (!el) continue;
        const style = getComputedStyle(el);
        seen.push({
          text: (el.textContent ?? '').trim(),
          visible: style.visibility === 'visible',
          family: style.fontFamily,
        });
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });

  await page.goto('./');
  // Hydrated: Angular has claimed the server's elements (it tags them with
  // __ngContext__, in production builds too), and veneer's fetches, if any,
  // have had time to start.
  await page.waitForFunction(() => '__ngContext__' in document.getElementById('bound')!);
  await page.waitForLoadState('networkidle');

  for (const id of ['bound', 'piped']) {
    await expect(page.locator(`#${id}`)).toHaveText(SECRET);
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  const seen = await page.evaluate(
    () =>
      (window as unknown as { __seen: { text: string; visible: boolean; family: string }[] })
        .__seen,
  );
  expect(seen.length).toBeGreaterThan(0);
  for (const s of seen) {
    expect(s.text).toBe(SECRET);
    expect(s.visible).toBe(true);
    expect(s.family).not.toContain('Veneer-');
  }
  expect(fetched.filter((path) => path.endsWith('.ttf'))).toEqual([]);
  expect(errors).toEqual([]);
});
