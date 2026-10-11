/*
 * Public API Surface of @pacyfist/veneer/core
 *
 * The framework-free cipher. The font forge is `@pacyfist/veneer/forge`. Nothing here imports Angular, so it
 * runs in plain Node — pre-scrambling static content in a build script, for
 * example. The main entry point re-exports all of it.
 */

export {
  DEFAULT_CHARSET,
  buildScrambleMap,
  invertScrambleMap,
  isScramblable,
  randomSeed,
  scrambleText,
} from './scramble-map';
export type { ScrambleMap, ScrambleTextOptions } from './scramble-map';
export { LATIN_1, LATIN_EXT_A, charsetFromText } from './charsets';
export type { CharsetFromTextOptions } from './charsets';
export { charsetFromFont } from './charset-from-font';

// The font forge (parseBaseFont, forgeScrambledFont, coveredCodepoints,
// VeneerFontError) is its own entry point, `@pacyfist/veneer/forge`, and is
// deliberately not re-exported here: a static re-export would pull it into
// every app's initial bundle through the main entry point, which re-exports
// this one. The Angular service loads it with a dynamic import instead.
