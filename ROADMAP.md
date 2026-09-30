# veneer roadmap

## Executive summary

**Where the project stands.** veneer (`@pacyfist/veneer` v0.0.2, AGPL-3.0) is small and well built. It is about 1,035 lines in `projects/pacyfist/veneer/src/lib`, the core is split cleanly from the Angular layer, it fails open when something breaks, the unit and e2e tests are real, and it is published to npm with provenance. The technique works. But it is hard for real teams to adopt, for four reasons:

1. **Some security claims are false today.**
   - `README.md:102` says veneer stops "Crawlers that don't run JavaScript".
   - The library README says the seed "costs nothing" (`projects/pacyfist/veneer/README.md:277`) and calls it "random per page load" (`:186`).
   - In fact the seed is written into the SSR HTML (`SEED_KEY`, `veneer-font.service.ts:27`, set at `:100-104`). `buildScrambleMap` is public, so a plain fetch plus a regex decodes every server-rendered page.
   - The demo is fully prerendered (`projects/demo/src/app/app.routes.server.ts`), so every visitor shares one seed fixed at build time.
2. **Common setups break without any error.**
   - Nested markup is destroyed, because the directive sets `textContent` (`veneer.directive.ts:95`).
   - A binding that changes to `''` keeps showing the old text (`:57`).
   - The README snippet uses a leading-slash font path, which fails under subpath deploys (`README.md:61`, lib README `:85`/`:172`, `sections/get-started.ts:18`).
   - Any glyph missing from the font switches protection off for the whole site (`font-forge.ts`, then `load()` catches the error).
   - Letters can map to `- / ? !`, so protected words wrap mid-word.
3. **It costs more than it needs to.**
   - opentype.js (about 67 KB gzip) is imported statically (`font-forge.ts:12`, reached through `veneer-font.service.ts:16`).
   - The forge rebuilds the font from glyph outlines (`font-forge.ts:48-87`). That drops kerning (GPOS), ligatures (GSUB) and hinting, and changes the vertical metrics.
4. **Some audiences are shut out entirely.** Non-Angular users, WOFF2-only sites, non-ASCII content, teams with accessibility obligations, and anyone whose legal team rejects AGPL §13.

**Core thesis.** Make veneer honest and dependable for the Angular adopters it already targets before widening its reach:

- **Now:** correct the claims, fix the traps in the first hour of use, and gate releases on real validation.
- **Next:** handle rich content, take the key out of the HTML, and fix rendering quality.
- **Later:** a framework-free runtime, a web component and build-time tooling. Only do this after the license decision, because under AGPL most non-Angular commercial users could not adopt it anyway.

---

## Now (next release, target v0.1.0 "honest and adoption-ready")

### 1. Correct the security claims and publish a threat model

- **Why:**
  - `README.md:98-104` lists "Crawlers that don't run JavaScript" and "Cheap bulk scraping for AI training sets" as stopped. Both fail on any SSR page, because the `veneerSeed` in `<script id="ng-state">` plus the public `buildScrambleMap` recovers the full key.
  - The code comment at `veneer-font.service.ts:19-26` and lib README `:277` say exposing the seed "costs nothing". That is only true for an attacker who already runs JS and fetches the font.
  - lib README `:186` says the seed is "random per page load". On prerendered sites (the demo) it is not.
  - Overclaiming loses trust as soon as someone publishes a bypass.
- **What:**
  - Rewrite the Stops / Doesn't-stop table so it is honest about SSR and SSG.
  - Add `THREAT_MODEL.md` with adversary tiers: generic crawler, veneer-aware crawler, headless browser with hooks, OCR or vision LLM, and a human targeting one site. Separate "one-time generic bypass" from "per-site effort", and say why veneer works best while few sites use it.
  - Add `SECURITY.md` with GitHub private vulnerability reporting. It should say what counts as a vulnerability (for example, SSR HTML leaking plaintext) and what is a documented limitation (OCR).
  - Fix the comment in `veneer-font.service.ts`.
