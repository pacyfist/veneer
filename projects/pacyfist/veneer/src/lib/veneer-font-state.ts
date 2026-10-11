import { Signal, WritableSignal } from '@angular/core';
import type { ScrambleMap } from '@pacyfist/veneer/core';
import type { VeneerFailure, VeneerStatus } from './veneer-status';

/**
 * The public shape of `VeneerFontService`: everything the directives, the pipe
 * and application code read from it.
 *
 * `VeneerFontService` implements it, and so does the stand-in that
 * `provideVeneerTesting()` from `@pacyfist/veneer/testing` registers under the
 * `VeneerFontService` token.
 */
export interface VeneerFontState {
  /**
   * The substitution in force. It can change once, after the font loads, when
   * characters the font cannot draw are dropped (see `strictCoverage`).
   */
  readonly map: Signal<ScrambleMap>;

  /**
   * The map server-rendered text was scrambled with, so hydration inverts
   * with it. Null while the client does not know it yet: directives then keep
   * the server's text in place and recover the originals once it is set.
   * Without server rendering it is the client's own map from the start.
   */
  readonly initialMap: Signal<ScrambleMap | null>;

  /** Family name of the forged font. */
  readonly familyName: string;

  /** True once the forged font is registered and text is safe to show. */
  readonly ready: Signal<boolean>;

  /**
   * Set when the font could not be built: a stable `code`, a `message`, and for
   * missing glyphs the `missing` characters. The library fails open when this
   * happens. Read `failed()?.message` for the text.
   */
  readonly failed: Signal<VeneerFailure | null>;

  /** `loading`, `active`, `failed` or `disabled`. */
  readonly status: Signal<VeneerStatus>;

  /**
   * Demo/debug switch. When true the forged font is withheld, exposing the raw
   * scrambled characters.
   */
  readonly revealed: WritableSignal<boolean>;

  /**
   * Readable mode: the visitor's choice to switch scrambling off for the
   * page, remembered in `localStorage`. Writable; `VeneerReadableToggle`
   * flips it.
   */
  readonly readable: WritableSignal<boolean>;

  /** Whether scrambling applies at all: not disabled, not failed, not in readable mode. */
  readonly active: Signal<boolean>;

  /** The `font-family` value protected elements should use. */
  readonly fontStack: Signal<string>;

  /** True while protected text should stay hidden to avoid a flash of gibberish. */
  readonly hidden: Signal<boolean>;

  /** Scramble a string, or return it untouched when protection is off or broken. */
  scramble(text: string): string;
}
