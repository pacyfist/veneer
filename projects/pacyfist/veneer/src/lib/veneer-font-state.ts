import { Signal, WritableSignal } from '@angular/core';
import type { ScrambleMap } from '@pacyfist/veneer/core';

/**
 * The public shape of `VeneerFontService`: everything the directives, the pipe
 * and application code read from it.
 *
 * `VeneerFontService` implements it, and so does the stand-in that
 * `provideVeneerTesting()` from `@pacyfist/veneer/testing` registers under the
 * `VeneerFontService` token.
 */
export interface VeneerFontState {
  /** The substitution in force for this page load. */
  readonly map: ScrambleMap;

  /** Family name of the forged font. */
  readonly familyName: string;

  /** True once the forged font is registered and text is safe to show. */
  readonly ready: Signal<boolean>;

  /** Set when the font could not be built. The library fails open when this happens. */
  readonly failed: Signal<string | null>;

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
