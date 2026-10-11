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
   * The substitution in force: what `scramble()` applies. In a client-only app
   * it can change once, after the font loads, when characters the font cannot
   * draw are dropped (see `strictCoverage`). When hydrating a server render it
   * changes once, to the server's map, when that becomes known.
   */
  readonly map: Signal<ScrambleMap>;

  /**
   * The map server-rendered text was scrambled with, so the one hydration
   * inverts.
   *
   * The server never sends its map or a seed. In the browser this stays `null`
   * until the forged font the server rendered with has been fetched and its
   * cmap read; anything that recovers readable text from server-rendered
   * ciphertext must wait for it to be non-null. Without server rendering it is
   * the browser's own map from the start.
   */
  readonly initialMap: Signal<ScrambleMap | null>;

  /** Family name of the forged font. Random: it says nothing about the cipher. */
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
