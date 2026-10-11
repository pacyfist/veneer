/*
 * Public API Surface of @pacyfist/veneer/core
 *
 * The framework-free cipher and font forge. Nothing here imports Angular, so it
 * runs in plain Node — pre-scrambling static content in a build script, for
 * example. The main entry point re-exports all of it.
 */

export {
  DEFAULT_CHARSET,
  buildScrambleMap,
  invertScrambleMap,
  randomSeed,
  scrambleText,
} from './scramble-map';
export type { ScrambleMap } from './scramble-map';
export { VeneerFontError, forgeScrambledFont, parseBaseFont } from './font-forge';
