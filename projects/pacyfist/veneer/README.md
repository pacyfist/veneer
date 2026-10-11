# @pacyfist/veneer

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Angular](https://img.shields.io/badge/angular-20%20%7C%2021%20%7C%2022-dd0031.svg)](https://angular.dev)
[![SSR](https://img.shields.io/badge/SSR-supported-brightgreen.svg)](#server-side-rendering)

Angular directives that keep text readable for people while scrapers, scripts
and copy-paste get gibberish.

Text is stored in the DOM as a substitution cipher. A font generated in the
browser at page load maps the scrambled codepoints back to the correct glyph
outlines. A reader sees the original words; anything reading `textContent` gets
noise.

```html
<p veneer>The quick brown fox jumps over the lazy dog.</p>
```

```
on screen:  The quick brown fox jumps over the lazy dog.
innerText:  Qi& sgY.a Rj4vE @4' Pg8So 4c&j Gi& [xN? 74O_
```

**Live demo:** https://pacyfist.github.io/veneer/

> [!IMPORTANT]
> This raises the cost of scraping. It does not make content secret, and it is
> not access control. Read [What this defends against](#what-this-defends-against)
> and [Trade-offs](#trade-offs) before adopting it.

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Server-side rendering](#server-side-rendering)
- [Search engines and `shouldProtect`](#search-engines-and-shouldprotect)
- [What this defends against](#what-this-defends-against)
- [Accessibility](#accessibility)
- [Trade-offs](#trade-offs)
- [Failure behaviour](#failure-behaviour)
- [WOFF2 and Google Fonts](#woff2-and-google-fonts)
- [Using the cipher outside Angular](#using-the-cipher-outside-angular)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Requirements

| Requirement | Version / notes                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Angular     | 20, 21 or 22 (`@angular/core`, `@angular/common`)                                                                                        |
| Base font   | A **`.ttf`, `.otf` or `.woff`** file you are licensed to embed. WOFF2 needs a decoder you choose, see below                              |
| Browser     | Anything with the [CSS Font Loading API](https://developer.mozilla.org/docs/Web/API/CSS_Font_Loading_API) (`FontFace`, `document.fonts`) |

veneer has no runtime dependency besides Angular. It reads TrueType, CFF
OpenType and WOFF 1.0 itself (WOFF through the browser's `DecompressionStream`).
It does not decode **WOFF2**, which would put a Brotli decoder in every bundle;
see [WOFF2 and Google Fonts](#woff2-and-google-fonts).

Use the same typeface your body text already uses. The forged font replaces it
wherever `veneer` is applied, so a mismatch is immediately visible.

## Installation

```bash
npm install @pacyfist/veneer
```

## Quick start

**1. Register the library** in your `ApplicationConfig`:

```ts
import { ApplicationConfig } from '@angular/core';
import { provideVeneer } from '@pacyfist/veneer';

export const appConfig: ApplicationConfig = {
  providers: [
    provideVeneer({
      font: 'fonts/Roboto-Regular.ttf',
      fallbackFontFamily: "'Roboto', sans-serif",
    }),
  ],
};
```

Keep the font path relative (no leading slash): it resolves against `<base href>`, so it keeps working when the app is deployed under a subpath such as `/my-app/`.

**2. Import the pieces** you need into a component and protect some text:

```ts
import { Component, input } from '@angular/core';
import { VeneerDirective, VeneerFontDirective, VeneerPipe } from '@pacyfist/veneer';

@Component({
  selector: 'app-article',
  imports: [VeneerDirective, VeneerFontDirective, VeneerPipe],
  template: `
    <h1 veneerFont>{{ title() | veneer }}</h1>
    <p veneer>Text a scraper should not be able to read.</p>
  `,
})
export class Article {
  readonly title = input.required<string>();
}
```

That is the whole setup. No stylesheet to import - the directives set
`font-family` on the element through `Renderer2`.

## Usage

### Static text - `[veneer]` directive

The directive scrambles every text node inside the element and points the
element at the forged font. Markup inside stays as it is: links, emphasis and
footnotes keep working, and only their text is scrambled.

```html
<p veneer>Text a scraper should <a href="/why">not</a> be able to <em>read</em>.</p>
```

Each text node is rewritten in place, so the nodes Angular created (or claimed
during hydration) keep working. These stay readable: text inside `script`,
`style`, `code`, `textarea` and `noscript`, and anything you mark with
`veneer-skip` (drawn in `fallbackFontFamily`, since it is not scrambled). A
nested `veneer` or `veneerFont` element protects its own text. `pre` is
protected: code inside `<pre><code>` is skipped through `code`, and a bare
`pre` is usually prose.

```html
<article veneer>
  <p>Protected, <strong>all</strong> of it.</p>
  <p>Install with <code>npm i some-package</code>, by <span veneer-skip>Ada Lovelace</span>.</p>
</article>
```

The walk happens when the element renders and whenever protection changes
(font ready, fail-open, readable mode). Text added or changed inside the
element later is not watched: bind it instead (below).

### Text you hand it directly

Bind a string and the directive renders it as the element's only content. A
binding that changes to `''` (or `undefined`) clears the text:

```html
<p [veneer]="article().title"></p>
```

### HTML from a CMS - `[veneerHtml]`

Bind HTML and the directive renders it sanitized, the way Angular sanitizes
`[innerHTML]` (scripts, event handlers and unsafe URLs are stripped), then
protects its text nodes. A `SafeHtml` from `DomSanitizer.bypassSecurityTrustHtml()`
is rendered as is.

```html
<div [veneerHtml]="article().bodyHtml"></div>
```

### Interpolated text - `veneer` pipe + `veneerFont`

When Angular interpolates the text, scramble with the pipe and supply the font
with `veneerFont`:

```html
<h1 veneerFont>{{ title() | veneer }}</h1>
```

> [!WARNING]
> Do not interpolate inside a `veneer` element (`<p veneer>{{ title() }}</p>`).
> The directive scrambles first and the interpolation then writes readable text
> over it, in the forged font. Interpolation → pipe; everything else →
> directive. Development builds warn ([VNR001](#vnr001)).

`veneerFont` on its own only applies the font, without touching text - use it on
any element that renders already-scrambled content.

### Runtime state

```ts
import { inject } from '@angular/core';
import { VeneerFontService } from '@pacyfist/veneer';

const veneer = inject(VeneerFontService);

veneer.status(); // signal: 'loading' | 'active' | 'failed' | 'disabled'
veneer.ready(); // signal<boolean>       - forged font registered
veneer.failed(); // signal<VeneerFailure | null> - { code, message, missing? }, or null
veneer.active(); // computed<boolean>     - protection actually in force
veneer.hidden(); // computed<boolean>     - text held back to avoid a flash
veneer.readable.set(true); // readable mode: scrambling off for the page, remembered
veneer.revealed.set(true); // withhold the font - show the raw scrambled characters
```

To hear about failures in production (RUM, Sentry), add a status listener. To
style or monitor by attribute, mirror the status on `<html data-veneer-status>`:

```ts
import { provideVeneer, withStatusAttribute, withStatusListener } from '@pacyfist/veneer';

provideVeneer(
  { font: 'fonts/Roboto-Regular.ttf' },
  withStatusListener(({ status, failure }) => {
    if (status === 'failed') reportToMonitoring(failure!.code, failure!.message);
  }),
  withStatusAttribute(), // one instance only; written during SSR too
);
```

Listeners run in the browser only. Failure codes are listed under
[Error codes](#error-codes).

`revealed` is a demo and debugging switch: flipping it on renders exactly what a
scraper receives, which is a convincing way to show the mechanism working.

## Configuration

```ts
provideVeneer({
  font: 'fonts/Roboto-Regular.ttf',
  fallbackFontFamily: "'Roboto', sans-serif",
  charset: undefined,
  seed: undefined,
  hideUntilReady: true,
  hideWith: 'stylesheet',
  disabled: false,
  strictCoverage: false,
  id: undefined,
});
```

| Option               | Type                                                  | Default                   | Purpose                                                                                           |
| -------------------- | ----------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `font`               | `string \| ArrayBuffer \| () => Promise<ArrayBuffer>` | _required_                | Base font supplying the glyph outlines                                                            |
| `fallbackFontFamily` | `string`                                              | `'sans-serif'`            | Used until the font is ready, when off, and for missing glyphs                                    |
| `charset`            | `readonly number[]`                                   | `DEFAULT_CHARSET` (ASCII) | Codepoints the cipher covers                                                                      |
| `seed`               | `number`                                              | none (CSPRNG, no seed)    | Pins the cipher. Tests and reproducible builds only; solvable                                     |
| `hideUntilReady`     | `boolean`                                             | `true`                    | Keep protected text invisible until the font lands                                                |
| `hideWith`           | `'stylesheet' \| 'hidden'`                            | `'stylesheet'`            | How server-rendered text is hidden; `'hidden'` needs no inline code under a CSP                   |
| `disabled`           | `boolean`                                             | `false`                   | Turn everything off, per environment                                                              |
| `strictCoverage`     | `boolean`                                             | `false`                   | Fail open on any glyph the font lacks, instead of leaving those characters unscrambled            |
| `id`                 | `string`                                              | none                      | Namespaces the forged-font state carried from server to client, for several instances on one page |

**`charset`** defaults to `DEFAULT_CHARSET`: the 84 printable ASCII characters
the cipher can swap without moving a line break. The browser wraps lines based on
the codepoints in the DOM, not on the glyphs it draws, so the cipher only swaps
characters it treats the same: letters with letters, digits with digits, and
punctuation within groups measured to break identically in Chromium and Firefox.
The space, `- / ? ! | }` (they let a line wrap inside a word in at least one
engine) and `" ' $ <` (no safe swap partner) are left out and stay as they are.
Within each group the cipher is a _derangement_ - every character maps to a
different character, so nothing in the charset survives untouched. A group with
a single member in your charset cannot be deranged and passes through too.
Characters outside the map render from the same forged font, which keeps every
base glyph; only characters the base font lacks fall back to
`fallbackFontFamily`.

Accented letters are not in the default. Add the Latin presets by spreading them
(order and duplicates do not matter); Roboto covers both:

```ts
import { DEFAULT_CHARSET, LATIN_1, LATIN_EXT_A } from '@pacyfist/veneer';

provideVeneer({ font, charset: [...DEFAULT_CHARSET, ...LATIN_1, ...LATIN_EXT_A] });
```

Accented letters swap only with other accented letters. `charsetFromText(text,
{ base })` lists the codepoints in your content that can be scrambled, for
pasting into the config at build time. Text is NFC-normalized before it is
scrambled, so `e` + U+0301 is protected like `é`.

**`seed`** should normally be left alone. Without it the cipher is drawn from the
CSPRNG with no seed at all (`randomScrambleMap`), on the server and in the
browser. A fixed seed is solvable: it is in your JavaScript bundle, and even
without it, a 32-bit seed fed to the public `buildScrambleMap` can be found by
trying all of them against some ciphertext (about 48 CPU-hours untuned). Every
visitor and every crawl then sees the same substitution.

**`strictCoverage`** decides what happens when the base font has no glyph for
some charset characters. Off (the default), they are dropped from the cipher once
the font has loaded (on the server, before rendering): the map is redrawn without
them, protected text is re-scrambled, those characters show as themselves in the fallback font,
and a dev-mode warning ([VNR014](#vnr014)) lists them. On, the instance fails open
instead ([VNR012](#vnr012)).

**Bold and italic faces.** `font` is the regular face. Without more faces, bold
or italic protected text is synthesized by the browser from it. Add real faces
with `withFaces()`; they are forged from the same map under the same family name,
with matching `FontFace` descriptors:

```ts
provideVeneer(
  { font: 'fonts/Roboto-Regular.ttf', fallbackFontFamily: "'Roboto', sans-serif" },
  withFaces(
    { src: 'fonts/Roboto-Bold.ttf', weight: 700 },
    { src: 'fonts/Roboto-Italic.ttf', style: 'italic' },
  ),
);
```

Every face must load, or the instance fails open. Characters any face lacks are
dropped from the cipher (see `strictCoverage`).

**`id`** matters only when several `provideVeneer` instances render on one server
page (for example in lazy routes). Each publishes its forged fonts' URLs for
hydration; give each a distinct `id` so they don't overwrite one another.

**`hideUntilReady`** keeps scrambled characters from flashing on screen before
the forged font is ready. Turn it off to accept the flash instead. The served
HTML has no inline `visibility: hidden`: the server marks hidden elements with
`data-veneer-hidden` and adds a one-line `<style>` rule to `<head>`, which a
one-line inline `<script>` switches on by adding `veneer-js` to `<html>`. Readers
that never run that script (JavaScript off, reader modes and archives that strip
scripts) see the scrambled text instead of blank space. In the browser veneer
hides with a CSSOM style, which a strict CSP allows, and drops the marker.

**`hideWith`** matters under a Content Security Policy without `'unsafe-inline'`:

- `'stylesheet'` (default): the inline `<style>` and `<script>` need the page's
  nonce or their hashes. veneer adds Angular's `CSP_NONCE` to both when it is set
  (provide `CSP_NONCE`, or put `ngCspNonce` on the root element). On prerendered
  pages, where there is no per-request nonce, add the hashes from
  `VENEER_CSP_HASHES` to `script-src` and `style-src`. If the CSP blocks them, the
  text shows scrambled in the fallback font until the app hydrates (never
  readable).
- `'hidden'`: the HTML `hidden` attribute, applied by the browser's own
  stylesheet, so no CSP can block it and nothing inline is added. Readers without
  JavaScript then see nothing, and the text takes no space until the client takes
  over, so the layout shifts.

```ts
import { VENEER_CSP_HASHES } from '@pacyfist/veneer';

const csp = `script-src 'self' ${VENEER_CSP_HASHES.script}; style-src 'self' ${VENEER_CSP_HASHES.style}`;
```

`e2e/csp.spec.ts` serves the demo with a nonce CSP and samples every frame: the
protected text is never visible before the forged font is loaded.

### Reader mode, translation, print and archives

- **Readers without JavaScript, "cached page" views, archives that strip
  scripts:** they get the scrambled text in the fallback font, not blank space.
- **Reader modes** (Firefox, Safari, Edge) re-render the page's text in their own
  font, so protected text shows as ciphertext. With `withA11y('hide')`, Firefox's
  reader drops it, because it skips `aria-hidden` content.
- **Translation:** protected elements carry `translate="no"` and the `notranslate`
  class while protection is on, so browser and Google translation leave them
  alone instead of translating gibberish. They are removed when protection is off.
- **Print:** prints what is on screen. The forged font is registered in
  `document.fonts`, so printed text is readable.
- **Archives that replay JavaScript** (Wayback Machine) work if they archived the
  base font; if the font request fails there, veneer fails open as usual.

## API reference

### Setup

| Export                                               | Description                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `provideVeneer(config, ...features)`                 | Returns `EnvironmentProviders`. Add to `providers`                                                           |
| `withStatusListener(fn)`, `withStatusAttribute()`    | Features: report status changes; mirror status on `<html data-veneer-status>`                                |
| `withFaces(...faces)`                                | Feature: bold, italic or other faces of the base family (`VeneerFace`: `{ src, weight?, style?, stretch? }`) |
| `withA11y('hide')`                                   | Feature: `aria-hidden` on protected elements while they are scrambled. See [Accessibility](#accessibility)   |
| `withReadableCopy()`                                 | Feature: copying protected text puts the readable words on the clipboard                                     |
| `VENEER_CSP_HASHES`                                  | `{ script, style }` CSP hashes of the inline hiding code, for pages without a nonce                          |
| `VeneerStatus`, `VeneerFailure`, `VeneerStatusEvent` | Status types                                                                                                 |
| `VeneerConfig`, `VeneerFontSource`, `VeneerFeature`  | Config types                                                                                                 |

Exports whose names start with `ɵ` are internal (they exist for
`@pacyfist/veneer/testing`) and may change in any release.

### Server

`@pacyfist/veneer/server`, Node only. See [Server-side rendering](#server-side-rendering)
and [Search engines](#search-engines-and-shouldprotect).

| Export                                                                          | Description                                                                                   |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `provideVeneerServer({ fonts, path?, emitDir?, shouldProtect? })`               | Forge the font during server rendering; `shouldProtect(request, context)` decides per request |
| `veneerFontMiddleware()`, `getVeneerFont(path)`                                 | Serve the forged fonts (Express/Connect middleware, or the bytes for any server)              |
| `verifyCrawler(ip, userAgent?)`                                                 | `Promise<{ name, hostname } \| null>`: a search crawler verified by reverse and forward DNS   |
| `createCrawlerVerifier(options?)`, `KNOWN_CRAWLERS`                             | A verifier with its own crawler list, resolver, timeout and cache; the default list           |
| `VeneerShouldProtect`, `VeneerCrawler`, `VerifiedCrawler`, `CrawlerDnsResolver` | Types                                                                                         |

### Template pieces

| Export                 | Selector                       | Description                                                                       |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `VeneerDirective`      | `[veneer]`, `[veneerHtml]`     | Scrambles the element's text nodes (or bound string or HTML) and applies the font |
| `VeneerFontDirective`  | `[veneerFont]`                 | Applies the font only, leaves text alone                                          |
| `VeneerPipe`           | `\| veneer`                    | Scrambles a bound string. Impure by design (see below)                            |
| `VeneerReadableToggle` | `button[veneerReadableToggle]` | A toggle button for readable mode (`aria-pressed`)                                |

`VeneerPipe` is impure because protection has to switch off the instant the font
fails to load, and a pure pipe would keep serving its cached scramble since the
input string never changed. The cost is one `Map` lookup per character per call.

### Runtime state

**`VeneerFontService`** - provided by `provideVeneer`. Its public shape is the
exported `VeneerFontState` interface, which the testing stand-in implements too.

| Member           | Type                            | Description                                                                  |
| ---------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `map`            | `Signal<ScrambleMap>`           | The substitution in force. Narrowed once after load if the font lacks glyphs |
| `initialMap`     | `Signal<ScrambleMap \| null>`   | The map server-rendered text uses; `null` until the forged font is read      |
| `familyName`     | `string`                        | Family name of the forged font: random, says nothing about the cipher        |
| `ready`          | `Signal<boolean>`               | Font registered and text is safe to show                                     |
| `status`         | `Signal<VeneerStatus>`          | `loading`, `active`, `failed` or `disabled`                                  |
| `failed`         | `Signal<VeneerFailure \| null>` | `{ code, message, missing? }` when the font could not be built               |
| `revealed`       | `WritableSignal<boolean>`       | Withhold the font, exposing raw scrambled characters                         |
| `readable`       | `WritableSignal<boolean>`       | Readable mode: scrambling off for the page, remembered in `localStorage`     |
| `active`         | `Signal<boolean>`               | `!disabled && !failed && !readable`                                          |
| `fontStack`      | `Signal<string>`                | The `font-family` value protected elements use                               |
| `hidden`         | `Signal<boolean>`               | Protected text should stay hidden right now                                  |
| `scramble(text)` | `string`                        | Scramble, or return unchanged when protection is off                         |

### Framework-free core

Two entry points that import no Angular. `@pacyfist/veneer/core` holds the
cipher and is re-exported from `@pacyfist/veneer`. `@pacyfist/veneer/forge` holds
the font forge (`parseBaseFont`, `forgeScrambledFont`, `coveredCodepoints`,
`VeneerFontError`, `BaseFont`). The forge is not re-exported from either, so it
stays out of your initial bundle: the service loads it with a dynamic import
when the font is built, and bundlers emit it as a lazy chunk (about 5 KB gzip).

| Export                                      | Description                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `DEFAULT_CHARSET`                           | The 84 ASCII characters that are safe to swap (see `charset`)                          |
| `buildScrambleMap(seed, charset?)`          | Derange per class. Throws if nothing in the charset can be swapped                     |
| `randomScrambleMap(charset?)`               | The same, drawn from the CSPRNG with no seed. What veneer uses by default              |
| `isScramblable(codepoint)`                  | Whether a codepoint can take part in the cipher                                        |
| `LATIN_1`, `LATIN_EXT_A`                    | Letter presets: U+00C0-U+00FF (no `×` `÷`) and U+0100-U+017F                           |
| `charsetFromText(text, { base? })`          | The scramblable codepoints in `text`, sorted, plus `base`                              |
| `scrambleText(text, map, { normalize? })`   | Apply a map, NFC first; unmapped characters pass through                               |
| `invertScrambleMap(map)`                    | The reverse substitution - decode your own output                                      |
| `randomSeed()`                              | A 32-bit seed from the CSPRNG. Searchable: prefer `randomScrambleMap`                  |
| `ScrambleMap`                               | `{ seed?, forward: ReadonlyMap<number, number>, inverse? }`                            |
| `parseBaseFont(buffer)`                     | `/forge`. Async. Parse a `.ttf`/`.otf`/`.woff` into a `BaseFont`                       |
| `parseBaseFontSync(buffer)`                 | `/forge`. The same for `.ttf`/`.otf`, without waiting (no WOFF)                        |
| `readScrambleMap(base, forged)`             | `/forge`. Read the cipher back out of a forged font, given its base font               |
| `BaseFont`                                  | `/forge`. `{ outlines, unitsPerEm, numGlyphs, familyName, glyphId(cp), codepoints() }` |
| `forgeScrambledFont(base, map, familyName)` | `/forge`. Produce the font binary whose `cmap` is scrambled                            |
| `coveredCodepoints(base, candidate)`        | `/forge`. The candidate codepoints the base font has a glyph for                       |
| `charsetFromFont(bytes, candidate?)`        | Async, build time. Covered codepoints that are safe to scramble                        |
| `VeneerFontError`                           | `/forge`. Thrown on parse failure or missing glyphs; carries `missing: string[]`       |

### Testing

`@pacyfist/veneer/testing` replaces `provideVeneer` in component tests. No font
is fetched or forged, so nothing needs `FontFace` (jsdom has none).

```ts
import { TestBed } from '@angular/core/testing';
import {
  VeneerTestingFontService,
  decodeVeneer,
  provideVeneerTesting,
} from '@pacyfist/veneer/testing';

TestBed.configureTestingModule({ providers: [provideVeneerTesting({ seed: 1 })] });
// ... render a component that uses [veneer] ...
expect(decodeVeneer(el)).toBe('Hello, world');

TestBed.inject(VeneerTestingFontService).setState('failed'); // simulate a font failure
```

| Export                           | Description                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `provideVeneerTesting(options?)` | Provides a deterministic `VeneerFontService` stand-in                                                           |
| `VeneerTestingOptions`           | `{ seed?, state?, charset?, fallbackFontFamily?, initialMap? }`; `initialMap: null` hydrates                    |
| `VeneerTestingState`             | `'ready'` (default), `'loading'`, `'failed'` or `'disabled'`                                                    |
| `VeneerTestingFontService`       | The stand-in. `setState(state)` changes state; `setInitialMap(map \| null)` simulates the server's map arriving |
| `decodeVeneer(elOrText, map?)`   | Readable text of a protected element or string. Defaults to the current stand-in's cipher                       |
| `findVeneerLeaks(text, list)`    | Protected originals, or runs of 4+ of their words, readable in HTML, JSON or a JS bundle                        |

## Server-side rendering

Supported, and this is where the technique earns its keep: most crawlers read the
server-rendered HTML and never execute JavaScript. The server needs
`@pacyfist/veneer/server` (Node only), so it can forge the font itself and keep
the key out of the page:

```ts
// app.config.server.ts
import { provideVeneerServer } from '@pacyfist/veneer/server';

providers: [
  provideServerRendering(withRoutes(serverRoutes)),
  // Where the server reads the base font: the folder the `font` URL is served
  // from. Here the browser build output, next to the server bundle.
  provideVeneerServer({ fonts: join(import.meta.dirname, '../browser') }),
];

// server.ts, before the Angular handler
import { veneerFontMiddleware } from '@pacyfist/veneer/server';
app.use(veneerFontMiddleware());
```

How it works:

1. During the render the server draws the cipher from the CSPRNG (no seed
   exists), forges the font (the base font with only its `cmap` replaced) and
   scrambles the text with it. The page carries only the forged font's URL
   (`veneer/<random id>.ttf`, relative to `<base href>`) and a random family name,
   in `TransferState` under a key namespaced by `id`. No seed, no map.
2. In the browser, `initialMap()` stays `null` and protected text stays hidden
   (with `hideUntilReady`) while the service fetches the forged font, reads the
   cipher back out of its `cmap` against the base font (`readScrambleMap`), and
   registers it. Then directives recover the readable text from the server's
   ciphertext, and the page shows exactly what the server rendered.

A crawler that reads the HTML gets ciphertext and no key. To decode it, it has to
fetch the forged font and the base font and compare their `cmap` tables, which is
what a browser does. That is the bar: a font parser and two downloads, not a regex.
Once JavaScript runs, the forged font is the key; see what this does not stop below.

**One cipher per server process.** Each `provideVeneer` configuration is forged
once per process and shared by every request, so visitors fetch and cache the font
once (it is served as immutable). A fresh cipher per request would cost every page
view a ~124 KB font download, and the server would have to keep every page's font
in memory until it is fetched, or re-forge it on demand. The fonts live in the
process's memory: behind a load balancer, route a page's font request to the
instance that rendered it (sticky sessions), or prerender. If the font cannot be
fetched (for example after a restart, for a page rendered before it), the
server's ciphertext cannot be decoded and stays visible as gibberish
([VNR016](#vnr016)).

**Prerendering (SSG).** One cipher per build, shared by every visitor until the
next build. No server is left to serve the fonts, so write them to a folder and
copy it into the browser output after the build. The folder must be outside the
build output, which the Angular builder empties after prerendering:

```ts
provideVeneerServer({ fonts: 'public', emitDir: 'dist/veneer-fonts' });
```

```sh
rm -rf dist/veneer-fonts && ng build && cp -r dist/veneer-fonts/. dist/my-app/browser/
```

**Without `provideVeneerServer()`** the server cannot scramble without putting the
key into the page, so it renders protected text readable and logs
[VNR015](#vnr015). The exception is a fixed `seed`, which both sides know from the
app's code (solvable; tests and reproducible builds only). The server reads `.ttf`
or `.otf` base fonts; a `font` given as a loader function or a WOFF file needs
`fonts` as a function that returns `.ttf` bytes.

Elements the server scrambled carry a `data-veneer-ssr` attribute. The `veneer`
directive in its element-content form (`<p veneer>Text</p>`) takes the element's
own text as the original, and on a hydrating page that text is _already_
ciphertext - scrambling it again would leave the reader looking at the server's
output, since the font undoes only one layer. The attribute is how a hydrating
element is told apart from one the browser rendered itself, such as a `@defer`
block whose text is still the readable template content. Such an element is
inverted only once `initialMap()` is known.

Without server rendering, nothing changes: the browser draws its own cipher and
forges its own font, and `initialMap()` is that map from the start.

## Search engines and `shouldProtect`

Protected text is ciphertext to every crawler, search engines included, so by
default it does not rank. `shouldProtect` lets the server decide per request,
for example to give verified search crawlers readable text:

```ts
// app.config.server.ts
provideVeneerServer({
  fonts: join(import.meta.dirname, '../browser'),
  // `context` is the second argument server.ts passes to angularApp.handle().
  shouldProtect: (request, context) => !(context as { crawler?: unknown })?.crawler,
});
```

- **Dynamic SSR only.** It runs for routes rendered per request
  (`RenderMode.Server` with `AngularNodeAppEngine`/`AngularAppEngine`), where
  Angular provides `REQUEST`. Prerendered (SSG) pages, build-time route
  extraction and `CommonEngine` have no request: the hook is not called and the
  page is protected. A prerendered page cannot be unprotected for a crawler.
- **`false` means readable.** That render scrambles nothing, forges no font and
  puts no font URL in the page; `TransferState` carries only
  `{ protect: false }`, so the browser that hydrates it keeps the readable text
  (status `disabled`, nothing hidden, nothing fetched). Only an explicit `false`
  unprotects; anything else protects.
- **Errors protect.** If the hook throws or rejects, the page is rendered
  protected and the server logs [VNR017](#vnr017). An error means the visitor
  could not be verified; failing towards readable text would hand the page to
  anyone who can make the check fail. People see the same page either way, so
  the cost is a crawler occasionally getting protected text.
- **It may be async**, and the render waits for it, so keep it fast (the crawler
  check below caches and times out).

**Verifying crawlers.** Never trust the user-agent: anyone can send `Googlebot`.
`verifyCrawler(ip, userAgent?)` does what Google and Bing document: the IP's
reverse DNS name must end in the crawler's domain (`googlebot.com` or
`google.com`, `search.msn.com`, `applebot.apple.com`) and that name must resolve
forward to the same IP. The user-agent only skips the lookups for requests that
do not claim to be a known crawler. Results are cached per IP for an hour; a
lookup that fails or takes over two seconds counts as "not a crawler" and is
not cached. It never rejects. The Fetch `Request` Angular renders has no client
IP, so call it in server.ts and pass the result as the request context:

```ts
// server.ts
import { veneerFontMiddleware, verifyCrawler } from '@pacyfist/veneer/server';

// Behind a proxy or CDN, trust exactly your proxies so req.ip is the client's
// address. An X-Forwarded-For header from anyone else is attacker-controlled.
app.set('trust proxy', 'loopback');

app.use(async (req, res, next) => {
  const crawler = await verifyCrawler(req.ip ?? '', req.get('user-agent'));
  angularApp
    .handle(req, { crawler })
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});
```

`createCrawlerVerifier({ crawlers?, resolver?, timeout?, ttl?, maxEntries? })`
builds one with its own cache, list (`KNOWN_CRAWLERS` is the default) or DNS
resolver (inject a fake one in tests).

## What this defends against

**Stops** bulk text extraction - `fetch` plus an HTML parse, `innerText`
scraping, copy-pasting a page into a chat window, and crawlers that don't run
JavaScript. With server rendering this needs `provideVeneerServer()`: the page then
carries no seed or map, only the forged font's URL (see Server-side rendering).

**Does not stop** a determined adversary. The generated font is downloadable and
its `cmap` describes the substitution completely, so anyone willing to parse it
can invert the cipher in a few lines. Rendering the page and running OCR defeats
it too.

This raises the cost of scraping; it does not make content secret. **Do not use
it as an access control.**

## Accessibility

Scrambled text is not accessible, and veneer does not pretend otherwise. Screen
readers, braille displays, find-in-page, translation and copy-paste all get the
scrambled characters, because that is the protection.

What veneer offers, all opt-in:

- **Readable mode** - `VeneerFontService.readable`, a signal that switches
  scrambling off for every protected element on the page, remembered in
  `localStorage` (where storage works). `VeneerReadableToggle` is a ready-made
  toggle button for it:

  ```html
  <button veneerReadableToggle>Readable text</button>
  ```

  Put it early in the page, outside protected content, so keyboard and screen
  reader users reach it first. **This is the route to conformance**: a visitor who
  needs the text switches it on and gets ordinary text, accessible like the rest
  of your page. WCAG lets a page conform through a conforming alternate version
  reached by an accessible mechanism; whether a toggle on the same page satisfies
  your audit is for your auditor to decide.

- **`withA11y('hide')`** - sets `aria-hidden="true"` on protected elements while
  they are scrambled, and removes it when protection fails open, is disabled, or
  the visitor switches on readable mode. Say it plainly: `aria-hidden` **hides**
  the content from assistive technology. It does not make it accessible. It stops
  a screen reader from reading gibberish aloud, and the reader then gets nothing
  instead. Use it together with readable mode, never as the whole answer. It
  skips elements that are or contain something focusable (a link, a button),
  because hiding focusable content breaks keyboard and screen reader navigation;
  development builds warn ([VNR021](#vnr021)).

- **`withReadableCopy()`** - copying a selection that includes protected text puts
  the readable words on the clipboard (`text/plain` and `text/html`). Off by
  default, because it also makes the text one Ctrl+C away from a chatbot.

WCAG 2.2 success criteria that scrambled text affects, while readable mode is off:

| Criterion                       | Level | Why                                                                                                               |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| 1.3.1 Info and Relationships    | A     | The words on screen come from the font, not the text; they cannot be programmatically determined                  |
| 1.1.1 Non-text Content          | A     | Like an icon font, the visible words are glyphs standing in for other characters, with no text alternative        |
| 2.4.4 Link Purpose (In Context) | A     | A link inside protected text has a scrambled name                                                                 |
| 2.5.3 Label in Name             | A     | The visible label of a link or control inside protected text does not match its accessible name                   |
| 4.1.2 Name, Role, Value         | A     | The same, for the name of any control; and `aria-hidden` over focusable content (which `withA11y('hide')` avoids) |

Keep navigation, headings, form labels, links and controls unprotected. Protect
long-form content, and offer readable mode wherever you protect.

## Trade-offs

On protected text only:

- **Screen readers announce gibberish** - see [Accessibility](#accessibility)
- **Find-in-page (Ctrl+F) does not match**
- **Copy-paste yields the scrambled string**
- **The forged font is the key** - it is the base font with only the `cmap`
  replaced, so it keeps the base glyph ids, kerning, ligatures and hinting, and
  protected text shapes exactly like the base font. Anyone holding it, or
  comparing its glyphs with the public base font, can invert the cipher. `post`
  glyph names are stripped, but a CFF (`.otf`) base font keeps its glyph names in
  the `CFF` table.
- **Hinting can differ by a pixel in Firefox on Linux** - widths, kerning and
  ligatures match exactly everywhere, and Chromium draws identical pixels. Firefox
  on Linux hints with FreeType's auto-hinter, which measures letters such as `x`
  and `o` through the `cmap`; the scrambled `cmap` shifts some vertical snapping.
- **`text-transform` and `small-caps` paint the wrong letters** - the browser
  changes the case of the scrambled codepoints, and the forged font then draws
  whatever readable letter sits at the new codepoint. Style protected text with
  real capitals in the source instead. Development builds warn
  ([VNR020](#vnr020)).

These are the same mechanism as the protection, not bugs to be fixed. Protect
article bodies. Leave navigation, headings, form labels, and anything assistive
technology needs alone.

## Failure behaviour

If the font cannot be fetched, parsed, or forged, the library **fails open**:
`active()` goes false, every directive restores its readable text, an error
starting `[veneer] disabled (VNRxxx)` is logged, `failed()` holds
`{ code, message, missing? }`, and the page renders normally. Unreadable content
is worse than unprotected content. Use `withStatusListener()` to report it.

One case cannot fail open: a server-rendered page whose forged font never arrives
([VNR016](#vnr016)). The readable text of server-rendered element content is not
in the page, by design, so it stays as the server rendered it.

A base font without a glyph for some charset characters does not fail by default:
those characters are left out of the cipher (see `strictCoverage`). The forge
itself never guesses: `forgeScrambledFont` throws when the font lacks a glyph for
a character in the map it is given, because silently dropping it would show
readers the _wrong letter_. The thrown `VeneerFontError` lists the missing
characters in `missing`. With `strictCoverage: true` that throw reaches the
service, which fails open with `VNR012`.

## WOFF2 and Google Fonts

veneer reads `.ttf`, `.otf` and `.woff`. For a **WOFF2** font, either convert it
once at build time:

```bash
woff2_decompress Font.woff2          # google/woff2, writes Font.ttf
# or: pip install fonttools brotli && fonttools ttLib.woff2 decompress Font.woff2
```

or decode it in the app with a decoder you pick, through the loader:

```ts
provideVeneer({
  font: async () => {
    const woff2 = await (await fetch('fonts/Font.woff2')).arrayBuffer();
    const { decompress } = await import('some-woff2-decoder'); // your choice
    return decompress(woff2); // must resolve to .ttf/.otf bytes
  },
});
```

**Static TTFs from Google Fonts:** the css2 API serves WOFF2 to browsers. Download
the family from its page on fonts.google.com ("Get font" then "Download all"): the
zip has variable TTFs at the top and static TTFs per weight under `static/`. Use
the static file that matches the weight your text uses, e.g.
`static/Roboto-Regular.ttf`, and serve it next to your web fonts. The same files
are in the `google/fonts` GitHub repository under `ofl/<family>/` or
`apache/<family>/`.

**Charset for a font:** characters the font lacks are dropped at runtime with a
dev-mode warning (or fail the instance with `strictCoverage: true`). To keep the
charset honest, check coverage at build time and paste the result into
`charset`:

```ts
import { readFileSync } from 'node:fs';
import { DEFAULT_CHARSET, charsetFromFont } from '@pacyfist/veneer/core';

const charset = await charsetFromFont(readFileSync('Font.ttf'), DEFAULT_CHARSET);
console.log(JSON.stringify(charset));
```

It leaves out whitespace (including U+00A0), U+00AD, control and format
characters and combining marks.

## Using the cipher outside Angular

The core is framework-free - the same functions run in the browser, in an SSR
process, and in a plain Node script. Import it from `@pacyfist/veneer/core`,
which does not load Angular:

```ts
import { buildScrambleMap, scrambleText, invertScrambleMap } from '@pacyfist/veneer/core';

const map = buildScrambleMap(12345);

scrambleText('Hello, world', map);
// 'qiBBA; kAoBj'

scrambleText('qiBBA; kAoBj', invertScrambleMap(map));
// 'Hello, world'
```

Useful for pre-scrambling static content in a build step, paired with
`forgeScrambledFont` from `@pacyfist/veneer/forge` to emit the matching font file.

## Error codes

Every message veneer logs or throws starts with `[veneer] VNRxxx:` and links here.
Dev-mode warnings are left out of production builds.

### VNR001

Dev-mode warning: text inside a `veneer` element changed after the directive
scrambled it, usually an interpolation (`<p veneer>{{ title() }}</p>`) or an
`@if` inside the element. That text is readable to scrapers and drawn as
gibberish for people until protection next changes. Use the pipe with
`veneerFont` (`<p veneerFont>{{ title() | veneer }}</p>`), or bind the string
(`<p [veneer]="title()"></p>`) or the HTML (`[veneerHtml]`).

### VNR002

Dev-mode warning: the `veneer` pipe's output was rendered in an element that is
not drawn with the forged font, so readers see it scrambled. Put `veneerFont` on
the element that renders it. A pipe is not told where its result goes, so the
check looks for the output in the page's text nodes after rendering and checks
that they sit inside a `veneerFont` or `veneer` element (or an element whose
`font-family` names the forged font). Output used in an attribute is not checked.

### VNR003

A directive or the pipe found no `VeneerFontService`: `provideVeneer()` is missing
from the injector tree. Add it to the `providers` of your `ApplicationConfig` (or of
the route or component that uses veneer). In unit tests, use `provideVeneerTesting()`
from `@pacyfist/veneer/testing`.

### VNR010

The base font could not be loaded: the request failed (the message names the
resolved URL and the status) or the `font` loader rejected. Check that the file is
served at that URL. Use a relative path such as `'fonts/Roboto-Regular.ttf'`: it
resolves against `<base href>`, while a leading slash ignores it and breaks subpath
deploys. Protection fails open.

### VNR011

The base font bytes are not a font veneer can read (not `.ttf`, `.otf` or `.woff`,
WOFF2, a collection, or a malformed table), or forging failed. The message says
which. Protection fails open.

### VNR012

The base font has no glyph for some charset characters; `failed().missing` lists
them. Only with `strictCoverage: true`. Narrow `charset` (see `charsetFromFont`)
or use a fuller font. Protection fails open.

### VNR013

The browser rejected the forged font, or has no CSS Font Loading API (`FontFace`).
Check the console for the browser's reason, and a `font-src` Content Security
Policy. Protection fails open.

### VNR014

Dev-mode warning: the base font has no glyph for the listed charset characters, so
they were left out of the cipher and show as themselves, in the fallback font.
Protection stays on for everything else. Narrow `charset` to the characters the
font covers (see `charsetFromFont`) to silence it, or set `strictCoverage: true`
to fail instead.

### VNR015

On the server: the cipher and forged font could not be built, so the server
rendered protected text **readable**. Either `provideVeneerServer()` from
`@pacyfist/veneer/server` is missing from the server config (without it the server
cannot scramble without writing the key into the page), or it could not read the
base font (check `fonts` points at the folder the `font` URL is served from) or
forge it. The server log has the reason.

### VNR016

In the browser: the forged font the server rendered with could not be fetched, or
does not decode against the base font. The server's ciphertext cannot be decoded
without it, so server-rendered element content stays unreadable (bound text,
`veneerHtml` and the pipe fall back to readable). Check that server.ts mounts
`veneerFontMiddleware()`, that a load balancer sends the font request to the
instance that rendered the page, or for prerendered pages that the `emitDir`
folder was copied into the browser output.

### VNR017

On the server: the `shouldProtect` hook given to `provideVeneerServer()` threw or
rejected, so the page was rendered **protected**. Logged once per distinct error.
The server log has the error; a common cause is a DNS lookup in the hook failing.

### VNR020

Dev-mode warning: protected text is styled with `text-transform` (other than
`none`) or small caps. CSS case changes apply to the characters in the DOM, which
are the scrambled ones, so the forged font is asked for a different letter's
glyph and draws the wrong one. Change the case in the text itself, or keep the
style off protected text. Small caps are safe only when the font has real
small-cap glyphs (the `smcp` feature), which the forge keeps, and the browser does
not synthesize them.

### VNR021

Dev-mode warning: `withA11y('hide')` did not hide a protected element because it is
or contains something focusable (a link, a button, a form control, an element
with `tabindex`). `aria-hidden` over focusable content leaves keyboard stops that
assistive technology cannot describe (WCAG 4.1.2), so veneer leaves the element
exposed and screen readers will read its scrambled text. Keep links and controls
out of protected elements, or rely on readable mode for that content.

## Troubleshooting

| Symptom                                         | Cause                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `could not parse the base font`                 | The file is not a font. veneer reads `.ttf`, `.otf` and `.woff`                                                |
| `the base font is WOFF2`                        | Convert it to `.ttf`, or decode it in the `font` loader. See [WOFF2 and Google Fonts](#woff2-and-google-fonts) |
| `the base font has no glyph for N character(s)` | Base font doesn't cover the charset (`strictCoverage: true`). Use a fuller font, or narrow `charset`           |
| `VNR010 ... request for <url> failed: 404`      | The `font` URL isn't served. Check it's in your `public` output and the path has no leading slash              |
| Protected text is invisible and never appears   | `hideUntilReady` is on while the font request hangs, or the app never booted. Check the console                |
| Text renders readable, protection seems off     | The library failed open. Inspect `failed()`, or `disabled` is set                                              |
| Protected text is in the wrong typeface         | `fallbackFontFamily` doesn't name the same typeface as `font`                                                  |
| Reader sees gibberish after hydration           | Interpolating into an element that also has `veneer` ([VNR001](#vnr001)). Use the pipe + `veneerFont`          |
| Server HTML has readable protected text         | `provideVeneerServer()` is missing or cannot read the font ([VNR015](#vnr015)). Check the server log           |
| `VNR016 ... forged font request ... failed`     | The server's forged font is not served. Mount `veneerFontMiddleware()`, or copy `emitDir` after prerendering   |

## Contributing

The library lives in an Angular workspace alongside an SSR demo app that consumes
it exactly as an outside user would.

```bash
npm install
npm start        # build the library, serve the demo on :4321
npm test         # library unit tests (vitest)
npm run test:node-core  # load the built core in plain Node and forge a font
npm run e2e      # Playwright checks against the built static site
npm run build    # library + demo production build
```

Issues and pull requests: https://github.com/pacyfist/veneer

## License

**AGPL-3.0-only.** Read this before adopting it: the AGPL's network clause (§13)
applies to software offered to users over a network, which is what a web page is.
Using this library in a site you serve publicly means that site's source falls
under the same terms. That is the intent, not an oversight.

The base font is yours to supply and license.
