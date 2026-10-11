import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * The demo's "Get started" code blocks are the root README's, line for line.
 * The README is the source of truth; when it changes, change the constants in
 * projects/demo/src/app/sections/get-started.ts to match.
 */

/** The fenced code blocks of the README's "Get started" section, as lines. */
function readmeBlocks(): string[][] {
  const readme = readFileSync('README.md', 'utf8');
  const start = readme.indexOf('## Get started');
  const section = readme.slice(start, readme.indexOf('\n## ', start + 1));
  return [...section.matchAll(/```\w*\n([\s\S]*?)```/g)].map((m) =>
    m[1].replace(/\n$/, '').split('\n'),
  );
}

test('the demo shows the README setup snippets exactly', async ({ page }) => {
  await page.goto('./');
  const blocks = page.locator('app-get-started ol app-code-block .mockup-code');
  const demo: string[][] = [];
  for (const block of await blocks.all()) {
    demo.push(
      await block.locator('pre code').evaluateAll((codes) => codes.map((c) => c.textContent ?? '')),
    );
  }

  const readme = readmeBlocks();
  expect(readme.length).toBeGreaterThan(3);
  expect(demo).toEqual(readme);
});
