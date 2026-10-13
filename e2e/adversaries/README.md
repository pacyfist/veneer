# Adversary suite

Cheap, realistic attacks on the built demo (`npm run build:pages`), run as part of the
Playwright suite. Each one records its cost as a test annotation (`attack cost`): the lines of
attack code between the `// attack:begin` and `// attack:end` markers, and the wall time.

| Spec                  | Attacker                                                     |
| --------------------- | ------------------------------------------------------------ |
| `plain-fetch.spec.ts` | (a) generic crawler: one GET, an HTML parser, no JavaScript  |
| `seed-regex.spec.ts`  | (b) veneer-aware crawler: regex the seed, rebuild the cipher |
| `font-hook.spec.ts`   | (c) headless browser: hook `FontFace`, invert the cmap       |
| `font-fetch.spec.ts`  | (d) font-aware crawler: download both fonts, invert the cmap |
| `../leaks.spec.ts`    | side channels: served HTML parts and every loaded JS bundle  |

The protected texts come from the demo source (`e2e/support/demo-specimens.ts`), not from a
hard-coded sentence. Places where the demo itself prints a specimen in the clear are listed in
`e2e/support/known-leaks.ts`.

## Attack matrix

Measured on the prerendered demo, Chromium 151 and Firefox 153, 2026-10-11, after Next #2 ("Take
the key out of the HTML"). Times include the page fetch or load, on a heavily loaded machine.

| Attacker                                                             | Needs                                                                                   | Cost                           | Result                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Generic crawler: GET + HTML parser                               | An HTTP client and an HTML parser                                                       | 5 lines, about 1 s             | **Blocked** for every protected element. Gets only what the demo prints in the clear itself (a code sample, an `<input value>`)                                                                                                                                        |
| (a') Crawler that also downloads the page's JS files as text         | The same, plus following `<script src>`                                                 | A few more lines               | **Succeeds** for all 9 demo specimens: each is a compile-time string in `main-*.js` (`leaks.spec.ts`). Only text that arrives at runtime (an API, a CMS) stays out of the bundle                                                                                       |
| (b) Veneer-aware crawler: regex the seed + public `buildScrambleMap` | HTTP, an HTML parser, `@pacyfist/veneer/core` from npm                                  | 15 lines, under 1 s            | **Blocked** since Next #2. There is no seed: the build draws the cipher from the CSPRNG, the family name is random, and ng-state holds only the forged font's URL. A patient variant that tries every integer in the page and the family name in every base also fails |
| (c) Headless browser + `FontFace` hook + cmap inversion              | A headless browser, a font parser (opentype.js), the base font (the page downloads it)  | 56 lines including glue, 1-2 s | **Succeeds**: every specimen on screen, across all 3 forged fonts on the page. This is the documented limit: once JS runs, the forged font is the key                                                                                                                  |
| (d) Font-aware crawler: download the forged and base fonts, no JS    | HTTP, an HTML parser, a font parser (opentype.js); the base font URL from the JS bundle | 15 lines, about 1-2 s          | **Succeeds**. This is the bar Next #2 sets: a font parser and two more downloads instead of a regex. On a prerendered site one forged font serves every visitor until the next build, so it is parsed once per build                                                   |

Not automated, listed so the table is complete:

| Attacker                                                    | Cost                                                                                                                                                                                                                                                                                                                   | Result                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Brute force of a seed against ciphertext alone              | No seed exists unless the app sets `seed`. The cipher is drawn from the CSPRNG, 32 fresh bits per shuffle step: about 225 bits for the letter class of the default charset alone. With a fixed 32-bit seed, the old cost applies (about 48 CPU-hours naively, far less tuned), and the seed is in the JS bundle anyway | Infeasible by default; trivial with a fixed `seed` (tests and demos only) |
| Ciphertext-only cryptanalysis (classic substitution solver) | Off-the-shelf. veneer keeps spaces, word lengths and punctuation classes, which helps the solver                                                                                                                                                                                                                       | Feasible on long passages, before and after Next #2                       |
| OCR or a vision model on a screenshot                       | A headless browser and an OCR or vision model                                                                                                                                                                                                                                                                          | Succeeds by design: the screen shows the real text                        |

## Expected failures

`leaks.spec.ts` marks the bundle check of each specimen `test.fail()`, since every demo specimen
is a compile-time string. A specimen that stops leaking shows up as "expected to fail, but
passed".

`seed-regex.spec.ts` used to state its property under `test.fail()`, with two `KNOWN LEAK` tests
proving the seed decoded the hero through ng-state and through the font family. Next #2 removed
both channels; the property is now a normal passing test, guarded by checks that the served HTML
carries no seed and that no number in it decodes the hero.

## Leak table

From `../leaks.spec.ts` on the prerendered demo. "Bundle" is `main-*.js`, which holds the demo's
own code; the other scripts the page loads (a chunk shared with the lazy `testing` entry, holding
Angular and veneer, and the lazy forge) hold no specimen. No specimen leaks through the title, meta and OG tags, JSON-LD (the demo has none),
`alt`/`aria-label`/`title` attributes or the ng-state JSON (the demo makes no HttpClient calls).

| Specimen (form)                                      | Served HTML                                 | Bundle                                      |
| ---------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| hero "This paragraph looks perfectly…" (element)     | clean                                       | leaks, twice (template text and a constant) |
| try-it "Copy this sentence and…" (element)           | clean                                       | leaks                                       |
| try-it "Find the word haystack…" (element)           | clean                                       | leaks                                       |
| apply-tabs "Protected by element content." (element) | document text: the demo's own code sample   | leaks, twice                                |
| apply-tabs "Protected from a bound signal." (bound)  | clean (inactive tab)                        | leaks (`signal('…')` literal)               |
| apply-tabs "Protected through the pipe." (pipe)      | clean (inactive tab)                        | leaks                                       |
| try-it "My secret sauce recipe" (pipe)               | `<input value>`: the demo pre-fills the box | leaks                                       |
| bench "Rendered with the settings…" (bound)          | clean (rendered in the browser only)        | leaks                                       |
| breakage "The page stays usable…" (bound)            | clean (rendered in the browser only)        | leaks                                       |
