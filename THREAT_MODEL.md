# veneer threat model

veneer raises the cost of reading a page's text without looking at it. It is a
speed bump for bulk scraping, not encryption and not access control. This
document says who it slows down, who it does not, and what each bypass costs.
The numbers come from the adversary suite in [`e2e/adversaries/`](e2e/adversaries/README.md),
which runs real attacks against the built demo on every CI run.

## How the protection works, in one paragraph

Protected text is stored in the DOM as a substitution cipher: each letter is
swapped for another letter, each digit for another digit, and so on. A font
forged from your normal font draws each swapped codepoint with the glyph of the
original character, so people read the real words. With server rendering and
`provideVeneerServer()`, the server draws the cipher from the CSPRNG (or derives
it from a server-side `secret`), forges the font, and writes ciphertext into the
HTML. The page carries only the forged font's URL. There is no seed and no map
in the HTML. **The forged font is the key**: anyone who has it and the public
base font can read the cipher out of their `cmap` tables.

## What is protected, and for how long

| Deployment                            | Cipher lifetime                                               | Key in the HTML?                     |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------------------ |
| SSR with `provideVeneerServer()`      | One per server process and `provideVeneer` config             | No, only the forged font's URL       |
| Prerendered (SSG)                     | One per build, shared by every visitor until the next build   | No, only the forged font's URL       |
| SSR or SSG with a `secret`            | One per secret, base font and config, across processes/builds | No, only the forged font's URL       |
| Client-only rendering (no SSR)        | One per page load, drawn in the browser                       | No text in the HTML at all           |
| SSR, `shouldProtect` returned `false` | None for that response: rendered **readable** on purpose      | Not applicable, the text is readable |
| SSR without `provideVeneerServer()`   | None: protected text is rendered **readable** (VNR015)        | Not applicable, the text is readable |
| Any setup with a fixed `seed`         | Fixed. The seed is in the JS bundle and 32 bits is searchable | Effectively yes                      |

