import { expect, test } from '@playwright/test';

/**
 * The library fails open: when forging or FontFace breaks it logs
 * `[veneer] disabled ...` and shows readable text. The page still looks fine,
 * so this console line is the only sign that protection is off.
 */
test('the demo page never logs "[veneer] disabled"', async ({ page }) => {
  const disabled: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('[veneer] disabled')) {
      disabled.push(message.text());
    }
  });

  await page.goto('./');
  // Every protected element is hidden until the font is ready or forging has
  // failed, so a visible hero means load() has settled one way or the other.
  await expect(page.locator('app-hero p[veneer]')).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(disabled).toEqual([]);
});
