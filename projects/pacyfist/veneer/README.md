# @pacyfist/veneer

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Angular](https://img.shields.io/badge/angular-%5E21.2-dd0031.svg)](https://angular.dev)
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
- [Using the cipher outside Angular](#using-the-cipher-outside-angular)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Requirements

| Requirement | Version / notes                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Angular     | `^21.2.0` (`@angular/core`, `@angular/common`)                                                                                           |
| opentype.js | `^2.0.0` - peer dependency, so you pin the version                                                                                       |
| Base font   | A **`.ttf` or `.otf`** file you are licensed to embed                                                                                    |
| Browser     | Anything with the [CSS Font Loading API](https://developer.mozilla.org/docs/Web/API/CSS_Font_Loading_API) (`FontFace`, `document.fonts`) |

opentype.js **cannot read WOFF or WOFF2** - those are compressed container
formats. Ship the uncompressed `.ttf`/`.otf` alongside your web fonts, or load
it through a custom loader that decompresses first.

Use the same typeface your body text already uses. The forged font replaces it
wherever `veneer` is applied, so a mismatch is immediately visible.

## Installation

```bash
npm install @pacyfist/veneer opentype.js
```

## Quick start

**1. Register the library** in your `ApplicationConfig`:

```ts
import { ApplicationConfig } from '@angular/core';
import { provideVeneer } from '@pacyfist/veneer';

export const appConfig: ApplicationConfig = {
  providers: [
    provideVeneer({
      font: '/fonts/Roboto-Regular.ttf',
      fallbackFontFamily: "'Roboto', sans-serif",
    }),
  ],
};
```

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

veneer.ready(); // signal<boolean>       - forged font registered
veneer.failed(); // signal<string | null> - error message, or null
veneer.active(); // computed<boolean>     - protection actually in force
veneer.hidden(); // computed<boolean>     - text held back to avoid a flash
veneer.revealed.set(true); // withhold the font - show the raw scrambled characters
```

`revealed` is a demo and debugging switch: flipping it on renders exactly what a
scraper receives, which is a convincing way to show the mechanism working.

## Configuration

```ts
provideVeneer({
  font: '/fonts/Roboto-Regular.ttf',
  fallbackFontFamily: "'Roboto', sans-serif",
  charset: undefined,
  seed: undefined,
  hideUntilReady: true,
  disabled: false,
});
```

| Option               | Type                                                  | Default                   | Purpose                                                         |
| -------------------- | ----------------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| `font`               | `string \| ArrayBuffer \| () => Promise<ArrayBuffer>` | _required_                | Base font supplying the glyph outlines                          |
| `fallbackFontFamily` | `string`                                              | `'sans-serif'`            | Renders characters outside the charset - spaces, accents, emoji |
| `charset`            | `readonly number[]`                                   | printable ASCII, no space | Codepoints the cipher covers                                    |
| `seed`               | `number`                                              | random per page load      | Pins the cipher. Tests and reproducible builds only             |
| `hideUntilReady`     | `boolean`                                             | `true`                    | Keep protected text invisible until the font lands              |
| `disabled`           | `boolean`                                             | `false`                   | Turn everything off, per environment                            |

**`charset`** defaults to `U+0021`-`U+007E` - printable ASCII **without the
space**. Space is excluded deliberately: it is the only character the browser can
break a line at, so mapping it to something else would collapse a paragraph into
one unbreakable word. The cipher is a _derangement_ - every character maps to a
different character, so nothing survives untouched. Characters outside the
charset pass through unchanged and render in `fallbackFontFamily`.

**`seed`** should normally be left alone. A constant seed means every visitor and
every crawl sees the same substitution, which is solvable once by frequency
analysis and reusable forever after.

**`hideUntilReady`** trades one flaw for another. Left on, scrambled characters
never flash on screen, but a visitor with JavaScript disabled sees nothing where
protected text would be. Turn it off to accept the flash instead.

## API reference

### Setup

| Export                                                     | Description                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `provideVeneer(config)`                                    | Returns `EnvironmentProviders`. Add to `providers`             |
| `VENEER_CONFIG`                                            | `InjectionToken<ResolvedVeneerConfig>` for the resolved config |
| `VeneerConfig`, `VeneerFontSource`, `ResolvedVeneerConfig` | Config types                                                   |

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

**`VeneerFontService`** - provided by `provideVeneer`.

| Member           | Type                      | Description                                          |
| ---------------- | ------------------------- | ---------------------------------------------------- |
| `map`            | `ScrambleMap`             | The substitution in force for this page load         |
| `familyName`     | `string`                  | Family name of the forged font, unique per load      |
| `ready`          | `Signal<boolean>`         | Font registered and text is safe to show             |
| `failed`         | `Signal<string \| null>`  | Error message when the font could not be built       |
| `revealed`       | `WritableSignal<boolean>` | Withhold the font, exposing raw scrambled characters |
| `active`         | `Signal<boolean>`         | `!disabled && !failed`                               |
| `fontStack`      | `Signal<string>`          | The `font-family` value protected elements use       |
| `hidden`         | `Signal<boolean>`         | Protected text should stay hidden right now          |
| `scramble(text)` | `string`                  | Scramble, or return unchanged when protection is off |

### Framework-free core

Exported so the cipher can be reused outside Angular.

| Export                                      | Description                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `DEFAULT_CHARSET`                           | Printable ASCII minus the space                                        |
| `buildScrambleMap(seed, charset?)`          | Build the derangement. Throws below 2 distinct codepoints              |
| `scrambleText(text, map)`                   | Apply a map; unmapped characters pass through                          |
| `invertScrambleMap(map)`                    | The reverse substitution - decode your own output                      |
| `randomSeed()`                              | A seed from the CSPRNG when there is one                               |
| `ScrambleMap`                               | `{ seed, forward: ReadonlyMap<number, number> }`                       |
| `parseBaseFont(buffer)`                     | Parse a `.ttf`/`.otf` into an opentype.js `Font`                       |
| `forgeScrambledFont(base, map, familyName)` | Produce the font binary whose `cmap` is scrambled                      |
| `VeneerFontError`                           | Thrown on parse failure or missing glyphs; carries `missing: string[]` |

## Server-side rendering

Supported, and this is where the technique earns its keep: most crawlers read the
server-rendered HTML and never execute JavaScript.

The cipher is built synchronously from a seed, so the server renders scrambled
text directly into the HTML. The seed travels to the client through Angular's
`TransferState`, both sides derive the same cipher, and hydration sees identical
text.

Elements the server scrambled carry a `data-veneer-ssr` attribute. The `veneer`
directive in its element-content form (`<p veneer>Text</p>`) takes the element's
own text as the original, and on a hydrating page that text is _already_
ciphertext - scrambling it again would leave the reader looking at the server's
output, since the font undoes only one layer. The attribute is how a hydrating
element is told apart from one the browser rendered itself, such as a `@defer`
block whose text is still the readable template content.

The seed is visible in the page source. That costs nothing: the forged font is
downloadable and its `cmap` already describes the substitution completely.

## What this defends against

**Stops** bulk text extraction - `fetch` plus an HTML parse, `innerText`
scraping, copy-pasting a page into a chat window, and crawlers that don't run
JavaScript.

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
- **No kerning** - the generated font carries no `kern`/`GPOS` table. Visually
  negligible for body text, measurable on pairs like `AV` at display sizes.

These are the same mechanism as the protection, not bugs to be fixed. Protect
article bodies. Leave navigation, headings, form labels, and anything assistive
technology needs alone.

## Failure behaviour

If the font cannot be fetched, parsed, or forged, the library **fails open**:
`active()` goes false, every directive restores its readable text, an error is
logged, and the page renders normally. Unreadable content is worse than
unprotected content.

`forgeScrambledFont` throws instead when the base font lacks a glyph for a
charset character - silently dropping it would show readers the _wrong letter_
with no other symptom. The thrown `VeneerFontError` lists the missing characters in
`missing`. That throw is still caught by the service, so the page fails open
either way.

## Using the cipher outside Angular

The core is framework-free - the same functions run in the browser, in an SSR
process, and in a plain Node script:

```ts
import { buildScrambleMap, scrambleText, invertScrambleMap } from '@pacyfist/veneer';

const map = buildScrambleMap(12345);

scrambleText('Hello, world', map);
// '$&[[4` v4j[7'

scrambleText('$&[[4` v4j[7', invertScrambleMap(map));
// 'Hello, world'
```

Useful for pre-scrambling static content in a build step, paired with
`forgeScrambledFont` to emit the matching font file.

## Troubleshooting

| Symptom                                         | Cause                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `could not parse the base font`                 | The file is WOFF/WOFF2. opentype.js needs `.ttf` or `.otf`                                                     |
| `the base font has no glyph for N character(s)` | Base font doesn't cover the charset. Use a fuller font, or narrow `charset`                                    |
| `base font request failed: 404`                 | The `font` URL isn't served. Check it's in your `assets`/`public` output                                       |
| Protected text is invisible and never appears   | The font never loaded and JS is disabled, or `hideUntilReady` is on while the request hangs. Check the console |
| Text renders readable, protection seems off     | The library failed open. Inspect `failed()`, or `disabled` is set                                              |
| Protected text is in the wrong typeface         | `fallbackFontFamily` doesn't name the same typeface as `font`                                                  |
| Reader sees gibberish after hydration           | Interpolating into an element that also has `veneer`. Use the pipe + `veneerFont`                              |

## Contributing

The library lives in an Angular workspace alongside an SSR demo app that consumes
it exactly as an outside user would.

```bash
npm install
npm start        # build the library, serve the demo on :4321
npm test         # library unit tests (vitest)
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
