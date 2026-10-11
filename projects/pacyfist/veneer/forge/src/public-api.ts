/*
 * Public API Surface of @pacyfist/veneer/forge
 *
 * The font forge: parse a base font and produce the font that undoes the
 * cipher. Framework-free and dependency-free. It is its own entry point so the
 * Angular service can load it with a dynamic import, keeping it (and WOFF
 * decoding) out of an app's initial bundle. `@pacyfist/veneer/core`
 * re-exports all of it.
 */

export {
  VeneerFontError,
  coveredCodepoints,
  forgeScrambledFont,
  parseBaseFont,
} from './font-forge';
export type { BaseFont, ForgeMap } from './font-forge';
