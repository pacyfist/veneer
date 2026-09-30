import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { DEFAULT_CHARSET } from './scramble-map';
import { VeneerFontService } from './veneer-font.service';

/** Where the base outlines come from. A URL, the bytes themselves, or a loader. */
export type VeneerFontSource = string | ArrayBuffer | (() => Promise<ArrayBuffer>);

export interface VeneerConfig {
  /**
   * Base font supplying the glyph outlines, as a .ttf or .otf (not WOFF/WOFF2).
   *
   * Pick the font your body text already uses — the forged font replaces it
   * wherever veneer is applied, so a mismatch is visible.
   */
  font: VeneerFontSource;

  /**
   * CSS families to fall back to for characters outside the charset — spaces,
   * accented letters, emoji — which the forged font does not contain.
   *
   * Should name the same typeface as `font` so the two are indistinguishable.
   */
  fallbackFontFamily?: string;

  /** Codepoints the cipher covers. Defaults to printable ASCII without the space. */
  charset?: readonly number[];

  /**
   * Fixes the cipher instead of drawing a fresh one per page load.
   *
   * Only for tests and reproducible builds. A constant seed means every visitor
   * and every crawl sees the same substitution, which is trivially solvable
   * once by frequency analysis and reusable forever after.
   */
  seed?: number;

  /**
   * Keep protected text invisible until the forged font is ready, so scrambled
   * characters never flash on screen. Defaults to true.
   *
   * The cost is that a visitor with JavaScript disabled sees nothing where
   * protected text would be. Set false to accept the flash instead.
   */
  hideUntilReady?: boolean;

  /** Turns the whole thing off; text renders untouched. Useful per-environment. */
  disabled?: boolean;
}

/** Config with defaults applied, as injected. */
export type ResolvedVeneerConfig = Required<Omit<VeneerConfig, 'seed'>> &
  Pick<VeneerConfig, 'seed'>;

export const VENEER_CONFIG = new InjectionToken<ResolvedVeneerConfig>('VENEER_CONFIG');

/**
 * Register veneer. Add to `providers` in your `ApplicationConfig`.
 *
 * ```ts
 * provideVeneer({
 *   font: 'fonts/Roboto-Regular.ttf',
 *   fallbackFontFamily: 'Roboto, sans-serif',
 * })
 * ```
 */
export function provideVeneer(config: VeneerConfig): EnvironmentProviders {
  const resolved: ResolvedVeneerConfig = {
    fallbackFontFamily: 'sans-serif',
    charset: DEFAULT_CHARSET,
    hideUntilReady: true,
    disabled: false,
    ...config,
  };
  return makeEnvironmentProviders([
    { provide: VENEER_CONFIG, useValue: resolved },
    VeneerFontService,
  ]);
}
