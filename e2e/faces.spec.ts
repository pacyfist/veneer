import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Several faces under one forged family, as `withFaces()` registers them: one
 * seed, one family name, each face with its own FontFace descriptors. Checks
 * in a real engine that bold protected text is drawn with the registered bold
 * face (not a synthesized bold of the regular one) and still decodes.
 *
 * The repository ships only Roboto-Regular, so the "bold" face is derived
 * here, for this test only: Roboto-Regular with every advance width scaled by
 * 1.25. That makes it easy to tell which face drew a line (by its width)
 * without downloading a real bold font. The faces are registered the way the
 * service does it, from the built `@pacyfist/veneer/forge` and
 * `@pacyfist/veneer/core` bundles; the service's own wiring of descriptors is
 * covered by unit tests (veneer-faces.spec.ts).
 */

const CORE = 'dist/pacyfist/veneer/fesm2022/pacyfist-veneer-core.mjs';
const FORGE = 'dist/pacyfist/veneer/fesm2022/pacyfist-veneer-forge.mjs';
const ROBOTO = 'projects/demo/public/fonts/Roboto-Regular.ttf';
const ORIGIN = 'http://veneer.test';
const WIDEN = 1.25;

/** Roboto-Regular with every advance width (and advanceWidthMax) scaled by WIDEN. */
function widenedRoboto(): Buffer {
  const font = Buffer.from(readFileSync(ROBOTO));
  const tables = new Map<string, number>();
  const numTables = font.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    tables.set(font.toString('latin1', record, record + 4), font.readUInt32BE(record + 8));
  }
  const hhea = tables.get('hhea')!;
  const hmtx = tables.get('hmtx')!;
  font.writeUInt16BE(Math.round(font.readUInt16BE(hhea + 10) * WIDEN), hhea + 10);
  const metrics = font.readUInt16BE(hhea + 34);
  for (let i = 0; i < metrics; i++) {
    const at = hmtx + i * 4;
    font.writeUInt16BE(Math.round(font.readUInt16BE(at) * WIDEN), at);
  }
  // Checksums are now stale; the forge recomputes them when it writes the font.
  return font;
}

test('bold protected text uses the registered bold face of the forged family', async ({ page }) => {
  const files: Record<string, [string, Buffer | string]> = {
    '/': ['text/html', '<!doctype html><meta charset="utf-8"><title>faces</title><body></body>'],
    '/core.mjs': ['text/javascript', readFileSync(CORE)],
    '/forge.mjs': ['text/javascript', readFileSync(FORGE)],
    '/Regular.ttf': ['font/ttf', readFileSync(ROBOTO)],
    '/Bold.ttf': ['font/ttf', widenedRoboto()],
  };
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = files[new URL(route.request().url()).pathname];
    return file
      ? route.fulfill({ contentType: file[0], body: file[1] })
      : route.fulfill({ status: 404 });
  });
  await page.goto(`${ORIGIN}/`);

  const result = await page.evaluate(async () => {
    const load = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
    const core = await load('/core.mjs');
    const forge = await load('/forge.mjs');
    const bytes = async (url: string) => (await fetch(url)).arrayBuffer();
    const regularBytes = await bytes('/Regular.ttf');
    const boldBytes = await bytes('/Bold.ttf');

    // What the service does: one seed, one map, one family, a face per weight.
    const map = core.buildScrambleMap(2024);
    const family = 'Veneer-faces';
    const faces = [
      new FontFace(
        family,
        forge.forgeScrambledFont(await forge.parseBaseFont(regularBytes), map, family),
      ),
      new FontFace(
        family,
        forge.forgeScrambledFont(await forge.parseBaseFont(boldBytes), map, family),
        { weight: '700' },
      ),
      // Readable references for both faces.
      new FontFace('Plain-regular', regularBytes),
      new FontFace('Plain-bold', boldBytes),
    ];
    for (const face of await Promise.all(faces.map((f) => f.load()))) document.fonts.add(face);

    const text = 'The quick brown fox jumps over the lazy dog.';
    const width = (fontFamily: string, weight: string, content: string) => {
      const span = document.createElement('span');
      span.style.cssText = `font-family: "${fontFamily}"; font-weight: ${weight}; font-size: 32px; white-space: pre; font-synthesis: weight;`;
      span.textContent = content;
      document.body.append(span);
      const w = span.getBoundingClientRect().width;
      span.remove();
      return w;
    };
    const scrambled = core.scrambleText(text, map);
    return {
      changed: scrambled !== text,
      protectedRegular: width(family, '400', scrambled),
      protectedBold: width(family, '700', scrambled),
      plainRegular: width('Plain-regular', '400', text),
      plainBold: width('Plain-bold', '400', text),
    };
  });

  expect(result.changed).toBe(true);
  // The regular face decodes like the regular base font...
  expect(result.protectedRegular).toBeCloseTo(result.plainRegular, 1);
  // ...and bold protected text is drawn by the bold face, decoded, rather than
  // a synthesized bold of the regular face (which would keep regular widths).
  expect(result.protectedBold).toBeCloseTo(result.plainBold, 1);
  expect(result.protectedBold).toBeGreaterThan(result.protectedRegular * 1.2);
});
