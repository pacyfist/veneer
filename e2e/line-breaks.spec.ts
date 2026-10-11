import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Protected text must wrap where the readable text would.
 *
 * The browser picks line-break opportunities from the codepoints in the DOM,
 * so a cipher that turns a letter into `-` or `?` lets a word split in half
 * while the reader still sees letters. This renders a long paragraph readable
 * and protected, for many seeds and column widths, and compares where every
 * line starts.
 *
 * The prerendered demo has one seed per build, so this page drives the BUILT
 * core bundle directly instead (dist/, the same file `@pacyfist/veneer/core`
 * publishes) and picks the seeds itself. Its files are served through
 * `page.route` under the suite's base URL; nothing here depends on the demo's
 * markup.
 *
 * Kerning and ligatures are off on both paragraphs, so they differ only in
 * their codepoints and any difference in wrapping comes from line breaking. A
 * zero-width column wraps at every break opportunity, which lists them all
 * independently of glyph widths.
 */

const ROOT = join(__dirname, '..');
const FILES: Record<string, { path: string; type: string }> = {
  'core.mjs': {
    path: 'dist/pacyfist/veneer/fesm2022/pacyfist-veneer-core.mjs',
    type: 'text/javascript',
  },
  'opentype.mjs': { path: 'node_modules/opentype.js/dist/opentype.mjs', type: 'text/javascript' },
  'Roboto-Regular.ttf': {
    path: 'projects/pacyfist/veneer/testing/Roboto-Regular.ttf',
    type: 'font/ttf',
  },
};

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script type="importmap">{ "imports": { "opentype.js": "./opentype.mjs" } }</script>
    <style>
      p {
        margin: 0 0 24px;
        font-size: 16px;
        line-height: 20px;
        font-kerning: none;
        font-variant-ligatures: none;
        font-feature-settings: 'kern' 0, 'liga' 0, 'calt' 0;
      }
    </style>
  </head>
  <body>
    <p id="plain"></p>
    <p id="protected"></p>
  </body>
</html>`;

/** Every kind of character the cipher has to handle, in running prose. */
const TEXT = [
  "Veneer's cipher must never move a line break. Consider well-known compounds, and/or",
  'slashes, questions? Exclamations! Prices like $1,299.99 or 15% off; e-mail jo.doe@example.com,',
  'the address https://example.com/path?q=1&r=2#top, (parentheses), [brackets], {braces},',
  '"double" and \'single\' quotes, <angle> brackets, a|b pipes, snake_case, back`ticks`,',
  'tilde~waves, carets^up, a+b=c*d, 3:45 p.m.; 2024-10-11; ratio 16:9; 1.5x faster (v2.0).',
  'Accents travel too: Zażółć gęślą jaźń, Größe, façade, naïve café, Łódź, Kraków, Ærøskøbing,',
  'señor, coração, Dvořák, Đorđe, İstanbul. Also “curly” and ‘single’ quotes, «guillemets»,',
  'em—dashes, en–dashes, ellipses… and 10°C ± 2, © 2026, 3×4÷2, ½ cup, 50 € or £20 for §7.',
  'Mid-word punctuation (like this.one, that,one, x:y, a;b, #tag, &amp, *star, =eq, >gt,',
  '~tilde, %pct, +plus, \\back, @at, ^hat, _under, `tick) must keep every word in one piece.',
]
  .join(' ')
  .normalize('NFC');

const SEEDS = Array.from({ length: 40 }, (_, i) => ((i + 1) * 0x9e3779b1) >>> 0);
const COLUMNS = [180, 240, 320];

interface Layout {
  seed: number;
  /** Break opportunities of the readable text (zero-width column, base font). */
  opportunities: number[];
  /** Break opportunities of the ciphertext drawn in the base font. */
  cipherOpportunities: number[];
  /** Break opportunities of the ciphertext drawn as a reader sees it. */
  forgedOpportunities: number[];
  /** Line starts per column width, readable and protected. */
  columns: { width: number; plain: number[]; protected: number[] }[];
}

test.beforeEach(async ({ page }) => {
  await page.route('**/__line-breaks/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (name === 'index.html') {
      return route.fulfill({ body: PAGE, contentType: 'text/html; charset=utf-8' });
    }
    const file = FILES[name];
    if (!file) return route.fulfill({ status: 404 });
    return route.fulfill({ body: readFileSync(join(ROOT, file.path)), contentType: file.type });
  });
  await page.goto('./__line-breaks/index.html');
});

/**
 * Lay `TEXT` out readable and protected for each seed.
 *
 * `naive` swaps the library's cipher for a single-pool derangement of all
 * printable ASCII, the pre-0.1 behaviour, as a control that the comparison
 * can actually see a split word.
 */
