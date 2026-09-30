/*
 * Public API Surface of @pacyfist/veneer
 */

// Setup
export { provideVeneer, VENEER_CONFIG } from './lib/veneer.config';
export type { VeneerConfig, VeneerFontSource, ResolvedVeneerConfig } from './lib/veneer.config';

// Template pieces
export { VeneerDirective } from './lib/veneer.directive';
export { VeneerFontDirective } from './lib/veneer-font.directive';
export { VeneerPipe } from './lib/veneer.pipe';

// Runtime state: font readiness, failures, and the reveal toggle
export { VeneerFontService } from './lib/veneer-font.service';

// The framework-free core, exported so the cipher can be reused outside Angular
// — pre-scrambling static content in a build script, for example.
export {
  DEFAULT_CHARSET,
  buildScrambleMap,
  invertScrambleMap,
  randomSeed,
  scrambleText,
} from './lib/scramble-map';
export type { ScrambleMap } from './lib/scramble-map';
export { VeneerFontError, forgeScrambledFont, parseBaseFont } from './lib/font-forge';
