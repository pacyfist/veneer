# veneer

[![Angular](https://img.shields.io/badge/Angular-20%20%7C%2021%20%7C%2022-dd0031.svg?logo=angular)](https://angular.dev)
[![SSR](https://img.shields.io/badge/SSR-supported-brightgreen.svg)](projects/pacyfist/veneer/README.md#server-side-rendering)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

**An Angular library that keeps your text readable for people, while scrapers,
scripts and copy-paste get gibberish.**

Add one directive to your templates. Visitors read your page as usual. Anything
that reads the page's text instead of looking at it gets scrambled nonsense:
AI crawlers, `fetch` plus an HTML parser, `innerText`, copy-paste into a
chatbot, and Ctrl+F.

```html
<p veneer>The quick brown fox jumps over the lazy dog.</p>
```

```
on screen:  The quick brown fox jumps over the lazy dog.
innerText:  Qi& sgY.a Rj4vE @4' Pg8So 4c&j Gi& [xN? 74O_
```

**Live demo:** https://pacyfist.github.io/veneer/ (copy the text, search it,
and toggle "bot vision" to see what a scraper gets).

## How it works

It's a secret code plus a font that decodes it.

1. **Swap every letter.** Each character is replaced with a different one, and
   the scrambled version is what goes into your HTML.
2. **Build a matching font.** When the page loads, the browser builds a font
   from your normal `.ttf`. Its lookup table is shuffled to match the code, so
   the slot for `Q` draws a `T`.
3. **Eyes decode, code doesn't.** Your screen draws shapes, so people read the
   words. Scrapers read characters, so they get the code.

There's no server component and no third-party service. With SSR, the server
writes the scrambled text into the HTML, so crawlers never see the real words.

## Get started

You need Angular 20, 21 or 22, opentype.js 2, and a `.ttf` or `.otf` copy of the font
your page already uses. WOFF and WOFF2 won't work.

**1. Install**

```bash
npm install @pacyfist/veneer opentype.js
```

**2. Point it at your font** in `app.config.ts`

```ts
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

**3. Mark your text**

```ts
import { VeneerDirective } from '@pacyfist/veneer';

@Component({
  imports: [VeneerDirective],
  template: `<p veneer>Scrapers get gibberish here.</p>`,
})
export class Article {}
```

No stylesheet to copy and no build plugin.

### Which form do I use?

Rule of thumb: **if you see `{{ }}`, use the pipe.** Otherwise, use the
attribute.

| Situation                         | Use                                           |
| --------------------------------- | --------------------------------------------- |
| Text written in the template      | `<p veneer>Hello</p>`                         |
| Text from a variable or an API    | `<p [veneer]="article().body"></p>`           |
| Text you already interpolate      | `<h1 veneerFont>{{ title() \| veneer }}</h1>` |
| ⚠️ Don't: `{{ }}` inside `veneer` | `<p veneer>{{ title() }}</p>` renders empty   |

## A speed bump, not a vault

veneer makes lazy, bulk scraping pointless. It won't stop someone who is
specifically after your content, and it doesn't pretend to.

| Stops                                        | Doesn't stop                                           |
| -------------------------------------------- | ------------------------------------------------------ |
| Scripts that download your HTML and parse it | Screenshots run through OCR (the pixels are correct)   |
| Crawlers that don't run JavaScript           | Someone who downloads the font and reverses the cipher |
| Copy-pasting your page into a chatbot        | A determined person targeting your site in particular  |
| Cheap bulk scraping for AI training sets     |                                                        |

**What it costs you**, on protected text only:

- Ctrl+F can't find it.
- Your human readers get gibberish when they copy it, too.
- Screen readers read the scrambled text. Hide it with `aria-hidden` and offer
  a readable alternative.
- Search engines index the scrambled text.

**Good use:** article bodies, recipes, lyrics, product descriptions.
**Leave alone:** menus, headings, form labels, and anything you want to rank.
**Never:** secrets. This is not encryption.

## It fails safe

If the font can't be fetched or built, protected text turns back into ordinary
readable text and an error is logged. The worst case is unprotected, never
unreadable.

## FAQ

**Is this only for Angular?**
Yes. The directive, pipe and `provideVeneer()` are Angular APIs, with SSR and
hydration support. There's no React or Vue wrapper. The low-level cipher and
font builder are plain functions a build script could use.

**Is it slow?**
The font is built once, in the browser, when the page loads. After that each
character is one lookup. Kerning is dropped, which you'll barely notice in body
text.

**What does the license mean for me?**
It's AGPL-3.0. If you use it on a public website, that site's source code has to
be available under the same license. That's intentional. You also need a font
whose license allows embedding.

## Documentation

The full reference covers every config option, the API, SSR details,
troubleshooting and the framework-free core:
[projects/pacyfist/veneer/README.md](projects/pacyfist/veneer/README.md).

What's planned next, and why: [ROADMAP.md](ROADMAP.md).

## Repository layout

| Path                       | What                                         |
| -------------------------- | -------------------------------------------- |
| `projects/pacyfist/veneer` | The library, published as `@pacyfist/veneer` |
| `projects/demo`            | The showcase site on GitHub Pages            |
| `e2e`                      | Playwright checks against the built site     |

```bash
npm install
npm start            # demo at http://localhost:4321
npm test             # library unit tests
npm run build:pages  # static site in dist/demo/browser
```

## License

[AGPL-3.0-only](LICENSE).
