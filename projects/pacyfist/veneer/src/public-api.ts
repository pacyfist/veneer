/*
 * Public API Surface of @pacyfist/veneer
 */

// Setup
export {
  provideVeneer,
  withStatusAttribute,
  withStatusListener,
  VENEER_CONFIG,
} from './lib/veneer.config';
export type {
  VeneerConfig,
  VeneerFeature,
  VeneerFeatureKind,
  VeneerFontSource,
  ResolvedVeneerConfig,
} from './lib/veneer.config';

// Template pieces
export { VeneerDirective } from './lib/veneer.directive';
export { VeneerFontDirective } from './lib/veneer-font.directive';
export { VeneerPipe } from './lib/veneer.pipe';

// Runtime state: font readiness, failures, and the reveal toggle
export { VeneerFontService } from './lib/veneer-font.service';
export type { VeneerFontState } from './lib/veneer-font-state';
export type {
  VeneerFailure,
  VeneerFailureCode,
  VeneerStatus,
  VeneerStatusEvent,
  VeneerStatusListener,
} from './lib/veneer-status';

// The framework-free core, also published on its own as `@pacyfist/veneer/core`
// so it can be used outside Angular without pulling in `@angular/core`.
export * from '@pacyfist/veneer/core';
