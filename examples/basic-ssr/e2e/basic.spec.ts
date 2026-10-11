import { expect, test } from '@playwright/test';

/** Same text as src/app/app.ts. */
const SECRET = 'The quick brown fox jumps over the lazy dog.';

const decodeHtml = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

test('protected text is scrambled in the served HTML and visible once running', async ({
  page,
}, testInfo) => {
  const ssr = testInfo.project.name !== 'csr';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const response = await page.goto('./');
  const html = (await response!.text()).replace(/\s+/g, ' ');

  expect(html).not.toContain(SECRET);
  if (ssr) expect(html).toContain('data-veneer-ssr');

  for (const id of ['bound', 'piped']) {
    const el = page.locator(`#${id}`);
    // hideUntilReady keeps it hidden until the forged font is registered.
    await expect(el).toBeVisible();
    await expect(el).toHaveCSS('font-family', /^"?Veneer-/);

    const text = (await el.textContent())?.trim() ?? '';
    expect(text).not.toBe(SECRET);
    expect(text).toHaveLength(SECRET.length);

    if (ssr) {
      // The client read the server's cipher out of the forged font, so it
      // shows the very ciphertext the server rendered.
      const served = html.match(new RegExp(`<p id="${id}"[^>]*>([^<]*)</p>`))?.[1];
      expect(served && decodeHtml(served).trim()).toBe(text);
    }
  }

  const major = process.env['ANGULAR_MAJOR'];
  if (major) {
    const version = await page.locator('[ng-version]').first().getAttribute('ng-version');
    expect(version?.split('.')[0]).toBe(major);
  }

  expect(errors).toEqual([]);
});
