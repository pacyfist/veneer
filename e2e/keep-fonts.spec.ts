import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { createStaticServer } from './serve-static.mjs';

/**
 * `node scripts/demo-veneer-fonts.mjs keep <url> [dir]`, which deploy.yml runs
 * before publishing: the fonts of the site that is live now must survive the
 * deploy, so HTML cached from it still decodes. A copy of the current build
 * stands in for the live site, served the way GitHub Pages serves it.
 *
 * No browser: this checks a build script. It runs once, under chromium.
 */

const BUILD = 'dist/demo/browser';
const run = promisify(execFile);

/** Runs `keep` against `url`, writing into `dir`. Async: the server is in this process. */
const keep = (url: string, dir: string) =>
  run('node', ['scripts/demo-veneer-fonts.mjs', 'keep', url, dir], { timeout: 60_000 });

let work = '';
let live: string;
let server: Server | undefined;

/** Serves `root` like GitHub Pages under /veneer/; resolves to the base URL. */
async function serve(root: string): Promise<string> {
  server = createStaticServer({ root });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/veneer/`;
}

/** The forged fonts a build's index.html references. */
const fontsOf = (dir: string): string[] =>
  JSON.parse(
    `[${readFileSync(join(dir, 'index.html'), 'utf8').match(/"fonts":\[([^\]]*)\]/)![1]}]`,
  );

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'a build script, not a browser: once is enough');
  work = mkdtempSync(join(tmpdir(), 'veneer-keep-'));
  // The deployed site: this build, with the SPA fallback deploy.yml adds.
  live = join(work, 'live');
  cpSync(BUILD, live, { recursive: true });
  cpSync(join(live, 'index.html'), join(live, '404.html'));
});

test.afterEach(async () => {
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  server = undefined;
  if (work) rmSync(work, { recursive: true, force: true });
  work = '';
});

/** The next build: the same pages, but its own fonts, none of the live ones. */
function nextBuild(): string {
  const next = join(work, 'next');
  cpSync(BUILD, next, { recursive: true });
  rmSync(join(next, 'veneer'), { recursive: true, force: true });
  return next;
}

test('adds the fonts the live pages reference to the new build', async () => {
  const fonts = fontsOf(live);
  expect(fonts.length).toBeGreaterThan(0);
  const url = await serve(live);
  const next = nextBuild();

  const { stdout } = await keep(url, next);
  expect(stdout).toContain(`kept ${fonts.length} forged font(s)`);
  for (const font of fonts) {
    expect(readFileSync(join(next, font))).toEqual(readFileSync(join(live, font)));
  }

  // Run again: everything is there already, so nothing changes.
  const again = await keep(url, next);
  expect(again.stdout).toContain(`kept 0 forged font(s)`);
  expect(again.stdout).toContain(`${fonts.length} already in`);
});

test('reads fonts from the 404 page too, and skips URLs that are not forged fonts', async () => {
  const fonts = fontsOf(live);
  // A live site whose index.html is gone, and whose 404.html also lists a
  // font that does not exist and URLs that would leave the build folder.
  rmSync(join(live, 'index.html'));
  const html = readFileSync(join(live, '404.html'), 'utf8').replace(
    /"fonts":\[/,
    `"fonts":["../../escape/${'a'.repeat(32)}.ttf","https://evil.example/${'b'.repeat(32)}.ttf","veneer/${'c'.repeat(32)}.ttf",`,
  );
  writeFileSync(join(live, '404.html'), html);
  const url = await serve(live);
  const next = nextBuild();

  const { stdout } = await keep(url, next);
  expect(stdout).toContain(`kept ${fonts.length} forged font(s)`);
  expect(stdout).toContain(`could not keep veneer/${'c'.repeat(32)}.ttf`);
  expect(readdirSync(join(next, 'veneer')).sort()).toEqual(
    fonts.map((font) => font.split('/').pop()).sort(),
  );
  expect(existsSync(join(work, 'escape'))).toBe(false);
});

test('succeeds quietly when the site has no veneer fonts or cannot be reached', async () => {
  const empty = join(work, 'empty');
  mkdirSync(empty);
  writeFileSync(join(empty, 'index.html'), '<!doctype html><title>first deploy</title>');
  const url = await serve(empty);
  const next = nextBuild();

  const none = await keep(url, next);
  expect(none.stdout).toContain('references no forged fonts');
  expect(existsSync(join(next, 'veneer'))).toBe(false);

  // Port 9 (discard) on loopback: nothing listens there.
  const down = await keep('http://127.0.0.1:9/veneer/', next);
  expect(down.stdout).toContain('unreachable');
  expect(existsSync(join(next, 'veneer'))).toBe(false);
});
