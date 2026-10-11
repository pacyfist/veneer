/**
 * Where an instance is in its life:
 *
 * - `loading`: text is scrambled and the forged font is on its way (and,
 *   during server rendering, always, since the server never loads the font).
 * - `active`: the forged font is registered; protection is in force, unless
 *   the visitor switched on readable mode (`readable()`, see `active()`).
 * - `failed`: the font could not be built; text is shown readable (fail open).
 * - `disabled`: `disabled: true` in the config; text is never scrambled.
 */
export type VeneerStatus = 'loading' | 'active' | 'failed' | 'disabled';

/**
 * Why protection switched off. Each code has a section in the README.
 *
 * - `VNR010`: the base font could not be fetched, or the `font` loader rejected.
 * - `VNR011`: the base font is not a font veneer can read, or forging it failed.
 * - `VNR012`: the base font has no glyph for some charset characters
 *   (only with `strictCoverage: true`; see `missing`).
 * - `VNR013`: the browser rejected the forged font, or has no `FontFace`.
 */
export type VeneerFailureCode = 'VNR010' | 'VNR011' | 'VNR012' | 'VNR013';

/** A structured description of a failure, for logging and alerting. */
export interface VeneerFailure {
  /** Stable code. Alert on this rather than on the message text. */
  readonly code: VeneerFailureCode;
  /** Human-readable explanation. */
  readonly message: string;
  /** For `VNR012`: the charset characters the base font has no glyph for. */
  readonly missing?: readonly string[];
  /** The underlying error, when there was one. */
  readonly cause?: unknown;
}

/** What a status listener receives on every status change. */
export interface VeneerStatusEvent {
  readonly status: VeneerStatus;
  /** Set when `status` is `failed`, otherwise null. */
  readonly failure: VeneerFailure | null;
  /** Family name of the instance's forged font, to tell instances apart. */
  readonly familyName: string;
}

/** Called on every status change of an instance, in the browser only. */
export type VeneerStatusListener = (event: VeneerStatusEvent) => void;
