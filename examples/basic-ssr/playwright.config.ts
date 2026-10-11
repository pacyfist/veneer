import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Smoke test for the example app that scripts/example-smoke.mjs installs from
 * the packed tarball and builds outside the repository. Run that script; it
 * calls `playwright test -c examples/basic-ssr` with EXAMPLE_APP_DIR set.
 *
 * Three builds, one project each: `ssr` (zone.js, hydration), `zoneless`
 * (hydration) and `csr` (no server, no hydration). Chromium only: the main
 * e2e suite covers the other engines; this one covers packaging and setups.
 */
const APP = process.env['EXAMPLE_APP_DIR'] ?? join(tmpdir(), 'veneer-example-basic-ssr', 'app');
const PORT = Number(process.env['EXAMPLE_PORT'] ?? 4610);

const variants = [
  { name: 'ssr', port: PORT, command: `node ${join(APP, 'dist/ssr/server/server.mjs')}` },
  {
    name: 'zoneless',
    port: PORT + 1,
    command: `node ${join(APP, 'dist/zoneless/server/server.mjs')}`,
  },
  {
    name: 'csr',
    port: PORT + 2,
    // webServer commands run in this config's directory.
    command: 'node e2e/serve-static.mjs',
    root: join(APP, 'dist/csr/browser'),
  },
];

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  outputDir: join(APP, 'test-results'),
  use: { trace: 'on-first-retry' },

  projects: variants.map(({ name, port }) => ({
    name,
    use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${port}/` },
  })),

  // Never reuse a server: a stray one on the port would test something else.
  webServer: variants.map(({ port, command, root }) => ({
    command,
    url: `http://127.0.0.1:${port}/`,
    // VENEER_EXAMPLE_TEST_CRAWLER: test-only crawler header, see src/server.ts.
    env: { PORT: String(port), VENEER_EXAMPLE_TEST_CRAWLER: '1', ...(root ? { ROOT: root } : {}) },
    reuseExistingServer: false,
    timeout: 30_000,
  })),
});
