import AxeBuilder from '@axe-core/playwright';
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

test.describe('bold and italic faces', () => {
  test('load only on demand and register weight 700 and italic faces', async ({ page }) => {
    const faceRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/fonts/faces/')) faceRequests.push(new URL(r.url()).pathname);
    });
    await openDemo(page);
    await page.locator('summary', { hasText: 'Real bold and italic faces' }).click();
    expect(faceRequests).toEqual([]);

    await page.getByRole('button', { name: /Load bold and italic/ }).click();
    const cards = page.locator('app-faces app-faces-card');
    await expect(cards).toHaveCount(2);
    const [regular, faces] = [cards.nth(0), cards.nth(1)];

    await expect(faces.getByTestId('faces').locator('li')).toHaveText([
      'weight normal, style normal',
      'weight 700, style normal',
      'weight normal, style italic',
    ]);
    await expect(regular.getByTestId('faces').locator('li')).toHaveText([
      'weight normal, style normal',
    ]);
    expect(faceRequests.sort()).toEqual([
      '/veneer/fonts/faces/Roboto-Bold.ttf',
      '/veneer/fonts/faces/Roboto-Italic.ttf',
    ]);

    // Still protected: the bold words are not in the DOM.
    const strong = faces.locator('p[veneer] strong');
    await expect(strong).toHaveCSS('font-weight', '700');
    expect(await strong.textContent()).not.toBe('bold words');
  });
});

test.describe('[veneerHtml] with CMS HTML', () => {
  test('strips the unsafe bits, keeps markup, and keeps veneer-skip from SafeHtml', async ({
    page,
  }) => {
    await openDemo(page);
    const panel = page.locator('app-cms-html');
    const element = panel.getByTestId('cms-element');
    const dom = panel.getByTestId('cms-dom');

    // A plain string: sanitized like [innerHTML].
    await expect(dom).toContainText('<a href="#start">');
    await expect(dom).toContainText('<strong>');
    await expect(dom).toContainText('<code>npm test</code>');
    await expect(dom).not.toContainText('onclick');
    await expect(dom).not.toContainText('script');
    expect(await element.locator('script').count()).toBe(0);
    expect(await element.locator('a').getAttribute('onclick')).toBeNull();
    await expect(element.locator('a')).not.toHaveText('setup guide');
    // Angular's sanitizer drops attributes it does not know, veneer-skip
    // included, so the name is scrambled with the rest. The copy says so; if
    // this starts failing, veneer-skip survives sanitizing: update the copy.
    await expect(dom).not.toContainText('veneer-skip');
    await expect(dom).not.toContainText('Ada Lovelace');
    await expect(panel.getByTestId('a11y')).toContainText('contains a link');

    // SafeHtml goes in as it is: veneer-skip survives and stays readable.
    await panel.getByRole('tab', { name: 'SafeHtml' }).click();
    await expect(dom).toContainText('veneer-skip');
    await expect(element.locator('[veneer-skip]')).toHaveText('Ada Lovelace');
    await expect(element.locator('code')).toHaveText('npm test');
    await expect(element.locator('strong')).not.toHaveText('font');
  });
});

test.describe('status events', () => {
  test('each breakage button shows the code monitoring would receive', async ({ page }) => {
    await openDemo(page);
    const section = page.locator('app-breakage');
    const log = section.getByTestId('status-log');
    await expect(log.locator('li')).toHaveText([/loading/, /active/]);
    await expect(section.getByTestId('html-status')).toHaveText(
      '<html data-veneer-status="active">',
    );

    await section.getByRole('button', { name: "Font won't load" }).click();
    await expect(log.locator('li')).toHaveText([/loading/, /failed\s*VNR010/]);

    await section.getByRole('button', { name: 'Strict coverage' }).click();
    await expect(log.locator('li')).toHaveText([/loading/, /failed\s*VNR012/]);

    await section.getByRole('button', { name: 'Characters the font lacks' }).click();
    await expect(log.locator('li')).toHaveText([/loading/, /active/]);
    await expect(section).toContainText('VNR014');

    // The sample's failure never reaches the shell's own status.
    await expect(section.getByTestId('html-status')).toHaveText(
      '<html data-veneer-status="active">',
    );
  });
});

test.describe('accessibility mode, made visible', () => {
  test('specimens say whether screen readers skip them, and flip with readable mode', async ({
    page,
  }) => {
    await openDemo(page);
    const heroNote = page.locator('app-hero').getByTestId('a11y');
    const card = page.locator('app-breakage app-specimen-card');
    await expect(card.locator('.badge')).toHaveText('protected');
    const cardNote = card.getByTestId('a11y');
    const tabsNote = page.locator('app-apply-tabs').getByTestId('a11y');

    for (const note of [heroNote, cardNote, tabsNote]) {
      await expect(note).toContainText('skipped (aria-hidden="true")');
    }
    await expect(page.locator('app-hero p[veneer]')).toHaveAttribute('aria-hidden', 'true');

    await page.locator('button[veneerReadableToggle]').click();
    for (const note of [heroNote, cardNote, tabsNote]) {
      await expect(note).toContainText('read it, readable mode is on');
    }
    await expect(page.locator('app-hero p[veneer]')).not.toHaveAttribute('aria-hidden');

    await page.locator('button[veneerReadableToggle]').click();
    for (const note of [heroNote, cardNote, tabsNote]) {
      await expect(note).toContainText('skipped');
    }
  });
});

