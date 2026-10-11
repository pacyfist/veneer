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
   * The map built at startup over the configured charset. Server-rendered
   * text was scrambled with it, so hydration inverts with it.
   */
  readonly initialMap: ScrambleMap;

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
   * scrambled characters. The only writable part of the state.
   */
  readonly revealed: WritableSignal<boolean>;

  /** Whether scrambling applies at all. */
  readonly active: Signal<boolean>;

  /** The `font-family` value protected elements should use. */
  readonly fontStack: Signal<string>;

  /** True while protected text should stay hidden to avoid a flash of gibberish. */
  readonly hidden: Signal<boolean>;

  /** Scramble a string, or return it untouched when protection is off or broken. */
  scramble(text: string): string;
}
