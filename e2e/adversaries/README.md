# Adversary suite

Cheap, realistic attacks on the built demo (`npm run build:pages`), run as part of the
Playwright suite. Each one records its cost as a test annotation (`attack cost`): the lines of
attack code between the `// attack:begin` and `// attack:end` markers, and the wall time.

| Spec                  | Attacker                                                     |
| --------------------- | ------------------------------------------------------------ |
| `plain-fetch.spec.ts` | (a) generic crawler: one GET, an HTML parser, no JavaScript  |
| `seed-regex.spec.ts`  | (b) veneer-aware crawler: regex the seed, rebuild the cipher |
| `font-hook.spec.ts`   | (c) headless browser: hook `FontFace`, invert the cmap       |
| `../leaks.spec.ts`    | side channels: served HTML parts and every loaded JS bundle  |

The protected texts come from the demo source (`e2e/support/demo-specimens.ts`), not from a
hard-coded sentence. Places where the demo itself prints a specimen in the clear are listed in
`e2e/support/known-leaks.ts`.

## Attack matrix

Measured on the prerendered demo, Chromium 151 and Firefox 153, 2026-10-11. Times include the
page fetch or load.

| Attacker                                                             | Needs                                                                                  | Cost                             | Result today                                                                                                                                                                                         | After Next #2                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| (a) Generic crawler: GET + HTML parser                               | An HTTP client and an HTML parser                                                      | 5 lines, under 1 s               | **Blocked** for every protected element. Gets only what the demo prints in the clear itself (a code sample, an `<input value>`)                                                                      | Blocked                                                                                    |
| (a') Crawler that also downloads the page's JS files as text         | The same, plus following `<script src>`                                                | A few more lines                 | **Succeeds** for all 9 demo specimens: each is a compile-time string in `main-*.js` (`leaks.spec.ts`)                                                                                                | Succeeds. Only text that arrives at runtime (an API, a CMS) stays out of the bundle        |
| (b) Veneer-aware crawler: regex the seed + public `buildScrambleMap` | HTTP, an HTML parser, `@pacyfist/veneer/core` from npm                                 | 15 lines, under 1 s              | **Succeeds**: decodes every server-rendered protected element. The seed is in the HTML twice: `veneerSeed` in ng-state, and `Veneer-<seed base 36>` in each protected element's inline `font-family` | Blocked, if both copies of the seed leave the HTML. `seed-regex.spec.ts` flips and says so |
| (c) Headless browser + `FontFace` hook + cmap inversion              | A headless browser, a font parser (opentype.js), the base font (the page downloads it) | 54 lines including glue, 1-1.5 s | **Succeeds**: every specimen on screen (7 of 9; the other 2 sit in inactive tabs), across all 3 forged fonts on the page                                                                             | Succeeds. This is the documented limit: once JS runs, the forged font is the key           |

Not automated, listed so the table is complete:

| Attacker                                                    | Cost                                                                                                                                                                                                             | Result                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Brute force of the 32-bit seed against ciphertext alone     | The public `buildScrambleMap` takes about 40 µs per seed in Node, so all 2^32 seeds take about 48 CPU-hours naively. A tuned search (derive only the letter class, stop at the first wrong word) is far cheaper. | Feasible for a targeted attacker after Next #2, as long as the cipher is derived from a 32-bit seed by a public function |
| Ciphertext-only cryptanalysis (classic substitution solver) | Off-the-shelf. veneer keeps spaces, word lengths and punctuation classes, which helps the solver                                                                                                                 | Feasible on long passages, with or without Next #2                                                                       |
| OCR or a vision model on a screenshot                       | A headless browser and an OCR or vision model                                                                                                                                                                    | Succeeds by design: the screen shows the real text                                                                       |

## Expected failures

`seed-regex.spec.ts` states the property we want, "a regex crawler cannot recover plaintext from
the served HTML", and marks it `test.fail()` because it does not hold yet. `test.fail()` passes
for any failure, including a broken test, so two `KNOWN LEAK` tests next to it prove per channel
that the attack really decodes the hero today. When Next #2 lands, the property test reports
"expected to fail, but passed" and the KNOWN LEAK tests fail: delete both KNOWN LEAK tests and
the `test.fail()` line in that change.

`leaks.spec.ts` marks the bundle check of each specimen `test.fail()`, since every demo specimen
is a compile-time string. A specimen that stops leaking shows up as "expected to fail, but
passed".

## Leak table

From `../leaks.spec.ts` on the prerendered demo. "Bundle" is `main-*.js`, the only script the page
loads. No specimen leaks through the title, meta and OG tags, JSON-LD (the demo has none),
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
