# TODO

Upgrade ideas for veneer. Each one was checked against the code, the installed
`node_modules` and headless Chromium 152 on 2026-10-10 and re-checked on
2026-10-11. Ordered by value for effort. Effort: **S** = an hour or two,
**M** = a day or so, **L** = several days.

## 1. Rewrite the cmap in place instead of rebuilding the font (M)

Keep the base `.ttf` bytes and replace only its `cmap` table, so each scrambled
codepoint points at the glyph id of its readable character. Glyph ids do not
change, so every other table keeps working.

Why:

- The current forge (`font-forge.ts`, `new Font({...}).toArrayBuffer()`) drops
  GPOS, GSUB, `gasp` and hinting (`fpgm`, `prep`, `cvt`). opentype.js 2's writer
  (`fontToSfntTable`) never emits GPOS or `kern` at all, so this cannot be fixed
  by copying tables across.
- The forge also converts TrueType outlines to CFF. Protected text may then
  rasterise differently from the surrounding Roboto on Windows. Not verified on
  Windows; the format change itself is measured.
- Only charset glyphs survive, so accents depend on `fallbackFontFamily`.

Measured with Roboto-Regular, text at 32px in Chromium:

| Text            | Base font | In-place cmap | Current forge |
| --------------- | --------- | ------------- | ------------- |
| `AV` (kerning)  | 39.89px   | 39.89px       | 41.25px       |
| `fi` (ligature) | 17.73px   | 17.73px       | 18.91px       |
| `ffl`           | 27.31px   | 27.31px       | 30.03px       |
| Pangram         | 640.09px  | 640.09px      | 641.67px      |

| Font          | Tables kept | Outlines | Size   |
| ------------- | ----------- | -------- | ------ |
| Base          | 15          | TrueType | 124 KB |
| In-place cmap | 15          | TrueType | 129 KB |
| Current forge | 8           | CFF      | 18 KB  |

Also confirmed:

- `new FontFace(name, bytes)` ignores the font's `name` table, so no renaming is
  needed.
- Scrambled punctuation and digit codepoints still get Latin kerning and
  ligatures from HarfBuzz.
- In Node, parsing the font takes about 15ms while the cmap rewrite takes about
  3ms. In Chromium, parse plus forge took about 70ms on first run.

Side benefits:

- opentype.js can leave the peer dependencies. It ships no `.d.ts`, yet the
  published types `import { Font } from 'opentype.js'`, so consumers need an
  undeclared `@types/opentype.js`.
- Its CommonJS `main` breaks the published bundle in plain Node (see item 4).
- A Web Worker for font building becomes pointless.

Watch out for:

- Codepoints above U+FFFF need a format 12 subtable.
- Write both the (0,3) and (3,1) encoding records, or keep the base's set
  consistent.
- The in-memory font is about 7x larger. That matters only for several faces or
  very large CJK fonts.
- `.otf` (CFF) and variable fonts work unchanged, since only `cmap` is touched.

## 2. Restore end-to-end tests and run CI on push and PR (M)

- `e2e/` holds only `serve-static.mjs`, so `npm run e2e` fails with "No tests
  found".
- `deploy.yml` has a NOTE saying nothing verifies the published site is
  scrambled. No workflow triggers on `pull_request`. `npm test` runs only in
  `publish.yml` on release.
- jsdom has no `FontFace`, so unit tests only ever exercise the fail-open path.
- The old suite was deleted in commit 68e648b and can be restored:
  `protection.spec.ts`, `hydration.spec.ts`, `clipboard.spec.ts`,
  `config-lab.spec.ts`. Selectors and the `NoAi-` family prefix need updating to
  `Veneer-`.
- CI needs `npx playwright install --with-deps chromium`.
- Useful assertions: served HTML contains no readable protected phrase, carries
  `data-veneer-ssr`, and a `Veneer-*` face is in `document.fonts`.
- Fix the stale reference to the deleted `scripts/verify-in-browser.mjs` in
  `veneer.directive.spec.ts`.

## 3. Remove `-` and `?` from the default charset (S)

In Chromium, only these two of the 94 default characters create a line-break
opportunity inside a word. A letter mapped to either lets a visible word wrap
mid-word. The reviewer saw one split word in about a third of five-line
paragraphs across 30 seeds.

- Drop U+002D and U+003F from `DEFAULT_CHARSET`, so they pass through like the
  space.
- This changes the cipher for a given seed. Bump the version.
- Firefox and Safari were not tested.
- Alternative: map into Private Use Area codepoints. That removes the
  derangement fix-up loop in `buildScrambleMap`, but copy-paste then yields tofu.

## 4. Add a `@pacyfist/veneer/core` secondary entry point (S)

Both READMEs say the cipher runs in a plain Node script. It does not: the FESM
imports `@angular/core`, `@angular/common` and `opentype.js`, and importing it
in Node fails with "Named export 'Font' not found" from opentype.js.