test.describe('without JavaScript', () => {
  test('a script-less frame of this page shows the scrambled hero, not blank space', async ({
    page,
  }) => {
    await openDemo(page);
    const card = page.locator('app-try-it');
    await card.getByRole('tab', { name: 'Without JavaScript' }).click();
    await card.getByRole('button', { name: 'Load this page with JavaScript off' }).click();

    const frame = page.frameLocator('app-no-js iframe');
    const hero = frame.locator('app-hero p[veneer]');
    await expect(hero).toBeVisible();
    await expect(hero).toHaveCSS('visibility', 'visible');
    // No script ran in the frame, not even veneer's inline one.
    await expect(frame.locator('html')).not.toHaveClass(/veneer-js/);
    await expect(frame.locator('html')).toHaveAttribute('data-veneer-status', 'loading');

    const readout = page.locator('app-no-js').getByTestId('no-js-hero');
    await expect(readout).toContainText('visible');
    const text = (await hero.textContent())!.replace(/\s+/g, ' ').trim();
    expect(text).toHaveLength(HERO.text.length);
    expect(text).not.toBe(HERO.text);
    await expect(readout).toContainText(text);

    // axe cannot run inside a frame that blocks scripts; it still checks the
    // frame element itself (frame-title and the rest).
    const { violations } = await new AxeBuilder({ page })
      .include('app-no-js')
      .options({ iframes: false })
      .setLegacyMode()
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual(
      [],
    );
  });
});

test.describe('Content Security Policy', () => {
  test('the exported hashes match the inline elements of the served page', async ({ page }) => {
    await openDemo(page);
    await page.locator('summary', { hasText: 'Strict Content Security Policy' }).click();
    const table = page.getByTestId('csp-hashes');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    for (const row of await table.locator('tbody tr').all()) {
      const exported = row.locator('td').nth(1);
      await expect(exported).toHaveText(/^'sha256-[A-Za-z0-9+/]+=*'$/);
      await expect(row.locator('td').nth(2)).toHaveText((await exported.textContent())!);
      await expect(row.locator('td').nth(3)).toHaveText('matches');
    }
    await expect(page.locator('app-csp')).toContainText("hideWith: 'hidden'");
  });
});

test.describe('leak self-check', () => {
  test('finds the served HTML clean and every protected text in the bundle', async ({ page }) => {
    const lazy: string[] = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'script') lazy.push(new URL(r.url()).pathname);
    });
    await openDemo(page);
    const loadedBefore = lazy.length;

    const panel = page.locator('app-leak-check');
    await panel.getByRole('button', { name: 'Check this page for leaks' }).click();
    const rows = page.getByTestId('leak-report').locator('li');
    await expect(rows.first()).toBeVisible();
    // The testing entry point arrived as its own lazy chunk, on the click.
    expect(lazy.length).toBeGreaterThan(loadedBefore);

    const report = await rows.evaluateAll((items) =>
      items.map((li) =>
        ['text', 'html', 'js'].map((field) =>
          li.querySelector(`[data-field="${field}"]`)!.textContent!.trim(),
        ),
      ),
    );
    expect(report.length).toBeGreaterThanOrEqual(5);
    expect(report.map((r) => r[0])).toContain(HERO.text);
    for (const [text, html, js] of report) {
      // The only HTML hit is the demo's own code sample quoting its specimen.
      expect(html, text).toBe(
        text === 'Protected by element content.' ? 'quoted in a code sample' : 'clean',
      );
      expect(js, text).toMatch(/^found in main-[\w-]+\.js/);
    }
  });
});

test.describe('attack matrix', () => {
  test('lists who is stopped and who is not, as THREAT_MODEL.md does', async ({ page }) => {
    await page.goto('./');
    const rows = page.getByTestId('attack-matrix').locator('tbody tr');
    await expect(rows).toHaveCount(8);
    const result = (who: RegExp) => rows.filter({ hasText: who }).locator('.badge');
    await expect(result(/^\(a\) Crawler/)).toHaveText('Blocked');
    await expect(result(/^\(b\)/)).toHaveText('Blocked');
    await expect(result(/^\(c\)/)).toHaveText('Succeeds');
    await expect(result(/^\(d\)/)).toHaveText('Succeeds');
  });
});

test.describe('server-only options', () => {
  test('are code samples that point at the runnable example', async ({ page }) => {
    await openDemo(page);
    await page.locator('summary', { hasText: 'More for server-rendered apps' }).click();
    const panel = page.locator('app-server-options');
    for (const option of ['secret:', 'veneerFontMiddleware', 'shouldProtect', 'verifyCrawler']) {
      await expect(panel).toContainText(option);
    }
    await expect(panel.getByRole('link', { name: 'examples/basic-ssr' })).toHaveAttribute(
      'href',
      'https://github.com/pacyfist/veneer/tree/main/examples/basic-ssr',
    );
  });
});
