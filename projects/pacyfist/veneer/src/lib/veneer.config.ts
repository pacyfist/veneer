import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { DEFAULT_CHARSET } from '@pacyfist/veneer/core';
import { VeneerFontService } from './veneer-font.service';
import { installReadableCopy } from './veneer-copy';
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

/** The options of `provideVeneer()`. Only `font` is required. */
export interface VeneerConfig {
  /**
   * Base font supplying the glyph outlines, as a .ttf, .otf or .woff (not
   * WOFF2). A URL resolves against `<base href>`: keep it relative.
   *
   * Pick the font your body text already uses — the forged font replaces it
   * wherever veneer is applied, so a mismatch is visible.
   */
  font: VeneerFontSource;

  /**
   * CSS families used before the forged font is ready, when protection is
   * off, for `veneer-skip` content, and for characters the base font has no
   * glyph for (the forged font keeps every glyph of the base font).
   *
   * Should name the same typeface as `font` so the two are indistinguishable.
   */
  fallbackFontFamily?: string;

  /** Codepoints the cipher covers. Defaults to printable ASCII without the space. */
  charset?: readonly number[];

  /**
   * Fixes the cipher instead of drawing it from the CSPRNG.
   *
   * Only for tests and reproducible builds. A fixed seed is solvable: it sits
   * in your JavaScript bundle, a 32-bit seed can be found by trying them all
   * with the public `buildScrambleMap`, and every visitor and every crawl sees
   * the same substitution. Without it there is no seed at all: the server (see
   * `provideVeneerServer` in `@pacyfist/veneer/server`) or the browser draws
   * the map from the CSPRNG.
   */
  seed?: number;

  /**
   * Keep protected text invisible until the forged font is ready, so scrambled
   * characters never flash on screen. Defaults to true.
   *
   * Server-rendered text is hidden by a small inline `<style>` and `<script>`
   * veneer adds to `<head>` (see `hideWith`), so readers that never run
   * JavaScript still get the scrambled text rather than blank space. Set false
   * to accept the flash instead.
   */
  hideUntilReady?: boolean;

  /**
   * How server-rendered text is hidden while `hideUntilReady` is on.
   *
   * `'stylesheet'` (the default): a marker attribute plus an inline `<style>`
   * rule that a tiny inline `<script>` switches on. Readers without
   * JavaScript see the scrambled text. Under a Content Security Policy both
   * need the page's nonce (Angular's `CSP_NONCE`, added automatically) or
   * the hashes in `VENEER_CSP_HASHES`; if the CSP blocks them, the text shows
   * scrambled in the fallback font until the app hydrates.
   *
   * `'hidden'`: the HTML `hidden` attribute, which the browser's own
   * stylesheet applies, so no CSP can block it and no inline code is added.
   * The costs: readers without JavaScript see nothing, and the text takes no
   * space until the client takes over, so the layout shifts.
   *
   * In the browser veneer always hides with a CSSOM style, which a strict CSP
   * allows.
   */
  hideWith?: 'stylesheet' | 'hidden';

  /** Turns the whole thing off; text renders untouched. Useful per-environment. */
  disabled?: boolean;

  /**
   * What to do when the base font has no glyph for some charset characters.
   *
   * `false` (the default): leave those characters out of the cipher. They pass
   * through unscrambled and render in the fallback font, and a dev-mode
   * warning (VNR014) lists them. The map is redrawn without them (on the
   * server before rendering, in the browser once the font has loaded), and
   * protected text is re-scrambled with it.
   *
   * `true`: fail open instead (VNR012), switching protection off for the whole
   * instance, as before 0.1.
   */
  strictCoverage?: boolean;

  /**
   * Names this instance, so several instances can render on one server page:
   * each carries its forged fonts' URLs to the client under its own key.
   * Without distinct ids, the last instance's fonts win and the others
   * hydrate with the wrong cipher.
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
    /** From `withA11y()`. */
    readonly a11y: VeneerA11yMode | 'none';
    /**
     * From `withReadableCopy()`: the copy handler's installer, carried by the
     * feature so apps without it do not ship the handler.
     */
    readonly readableCopy: ((document: Document) => void) | null;
  };

/** What `withA11y()` does to protected elements. */
export type VeneerA11yMode = 'hide';

/** The features `provideVeneer` accepts after the config. */
export type VeneerFeatureKind =
  'statusListener' | 'statusAttribute' | 'faces' | 'a11y' | 'readableCopy';

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
 * All faces are forged from one map under one family name, with matching
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
 * With several instances using it, the attribute shows the most urgent of
 * their statuses: `failed`, then `loading`, then `active`, then `disabled`.
 * It is removed when the last of them is destroyed.
 */
export function withStatusAttribute(): VeneerFeature<'statusAttribute'> {
  return { ɵkind: 'statusAttribute', ɵapply: (config) => ({ ...config, statusAttribute: true }) };
}

/**
 * Hide protected text from assistive technology while it is scrambled:
 * `aria-hidden="true"` on every `veneer` and `veneerFont` element, set only
 * while protection is active and removed when it fails open, is disabled, or
 * the visitor switches on readable mode.
 *
 * ```ts
 * provideVeneer({ font: 'fonts/Roboto-Regular.ttf' }, withA11y('hide'));
 * ```
 *
 * This keeps screen readers from reading gibberish aloud. It does not make the
 * text accessible: it removes it. Pair it with readable mode
 * (`VeneerReadableToggle`), which is what lets those readers get the text.
 * An element that is or contains something focusable (a link, a button) is
 * left alone, because hiding focusable content breaks keyboard and screen
 * reader navigation; development builds warn (VNR021).
 */
export function withA11y(mode: VeneerA11yMode): VeneerFeature<'a11y'> {
  return { ɵkind: 'a11y', ɵapply: (config) => ({ ...config, a11y: mode }) };
}

/**
 * Copy readable text. When a visitor copies a selection that includes
 * protected text, the clipboard gets the words they see instead of the
 * scrambled characters:
 *
 * ```ts
 * provideVeneer({ font: 'fonts/Roboto-Regular.ttf' }, withReadableCopy());
 * ```
 *
 * One `copy` listener on `document` (a selection that starts outside a
 * protected element never reaches that element's own listener) decodes only
 * the text nodes inside this instance's protected elements, so the rest of the
 * selection is copied as it is. Both `text/plain` and `text/html` are
 * replaced. Applies to copy only: scripts reading the DOM still get the
 * scrambled text, which is the point. It does make your protected text one
 * Ctrl+C away from a chatbot, so turn it on only where sharing quotes matters
 * more than that.
 */
export function withReadableCopy(): VeneerFeature<'readableCopy'> {
  return {
    ɵkind: 'readableCopy',
    ɵapply: (config) => ({ ...config, readableCopy: installReadableCopy }),
  };
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
    hideWith: 'stylesheet',
    disabled: false,
    strictCoverage: false,
    ...config,
    faces: [],
    statusListeners: [],
    statusAttribute: false,
    a11y: 'none',
    readableCopy: null,
  } as ResolvedVeneerConfig);
  return makeEnvironmentProviders([
    { provide: VENEER_CONFIG, useValue: resolved },
    VeneerFontService,
  ]);
}
