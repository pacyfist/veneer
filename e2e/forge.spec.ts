import { readFileSync } from 'node:fs';
import {
  type Browser,
  type BrowserType,
  type Page,
  chromium,
  expect,
  firefox,
  test,
  webkit,
} from '@playwright/test';
import opentype from 'opentype.js';

/**
 * The forged font in real engines: it must pass each browser's font sanitiser
 * (OTS in Chromium and Firefox, WebKit's own checks), and protected text must
 * shape exactly like plain text in the base font, kerning and ligatures
 * included.
 *
 * The forge runs inside the page, from the built `@pacyfist/veneer/core`
 * bundle (`npm run build:lib`, part of `build:pages`). The bundle has no
 * imports, so it loads as a plain module from a routed fake origin.
 *
 * Engines missing from playwright.config.ts are launched here directly, and
 * skipped when their browser is not installed.
 */

const CORE = 'dist/pacyfist/veneer/fesm2022/pacyfist-veneer-core.mjs';
const ROBOTO = 'projects/demo/public/fonts/Roboto-Regular.ttf';
const ORIGIN = 'http://veneer.test';

/** Kerning (AV, To), ligatures (fi, ffl) and a pangram. */
const SAMPLES = ['AV', 'To', 'fi', 'ffl', 'Wave', 'The quick brown fox jumps over the lazy dog.'];

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };

/** Installed in the page by openForgePage. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function loadCore(): Promise<any>;

/** A tiny CFF font whose last glyph sits above U+FFFF, to exercise format 12. */
function tinyCffFont(): Buffer {
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', advanceWidth: 500, path: new opentype.Path() }),
  ];
  ['a', 'b', 'c', '😀'].forEach((char, i) => {
    const width = 400 + i * 100;
    const path = new opentype.Path();
    path.moveTo(50, 0);
    path.lineTo(width - 50, 0);
    path.lineTo(width - 50, 700);
    path.lineTo(50, 700);
    path.close();
    glyphs.push(
      new opentype.Glyph({
        name: `g${i}`,
        unicode: char.codePointAt(0),
        advanceWidth: width,
        path,
      }),
    );
  });
  const font = new opentype.Font({
    familyName: 'TinyCff',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
  });
  return Buffer.from(font.toArrayBuffer());
}

async function openForgePage(page: Page): Promise<void> {
  // A real dynamic import, out of reach of the test transpiler.
  await page.addInitScript(() => {
    Reflect.set(globalThis, 'loadCore', new Function("return import('/core.mjs')"));
  });
  const files: Record<string, [string, Buffer | string]> = {
    '/': ['text/html', '<!doctype html><meta charset="utf-8"><title>forge</title><body></body>'],
    '/core.mjs': ['text/javascript', readFileSync(CORE)],
    '/Roboto.ttf': ['font/ttf', readFileSync(ROBOTO)],
    '/Tiny.otf': ['font/otf', tinyCffFont()],
  };
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = files[new URL(route.request().url()).pathname];
    return file
      ? route.fulfill({ contentType: file[0], body: file[1] })
      : route.fulfill({ status: 404 });
  });
  await page.goto(`${ORIGIN}/`);
}

interface Measurement {
  text: string;
  /** `text-rendering`: the default, and geometricPrecision for unhinted, fractional advances. */
  mode: string;
  base: number;
  forged: number;
  /** The ciphertext in the base font: what the page shows without the forged font. */
  control: number;
}

/** Forge Roboto in the page and measure every sample in both fonts. */
async function measureRoboto(page: Page) {
  return page.evaluate(async (samples) => {
    const core = await loadCore();
    const bytes = await (await fetch('/Roboto.ttf')).arrayBuffer();

    const started = performance.now();
    const base = await core.parseBaseFont(bytes);
    const map = core.buildScrambleMap(2024);
    const forged: ArrayBuffer = core.forgeScrambledFont(base, map, 'Veneer-e2e');
    const forgeMs = performance.now() - started;

    const baseFace = new FontFace('Base-e2e', bytes);
    const forgedFace = new FontFace('Veneer-e2e', forged);
    await Promise.all([baseFace.load(), forgedFace.load()]);
    document.fonts.add(baseFace);
    document.fonts.add(forgedFace);

    const width = (family: string, text: string, mode: string) => {
      const span = document.createElement('span');
      span.style.cssText =
        `font: 32px "${family}"; font-kerning: normal; white-space: pre; ` +
        `text-rendering: ${mode};`;
      span.textContent = text;
      document.body.append(span);
      const w = span.getBoundingClientRect().width;
      span.remove();
      return w;
    };

    const measurements = ['auto', 'geometricPrecision'].flatMap((mode) =>
      samples.map((text) => {
        const scrambled: string = core.scrambleText(text, map);
        return {
          text,
          mode,
          base: width('Base-e2e', text, mode),
          forged: width('Veneer-e2e', scrambled, mode),
          control: width('Base-e2e', scrambled, mode),
        };
      }),
    );
    return {
      forgeMs,
      status: forgedFace.status,
      baseSize: bytes.byteLength,
      forgedSize: forged.byteLength,
      measurements,
    };
  }, SAMPLES);
}

