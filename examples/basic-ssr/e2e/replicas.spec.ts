import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Two instances of the `ssr` build with one `secret` and one shared `emitDir`
 * (see playwright.config.ts), as replicas behind a load balancer without
 * sticky sessions, or one server before and after a restart.
 */

/** As in playwright.config.ts. */
const APP = process.env['EXAMPLE_APP_DIR'] ?? join(tmpdir(), 'veneer-example-basic-ssr', 'app');
const PORT = Number(process.env['EXAMPLE_PORT'] ?? 4610);
const REPLICA_FONT_DIR = join(APP, 'replica-fonts');
const [A, B] = [PORT + 3, PORT + 4].map((port) => `http://127.0.0.1:${port}`);

const stateOf = (html: string) =>
  JSON.parse(html.match(/<script id="ng-state"[^>]*>([\s\S]*?)<\/script>/)![1]).veneer as {
    family: string;
    fonts: string[];
  };

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'ssr', 'talks to the replicas directly, once');
});

test('a replica that never rendered the page serves its font, and renders the same cipher', async ({
  request,
}) => {
  const fromA = stateOf(await (await request.get(`${A}/`)).text());
  const font = await request.get(`${A}/${fromA.fonts[0]}`);
  expect(font.status()).toBe(200);
  const bytes = await font.body();

  // B has rendered nothing: the font comes from the shared folder A wrote.
  const fromDisk = await request.get(`${B}/${fromA.fonts[0]}`);
  expect(fromDisk.status()).toBe(200);
  expect(fromDisk.headers()['content-type']).toBe('font/ttf');
  expect(fromDisk.headers()['cache-control']).toContain('immutable');
  expect(Buffer.compare(await fromDisk.body(), bytes)).toBe(0);

  // And B, rendering the page itself, derives the same family and font URL.
  expect(stateOf(await (await request.get(`${B}/`)).text())).toEqual(fromA);

  // Even with the shared folder gone, B now holds the font in memory.
  rmSync(REPLICA_FONT_DIR, { recursive: true, force: true });
  expect((await request.get(`${B}/${fromA.fonts[0]}`)).status()).toBe(200);
});
