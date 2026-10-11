/*
 * Public API Surface of @pacyfist/veneer/testing
 *
 * A deterministic stand-in for the font service, for component tests under
 * jsdom or any other environment without FontFace or network access.
 */

export { VeneerTestingFontService, provideVeneerTesting } from './veneer-testing';
export type { VeneerTestingOptions, VeneerTestingState } from './veneer-testing';
export { decodeVeneer } from './decode-veneer';
