import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { DEFAULT_CHARSET } from '@pacyfist/veneer/core';
import { VeneerFontService } from './veneer-font.service';
import type { VeneerStatusListener } from './veneer-status';

/** Where the base outlines come from. A URL, the bytes themselves, or a loader. */
export type VeneerFontSource = string | ArrayBuffer | (() => Promise<ArrayBuffer>);

/** One more face of the base family, for `withFaces()`. */
export interface VeneerFace {
  /** The face's base font, in the same forms as `font`. */
  src: VeneerFontSource;
  /** CSS `font-weight` this face is used for, e.g. `700` or `'bold'`. Default `normal`. */
  weight?: string | number;
  /** CSS `font-style`, e.g. `'italic'`. Default `normal`. */
  style?: string;
  /** CSS `font-stretch`, e.g. `'condensed'`. Default `normal`. */
  stretch?: string;
}

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

  /**
   * Names this instance, so several instances with implicit seeds can render
   * on one server page: each carries its seed to the client under its own
   * key. Without distinct ids, the last instance's seed wins and the others
   * hydrate with the wrong cipher. Not needed with an explicit `seed`.
   */
  id?: string;
}

/**
 * Config with defaults applied and features folded in, as injected.
 *
 * @internal Exported as `ɵResolvedVeneerConfig` for the testing entry point only.
 */
export type ResolvedVeneerConfig = Required<Omit<VeneerConfig, 'seed' | 'id'>> &
  Pick<VeneerConfig, 'seed' | 'id'> & {
    /** From `withFaces()`. */
    readonly faces: readonly VeneerFace[];
    /** From `withStatusListener()`. */
    readonly statusListeners: readonly VeneerStatusListener[];
    /** From `withStatusAttribute()`. */
    readonly statusAttribute: boolean;
  };

/** The features `provideVeneer` accepts after the config. */
export type VeneerFeatureKind = 'statusListener' | 'statusAttribute' | 'faces';

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
 * Add bold, italic or other faces of the base family, so protected text in
 * those styles uses real outlines instead of the browser's synthesized bold or
 * slant. `font` stays the regular face.
 *
 * ```ts
 * provideVeneer(
 *   { font: 'fonts/Roboto-Regular.ttf' },
 *   withFaces(
 *     { src: 'fonts/Roboto-Bold.ttf', weight: 700 },
 *     { src: 'fonts/Roboto-Italic.ttf', style: 'italic' },
 *   ),
 * );
 * ```
 *
 * All faces are forged with one seed under one family name, with matching
 * `FontFace` descriptors. Every face must load: if one cannot be built the
 * whole instance fails open. Characters any face lacks are dropped from the
 * cipher (see `strictCoverage`).
 */
export function withFaces(...faces: VeneerFace[]): VeneerFeature<'faces'> {
  return {
    ɵkind: 'faces',
    ɵapply: (config) => ({ ...config, faces: [...config.faces, ...faces] }),
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
    faces: [],
    statusListeners: [],
    statusAttribute: false,
  } as ResolvedVeneerConfig);
  return makeEnvironmentProviders([
    { provide: VENEER_CONFIG, useValue: resolved },
    VeneerFontService,
  ]);
}