async function layouts(page: Page, seeds: number[], naive = false): Promise<Layout[]> {
  return page.evaluate(
    async ({ text, seeds, columns, naive }) => {
      const core = await import(new URL('core.mjs', location.href).href);
      const bytes = await (await fetch('Roboto-Regular.ttf')).arrayBuffer();
      document.fonts.add(await new FontFace('LineBreakBase', bytes).load());
      const parsed = core.parseBaseFont(bytes);
      const charset = [...core.DEFAULT_CHARSET];

      const naiveMap = (seed: number) => {
        const pool = Array.from({ length: 94 }, (_, i) => 0x21 + i);
        const target = [...pool];
        let s = seed;
        const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
        for (let i = target.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [target[i], target[j]] = [target[j], target[i]];
        }
        for (let i = 0; i < target.length; i++) {
          if (target[i] !== pool[i]) continue;
          const j = (i + 1) % target.length;
          [target[i], target[j]] = [target[j], target[i]];
        }
        return { seed, forward: new Map(pool.map((cp, i) => [cp, target[i]])) };
      };

      const plain = document.getElementById('plain')!;
      const prot = document.getElementById('protected')!;
      plain.style.fontFamily = 'LineBreakBase';
      plain.textContent = text;

      /** Offsets of the first non-space character of every line after the first. */
      const lineStarts = (el: HTMLElement, width: number): number[] => {
        el.style.width = `${width}px`;
        const node = el.firstChild as Text;
        const range = document.createRange();
        const starts: number[] = [];
        let top: number | null = null;
        for (let i = 0; i < node.length; i++) {
          if (node.data[i] === ' ') continue;
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect) continue;
          const t = Math.round(rect.top);
          if (top !== null && t > top) starts.push(i);
          top = t;
        }
        return starts;
      };

      const opportunities = lineStarts(plain, 0);
      const out = [];
      for (const seed of seeds) {
        const map = naive ? naiveMap(seed) : core.buildScrambleMap(seed, charset);
        const family = `LineBreakForged${naive ? 'Naive' : ''}${seed}`;
        const face = new FontFace(family, core.forgeScrambledFont(parsed, map, family));
        document.fonts.add(await face.load());
        prot.textContent = core.scrambleText(text, map);

        prot.style.fontFamily = 'LineBreakBase';
        const cipherOpportunities = lineStarts(prot, 0);
        prot.style.fontFamily = `"${family}", LineBreakBase`;
        const forgedOpportunities = lineStarts(prot, 0);
        const cols = columns.map((width) => ({
          width,
          plain: lineStarts(plain, width),
          protected: lineStarts(prot, width),
        }));
        out.push({ seed, opportunities, cipherOpportunities, forgedOpportunities, columns: cols });
        document.fonts.delete(face);
      }
      return out;
    },
    { text: TEXT, seeds, columns: COLUMNS, naive },
  );
}

/** Where `offsets` falls in the text, for a readable failure message. */
function at(offsets: number[]): string[] {
  return offsets.map(
    (i) => `${i} "${TEXT.slice(Math.max(0, i - 12), i)}|${TEXT.slice(i, i + 12)}"`,
  );
}

/** Words per line, given where lines start. */
function wordsPerLine(starts: number[]): number[] {
  return [0, ...starts].map((from, i) => {
    const line = TEXT.slice(from, starts[i] ?? TEXT.length).trim();
    return line.split(/ +/).length;
  });
}

test.describe('line breaks', () => {
  test('the cipher keeps every break opportunity, across seeds', async ({ page }) => {
    test.setTimeout(120_000);
    const results = await layouts(page, SEEDS);

    for (const r of results) {
      expect(r.opportunities.length, 'the paragraph has break opportunities').toBeGreaterThan(100);
      // The cipher alone, drawn in the base font: the browser must see exactly
      // the same opportunities in the ciphertext as in the readable text.
      expect(at(r.cipherOpportunities), `seed ${r.seed}`).toEqual(at(r.opportunities));
      // As a reader sees it. No word may gain a break the readable text lacks.
      // Losing one is tolerated: Firefox 153 drops the break after a `-`
      // between digits ("2024-10-11") when the hyphen is drawn by the fallback
      // font and the digits by the forged one, because the forged font only
      // covers scrambled codepoints. A forged font that also kept the
      // pass-through characters would remove that difference.
      const added = r.forgedOpportunities.filter((i) => !r.opportunities.includes(i));
      expect(at(added), `seed ${r.seed}: breaks inside words`).toEqual([]);
    }
  });

  test('protected text wraps like the readable text in narrow columns, across seeds', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const results = await layouts(page, SEEDS);

    for (const r of results) {
      for (const c of r.columns) {
        const label = `seed ${r.seed}, ${c.width}px column`;
        expect(c.plain.length, `${label}: the paragraph wraps`).toBeGreaterThan(5);
        // Every line must start where the readable text could break: no word
        // split mid-word.
        const split = c.protected.filter((i) => !r.opportunities.includes(i));
        expect(at(split), `${label}: lines starting mid-word`).toEqual([]);
        // And the lines must match: same count, same words on each.
        expect(wordsPerLine(c.protected), label).toEqual(wordsPerLine(c.plain));
        expect(at(c.protected), label).toEqual(at(c.plain));
      }
    }
  });

  test('control: a single-pool cipher over all of ASCII does split words', async ({ page }) => {
    // Proves the comparison above can see the bug it guards against.
    const results = await layouts(page, SEEDS.slice(0, 10), true);
    const split = results.flatMap((r) =>
      r.columns.flatMap((c) => c.protected.filter((i) => !r.opportunities.includes(i))),
    );
    expect(split.length).toBeGreaterThan(0);
  });
});