/** Forge the CFF font with an astral codepoint in the page and measure glyph advances. */
async function measureCff(page: Page) {
  return page.evaluate(async () => {
    const core = await loadCore();
    const bytes = await (await fetch('/Tiny.otf')).arrayBuffer();
    const base = await core.parseBaseFont(bytes);
    // a -> 😀 -> b -> a; c stays.
    const map = {
      seed: 0,
      forward: new Map([
        [0x61, 0x1f600],
        [0x1f600, 0x62],
        [0x62, 0x61],
      ]),
    };
    const face = new FontFace('Tiny-e2e', core.forgeScrambledFont(base, map, 'Tiny-e2e'));
    await face.load();
    document.fonts.add(face);

    const span = document.createElement('span');
    span.style.cssText = 'font: 100px "Tiny-e2e"; white-space: pre;';
    document.body.append(span);
    const width = (text: string) => {
      span.textContent = text;
      return span.getBoundingClientRect().width;
    };
    // Advances are 400 (a), 500 (b), 600 (c), 700 (😀) units on a 1000-unit em.
    return {
      outlines: base.outlines,
      b: width('b'),
      smile: width('😀'),
      a: width('a'),
      c: width('c'),
    };
  });
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: the forged font loads and shapes exactly like the base font`, async ({
    browser,
    browserName,
  }, testInfo) => {
    const projectEngine = (p: (typeof testInfo.config.projects)[number]) =>
      p.use.browserName ?? p.use.defaultBrowserType ?? 'chromium';
    const configured = testInfo.config.projects.some((p) => projectEngine(p) === engine);
    const firstProject = testInfo.config.projects[0]?.name === testInfo.project.name;
    test.skip(
      configured ? browserName !== engine : !firstProject,
      `${engine} runs in its own project`,
    );

    let own: Browser | undefined;
    if (browserName !== engine) {
      try {
        own = await ENGINES[engine].launch();
      } catch (error) {
        const message = (error as Error).message;
        const reason = /missing dependencies/i.test(message)
          ? 'the host is missing its system libraries'
          : message.split('\n')[0];
        test.skip(true, `${engine} did not launch: ${reason}`);
      }
    }
    const context = await (own ?? browser).newContext();
    try {
      const page = await context.newPage();
      await openForgePage(page);

      const roboto = await measureRoboto(page);
      expect(roboto.status).toBe('loaded');
      for (const m of roboto.measurements as Measurement[]) {
        const label = `${engine} ${m.mode} "${m.text}"`;
        expect(Math.abs(m.forged - m.base), label).toBeLessThanOrEqual(0.01);
      }
      // Proves the forged face is what drew the text: the ciphertext in the base font differs.
      const pangram = (roboto.measurements as Measurement[]).at(-1)!;
      expect(Math.abs(pangram.control - pangram.base)).toBeGreaterThan(1);

      const cff = await measureCff(page);
      expect(cff.outlines).toBe('cff');
      expect(cff.b).toBeCloseTo(70, 1); // draws 😀
      expect(cff.smile).toBeCloseTo(40, 1); // draws a
      expect(cff.a).toBeCloseTo(50, 1); // draws b
      expect(cff.c).toBeCloseTo(60, 1); // untouched

      const report = {
        engine,
        version: (own ?? browser).version(),
        forgeMs: Math.round(roboto.forgeMs * 10) / 10,
        baseSize: roboto.baseSize,
        forgedSize: roboto.forgedSize,
        widths: roboto.measurements,
        cff,
      };
      console.log(JSON.stringify(report));
      await testInfo.attach('measurements', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await context.close();
      await own?.close();
    }
  });
}
