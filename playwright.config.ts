import { defineConfig, devices } from '@playwright/test';

const PORT = 4322;
const BASE_URL = `http://127.0.0.1:${PORT}/no-ai/`;

/**
 * End-to-end checks run against the BUILT static site, not the dev server.
 *
 * Everything this library claims depends on things jsdom cannot do — jsdom has
 * no FontFace, so every unit test necessarily runs the fail-open path and can
 * never observe the forged font at all. These tests are the only place the
 * central claim is actually verified.
 *
 * Run `npm run build:pages` first; the web server serves whatever is in dist.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  // Chromium only. The technique needs the FontFace API and canvas glyph
  // rasterisation; broadening browsers is a separate decision with its own
  // fallout, not a freebie.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'node e2e/serve-static.mjs',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
