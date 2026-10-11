import { InjectionToken } from '@angular/core';
import type { ScrambleMap } from '@pacyfist/veneer/core';
import type { ResolvedVeneerConfig } from './veneer.config';

/**
 * The contract between the service and `@pacyfist/veneer/server`.
 *
 * Internal: exported from the main entry point with a `ɵ` prefix for the
 * server entry point only; not covered by semver.
 */

/**
 * What the server built for one instance.
 *
 * @internal Exported as `ɵVeneerServerCipher` for the server entry point only.
 */
export interface VeneerServerCipher {
  /** The map the server renders with. Never sent to the client. */
  readonly map: ScrambleMap;
  /** Family name of the forged faces. Random, so it says nothing about the map. */
  readonly familyName: string;
  /**
   * Where the client fetches each forged face, in face order (`font` first,
   * then `withFaces()`). Relative URLs resolve against the document base URL.
   */
  readonly urls: readonly string[];
}

/**
 * Builds the cipher and the forged fonts during a server render.
 *
 * @internal Exported as `ɵVeneerServerForge` for the server entry point only.
 */
export interface VeneerServerForge {
  /**
   * Synchronous, because the first render scrambles synchronously. Throws when
   * the fonts cannot be read or forged; the instance then fails open.
   */
  prepare(config: ResolvedVeneerConfig): VeneerServerCipher;
}

/**
 * Provided by `provideVeneerServer()`.
 *
 * @internal Exported as `ɵVENEER_SERVER_FORGE` for the server entry point only.
 */
export const VENEER_SERVER_FORGE = new InjectionToken<VeneerServerForge>('VENEER_SERVER_FORGE');

/**
 * What travels from the server to the client in TransferState: no seed and no
 * map, only where the forged fonts are. The client has to fetch and parse one
 * to learn the cipher, which is exactly what an attacker has to do too.
 */
export interface VeneerTransfer {
  readonly family: string;
  readonly fonts: readonly string[];
}