- Add `projects/pacyfist/veneer/core/ng-package.json` plus
  `core/src/public-api.ts` exporting `scramble-map.ts` only. ng-packagr
  discovers it and adds `exports["./core"]` automatically.
- Add a `paths` entry in `tsconfig.json` if the demo imports it.
- `forgeScrambledFont` can join `/core` once item 1 lands, or with
  `import ot from 'opentype.js'`.

## 5. Charset presets and a `charsetFromFont` helper (S)

Non-ASCII letters pass through readable, so Polish, German and French text leaks
its diacritics.

- Roboto-Regular covers Latin-1 Supplement letters fully and Latin Extended-A
  fully (128 of 128). Polish, German and French letters are all present.
- Export presets such as `LATIN_1_LETTERS` and `LATIN_EXTENDED_A`, and a helper
  that reads the font's cmap.
- Never include U+00A0 (no-break space) or U+00AD (soft hyphen). Roboto has
  glyphs for both, so a font-derived helper must exclude them explicitly.

## 6. Document strict CSP behaviour, and offer a CSP-safe hide (S)

SSR writes `style="font-family: ...; visibility: hidden"` attributes into the
HTML. Under `style-src 'self'`, Chromium ignores style attributes in markup but
allows CSSOM writes from script, and the `hidden` attribute still works. So
under strict CSP, protected text shows as gibberish in the fallback font until
hydration, which is the flash `hideUntilReady` exists to prevent.

- Document it in the README.
- Consider emitting the `hidden` attribute, or a documented class, instead of an
  inline `visibility` style.

## 7. Warn that static template text ships readable in the JS bundle (S docs, L fix)

The hero's `<p veneer>` text appears in `main-*.js` in plain form, while
`index.html` contains none of it. Anyone fetching the bundle gets every static
`<p veneer>...</p>` string. Only the bound `[veneer]="data"` form avoids this.

- Document it under "What this defends against".
- A compile-time transform that scrambles element content would fix it. That
  fits with item 12.

## 8. Dependabot and a CHANGELOG (S)

- `.github/` has only `workflows/`. No Dependabot, Renovate or CHANGELOG exists.
- `publish.yml` runs an unpinned `npm install -g npm@latest`. Pin it.

## 9. Run unit tests in a real browser with Vitest browser mode (S to M)

- `@angular/build`'s unit-test builder has a `browsers` option, for example
  `["ChromiumHeadless"]`.
- It needs `@vitest/browser-playwright`, which is not installed.
- `font-forge.spec.ts` reads its fixture with `node:fs`. It must fetch a served
  fixture instead.
- Lower priority once item 2 lands.

## 10. Preserve inline markup inside protected elements (M)

`VeneerDirective` sets `textContent`, so links and emphasis inside
`<p veneer>` are flattened. That makes it awkward for real article bodies.

- Walk the element's text nodes and scramble each one with `Renderer2.setValue`,
  keeping the tree. Replacing nodes would break hydration's references.
- SSR runs on domino, which supports text nodes, `childNodes` and `nodeValue`.
- The SSR marker and inverse cipher still work per text node.
- A bound string with markup would mean setting `innerHTML` from data, so it
  needs sanitising or an explicit trusted contract.

## 11. Bold and italic faces (M, after item 10)

One provider forges one face with `styleName: 'Regular'`. Bold text in a
protected element gets synthetic bold.

- Let `font` accept several sources with weight and style.
- `new FontFace(family, bytes, { weight, style })` works in Chromium.
- Headings using `veneerFont` benefit even before item 10.
- Memory is about 4x, worse combined with item 1.

## 12. Build-time CLI for static sites (M, after item 1 or 4)

A `npx veneer` command that scrambles `[veneer]` elements in static HTML and
emits the matching font. Useful for Jekyll and similar sites.

- opentype.js 2 parses a Node `Buffer` fine, and no `FontFace` is needed.
- It cannot import `@pacyfist/veneer` in Node today. It needs item 1 or 4, or a
  bundled CLI.
- A static build means a fixed seed. Consider one seed and font per page.
- Skip `<script>`, `<style>` and attributes, and reuse item 10's text-node walk.

## 13. Opt-in readable copy for human readers (S, weakens the model)

A `copy` handler that puts the readable text on the clipboard, while `innerText`
scrapers still get gibberish.

- Works in Chromium for a selection inside one protected element.
- A selection that starts outside the protected element never fires that
  element's listener. The handler must listen on `document` and invert only the
  text nodes inside protected hosts.
- This contradicts the README's claim that copy-paste into a chatbot is stopped.
  Keep it opt-in and documented.

## Rejected

- **Lazy font loading.** `VeneerFontService` is a plain class provider with no
  initializer, so Angular only creates it, and starts the load, on first
  injection. It already loads once per page, only when something uses it.
- **Web Worker for building the font.** Item 1 cuts the work to a few
  milliseconds, and worker bundling for library consumers is costly.