- **Impact/effort:** High / S.
- **Dependencies:** None. Do not wait for the adversary suite (Next #9).

### 2. Decide the license (maintainer decision)

- **Why:** Both READMEs warn that AGPL §13 extends to the adopter's whole site (`README.md` FAQ, lib README "License"). The users the README names ("article bodies, product descriptions") are commercial operators, whose legal teams usually ban AGPL in front-end bundles. Whether the Later ecosystem work can turn into adoption depends on this. The root README calls AGPL "intentional", so this is the owner's call, not an engineering task.
- **What:** A written decision. Possible options:
  - (a) MPL-2.0 or LGPL for the libraries;
  - (b) AGPL plus a commercial license (`LICENSE-COMMERCIAL.md` with a contact);
  - (c) a permissive core with copyleft adapters.

  Then replace the FAQ answer with a "Can I use this on my commercial site?" table. In the same section, add a **font-license checklist**. Forging creates a renamed, modified derivative of the base font, which OFL fonts with a Reserved Font Name and most commercial EULAs forbid. Roboto (Apache-2.0) and OFL fonts without an RFN are fine.

- **Impact/effort:** High / S (engineering); the business decision is the real cost.
- **Dependencies:** None. It gates Later #1 to #3.

### 3. Fix the first-hour traps

- **Why:**
  - **Font path.** The README and Get Started snippets use `font: '/fonts/Roboto-Regular.ttf'`. A leading slash ignores `<base href>`, so under a subpath deploy the font returns 404 and the site falls back to unprotected text. `fetch()` already resolves relative paths against the document base URL. So the demo comment claiming the string form "breaks under the /veneer/ base href" (`projects/demo/src/app/app.config.ts:21-24`) is wrong, and the demo's workaround (`font-source.ts`) is unnecessary.
  - **Error message.** The fetch error omits the URL (`veneer-font.service.ts:33-36`).
  - **Repeat downloads.** Every `provideVeneer` instance downloads the font again.
  - **Empty binding.** `if (bound) this.original = bound` (`veneer.directive.ts:57`) keeps stale text when the binding becomes `''`.
  - **Silent misuse.** Interpolation inside `veneer`, the pipe without `veneerFont`, and a missing `provideVeneer()` fail silently or with a bare `NullInjectorError`: the service is `@Injectable()` with no `providedIn`, and `provideVeneer()` in `veneer.config.ts` is the only place it is provided.
- **What:**
  - Change every snippet to the relative form `'fonts/Roboto-Regular.ttf'`, add one sentence about subpath deploys, and fix the demo comment.
  - Put the resolved URL and a hint in the fetch error.
  - Add a module-level cache of in-flight and completed fetches keyed by URL, dropping failed fetches.
  - Track whether the input was ever bound (`input<string | undefined>(undefined)`).
  - Add `ngDevMode`-guarded warnings with stable codes and README anchors:
    - VNR001: `veneer` host has child nodes or bindings; use the pipe.
    - VNR002: pipe used with no `veneerFont` ancestor.
    - VNR003: `provideVeneer()` missing. Inject the service with `{ optional: true }` and throw a clear error.
- **Impact/effort:** High / S-M.
- **Dependencies:** None.

### 4. Make fail-open visible in production

- **Why:** Protection switches off silently when a glyph is missing, a browser has a quirk, or CSP blocks `FontFace`. The only signal is `console.error` (`veneer-font.service.ts:141-147`), and `failed` is a bare string even though `VeneerFontError` already carries `missing`.
- **What:**
  - Change `failed` to a structured `{ code, message, missing? }`.
  - Add an `onStatus`/`onFail` callback in config so teams can alert through RUM or Sentry.
  - Optionally set a `data-veneer-status` attribute on `<html>`.
- **Impact/effort:** High / S.
- **Dependencies:** Pairs with #3.

### 5. Lazy-load opentype.js and set a size budget

- **Why:** The static import (`font-forge.ts:12`) through `veneer-font.service.ts:16` puts about 245 KB min / 67 KB gzip into every app's initial bundle, even with `disabled: true` or on routes with no protected text. Adopters also get a CommonJS build warning, which the demo suppresses with `allowedCommonJsDependencies` (`angular.json:54`) and which the README never mentions.
- **What:**
  - Load `await import('./font-forge')` inside `load()`.
  - Memoize the parsed base font per source at module scope.
  - Add a size-limit check in CI on the library FESM bundle.
  - Document the CommonJS warning in Requirements.
- **Impact/effort:** High / S.
- **Dependencies:** Shares the cache with #3.

### 6. Make the default cipher safe for layout

- **Why:**
  - `DEFAULT_CHARSET` (U+0021-U+007E, `scramble-map.ts:15-17`) is shuffled as one pool, so letters can map to `-`, `/`, `?`, `!`. Those create UAX #14 break opportunities, and protected text wraps mid-word.
  - CSS `text-transform` and `small-caps` act on the scrambled codepoints, so they paint the wrong glyphs.
  - Neither issue is in the README trade-offs.
- **What:**
  - In `buildScrambleMap`, derange within classes only: letters to letters, digits to digits, break-neutral punctuation among itself.
  - Keep break-significant characters (`- / ? !`) as identity by default, the same way the space already is.
  - Add a dev-mode warning when a protected host has a computed `text-transform` other than `none`, or uses small-caps.
  - Add an e2e check comparing line boxes (`getClientRects`) with and without protection.
  - Record in the changelog that ciphertext for a fixed seed changes, which is acceptable at 0.0.x.
  - Defer the "case-aware" mode.
- **Impact/effort:** High / S-M.
- **Dependencies:** None.

### 7. Stop shipping invisible text to no-JS readers

- **Why:** On the server `ready()` never becomes true, so `hidden()` is true and both directives write inline `visibility:hidden` into the SSR HTML (`veneer.directive.ts:101-105`, `veneer-font.directive.ts:38-42`). No-JS readers, reader mode, archives and "cached page" views see blank space.
- **What:**
  - Hide through a class (or a `<style>` rule) that a tiny inline script removes, with a `<noscript>` override.
  - Add `translate="no"` and the `notranslate` class to protected elements.
  - Document how reader mode, translation, print and archives behave.
- **Impact/effort:** Medium / S.
- **Dependencies:** None.

### 8. Stop one missing glyph from disabling the whole site

- **Why:** `forgeScrambledFont` throws on any missing glyph (`font-forge.ts:73-79`), and `load()` then fails open for every page. A font without `~` or `|` leaves the site unprotected in production.
- **What:**
  - Add `strictCoverage: false`: drop uncovered codepoints from the map, so they pass through and render in the fallback font, and warn once in dev mode.
  - Keep `true` as an explicit opt-in.
  - Export `charsetFromFont(bytes, candidate)` as a build-time helper that prints a charset literal. `'auto'` cannot work at runtime, because the server builds the map synchronously without the font.
- **Impact/effort:** High / S.
- **Dependencies:** #4 for reporting.

### 9. Gate releases on the full validation, and test beyond Chromium

- **Why:**
  - **Publishing.** `publish.yml` runs only `npm test`, then rebuilds. There is no Angular 20/21/22 matrix, no Playwright run, and no link to the `ci.yml` validate workflow. Node is 22 there and 24 in `ci.yml`, and `npm install -g npm@latest` is unpinned.
  - **Browsers.** `playwright.config.ts:31` runs only Chromium, but lib README `:59` promises "Anything with the CSS Font Loading API". Because the library fails open, a Safari failure would silently expose plaintext to a large share of visitors.
- **What:**
  - Make `ci.yml` reusable (`workflow_call`) and call it through `needs:` in `publish.yml`, publishing the exact artifact the matrix validated.
  - Pin Node (`.nvmrc`) and the npm version.
  - Add `firefox` and `webkit` Playwright projects for the hydrate/forge test and the pixel-diff test.
  - Add an assertion that no `[veneer] disabled` console error appears.
  - Publish the resulting browser support table.
- **Impact/effort:** High / S-M.
- **Dependencies:** None.

### 10. Changelog, versioning policy and a review of the public API surface

- **Why:**
  - There is no CHANGELOG, and the only tag is v0.0.2.
  - The workspace `package.json` says 0.0.0 while the library's says 0.0.2.
  - `VENEER_CONFIG` and `ResolvedVeneerConfig` are exported from `public-api.ts`, which freezes internals by accident.
  - Under 0.0.x, every release is breaking for caret ranges.
- **What:**
  - Adopt release-please scoped to `projects/pacyfist/veneer`. It fits the existing Conventional Commits and triggers the existing `publish.yml`.
  - Backfill entries for 0.0.1 and 0.0.2.
  - Write a Stability & Support section covering 0.x semantics, the Angular-major support window (matching the `ci.yml` matrix) and a deprecation policy.
  - Before 0.1, mark internals `@internal` and move to `provideVeneer(config, ...features)` so later options stay additive.
  - Check in an API-report snapshot (API Extractor) that fails CI when it drifts.
- **Impact/effort:** Medium / S.
- **Dependencies:** None.

### 11. Document the side channels that leak plaintext

- **Why:** The library rewrites only text content. `provideClientHydration` (used in `projects/demo/src/app/app.config.ts:19`) turns on the HttpClient transfer cache by default, which serializes raw API responses, including plaintext bodies, into ng-state. Title, meta/OG, JSON-LD `articleBody`, and `alt`/`aria-label` leak the same way. The only leak check is a single sentence in `e2e/demo.spec.ts`.
- **What:**
  - A README section "Where plaintext still leaks", including the `withHttpTransferCacheOptions({ filter })` recipe and guidance to keep meta and JSON-LD to summaries.
  - A `findVeneerLeaks(html, originals)` helper, used in `e2e/demo.spec.ts` for every specimen.
- **Impact/effort:** High / S-M.
- **Dependencies:** None.

---

## Next (1-3 months)

### 1. Protect rich content by walking text nodes

- **Why:** `veneer.directive.ts:95` replaces `textContent`, so `<a>`, `<strong>`, `<em>` and footnotes inside a protected element are destroyed. Article bodies, CMS HTML, markdown output and `[innerHTML]` content cannot be protected, even though these are the README's "Good use" cases. The limitation is not documented.
- **What:**
  - Change the default to a TreeWalker over descendant text nodes. Skip `script`, `style`, `code` and `[veneer-skip]`.
  - Keep originals in a `WeakMap<Text, string>` so fail-open can restore them.
  - Make the SSR marker (`data-veneer-ssr`) cover the whole subtree.
  - Add a `veneerHtml` input that takes sanitized HTML.
  - Leave MutationObserver mode for later.
- **Impact/effort:** High / M.
- **Dependencies:** Now #3 (bound-tracking fix).

### 2. Take the key out of the HTML

- **Why:**
  - This is the most important efficacy gap: any regex crawler that knows veneer can decode every SSR page using the ng-state seed.
  - The client needs the map for any text it scrambles itself, so the realistic bar is "the attacker must fetch and parse a font or run JS", which is what the README already claims.
- **What:**
  - Stop writing a seed into TransferState. The server (dynamic SSR) or the build (SSG) forges the font with the existing framework-free `font-forge.ts` and emits it as a short-lived or hashed URL referenced from the page.
  - The client fetches that font and derives the map from its cmap: a small cmap parser, or lazy opentype.js.
  - Add namespaced state for multiple instances (see #6).
  - Add an e2e assertion that the SSR HTML contains no seed and that the seed-regex attack fails.
  - Document that SSG still means one cipher per build (see Open questions).
  - Widening the seed or adding HMAC on its own does not fix the leak and is not a separate item.
- **Impact/effort:** High / M-L.
- **Dependencies:** Now #1 (docs); benefits from #4.

### 3. Rewrite the forge so it only replaces the cmap

- **Why:** `font-forge.ts:48-87` rebuilds a CFF font from outlines, and the result is visibly worse:
  - GPOS kerning is lost (AV = -87 in Roboto), as are GSUB ligatures (liga, ccmp, locl, tnum) and TrueType hinting. `e2e/demo.spec.ts` has to tolerate pixel differences because of the lost hinting.
  - Variation tables are dropped.
  - The OS/2 metrics change: usWinAscent goes from 1946 to 1692, sTypoLineGap from 102 to 0, and usWeightClass from 400 to 500. Forged and fallback glyphs therefore sit in different line boxes.
  - `styleName` is hard-coded to `'Regular'` (`:81`).
- **What:**
  - A dependency-free sfnt writer (about 200-300 LOC) that copies every table byte for byte, rewrites the cmap (format 4 + 12), renames the family in `name`, recomputes checksums, and **strips `post` glyph names (format 3)**.
  - State openly that once JS runs, the forged font is the key. That is already true today, and base glyph IDs make it more obvious.
  - Tests comparing glyph IDs, GPOS values and OS/2 metrics between the base and forged fonts, and checking that the output passes OTS in Chromium, Firefox and WebKit.
  - Keep opentype.js only as an optional fallback.
- **Impact/effort:** High / M.
- **Dependencies:** Now #9 (browser matrix for OTS).

### 4. WOFF/WOFF2 input

- **Why:** `parseBaseFont` rejects WOFF and WOFF2 (`font-forge.ts:26-35`), so adopters must find, license and host a second `.ttf` copy of a font they already serve.
- **What:**
  - Native WOFF1 decoding with `DecompressionStream('deflate')`.
  - WOFF2 through an optional lazily imported decoder (for example wawoff2) behind the existing `font: () => Promise<ArrayBuffer>` loader, or converted at build or server time.
  - A docs recipe for getting static TTFs from Google Fonts, rather than a css2 resolver.
- **Impact/effort:** Medium / S-M.
- **Dependencies:** Now #8.

### 5. Accessibility: readable mode and an honest WCAG position

- **Why:** The directives set no ARIA attributes, and the demo patches this by hand (`projects/demo/src/app/ui/specimen-card.ts`, `try-it.ts`, `mirror-panel.ts`). For EU and public-sector adopters, screen readers announcing gibberish blocks adoption.
- **What:**
  - An opt-in `a11y: 'hide'` mode that sets `aria-hidden` only while `active()`, taken from `specimen-card.ts`.
  - A "readable mode" signal on the service plus a ready-made toggle component that switches scrambling off for the session and remembers the choice.
  - An opt-in "copy readable text" handler that decodes on a user gesture.
  - In both READMEs, say plainly that `aria-hidden` hides content from assistive tech rather than making it accessible, name the WCAG criteria affected, and present the toggle as the route to conformance.
  - Add axe-core checks to Playwright.
- **Impact/effort:** High / M.
- **Dependencies:** #1.

### 6. Font families and independent instances

- **Why:** Only one face exists. The `FontFace` has no descriptors (`veneer-font.service.ts:128`), so bold and italic protected text is synthesized by the browser. Instances with implicit seeds all write the single `'veneerSeed'` key, and the last writer wins. The demo avoids this by building instances client-only (`ui/isolated-instance.ts`).
- **What:**
  - `faces: [{ src, weight, style, stretch }]`, forged under one family name with one seed and matching descriptors.
  - An optional `id` that namespaces transferred state.
- **Impact/effort:** Medium / M.
- **Dependencies:** #3 (so metrics are preserved per face); #2 (state key).

### 7. Latin-1 and Latin Extended-A presets, plus NFC normalization

- **Why:** `DEFAULT_CHARSET` is ASCII, so é, ü, ß and ł pass through in the clear and render in the fallback font, mixing two fonts on one line. Decomposed input (e + U+0301) is not normalized.
- **What:**
  - Export `LATIN_1` and `LATIN_EXT_A` presets (Cyrillic and Greek next), using the class-preserving derangement from Now #6.
  - Add a `charsetFromText()` helper.
  - NFC-normalize input in `scrambleText` (on by default).
- **Impact/effort:** Medium / S-M.
- **Dependencies:** Now #6, Now #8.

### 8. A framework-free `@pacyfist/veneer/core` entry point, plus a testing entry point

- **Why:**
  - `ng-package.json` has one entry file, so the core reached through `public-api.ts` pulls in `@angular/core`, even for the README's own "Using the cipher outside Angular" Node example.
  - Consumer tests under jsdom hit the real service. jsdom has no `FontFace`, so every test takes the fail-open path and logs errors.
  - The library's own spec hand-rolls a `fakeService` and points to a `scripts/verify-in-browser.mjs` that does not exist (`veneer.directive.spec.ts:13-15`; `scripts/` holds only `use-angular.mjs`).
- **What:**
  - Secondary entry points built with ng-packagr:
    - `@pacyfist/veneer/core` (scramble-map and forge, no Angular imports), re-exported from the main entry;
    - `@pacyfist/veneer/testing`, with `provideVeneerTesting({ seed?, state? })` typed against an exported `VeneerFontState` interface, and `decodeVeneer(el | string)`.
  - Move the library's own specs to the testing entry point and remove the stale reference.
- **Impact/effort:** Medium / S.
- **Dependencies:** None.

### 9. A minimal adversary suite as a regression guard

- **Why:** Efficacy is asserted in prose. The glyph-order and seed leaks show that untested assumptions can quietly erase the protection.
- **What:** `e2e/adversaries/` with three checks:
  - (a) fetch the HTML, parse it, and assert no plaintext;
  - (b) regex out the seed and call `buildScrambleMap`; this fails today and should pass after Next #2;
  - (c) hook `FontFace` and invert the cmap, so the table reports what this costs an attacker.

  Publish the resulting attack matrix in THREAT_MODEL.md.

- **Impact/effort:** Medium / S-M.
- **Dependencies:** Now #1; guards #2.

### 10. Packed-tarball consumer smoke test and a minimal example app

- **Why:** The e2e suite consumes the library from `dist/` through workspace paths and suppresses the opentype.js CommonJS warning (`angular.json:54`). Nothing checks `exports`, the peer ranges (`^20 || ^21 || ^22`, opentype.js `^2`), or a clean install with strict peer dependencies.
- **What:**
  - An `examples/basic-ssr` fixture that CI builds per Angular major against the output of `npm pack` (CSR and SSR builds, one Playwright assertion).
  - `publint` and `@arethetypeswrong/cli` runs against the tarball.
  - A zoneless and a no-hydration CSR variant. The demo already runs zoneless (`app.config.ts:17`), but a CSR-only app is untested.
  - Share this fixture with the docs example (#11).
- **Impact/effort:** High / M.
- **Dependencies:** Now #9.

### 11. Consolidate the docs into one source of truth, with recipes

- **Why:** The READMEs contradict each other: interpolation "renders empty" (`README.md:92`) versus "gibberish after hydration" (lib README `:351`), and the `aria-hidden` advice appears only in the root README. There are no recipes for lazy routes, `@defer`, rich text, CSP or Core Web Vitals, and the demo snippets are hard-coded (`sections/get-started.ts`).
- **What:**
  - Keep the root README short, with an **"Is veneer right for me?"** box covering license, SEO, a11y, browser support, the SSG shared cipher and bundle cost.
  - Make the library README, mirrored on the demo site, the single reference.
  - Recipes:
    - lazy routes and multiple configs;
    - `@defer`;
    - rich text;
    - CSP: `font-src` for `FontFace` from an ArrayBuffer, and `data:` or nonce needs once server forging lands;
    - CLS: measure it, and use `size-adjust`/`ascent-override` on the fallback;
    - `disabled` per environment.
  - A short "Where veneer fits" section next to robots.txt, AI-preference signals and edge bot management, with no dated vendor-policy claims.
  - Add npm keywords.
  - Generate the demo snippets from the example app's compiled constants.
- **Impact/effort:** Medium / M.
- **Dependencies:** #10.

### 12. SEO guidance and a per-request `shouldProtect` hook

- **Why:** The README only says to leave alone anything you want to rank (`README.md:112-116`), and `disabled` is global. For the target audience, losing search traffic is often a veto, and a home-grown bypass keyed on the user-agent risks a cloaking penalty.
- **What:**
  - A server-evaluated `shouldProtect` hook, stating clearly that it applies to dynamic SSR only and not to prerendered pages.
  - A helper that verifies search crawlers by reverse and forward DNS.
  - Guidance, marked "verify with your SEO team", on paywalled-content structured data (`isAccessibleForFree` plus `cssSelector`).
  - A note that bypassing for a crawler also exposes the text to that operator's AI training.
- **Impact/effort:** Medium / M.
- **Dependencies:** Now #3.

### 13. Maintenance automation and filling test gaps

- **What:**
  - `dependabot.yml` for npm and github-actions, with `@angular/*` grouped.
  - A weekly scheduled validate run to catch Angular or Playwright drift (`scripts/use-angular.mjs` resolves `^22.0.0` at install time).
  - Specs for `veneer.pipe.ts`, `veneer-font.directive.ts`, `provideVeneer` defaults and the `resolveFontSource` branches.
  - A pure-Vitest run of the core specs on Angular 20, which `ci.yml` currently skips with `if: matrix.angular >= 21`.
  - `prettier --check`.
  - A bug-report issue form that asks for Angular version, browser, font format and SSR on/off.
- **Impact/effort:** Low-Medium / S.

---

## Later (3-6+ months)

### 1. A vanilla runtime extracted from the Angular service

- **Why:** The logic that fetches, forges, registers `FontFace`, hides until ready and fails open lives in the Angular-only `veneer-font.service.ts`. Non-Angular users get a cipher with nothing to decode it in the browser.
- **What:**
  - A `createVeneer({ font, charset, seed, ... })` runtime in `/core` that returns `{ ready, familyName, scramble, protect(el), reveal, dispose }`.
  - The Angular package becomes a thin adapter over it.
  - Split into a separate npm package only if non-Angular demand shows up.
- **Impact/effort:** High / M.
- **Dependencies:** Next #8; Now #2 (license).

### 2. A `<veneer-text>` web component

- **Why:** The README FAQ says "Is this only for Angular? Yes". A custom element reaches CMS, static and plain-HTML sites with one artifact.
- **What:**
  - A custom element plus a CDN loader.
  - A shared conformance test ported from `e2e/demo.spec.ts`.
  - React, Vue and Svelte adapters only on concrete demand, one at a time.
- **Impact/effort:** Medium-High / M.
- **Dependencies:** Later #1, Now #2.

### 3. Build-time pre-scrambling CLI

- **Why:** `projects/demo/src/app/sections/beyond-angular.ts` implies build-time pre-scrambling, but nothing ships it, and pre-scrambled HTML has no matching font.
- **What:**
  - `npx veneer scramble --font x.ttf --in 'dist/**/*.html' --selector '[data-veneer]'`. It rewrites the marked text, emits a hashed forged font and an `@font-face` rule, and needs no runtime JS.
  - Optionally rotate the seed per page.
  - Document the weaker security of one cipher per build.
  - Vite, Astro and Eleventy plugins after the CLI proves itself.
- **Impact/effort:** Medium / M-L.
- **Dependencies:** Next #3, Next #8.

### 4. Server forging with no client forge

- **Why:** Once Next #2 and Next #3 land, the server can inline the forged font (`@font-face` with a data URL or a per-render URL). The client would need only `document.fonts` and a small cmap parser: no opentype.js, and visible text from the first paint.
- **What:** `provideVeneer({ forge: 'server' })` plus `provideVeneerServer()`, and an Express or edge middleware example that re-seeds prerendered HTML per request.
- **Impact/effort:** Medium-High / L.
- **Dependencies:** Next #2, Next #3.

### 5. Opt-in homophonic cipher (research)

- **Why:** A 1:1 substitution keeps word lengths and letter frequencies, and standard solvers or LLMs can break it from a few hundred characters. This only matters once the cheaper leaks (Next #2) are closed.
- **What:**
  - `cipher: 'homophonic'`: several codepoints per character, with flattened frequencies.
  - Measure the effect on font size and line breaking before committing to space variants.
  - A solver benchmark in `scripts/`.
- **Impact/effort:** Low-Medium / L.
- **Dependencies:** Next #2, Next #3, Next #9.

### 6. CJK and complex scripts (research)

- **What:**
  - Per-page subset forging for CJK.
  - Partitioning by script, bidi class and joining type for RTL and Indic scripts, which requires the GSUB preserved by Next #3.
  - Evaluate mapping to Private Use Area codepoints.
- **Impact/effort:** Medium / L.
- **Dependencies:** Next #3, Next #7.

### 7. `ng add` schematic (conditional)

- **Why:** Setup is already about four steps. Once Now #3, Now #8 and Next #4 land, little friction remains.
- **What:**
  - Add opentype.js, insert `provideVeneer`, and optionally copy the bundled OFL/Apache font.
  - Run the coverage check from `charsetFromFont`.
  - Only if adoption data shows setup is a barrier.
- **Impact/effort:** Low-Medium / M.

---

## Explicitly not doing

- **Standalone glyph-order shuffle (e-shuffle-glyph-order):** The leak is real: glyph index k maps to charset[k-1] (`font-forge.ts:53`). But the forged font lives only in browser memory. An attacker who can capture it can also match outlines against the publicly fetched base font, and the cmap rewrite (Next #3) keeps base glyph IDs anyway. Covered instead by honest documentation and by stripping `post` names.
- **WordPress plugin and CMS integrations:** They depend on two unbuilt items and would be a separate PHP product to maintain. Revisit once the web component has users.
- **README health badges and a time-to-ready perf gate:** Badges don't change decisions and a perf gate would be flaky. The bundle budget is covered by Now #5.
- **Worker-thread forging:** About 34 ms of forging doesn't justify the complexity, and the lazy import plus the Later server forge address the cost.
- **Dev overlay, `window.veneer` console API, "bot vision" shortcut:** Low value for the cost. The structured status (Now #4) covers the real need.
- **`veneerAttr` directive and runtime document leak scanning:** Deferred. Documentation plus `findVeneerLeaks` in tests cover the practical cases.
- **A plaintext `aria-label` accessibility strategy:** It hands the plaintext to every DOM scraper and defeats the purpose.
- **Google Fonts css2 URL resolver:** It is fragile because the responses depend on the user-agent. A docs recipe is enough.
- **Wider seed or HMAC shuffle on its own:** It doesn't help while the seed is in the HTML, and is moot after Next #2.
- **React, Vue and Svelte adapters and a Nuxt module up front:** Each is ongoing maintenance for a solo maintainer. Build them only on demand.
- **Six-bot adversary suite (OCR, frequency solver):** Overbuilt for now. Three checks are enough (Next #9).
- **MutationObserver auto-rescramble:** Not in the first cut of the text-node walker.
- **SHA-pinned actions, OpenSSF Scorecard, protected publish environment, CODEOWNERS, Code of Conduct, ESLint, coverage floors:** Hygiene with negligible effect on adopters of a single-maintainer project with provenance already in place.
- **Separate `@pacyfist/veneer-core` npm package now:** The secondary entry point delivers the same value until non-Angular demand appears.

---

## Open questions for the maintainer

1. **License:** keep AGPL-3.0-only, switch to MPL or LGPL, or sell a commercial license? This decides whether Later #1-#3 are worth building.
2. **SSG vs per-visitor cipher:** On prerendered hosts such as GitHub Pages, do you want:
   - (a) one cipher per build with no seed in the HTML (Next #2);
   - (b) a client-side re-seed after hydration, which gives each visitor a unique cipher but requires the client-side forge and keeps opentype.js; or
   - (c) both, as a config choice?
3. **Default charset change:** Now #6 changes the ciphertext for pinned seeds. Is it acceptable to ship this as breaking at 0.0.x → 0.1.0?
4. **Accessibility default:** should `a11y: 'hide'` plus the readable-mode toggle be on by default, or opt-in?
5. **If WebKit or Firefox fail in e2e:** fix, narrow the documented support, or refuse to activate (and fail open) on those engines?
6. **Angular support window:** how many majors after Angular's own LTS will you carry in the `ci.yml` matrix?
7. **Demand signal:** who uses veneer today (npm downloads, issues, a short adopter survey)? This should decide the order of the Later work.
8. **`docs/superpowers/`:** keep it public, move it under an internal path, or remove it?

---

## Appendix: how this roadmap was produced

- **Five analyst lenses** each read the repository independently and produced an assessment plus proposals:
  - **architecture:** layering, forge quality, bundle cost, SSR;
  - **efficacy:** attacker cost, key leaks, side channels, collateral damage;
  - **DX:** first-hour failures, testing, versioning;
  - **ecosystem:** reach beyond Angular, licensing, prior art;
  - **quality:** tests, CI, release gating, project health.

  Together they submitted 47 proposals.

- **Two critics** reviewed every proposal. A **skeptic** checked each premise against the code and challenged effort and impact. A **user advocate** re-ranked items by what an adopting team would actually feel. Each marked items keep, modify, merge or cut and listed items the analysts had missed.
- **The synthesizer** (this document):
  - applied the agreed merges;
  - would have dropped any item both critics cut, but none were;
  - settled the disputed items by re-reading the code. For example:
    - the base-href claim was wrong: `fetch` honours the document base URL, and the real bug is the leading slash;
    - the glyph-order leak is real but gives little security value;
    - the seed exposure is confirmed at `veneer-font.service.ts:27` and `:100-104`;
    - the README claims were checked at `README.md:102` and lib README `:186`, `:277`;
    - Chromium-only e2e was confirmed at `playwright.config.ts:31`;
  - added the critics' verified "missing" items: README corrections as a standalone first step, fail-open observability, the font-license checklist, CSP and CLS recipes, the "Is veneer right for me?" guide, the CommonJS warning note, zoneless and CSR-only coverage, and license-first sequencing.