Only the text of elements marked with `veneer`, `[veneer]`, `[veneerHtml]` or
the `veneer` pipe is protected. Everything else on the page, and every copy of
the same text elsewhere, is outside veneer's reach (see
[Where plaintext still leaks](projects/pacyfist/veneer/README.md#where-plaintext-still-leaks)).

## Adversary tiers

| Tier                                | What they run                                                                          | What they get                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Generic crawler                  | One GET and an HTML parser. No JavaScript, no knowledge of veneer                      | **Blocked** for protected text in the served HTML. Gets every unprotected channel: title, meta and OG tags, JSON-LD, `alt` and `aria-label`, the HttpClient transfer cache          |
| 1'. Generic crawler that follows JS | The same, plus downloading the `<script src>` files as text                            | **Every compile-time string**: `<p veneer>Text</p>`, `signal('...')`, constants. Angular compiles them into the bundle. Only text that arrives at runtime (an API, a CMS) stays out |
| 2. Veneer-aware crawler             | HTTP, an HTML parser and a font parser. Downloads the forged and the base font         | **Everything protected.** Inverting the two `cmap` tables takes about 15 lines (`font-fetch.spec.ts`). On SSG the font is parsed once per build                                     |
| 3. Headless browser with hooks      | A real browser, a `FontFace` hook and a font parser                                    | **Everything protected**, in about 56 lines including glue (`font-hook.spec.ts`). Once JavaScript runs, the forged font is in memory                                                |
| 4. OCR or a vision model            | A headless browser, screenshots and an OCR engine or vision LLM                        | **Everything on screen.** The pixels are correct by design. Costs rendering plus inference per page                                                                                 |
| 5. A person targeting one site      | Any of the above, plus reading the page, readable mode, copy with `withReadableCopy()` | **Everything.** veneer does not try to stop a person who wants one site's text                                                                                                      |

Also feasible without any of the above: a **classic substitution solver** on the
ciphertext alone. veneer keeps spaces, word lengths and punctuation classes, so a
solver or an LLM breaks a long passage. This matters little while tier 2 is
cheaper.

## One-time generic bypass versus per-site effort

The two kinds of attacker cost behave very differently:

- **One-time generic bypass.** Tiers 2 and 3 are written once and then work on
  every site that uses veneer, because every site has the same structure: the
  forged font's URL in `ng-state` under `veneer`, the base font URL in the bundle
  or the CSS. Once a scraping framework ships a veneer decoder, every veneer site
  falls to it at almost no extra cost. Nothing in veneer makes that decoder
  harder to write per site.
- **Per-site effort.** What a decoder needs to know about your site in
  particular is close to nothing today: where your base font is. Changing the
  font, the charset or the cipher per build does not change that.

So **veneer works best while few sites use it.** A crawler operator collecting
text from millions of sites will not write and maintain a decoder for a
technique a handful of them use: the text they lose is not worth the effort.
That calculation changes as adoption grows. Plan for the day a generic decoder
exists, and treat veneer as one layer next to robots.txt, AI-preference signals
and bot management (see
[Where veneer fits](projects/pacyfist/veneer/README.md#where-veneer-fits)).

## `shouldProtect`: a deliberate bypass

On dynamic SSR, `provideVeneerServer({ shouldProtect })` can render a page
readable for some requests, typically search crawlers verified with
`verifyCrawler()` (reverse DNS, then forward DNS back to the same IP). That is a
bypass by design, so it is attack surface:

- **Spoofing the check.** The user agent proves nothing; the DNS round trip is
  what counts. An attacker who controls the client IP the server sees gets
  readable pages: behind a proxy or CDN, `trust proxy` must trust exactly your
  proxies, or a forged `X-Forwarded-For` header is enough.
- **Your own hook.** Whatever the app's `shouldProtect` returns `false` for gets
  readable text. A hook keyed on a header, a cookie or the user agent is as weak
  as that signal.
- **The crawler's operator.** Text served readable to a verified crawler is plain
  text to whoever runs it, for search and for anything else they do with it.
- **Fails closed.** A hook that throws or rejects renders the page protected
  (VNR017). Prerendered pages never call the hook.

## Attack matrix

Measured by the adversary suite on the prerendered demo, Chromium 151 and
Firefox 153, 2026-10-11, after the key left the HTML. Each attack records its
cost (lines between `// attack:begin` and `// attack:end`, and wall time) as a
test annotation. Source: [`e2e/adversaries/README.md`](e2e/adversaries/README.md).

| Attacker                                                   | Spec                  | Cost                                 | Result                                                                                                                          |
| ---------------------------------------------------------- | --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| (a) Generic crawler: GET + HTML parser                     | `plain-fetch.spec.ts` | 5 lines, about 1 s                   | **Blocked** for every protected element. Gets only what the demo itself prints in the clear (a code sample, an `<input value>`) |
| (a') Crawler that also downloads the page's JS as text     | `../leaks.spec.ts`    | A few more lines                     | **Succeeds** for all 9 demo specimens: each is a compile-time string in `main-*.js`                                             |
| (b) Veneer-aware crawler: regex a seed, `buildScrambleMap` | `seed-regex.spec.ts`  | 15 lines, under 1 s                  | **Blocked.** There is no seed in the page; trying every integer in the page and the family name also fails                      |
| (c) Headless browser + `FontFace` hook + cmap inversion    | `font-hook.spec.ts`   | 56 lines, 1-2 s                      | **Succeeds**: every specimen, across all forged fonts on the page                                                               |
| (d) Font-aware crawler: download both fonts, no JS         | `font-fetch.spec.ts`  | 15 lines, about 1-2 s                | **Succeeds.** This is the bar: a font parser and two downloads instead of a regex                                               |
| Brute force of a seed                                      | not automated         | About 225 bits for the letters alone | **Infeasible** by default; trivial with a fixed `seed`                                                                          |
| Ciphertext-only substitution solver                        | not automated         | Off-the-shelf                        | **Feasible** on long passages                                                                                                   |
| OCR or a vision model on a screenshot                      | not automated         | Rendering + inference                | **Succeeds** by design                                                                                                          |

## What veneer does not try to defend

- Content that must stay secret. Use authentication.
- Text outside protected elements, and copies of protected text the app puts
  elsewhere (meta tags, JSON-LD, the transfer cache, attributes, form values).
- Text written in your source code, which ships in your JS bundles.
- A reader who renders the page: a browser, a screenshot, a person.

## Reporting a problem

What counts as a vulnerability, and what is one of the documented limitations
above, is in [SECURITY.md](SECURITY.md).
