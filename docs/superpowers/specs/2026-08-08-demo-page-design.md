# Design: the no-ai demo page

Date: 2026-08-08
Status: approved, not implemented

## Problem

The demo page has been torn down. Its nine section components, their unit tests,
the Playwright suite and every earlier spec are deleted. What remains is a shell:
`app.html` with a single protected paragraph, `app.config.ts` wired to
`provideNoAi`, and `font-source.ts` fetching the base font once per page load.

The page that was removed failed on two counts, stated by the project owner:
it did not look like a product page anyone would want to read, and it did not
demonstrate the library's features correctly. The earlier design work is
explicitly out of scope as an influence. This spec starts from the library's
feature surface and the question a visitor actually arrives with.

## Governing principle

**A demonstration is correct when the visitor's own action, or their own
browser, produces the evidence.** Two strings printed side by side prove
nothing, because a sceptic assumes we typed the second one. Every section below
is chosen so the proof happens in front of the visitor: their clipboard, their
`Ctrl+F`, their browser's response to a real HTTP request, a control they turn
themselves.

This rules out the most common failure mode of a page like this, which is
asserting in prose what the library does and illustrating it with static
examples.

## Visual direction

Chosen from three mockups: a type-specimen treatment, a dark instrument
treatment, and an editorial treatment. The instrument direction won.

The page reads as a diagnostic tool rather than marketing: monospace for
anything machine-side, a teal `primary`, panel structure, small uppercase
labels, live readouts. It is aimed at a sceptical developer, and it looks like
evidence rather than a pitch.

**Built from stock daisyUI components, not bespoke CSS.** daisyUI 5.7.16 is
already a dependency and already themed. The mapping:

| Purpose                  | Component                                  |
| ------------------------ | ------------------------------------------ |
| Panel with a label strip | `card`, `card-title`, `badge`              |
| Code sample              | `mockup-code` with line prefixes           |
| The served HTML          | `mockup-browser` wrapping `mockup-code`    |
| Header telemetry         | `stats`, `stat-value`, `stat-desc`         |
| The three template APIs  | `tabs`, with a fourth warning-coloured tab |
| Config knobs             | `select`, `range`, `toggle`, `checkbox`    |
| AGPL warning             | `alert alert-warning`                      |
| Keyboard instruction     | `kbd`                                      |
| Cipher table             | `table table-zebra`                        |

`mockup-browser` around `mockup-code` is doing real work rather than decoration:
section 03 claims the served HTML is scrambled, and the component shows that
HTML arriving from a URL with a `200` on it.

### Layout and theme

- Content capped at `max-w-5xl` (1024px) and centred, so the page does not
  stretch on a wide monitor. The approved mockup was drawn at 920px; the extra
  104px does not change the layout, and `max-w-5xl` is the value to implement.
- Themes stay as `styles.css` declares them today: `light --default,
dark --prefersdark`, plus a toggle in the navbar. The page follows the
  visitor's preference. The instrument character survives in the monospace, the
  teal accent and the panel rhythm rather than in darkness.
- Protected text renders in Roboto, because the forged font is built from
  Roboto outlines and a mismatch is visible. Machine-side readouts render in a
  monospace stack. This is not an inconsistency: ciphertext readouts are
  deliberately unprotected, since showing the raw characters is their entire
  purpose.

## Page structure

Nine sections, one route, anchor navigation in the navbar.

### 01 Hero: the mirror

Two panels: the paragraph as rendered, and a live readout of its `innerText`.
Below them, a text input, and a toggle that withholds the forged font.

Demonstrates the core mechanism, `NoAiFontService.revealed`, and live
scrambling. Chosen as the hero over a copy-to-clipboard prompt and a
view-source panel because it requires no instruction and no action: the gap is
simply on screen when the page loads, and the input turns it into a toy within
seconds.

A `stats` row carries seed, glyphs forged, fixed points (always `0`) and status.

### 02 The cipher

The substitution table in force, as a zebra table. Reload and every pair
changes.

Demonstrates `buildScrambleMap`, the derangement guarantee, and why the space
character is excluded. Runs on its own client-side instance (see
**Architecture**), because the shell's seed is fixed at build time.

### 03 At the source

The page fetches its own served HTML from this origin and shows the specimen
paragraph as it exists in the response body, inside a `mockup-browser`.

Demonstrates SSR scrambling, the `data-no-ai-ssr` marker, and that hydration
does not scramble already-scrambled text a second time. This is the page's
strongest evidence, because the bytes come from the server rather than from us.

### 04 Three ways to apply it

Four tabs. `<p noAi>`, `[noAi]="expr"`, `{{ x | noAi }}` with `noAiFont`, and a
fourth tab that puts `noAi` on an interpolated element so the directive and the
binding fight over `textContent` in view.

Demonstrates the entire template surface. Each tab runs live with its own
`innerText` readout underneath, so the visitor sees which forms protect and
which do not. The fourth tab exists because the README's documented trap is
better watched than warned about.

### 05 The bench

Config knobs on one side, a live isolated instance on the other.

Demonstrates `charset`, `seed`, `hideUntilReady`, `fallbackFontFamily` and
`disabled`, plus charset passthrough: accented characters and emoji render
untouched while ASCII scrambles.

### 06 When it breaks

Three controls that genuinely break the library rather than describing
breakage: kill the font fetch, request a charset the base font cannot cover,
and replay the load with `hideUntilReady` off.

