/*
 * Public API Surface of @pacyfist/veneer
 */

// Setup
export {
  provideVeneer,
  withFaces,
  withStatusAttribute,
  withStatusListener,
} from './lib/veneer.config';
export type {
  VeneerConfig,
  VeneerFace,
  VeneerFeature,
  VeneerFeatureKind,
  VeneerFontSource,
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

// Internal. Exported only for `@pacyfist/veneer/testing`; not covered by
// semver and may change in any release.
export { VENEER_CONFIG as ɵVENEER_CONFIG } from './lib/veneer.config';
export type { ResolvedVeneerConfig as ɵResolvedVeneerConfig } from './lib/veneer.config';

// Internal. Exported only for `@pacyfist/veneer/server`; not covered by
// semver and may change in any release.
export { VENEER_SERVER_FORGE as ɵVENEER_SERVER_FORGE } from './lib/veneer-server';
export type {
  VeneerServerCipher as ɵVeneerServerCipher,
  VeneerServerForge as ɵVeneerServerForge,
} from './lib/veneer-server';
