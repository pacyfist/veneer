# veneer

[![Angular](https://img.shields.io/badge/Angular-20%20%7C%2021%20%7C%2022-dd0031.svg?logo=angular)](https://angular.dev)
[![SSR](https://img.shields.io/badge/SSR-supported-brightgreen.svg)](projects/pacyfist/veneer/README.md#server-side-rendering)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

**An Angular library that keeps your text readable for people, while scrapers,
scripts and copy-paste get gibberish.**

Add one directive to your templates. Visitors read your page as usual. Anything
that reads the page's text instead of looking at it gets scrambled nonsense:
`fetch` plus an HTML parser, `innerText`, copy-paste into a chatbot, and Ctrl+F.

```html
<p veneer>The quick brown fox jumps over the lazy dog.</p>
```

```
on screen:  The quick brown fox jumps over the lazy dog.
innerText:  XdU LeqNs zKhZP Thl reFYC hQUK wdU kRBu Ahf;
```

**Live demo:** https://pacyfist.github.io/veneer/ (copy the text, search it,
and toggle "bot vision" to see what a scraper gets).

## How it works

It's a secret code plus a font that decodes it.

1. **Swap every letter.** Each letter is replaced with a different letter (and
   digits with digits), and the scrambled version is what goes into your HTML.
2. **Build a matching font.** A copy of your normal font gets a shuffled lookup
   table that matches the code, so the slot for `X` draws a `T`. Kerning,
   ligatures and hinting carry over.
3. **Eyes decode, code doesn't.** Your screen draws shapes, so people read the
   words. Scrapers read characters, so they get the code.

There's no third-party service. With server rendering, the server forges the
font and writes scrambled text into the HTML, which carries only the font's URL,
never the key.

## Is veneer right for me?

Read this before you install. Each answer links to the details.

| Question               | Answer                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **License**            | AGPL-3.0-only. On a public website, your site's source has to be available under the same license. Your font's license must allow modified versions ([checklist](projects/pacyfist/veneer/README.md#font-license-checklist))                                                                               |
| **SEO**                | Search engines index protected text as gibberish. Protect bodies, not what you want to rank for. On dynamic SSR, `shouldProtect` can serve verified crawlers readable text ([SEO](projects/pacyfist/veneer/README.md#search-engines-and-shouldprotect))                                                    |
| **Accessibility**      | Scrambled text is not accessible. Readable mode (a toggle button) is the route to WCAG conformance; `withA11y('hide')` only hides it from screen readers ([details](projects/pacyfist/veneer/README.md#accessibility))                                                                                     |
| **Browsers**           | Chromium and Firefox measured in e2e on Linux; WebKit tested in CI only. Anything without `FontFace` falls back to readable text ([support](projects/pacyfist/veneer/README.md#browsers))                                                                                                                  |
| **Prerendered sites**  | One cipher per build, shared by every visitor until the next build. Server rendering uses one per server process                                                                                                                                                                                           |
| **Bundle and network** | About 22 KB minified (8-9 KB gzip) in the initial bundle, a 5 KB (gzip) lazy chunk, and your base font (Roboto Regular: 74 KB gzip). Server-rendered pages also download the forged font, about the same size ([measured](projects/pacyfist/veneer/README.md#what-it-costs-your-bundle-and-your-visitors)) |
| **Security**           | A speed bump for bulk scraping, not encryption. Text written in your source ships readable in your JS bundle, and a scraper that knows veneer decodes it ([threat model](THREAT_MODEL.md))                                                                                                                 |

## Get started

You need Angular 20, 21 or 22 and a `.ttf`, `.otf` or `.woff` copy of the font your
page already uses. WOFF2 needs converting first (see the library README).

**1. Install**

```bash
npm install @pacyfist/veneer
```

**2. Point it at your font** in `app.config.ts`

```ts
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

Keep the path relative (no leading slash): it resolves against `<base href>`, so it keeps working when the app is deployed under a subpath such as `/my-app/`.

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

**4. Server-rendered app? Add the server half**, or the server renders protected
text readable. The server forges the font and serves it:

```ts
// app.config.server.ts
import { provideVeneerServer } from '@pacyfist/veneer/server';
import { join } from 'node:path';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideVeneerServer({ fonts: join(import.meta.dirname, '../browser') }),
  ],
};
```

```ts
// server.ts, before the Angular request handler
import { veneerFontMiddleware } from '@pacyfist/veneer/server';

app.use(veneerFontMiddleware());
```

Prerendered pages need one copy step after the build: see
[Prerendering](projects/pacyfist/veneer/README.md#prerendering-ssg).

### Which form do I use?

Rule of thumb: **if you see `{{ }}`, use the pipe.** Otherwise, use the
attribute.

| Situation                         | Use                                           |
| --------------------------------- | --------------------------------------------- |
| Text written in the template      | `<p veneer>Hello <em>you</em></p>`            |
| Text from a variable or an API    | `<p [veneer]="article().title"></p>`          |
| HTML from a CMS                   | `<div [veneerHtml]="article().html"></div>`   |
| Text you already interpolate      | `<h1 veneerFont>{{ title() \| veneer }}</h1>` |
| ⚠️ Don't: `{{ }}` inside `veneer` | `<p veneer>{{ title() }}</p>` leaks it        |

Text written in the template is in your JS bundle too. Content that matters
should arrive at runtime, from an API or a CMS: see
[Where plaintext still leaks](projects/pacyfist/veneer/README.md#where-plaintext-still-leaks).

## A speed bump, not a vault

veneer makes lazy, bulk scraping pointless. It won't stop someone who is
specifically after your content, and it doesn't pretend to. The full picture,
with measured attack costs, is in [THREAT_MODEL.md](THREAT_MODEL.md).

| Stops                                                                                                                         | Doesn't stop                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crawlers that read your server-rendered or prerendered HTML without running JavaScript (with `provideVeneerServer()` for SSR) | Crawlers that also download your JS bundles: text written in your source (`<p veneer>Text</p>`, `signal('...')`, constants) ships there readable. Only runtime data (an API, a CMS) stays out |
| Scripts that read `innerText` or `textContent` of the page                                                                    | Scrapers that know veneer: downloading the forged and base fonts recovers the cipher in about 15 lines, written once for every veneer site                                                    |
| Copy-pasting your page into a chatbot                                                                                         | A headless browser that hooks `FontFace` and reads the font from memory                                                                                                                       |
| Bulk scrapers that have never heard of veneer                                                                                 | Screenshots run through OCR or a vision model: the pixels are correct                                                                                                                         |
|                                                                                                                               | A person targeting your site in particular                                                                                                                                                    |

veneer works best while few sites use it: a generic decoder is cheap to write,
and nobody writes one for a technique almost no site uses.

**What it costs you**, on protected text only:

- Ctrl+F can't find it.
- Your human readers get gibberish when they copy it, too.
- Screen readers read the scrambled text. `withA11y('hide')` hides it from them
  with `aria-hidden`, which hides it rather than making it accessible. The route
  to WCAG conformance is readable mode: a `<button veneerReadableToggle>` that
  switches scrambling off for the page. Affected criteria include 1.3.1, 1.1.1,
  and for links inside protected text 2.4.4, 2.5.3 and 4.1.2. See
  [Accessibility](projects/pacyfist/veneer/README.md#accessibility).
- Search engines index the scrambled text.

**Good use:** article bodies, recipes, lyrics, product descriptions.
**Leave alone:** menus, headings, form labels, and anything you want to rank
(see [Search engines and `shouldProtect`](projects/pacyfist/veneer/README.md#search-engines-and-shouldprotect)).
**Never:** secrets. This is not encryption.

## When it fails

If the font can't be fetched or built, protected text turns back into ordinary
readable text and an error is logged. Usually the worst case is unprotected text.
The exception is a server-rendered page: if the browser cannot get the base font,
the forged font or veneer's forge code (blocked, offline, or gone after a
redeploy), the text the server rendered stays scrambled, because the readable
text is not in the page. veneer retries once, then reports `VNR016`. Watch for it
with `withStatusListener()`.

## FAQ

**Is this only for Angular?**
Yes. The directive, pipe and `provideVeneer()` are Angular APIs, with SSR and
hydration support. There's no React or Vue wrapper. The low-level cipher and
font builder are plain functions a build script could use.

**Is it slow?**
The font is built once per page load, in a few milliseconds: it is your font
with only its lookup table replaced, so kerning and ligatures stay. After that
each character is one lookup.

**What does the license mean for me?**
It's AGPL-3.0. If you use it on a public website, that site's source code has to
be available under the same license. That's intentional. You also need a font
whose license allows modified versions: forging creates a renamed derivative of
it. See the [font license checklist](projects/pacyfist/veneer/README.md#font-license-checklist).

## Documentation

- **[Library reference](projects/pacyfist/veneer/README.md)**: every option and
  API, server rendering, recipes (lazy routes, `@defer`, rich text, CSP, layout
  shift), where plaintext still leaks, accessibility, error codes, support policy.
  This is the single source of truth; the demo site mirrors it.
- **[THREAT_MODEL.md](THREAT_MODEL.md)**: who veneer stops, who it doesn't, and the
  measured attack matrix.
- **[SECURITY.md](SECURITY.md)**: how to report a vulnerability, and what counts
  as one.
- **[CHANGELOG](projects/pacyfist/veneer/CHANGELOG.md)** and
  **[ROADMAP.md](ROADMAP.md)**.

## Repository layout

| Path                       | What                                         |
| -------------------------- | -------------------------------------------- |
| `projects/pacyfist/veneer` | The library, published as `@pacyfist/veneer` |
| `projects/demo`            | The showcase site on GitHub Pages            |
| `e2e`                      | Playwright checks against the built site     |
| `examples/basic-ssr`       | Consumer app installed from the npm tarball  |

```bash
npm install
npm start            # demo at http://localhost:4321
npm test             # library unit tests
npm run build:pages  # static site in dist/demo/browser
npm run e2e          # Playwright (Chromium, Firefox, WebKit) against that build
npm run check:package   # npm pack + publint + arethetypeswrong (after build:lib)
npm run api:check       # public API against projects/pacyfist/veneer/api/
npm run example:smoke   # install that tarball into examples/basic-ssr and test it
```

Releases are cut by [release-please](https://github.com/googleapis/release-please):
merging its release PR bumps `projects/pacyfist/veneer/package.json`, updates the
library [CHANGELOG](projects/pacyfist/veneer/CHANGELOG.md), tags `vX.Y.Z`, and
starts `publish.yml`, which publishes only after the full validate run passes.
The workspace root `package.json` is private and unversioned. The next release
is pinned to 0.1.0 by `release-as` in `release-please-config.json`, because it
carries breaking changes; remove that line once 0.1.0 is out, or every later
release PR proposes 0.1.0 again.

## License

[AGPL-3.0-only](LICENSE).
