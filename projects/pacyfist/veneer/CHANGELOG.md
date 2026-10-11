# Changelog

All notable changes to `@pacyfist/veneer` are recorded here. From 0.0.3 on,
release-please writes this file from Conventional Commits that touch
`projects/pacyfist/veneer`. The 0.0.1 and 0.0.2 entries were backfilled from
git history.

While the version is 0.0.x, every release may break your code: a caret range
such as `^0.0.2` only matches that exact version.

## [0.0.2](https://github.com/pacyfist/veneer/compare/d213f6b...v0.0.2) (2026-09-30)

### Features

- support Angular 20, 21 and 22: the peer dependency ranges for
  `@angular/core` and `@angular/common` are now `^20.0.0 || ^21.0.0 || ^22.0.0`
  instead of `^21.2.0`, and the published package is built with Angular 20,
  the oldest supported major ([3f1b59e](https://github.com/pacyfist/veneer/commit/3f1b59e))

## 0.0.1 (2026-09-30)

First release on npm. The library was developed as `no-ai` and renamed to
`@pacyfist/veneer` before publishing ([f5634dd](https://github.com/pacyfist/veneer/commit/f5634dd)).

### Features

- `veneer` directive, `veneerFont` directive, `veneer` pipe and
  `provideVeneer()`: text is scrambled in the DOM and drawn readable by a font
  forged at runtime with opentype.js, with server-side rendering and hydration
  support ([f86b505](https://github.com/pacyfist/veneer/commit/f86b505))
- the package ships its LICENSE file ([d213f6b](https://github.com/pacyfist/veneer/commit/d213f6b))

### Bug Fixes

- stop double scrambling static text on hydration ([77039dc](https://github.com/pacyfist/veneer/commit/77039dc))
- only publish the implicit seed to transfer state ([7f4f19d](https://github.com/pacyfist/veneer/commit/7f4f19d))
- remove the registered font face when the service is destroyed ([012eefb](https://github.com/pacyfist/veneer/commit/012eefb))

### Documentation

- license is AGPL-3.0-only ([f611226](https://github.com/pacyfist/veneer/commit/f611226))
- rewrite the library README ([11145d3](https://github.com/pacyfist/veneer/commit/11145d3))
