# Security policy

veneer makes bulk scraping of page text more expensive. It is not encryption and
not access control, and some attacks on it are expected to succeed. Read
[THREAT_MODEL.md](THREAT_MODEL.md) first: it lists who veneer stops and who it
does not, with measured costs.

## Supported versions

veneer is pre-1.0. Security fixes go into the latest `0.x` release only. Upgrade
to it to get a fix.

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting:

**https://github.com/pacyfist/veneer/security/advisories/new**

Please do not open a public issue, pull request or discussion for a
vulnerability. Include the veneer and Angular versions, whether the page is
server-rendered, prerendered or client-only, the browser if it matters, and the
smallest page or script that shows the problem.

veneer has one maintainer, so handling is best effort. You will get an answer in
the advisory thread, and a fix is released as a patch with a GitHub security
advisory. Credit is given in the advisory unless you ask otherwise.

## What counts as a vulnerability

A break of something veneer claims to do. For example:

- **Key material in the served HTML.** A seed, a scramble map, or anything else
  that decodes protected text, appearing in the server-rendered or prerendered
  HTML (including `ng-state`/`TransferState`) when `provideVeneerServer()` is in
  use and the app sets no fixed `seed`.
- **Plaintext in the served HTML.** The readable text of a protected element
  appearing anywhere in the server-rendered or prerendered HTML while the
  server reports success, except through the channels listed as limitations
  below.
- **A predictable cipher.** A cipher that is not drawn from the CSPRNG when no
  `seed` is set, or one that repeats across server processes or builds.
- **Silent fail-open.** Protection switching off, or readable text reaching a
  protected element in the browser, without `status()` becoming `failed` or
  `disabled` and without an error being logged (other than readable mode and
  the documented interpolation mistake, [VNR001](projects/pacyfist/veneer/README.md#vnr001)).
- **Ordinary web vulnerabilities in veneer's code.** Script injection through
  `[veneerHtml]` (it must sanitize like `[innerHTML]`), path traversal or
  arbitrary file reads through `veneerFontMiddleware()` or the server's font
  reader, or a crafted font that crashes or hangs the server or the browser tab.

## What is a documented limitation, not a vulnerability

These are known and described in the threat model and the README. Reports of
them are welcome as documentation improvements, but they are not
vulnerabilities:

- **Font capture.** Downloading the forged font and the public base font, or
  hooking `FontFace` in a headless browser, recovers the cipher. The forged font
  is the key once a client has it.
- **OCR and vision models.** The pixels on screen are correct by design.
- **Compile-time text in JS bundles.** Text written in your templates or code
  (`<p veneer>Text</p>`, `signal('...')`, constants) ships readable in your
  JavaScript. Only text that is not in the source keeps plaintext out of the
  bundle.
- **Substitution cryptanalysis.** veneer is a one-to-one substitution that keeps
  spaces and word lengths. A solver or an LLM can break long passages from the
  ciphertext alone.
- **Side channels the app creates.** The same text in meta and OG tags, JSON-LD,
  the page title, `alt`/`aria-label`/`title` attributes, form values, the
  HttpClient transfer cache, or quoted elsewhere on the page.
- **Shared ciphers.** One cipher per build on prerendered sites, and one per
  server process and config with `provideVeneerServer()`.
- **Choices the app makes.** A fixed `seed`; rendering without
  `provideVeneerServer()` (protected text is then served readable and VNR015 is
  logged); readable mode and `withReadableCopy()`, which hand out readable text
  on purpose; CFF (`.otf`) base fonts keeping glyph names in the `CFF` table.
- **Accessibility and SEO costs** described in the README.

If you are unsure which side a finding falls on, report it privately anyway.
