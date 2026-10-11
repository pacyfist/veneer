import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { DEFAULT_CHARSET } from '@pacyfist/veneer/core';
import { VeneerFontService } from './veneer-font.service';
import type { VeneerStatusListener } from './veneer-status';

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

  /**
   * What to do when the base font has no glyph for some charset characters.
   *
   * `false` (the default): leave those characters out of the cipher. They pass
   * through unscrambled and render in the fallback font, and a dev-mode
   * warning (VNR014) lists them. The map is rebuilt from the same seed once
   * the font has loaded, and protected text is re-scrambled with it.
   *
   * `true`: fail open instead (VNR012), switching protection off for the whole
   * instance, as before 0.1.
   */
  strictCoverage?: boolean;
}

/**
 * Config with defaults applied and features folded in, as injected.
 *
 * @internal Exported as `ɵResolvedVeneerConfig` for the testing entry point only.
 */
export type ResolvedVeneerConfig = Required<Omit<VeneerConfig, 'seed'>> &
  Pick<VeneerConfig, 'seed'> & {
    /** From `withStatusListener()`. */
    readonly statusListeners: readonly VeneerStatusListener[];
    /** From `withStatusAttribute()`. */
    readonly statusAttribute: boolean;
  };

/** The features `provideVeneer` accepts after the config. */
export type VeneerFeatureKind = 'statusListener' | 'statusAttribute';

/**
 * An optional addition to `provideVeneer(config, ...features)`, made by one of
 * the `with*()` functions. Its members are internal.
 */
export interface VeneerFeature<K extends VeneerFeatureKind = VeneerFeatureKind> {
  /** @internal */
  readonly ɵkind: K;
  /** @internal */
  readonly ɵapply: (config: ResolvedVeneerConfig) => ResolvedVeneerConfig;
}

/**
 * Call `listener` on every status change: `loading`, then `active` or `failed`
 * (or `disabled` once). Use it to report fail-open to RUM or error tracking:
 *
 * ```ts
 * provideVeneer(
 *   { font: 'fonts/Roboto-Regular.ttf' },
 *   withStatusListener(({ status, failure }) => {
 *     if (status === 'failed') Sentry.captureMessage(`veneer ${failure!.code}: ${failure!.message}`);
 *   }),
 * );
 * ```
 *
 * Runs in the browser only. An exception thrown by the listener is logged and
 * otherwise ignored.
 */
export function withStatusListener(
  listener: VeneerStatusListener,
): VeneerFeature<'statusListener'> {
  return {
    ɵkind: 'statusListener',
    ɵapply: (config) => ({ ...config, statusListeners: [...config.statusListeners, listener] }),
  };
}

/**
 * Mirror the status on `<html data-veneer-status="loading|active|failed|disabled">`,
 * for CSS hooks and for monitoring that reads the DOM. Written during server
 * rendering too.
 *
 * Use it on one instance only: several instances would overwrite each other.
 */
export function withStatusAttribute(): VeneerFeature<'statusAttribute'> {
  return { ɵkind: 'statusAttribute', ɵapply: (config) => ({ ...config, statusAttribute: true }) };
}

/**
 * The resolved config of the nearest `provideVeneer`.
 *
 * @internal Exported as `ɵVENEER_CONFIG` for the testing entry point only.
 */
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
 *
 * Optional features follow the config, e.g. `withStatusListener(fn)`.
 */
export function provideVeneer(
  config: VeneerConfig,
  ...features: VeneerFeature[]
): EnvironmentProviders {
  const resolved = features.reduce((current, feature) => feature.ɵapply(current), {
    fallbackFontFamily: 'sans-serif',
    charset: DEFAULT_CHARSET,
    hideUntilReady: true,
    disabled: false,
    strictCoverage: false,
    ...config,
    statusListeners: [],
    statusAttribute: false,
  } as ResolvedVeneerConfig);
  return makeEnvironmentProviders([
    { provide: VENEER_CONFIG, useValue: resolved },
    VeneerFontService,
  ]);
}
