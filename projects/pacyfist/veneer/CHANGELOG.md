# Changelog

All notable changes to `@pacyfist/veneer` are recorded here. From 0.0.3 on,
release-please writes this file from Conventional Commits that touch
`projects/pacyfist/veneer`. The 0.0.1 and 0.0.2 entries were backfilled from
git history.

While the version is 0.0.x, every release may break your code: a caret range
such as `^0.0.2` only matches that exact version.

## [0.1.0](https://github.com/pacyfist/veneer/compare/v0.0.2...v0.1.0) (2026-10-14)


### Features

* **a11y:** add readable mode with a toggle, withA11y hide, withReadableCopy and axe checks ([8dba9ae](https://github.com/pacyfist/veneer/commit/8dba9aead78b5beda386139685c39139352e6d37))
* **core:** add framework-free @pacyfist/veneer/core entry point ([b5bbd43](https://github.com/pacyfist/veneer/commit/b5bbd43b0b9f3996cd2c455fc400469c11c12282))
* **core:** add latin presets, charsetFromText and nfc normalization ([372e689](https://github.com/pacyfist/veneer/commit/372e689ef309caa0c2762d738cc5fb4b915d0391))
* **core:** derange within line-break classes so protected text wraps like plain text ([030d6a4](https://github.com/pacyfist/veneer/commit/030d6a483f2703cff2ebb63eec994c0fb2558354))
* **core:** forge by replacing only the cmap, add coverage helpers and woff input, drop opentype.js ([8fdfca6](https://github.com/pacyfist/veneer/commit/8fdfca6c19910fbde9a95e36acb091b8ccef4e34))
* **demo:** forge the font at build time, serve it as a static file, and test that no seed reaches the html ([e48225f](https://github.com/pacyfist/veneer/commit/e48225f289376f0e46e843def5423bbea3a892de))
* **demo:** show [veneerHtml] sanitizing cms html, and that veneer-skip survives only in safehtml ([01767dd](https://github.com/pacyfist/veneer/commit/01767dd4bb94d9aee07b4fde60f98354cfb326a9))
* **directive:** hide server text with a switchable style rule instead of inline visibility, support csp nonces and mark protected text notranslate ([03ba945](https://github.com/pacyfist/veneer/commit/03ba945d94de8f1cf36e5a225230a06f12e8f795))
* **directive:** walk text nodes so markup inside veneer survives, add veneerHtml and fix the empty binding ([54f93d4](https://github.com/pacyfist/veneer/commit/54f93d41596120b6a664752d3604b0d31ffcfeeb))
* **directive:** warn in dev mode about interpolation inside veneer, pipe output outside veneerFont and case-changing css ([1a9b221](https://github.com/pacyfist/veneer/commit/1a9b22158f6d52f3a645909701d4e8bd1c9fcfd7))
* **server:** add a per-request shouldProtect hook for dynamic ssr ([83ff098](https://github.com/pacyfist/veneer/commit/83ff0984ae8d88fcd43ebe33e24dd42bc4176e9e))
* **server:** add verifyCrawler to check search crawlers by reverse and forward dns ([c5cb6a5](https://github.com/pacyfist/veneer/commit/c5cb6a57ca49c907606d89e53e6aac00dc0f6189))
* **server:** forge the font on the server and read the cipher back from it in the browser, so no seed reaches the html ([73fb8f3](https://github.com/pacyfist/veneer/commit/73fb8f3a9a7b4a217820723360591ce5024b1514))
* **service:** add strictCoverage, drop characters the font lacks and re-scramble with a narrowed map ([7d0c6a6](https://github.com/pacyfist/veneer/commit/7d0c6a6ff433fd898b90c944e1b75ba07161bcd9))
* **service:** add withFaces for bold and italic faces under one forged family, and an id that namespaces the transferred seed ([10ee2ff](https://github.com/pacyfist/veneer/commit/10ee2ffacecd6b2c653f5624e6161f31204b747a))
* **service:** report failures as structured codes, add status listener and html status attribute features ([8a20137](https://github.com/pacyfist/veneer/commit/8a20137faf63ba400a1c531f0e62487e9cc5c2e7))
* **service:** share one font fetch and parse per page, name the url in fetch errors and explain a missing provideVeneer ([7fec913](https://github.com/pacyfist/veneer/commit/7fec9133f3723da08e9337cb0b83430d89b7ac0d))
* **testing:** add @pacyfist/veneer/testing entry point and move directive spec onto it ([459e2eb](https://github.com/pacyfist/veneer/commit/459e2ebf962c02d43b915e1dcbc7e9e560ff6453))
* **testing:** add findVeneerLeaks to report readable protected text ([af33fb0](https://github.com/pacyfist/veneer/commit/af33fb08e1fded2068fc3e85ad3aa12ae332f6b7))


### Bug Fixes

* **core:** report malformed font tables as veneer font errors ([340f248](https://github.com/pacyfist/veneer/commit/340f24804ff95acb5dd54b5595b7716f65d698ff))
* **demo:** keep font urls stable across builds with an optional secret, and carry the live site's fonts into each deploy ([ba30a79](https://github.com/pacyfist/veneer/commit/ba30a79517b9a8066d2f4ae31bdfe0aec4c736c7))
* **demo:** keep fonts retired by earlier deploys for a day, listed in veneer-fonts.json ([a06cfd5](https://github.com/pacyfist/veneer/commit/a06cfd5e28b801429ca1709744ae749de35e7aa7))
* **demo:** reword an faq answer that quoted a protected specimen, and record the server bundle size ([a628680](https://github.com/pacyfist/veneer/commit/a6286808d72b6f3629bf9e9d311ec6f6ea072d4d))
* **dev:** match vnr002 pipe output as whole words, skip short output, and warn only when no match is protected ([2a1ae5b](https://github.com/pacyfist/veneer/commit/2a1ae5b8774f8dcaeee01a888e546ed12397cfd1))
* **directive:** accept class="veneer-skip", which survives the html sanitizer ([b6986a8](https://github.com/pacyfist/veneer/commit/b6986a81bec1f6f0c921ced1f10fe90d348c59de))
* **package:** declare type module so the angular 20 build ships esm types ([d805597](https://github.com/pacyfist/veneer/commit/d8055970f7a2f994c13dfa09bb5b85db1e92fd87))
* **server:** accept only googlebot.com for googlebot, not google.com fetchers and proxies ([c81a5db](https://github.com/pacyfist/veneer/commit/c81a5dbe0b2474762d9ac680431e41336be55bae))
* **server:** derive the cipher, family and font ids from an optional secret, and serve fonts from a shared emitdir ([95d5368](https://github.com/pacyfist/veneer/commit/95d53689d83b44c38d84a802bf7434490afe6979))
* **server:** evict forged fonts together with their cipher, least recently used first, and count the cap in fonts ([ad02555](https://github.com/pacyfist/veneer/commit/ad0255500e8903a0e3bf1ad3bc5e6e106b592ae4))
* **server:** keep fonts read from the shared folder in a small memory cache ([e8d5de4](https://github.com/pacyfist/veneer/commit/e8d5de40b1627b2288ee6dc17d35e1b91ee50043))
* **server:** share the coverage narrowing and the vnr014 warning with the browser ([21784f5](https://github.com/pacyfist/veneer/commit/21784f5698255bb9bc5abea3c56c62df22a5a11c))
* **service:** log a server-side failure once per process, not on every request ([b075ca7](https://github.com/pacyfist/veneer/commit/b075ca7156311f387f36a7969afd674b2df469b4))
* **service:** make ready a read-only signal, as the font state interface declares it ([90effce](https://github.com/pacyfist/veneer/commit/90effcee2886e4a4d9402ed968bdc72dfef59592))
* **service:** report every hydrate failure before the cipher is known as vnr016, retry font and forge requests once, and say when text can stay unreadable ([f8f57c3](https://github.com/pacyfist/veneer/commit/f8f57c3344edc5afd4b307949b23b1e9f5da46d5))
* **service:** send each forged face with its descriptors and hydrate the server's faces whatever the browser config lists, warning vnr018 in dev ([5b1f8b9](https://github.com/pacyfist/veneer/commit/5b1f8b9c5d1595ae14b866e55970fd627cb1191d))
* **service:** share the status attribute between instances, show the most urgent status, and remove it with the last instance ([12067e6](https://github.com/pacyfist/veneer/commit/12067e609a82454139eb59faa6397a27e697badf))
* **service:** stop retrying the forge chunk, which browsers cannot refetch, and check for fonts before loading it ([03309b8](https://github.com/pacyfist/veneer/commit/03309b864d8416ce32846bc2120c8be687413875))


### Performance Improvements

* **forge:** move the forge to its own entry point and load it lazily from the service ([043c843](https://github.com/pacyfist/veneer/commit/043c843d48cbe075beda7433591c7ef39a6c7418))


### Documentation

* add a font license checklist ([3c12bd4](https://github.com/pacyfist/veneer/commit/3c12bd45eba1e33243ab7bd9a176366c39e62be8))
* describe the keyless server model and fix the claims about the seed ([928cf57](https://github.com/pacyfist/veneer/commit/928cf57faa1e9e0b3afee8a48a9ffd7bc05ed3fd))
* document where plaintext still leaks, with transfer cache recipes and a leak test ([60b6f11](https://github.com/pacyfist/veneer/commit/60b6f11e25a73a935e82912108ef77199260224a))
* **forge:** say the forge entry point is not re-exported ([1953638](https://github.com/pacyfist/veneer/commit/1953638cfdf4bc2d67f748e307eb9dd5f2bb031f))
* list the new demo specimens in the leak tables ([fca596d](https://github.com/pacyfist/veneer/commit/fca596ddeefa7b7c57964c234164671e246ea4e7))
* list uncoveredCodepoints in the forge api table ([7b7b3c3](https://github.com/pacyfist/veneer/commit/7b7b3c3f780efe98351b413e09f53f79a3436f29))
* make the library readme the single reference with recipes, and keep the root readme short with a fit check ([e61f25e](https://github.com/pacyfist/veneer/commit/e61f25e089487e8e65850d32dda6f2464bb7d7f5))
* **readme:** show the core and testing entry points ([292510c](https://github.com/pacyfist/veneer/commit/292510c5891ff6d16bd4c3deb7e27f15d1e9001c))
* rewrite the stops table honestly and add a threat model and security policy ([682dac0](https://github.com/pacyfist/veneer/commit/682dac03a0b48b5c7fcf8ffcb556380c30f6194a))
* **server:** add seo guidance on cloaking, paywall markup and ai training ([dee9524](https://github.com/pacyfist/veneer/commit/dee9524824b355be4dd7b871b471ae37d5024057))
* update the attack matrix and config docs for the keyless model ([21c62c2](https://github.com/pacyfist/veneer/commit/21c62c2de9dfefe74b4766dd121e8023a268a6c0))

## [0.0.2](https://github.com/pacyfist/veneer/compare/d213f6b...v0.0.2) (2026-09-30)

### Features

* support Angular 20, 21 and 22: the peer dependency ranges for
  `@angular/core` and `@angular/common` are now `^20.0.0 || ^21.0.0 || ^22.0.0`
  instead of `^21.2.0`, and the published package is built with Angular 20,
  the oldest supported major ([3f1b59e](https://github.com/pacyfist/veneer/commit/3f1b59e))

## 0.0.1 (2026-09-30)

First release on npm. The library was developed as `no-ai` and renamed to
`@pacyfist/veneer` before publishing ([f5634dd](https://github.com/pacyfist/veneer/commit/f5634dd)).

### Features

* `veneer` directive, `veneerFont` directive, `veneer` pipe and
  `provideVeneer()`: text is scrambled in the DOM and drawn readable by a font
  forged at runtime with opentype.js, with server-side rendering and hydration
  support ([f86b505](https://github.com/pacyfist/veneer/commit/f86b505))
* the package ships its LICENSE file ([d213f6b](https://github.com/pacyfist/veneer/commit/d213f6b))

### Bug Fixes

* stop double scrambling static text on hydration ([77039dc](https://github.com/pacyfist/veneer/commit/77039dc))
* only publish the implicit seed to transfer state ([7f4f19d](https://github.com/pacyfist/veneer/commit/7f4f19d))
* remove the registered font face when the service is destroyed ([012eefb](https://github.com/pacyfist/veneer/commit/012eefb))

### Documentation

* license is AGPL-3.0-only ([f611226](https://github.com/pacyfist/veneer/commit/f611226))
* rewrite the library README ([11145d3](https://github.com/pacyfist/veneer/commit/11145d3))
