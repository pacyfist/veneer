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
   * Whether this render is protected at all. False only when the app's
   * `shouldProtect` hook returned false for the current request; the
   * instance then renders readable text, forges nothing, and tells the
   * client to stay unprotected (`VeneerTransfer`).
   */
  protects(): boolean;

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
 *
 * Or, when `shouldProtect` turned protection off for the request, only
 * `{ protect: false }`, so the hydrating client keeps the readable text the
 * server rendered instead of scrambling it itself. It carries no secret.
 */
export type VeneerTransfer =
  | { readonly family: string; readonly fonts: readonly VeneerTransferFont[] }
  | { readonly protect: false };

/**
 * One forged face in `VeneerTransfer`, in face order (`font` first, then
 * `withFaces()`): its URL, plus the `FontFace` descriptors the server forged
 * it for, so the browser registers exactly the server's faces whatever its own
 * config says. A plain URL is a face with default descriptors (and what older
 * versions sent for every face).
 */
export type VeneerTransferFont =
  | string
  | {
      readonly url: string;
      readonly weight?: string;
      readonly style?: string;
      readonly stretch?: string;
    };
