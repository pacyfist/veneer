import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { HERO } from './support/demo-specimens';

/**
 * Accessibility (ROADMAP Next #5): axe-core over the demo page with readable
 * mode off and on, the readable-mode toggle, `withA11y('hide')` and
 * `withReadableCopy()`.
 *
 * axe cannot tell that a paragraph is gibberish, so a clean axe run while
 * protection is on says nothing about whether protected text is accessible
 * (it is not, see the README's Accessibility section). What it does catch are
 * the mistakes veneer itself could make: aria-hidden over focusable content,
 * missing names, attributes in the wrong place. Violations on or inside
 * protected elements are counted as veneer's and must be zero; the rest belong
 * to the demo's own design and are listed as annotations.
 */

const HERO_SELECTOR = 'app-hero p[veneer]';
const TOGGLE = 'button[veneerReadableToggle]';
const PROTECTED = '[veneer], [veneerfont], [data-veneer-ssr], .notranslate';

/** What a copy event carried, read in a listener that runs after veneer's. */
interface Copied {
  prevented: boolean;
  plain: string;
  html: string;
  selection: string;
}

interface Finding {
  rule: string;
  impact: string | null | undefined;
  target: string;
  veneer: boolean;
}

async function openDemo(page: Page) {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-veneer-status', 'active');
}

/** Runs axe and sorts every failing node into veneer's or the demo's. */
async function audit(page: Page): Promise<Finding[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const findings: Finding[] = [];
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const target = node.target.join(' ');
      const veneer = await page.evaluate(
        ([selector, protectedSelector]) => {
          try {
            return !!document.querySelector(selector)?.closest(protectedSelector);
          } catch {
            return false;
          }
        },
        [String(node.target.at(-1)), PROTECTED],
      );
      findings.push({ rule: violation.id, impact: violation.impact, target, veneer });
    }
  }
  return findings;
}

function report(findings: Finding[]) {
  const demo = findings.filter((f) => !f.veneer);
  const byRule = new Map<string, number>();
  for (const f of demo) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  test.info().annotations.push({
    type: 'demo-only axe violations',
    description: [...byRule].map(([rule, n]) => `${rule} x${n}`).join(', ') || 'none',
  });
  return findings.filter((f) => f.veneer);
}

test.describe('axe-core', () => {
  test('no violations from veneer with protection on', async ({ page }) => {
    await openDemo(page);
    const mine = report(await audit(page));
    expect(mine).toEqual([]);
  });

  test('no violations from veneer in readable mode', async ({ page }) => {
    await openDemo(page);
    await page.locator(TOGGLE).click();
    await expect(page.locator(HERO_SELECTOR)).toHaveText(HERO.text);
    const mine = report(await audit(page));
    expect(mine).toEqual([]);
  });
});

test.describe('readable mode', () => {
  test('the toggle turns the page readable, is remembered, and turns back', async ({ page }) => {
    await openDemo(page);
    const hero = page.locator(HERO_SELECTOR);
    const toggle = page.locator(TOGGLE);

    // withA11y('hide') on the shell: hidden from assistive tech while scrambled.
    await expect(hero).toHaveAttribute('aria-hidden', 'true');
    await expect(hero).toHaveAttribute('translate', 'no');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect((await hero.textContent())?.trim()).not.toBe(HERO.text);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(hero).toHaveText(HERO.text);
    await expect(hero).not.toHaveAttribute('aria-hidden');
    await expect(hero).not.toHaveAttribute('translate');
    await expect(hero).not.toHaveCSS('font-family', /Veneer-/);

    // Remembered: a reload hydrates straight into readable text.
    await page.reload();
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-pressed', 'true');
    await expect(hero).toHaveText(HERO.text);
    await expect(hero).toBeVisible();

    await page.locator(TOGGLE).click();
    await expect(hero).toHaveAttribute('aria-hidden', 'true');
    await expect(hero).toHaveCSS('font-family', /Veneer-/);
    expect((await hero.textContent())?.trim()).not.toBe(HERO.text);
  });
});

test.describe('withReadableCopy()', () => {
  /** Selects from `from` (a text node's element) into `to`, copies, and returns what reached the clipboard. */
  async function copySelection(
    page: Page,
    from: string,
    fromOffset: number,
    to: string,
    toOffset: number,
  ) {
    await page.evaluate(
      ([from, fromOffset, to, toOffset]) => {
        const text = (selector: string) => {
          const el = document.querySelector(selector as string)!;
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node = walker.nextNode();
          while (node && !node.textContent?.trim()) node = walker.nextNode();
          return node!;
        };
        (window as unknown as { __copied: Copied | null }).__copied = null;
        window.addEventListener(
          'copy',
          (event) => {
            const data = (event as ClipboardEvent).clipboardData!;
            (window as unknown as { __copied: Copied }).__copied = {
              prevented: event.defaultPrevented,
              plain: data.getData('text/plain'),
              html: data.getData('text/html'),
              selection: document.getSelection()!.toString(),
            };
          },
          { once: true },
        );
        document
          .getSelection()!
          .setBaseAndExtent(
            text(from as string),
            fromOffset as number,
            text(to as string),
            toOffset as number,
          );
      },
      [from, fromOffset, to, toOffset] as const,
    );
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForFunction(() => (window as unknown as { __copied: Copied | null }).__copied);
    return page.evaluate(() => (window as unknown as { __copied: Copied }).__copied);
  }

  test('copies readable words from an instance that opted in', async ({ page }) => {
    await openDemo(page);
    const card = page.locator('app-trade-offs app-specimen-card');
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.badge')).toHaveText('protected');
    const sample = card.locator('p.leading-relaxed');
    await expect(sample).toHaveCSS('font-family', /Veneer-/);
    const scrambled = (await sample.textContent())!;
    expect(scrambled).not.toContain('Copy me');

    // Start outside the protected element, in the explanation next to it.
    const copied = await copySelection(
      page,
      '#copy-explainer',
      0,
      'app-trade-offs app-specimen-card p.leading-relaxed',
      11,
    );
    expect(copied.prevented).toBe(true);
    expect(copied.plain).toMatch(/^\s*With withReadableCopy\(\)[\s\S]*Copy me and\s*$/);
    expect(copied.html).toContain('Copy me and');
    expect(copied.html).not.toMatch(/font-family:[^;"]*Veneer-/);

    // The DOM still holds the ciphertext.
    expect(await sample.textContent()).toBe(scrambled);
  });

  test('leaves copies alone where the feature is off', async ({ page }) => {
    await openDemo(page);
    const target = 'app-try-it p[veneer]';
    const scrambled = ((await page.locator(target).first().textContent()) ?? '').trim();
    const copied = await copySelection(page, target, 0, target, 10);
    expect(copied.prevented).toBe(false);
    expect(copied.plain).toBe('');
    expect(copied.selection.trim()).toBe(scrambled.slice(0, 10).trim());
  });
});