Demonstrates fail-open behaviour, `NoAiFontError` and its `missing` list, and
the flash of gibberish. The point of the section is that the page stays usable
in all three cases.

### 07 What it costs you

Four panels: find-in-page, screen reader, clipboard, and missing kerning.

The visitor presses `Ctrl+F` and searches a word they can plainly see. They
copy the specimen and the page shows what landed on their clipboard. The screen
reader panel shows the exact announced string. The kerning panel sets `AV` and
`To` at display size, forged against base.

Wording comes from the README so the two cannot drift, closing on: protect
article bodies, leave navigation and anything assistive technology needs alone.

### 08 Beyond Angular

The framework-free core: `buildScrambleMap`, `scrambleText`,
`invertScrambleMap`, shown as a Node snippet with its round trip.

### 09 Take it

Install command, peer ranges, base font format constraint, SSR support, and the
AGPL §13 warning stated plainly enough to produce a fast no.

## Architecture

Two kinds of `NoAiFontService` live on the page, and keeping them distinct is
the whole architecture.

**The shell's instance**, from `provideNoAi` in `app.config.ts`. It protects the
SSR-rendered specimen. The GitHub Pages build is `outputMode: static`, so its
seed is baked at build time and is identical for every visitor.

**Per-section child instances.** Sections 02, 04, 05 and 06 each demonstrate a
different configuration and must not disturb one another or the shell. Each gets
its own `EnvironmentInjector` carrying its own `provideNoAi`, created
client-side, drawing its own fresh seed. A component instantiated inside that
injector resolves its `NoAiFontService` rather than the shell's.

This pattern is not new to the project. The deleted `config-card.ts` used it,
and its approach is kept.

### Components

| Component                 | Owns                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `App`                     | navbar, theme toggle, width container, section order                |
| `ui/section-heading`      | number, title, rule                                                 |
| `ui/mirror-panel`         | the rendered-vs-`innerText` pair, reused in 01, 04, 05              |
| `ui/code-block`           | `mockup-code` wrapper                                               |
| `ui/isolated-instance`    | builds a child injector from a config, renders a specimen inside it |
| `sections/hero-mirror`    | 01, the withhold toggle, the text input                             |
| `sections/cipher-table`   | 02                                                                  |
| `sections/served-source`  | 03                                                                  |
| `sections/apply-tabs`     | 04                                                                  |
| `sections/bench`          | 05                                                                  |
| `sections/breakage`       | 06                                                                  |
| `sections/costs`          | 07                                                                  |
| `sections/beyond-angular` | 08                                                                  |
| `sections/take-it`        | 09                                                                  |

One job per component. `ui/isolated-instance` exists so that the injector
mechanics are written once rather than four times.

## Error handling

The library fails open by design, so the page's job is to make that visible
rather than to hide it. `failed()` drives the status stat in the header, and
section 06 triggers the failure deliberately.

Two failures belong to the page rather than the library:

- **The section 03 fetch** can fail when the page is offline or opened from
  `file://`. It degrades to a plain message explaining what could not be
  fetched. The section does not fabricate a sample response.
- **Clipboard reads** can be denied by permission. Section 07 falls back to a
  paste box the visitor pastes into themselves, which is equally convincing.

Neither failure takes the page down.

## Accessibility

`aria-hidden` is applied to a protected specimen **only when that instance is
actually ciphering**. A disabled or failed instance renders ordinary readable
text, and hiding that from assistive technology would impose the cost of the
library without any of its protection.

Every protected specimen is paired with a description that assistive technology
can reach, describing what the specimen is without reproducing its plaintext.

## Disclosures

The project owner chose to disclose the page's weaknesses rather than engineer
around them. Three statements appear on the page:

1. **Section 01** states that the default specimen also ships readable in
   `main-*.js`, because Angular compiles template text into the bundle, and
   that demo copy was never the thing being protected. The evidence that
   matters is the served HTML in section 03.
2. **Section 02** states that the page's own cipher is fixed at build time
   because the site is prerendered, and that the table above it runs a separate
   client-side instance to show what a per-load cipher looks like.
3. **Section 07** takes its wording from the README, so the page and the README
   cannot drift on the library's costs.

Disclosure was chosen over two alternatives: making the visitor's typed text the
only real specimen, and pre-scrambling the specimen in a build script so no
plaintext ships. The build-script option would have made section 08
self-demonstrating, but it couples the script to the prerender seed and fails
quietly when the two drift.

## Out of scope

**Tests.** The demo gets no new unit specs, the Playwright suite stays deleted,
and the CI deploy gate is not restored. This is a deliberate decision by the
project owner for this round of work, not an oversight. The library's own vitest
suite is untouched and unaffected.

## Known risks

- **The seed is fixed on the deployed site.** Section 02's client-side instance
  makes a per-load cipher visible, but the page's own specimen still uses one
  seed for every visitor. Disclosure 2 covers this. It would only be fully
  resolved by serving the demo from a Node SSR process rather than GitHub Pages.
- **Nine sections is a long page.** Anchor navigation in the navbar mitigates
  it, and the hero carries the whole argument for a visitor who reads nothing
  else.
- **Section 03 depends on same-origin fetch.** It works on GitHub Pages and on
  `ng serve`. It cannot work from `file://`, which the error path handles.
