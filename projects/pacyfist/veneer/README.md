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
- [What this defends against](#what-this-defends-against)
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

The directive takes the element's own content, replaces it with the scrambled
form, and points the element at the forged font:

```html
<p veneer>Text a scraper should not be able to read.</p>
```

### Text you hand it directly

Bind a string and the directive owns the element's content:

```html
<p [veneer]="article().body"></p>
```

### Interpolated text - `veneer` pipe + `veneerFont`

When Angular interpolates the text, scramble with the pipe and supply the font
with `veneerFont`:

```html
<h1 veneerFont>{{ title() | veneer }}</h1>
```

> [!WARNING]
> Do not put `veneer` on an element Angular also interpolates into. The directive
> owns `textContent` and the two will fight over it. Interpolation → pipe;
> everything else → directive.

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

**`hideUntilReady`** trades one flaw for another. Left on, scrambled characters
never flash on screen, but a visitor with JavaScript disabled sees nothing where
protected text would be. Turn it off to accept the flash instead.

## API reference

### Setup

| Export                                               | Description                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `provideVeneer(config, ...features)`                 | Returns `EnvironmentProviders`. Add to `providers`                                                           |
| `withStatusListener(fn)`, `withStatusAttribute()`    | Features: report status changes; mirror status on `<html data-veneer-status>`                                |
| `withFaces(...faces)`                                | Feature: bold, italic or other faces of the base family (`VeneerFace`: `{ src, weight?, style?, stretch? }`) |
| `VeneerStatus`, `VeneerFailure`, `VeneerStatusEvent` | Status types                                                                                                 |
| `VeneerConfig`, `VeneerFontSource`, `VeneerFeature`  | Config types                                                                                                 |

Exports whose names start with `ɵ` are internal (they exist for
`@pacyfist/veneer/testing`) and may change in any release.

### Template pieces

| Export                | Selector       | Description                                            |
| --------------------- | -------------- | ------------------------------------------------------ |
| `VeneerDirective`     | `[veneer]`     | Scrambles the element's text and applies the font      |
| `VeneerFontDirective` | `[veneerFont]` | Applies the font only, leaves text alone               |
| `VeneerPipe`          | `\| veneer`    | Scrambles a bound string. Impure by design (see below) |

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
| `active`         | `Signal<boolean>`               | `!disabled && !failed`                                                       |
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

## Trade-offs

On protected text only:

- **Screen readers announce gibberish**
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
  real capitals in the source instead.

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
without it, so server-rendered element content stays unreadable (bound text and
the pipe fall back to readable). Check that server.ts mounts
`veneerFontMiddleware()`, that a load balancer sends the font request to the
instance that rendered the page, or for prerendered pages that the `emitDir`
folder was copied into the browser output.

## Troubleshooting

| Symptom                                         | Cause                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `could not parse the base font`                 | The file is not a font. veneer reads `.ttf`, `.otf` and `.woff`                                                |
| `the base font is WOFF2`                        | Convert it to `.ttf`, or decode it in the `font` loader. See [WOFF2 and Google Fonts](#woff2-and-google-fonts) |
| `the base font has no glyph for N character(s)` | Base font doesn't cover the charset (`strictCoverage: true`). Use a fuller font, or narrow `charset`           |
| `VNR010 ... request for <url> failed: 404`      | The `font` URL isn't served. Check it's in your `public` output and the path has no leading slash              |
| Protected text is invisible and never appears   | The font never loaded and JS is disabled, or `hideUntilReady` is on while the request hangs. Check the console |
| Text renders readable, protection seems off     | The library failed open. Inspect `failed()`, or `disabled` is set                                              |
| Protected text is in the wrong typeface         | `fallbackFontFamily` doesn't name the same typeface as `font`                                                  |
| Reader sees gibberish after hydration           | Interpolating into an element that also has `veneer`. Use the pipe + `veneerFont`                              |
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
