import {
  DOCUMENT,
  Injectable,
  OnDestroy,
  PLATFORM_ID,
  Signal,
  WritableSignal,
  TransferState,
  afterNextRender,
  computed,
  inject,
  makeStateKey,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { VENEER_CONFIG } from './veneer.config';
import { ScrambleMap, buildScrambleMap, randomSeed, scrambleText } from '@pacyfist/veneer/core';
import { VeneerFontState } from './veneer-font-state';
import { Forge, FontSourceError, loadBaseFont, loadForge } from './base-font';
import type { BaseFont } from '@pacyfist/veneer/forge';
import { docsUrl, veneerMessage } from './veneer-errors';
import type { VeneerFailure, VeneerStatus } from './veneer-status';

/**
 * Carries the seed from the server render to the client so both build the same
 * cipher and hydration sees identical text.
 *
 * This does hand the seed to anyone reading the page source. That costs
 * nothing: the forged font's cmap is downloadable and already describes the
 * substitution completely. See the README on what this technique does and
 * does not defend against.
 */
const SEED_KEY = makeStateKey<number>('veneerSeed');

/** The attribute `withStatusAttribute()` maintains on `<html>`. */
const STATUS_ATTRIBUTE = 'data-veneer-status';

/** Which step of `load()` an error came from. */
type Stage = 'source' | 'forge' | 'face';

declare const ngDevMode: boolean | undefined;

/** Dropped-character sets already warned about, so each is reported once per page. */
const warnedUncovered = new Set<string>();

/** Turn whatever `load()` caught into a structured failure with a stable code. */
function describeFailure(error: unknown, stage: Stage): VeneerFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof FontSourceError) return { code: 'VNR010', message, cause: error };
  if (stage === 'face') return { code: 'VNR013', message, cause: error };
  // VeneerFontError lives in the lazily loaded forge, so it is recognised by
  // shape rather than by class.
  const missing = (error as { missing?: unknown } | null)?.missing;
  if (Array.isArray(missing) && missing.length > 0) {
    return { code: 'VNR012', message, missing: [...missing], cause: error };
  }
  return { code: 'VNR011', message, cause: error };
}

/**
 * Owns the cipher and the generated font.
 *
 * The map is built synchronously in the constructor so directives and pipes can
 * scramble on their very first render, on the server as well as the client.
 * Only the font is loaded asynchronously, and only in a browser.
 */
@Injectable()
export class VeneerFontService implements VeneerFontState, OnDestroy {
  private readonly config = inject(VENEER_CONFIG);
  private readonly document = inject(DOCUMENT);
  private readonly transferState = inject(TransferState);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** The face registered in `document.fonts`, so it can be removed on destroy. */
  private face: FontFace | undefined;

  /** Set once `ngOnDestroy` runs, so a load already in flight knows not to register its face. */
  private destroyed = false;

  /** The status listeners were last told about, so each change is reported once. */
  private reported: VeneerStatus | undefined;

  private readonly failure = signal<VeneerFailure | null>(null);

  /** The seed the cipher was built from. */
  private readonly seed: number;

  /**
   * The map built at startup over the configured charset: the one the server
   * rendered with, and so the one hydration inverts.
   */
  readonly initialMap: ScrambleMap;

  private readonly currentMap: WritableSignal<ScrambleMap>;

  /**
   * The substitution in force. Starts as `initialMap`; when the base font
   * lacks glyphs for some charset characters (and `strictCoverage` is off) it
   * is rebuilt from the same seed without them, once the font has loaded.
   */
  readonly map: Signal<ScrambleMap>;

  /** Family name of the forged font. Unique per load so nothing caches across ciphers. */
  readonly familyName: string;

  /** True once the forged font is registered and text is safe to show. */
  readonly ready = signal(false);

  /** Set when the font could not be built. The library fails open when this happens. */
  readonly failed = this.failure.asReadonly();

  /** `loading`, `active`, `failed` or `disabled`. */
  readonly status = computed<VeneerStatus>(() =>
    this.config.disabled
      ? 'disabled'
      : this.failure()
        ? 'failed'
        : this.ready()
          ? 'active'
          : 'loading',
  );

  /**
   * Demo/debug switch. When true the forged font is withheld, exposing the raw
   * scrambled characters - what a scraper receives.
   */
  readonly revealed = signal(false);

  /** Whether scrambling applies at all. */
  readonly active = computed(() => !this.config.disabled && this.failed() === null);

  /** The `font-family` value protected elements should use. */
  readonly fontStack = computed(() =>
    this.active() && !this.revealed()
      ? `"${this.familyName}", ${this.config.fallbackFontFamily}`
      : this.config.fallbackFontFamily,
  );

  /** True while protected text should stay hidden to avoid a flash of gibberish. */
  readonly hidden = computed(
    () => this.config.hideUntilReady && this.active() && !this.revealed() && !this.ready(),
  );

  constructor() {
    const seed =
      this.config.seed ??
      (this.isBrowser ? this.transferState.get(SEED_KEY, randomSeed()) : randomSeed());

    // Only an instance relying on an implicit seed needs to publish it for
    // hydration. One with an explicit seed is already deterministic across
    // server and client, and publishing would clobber the implicit instance's
    // seed when several instances render on the server.
    if (!this.isBrowser && this.config.seed === undefined) {
      this.transferState.set(SEED_KEY, seed);
    }

    this.seed = seed;
    this.initialMap = buildScrambleMap(seed, this.config.charset);
    this.currentMap = signal(this.initialMap);
    this.map = this.currentMap.asReadonly();
    this.familyName = `Veneer-${seed.toString(36)}`;

    if (this.config.disabled) {
      this.ready.set(true);
    } else if (this.isBrowser) {
      afterNextRender(() => void this.load());
    }
    this.report();
  }

  /** Scramble a string, or return it untouched when protection is off or broken. */
  scramble(text: string): string {
    return this.active() ? scrambleText(text, this.map()) : text;
  }

  private async load(): Promise<void> {
    let stage: Stage = 'source';
    try {
      // The forge is a separate chunk: fetch it alongside the font.
      const forge = loadForge();
      const base = await loadBaseFont(this.config.font, this.document.baseURI, async (bytes) =>
        (await forge).parseBaseFont(bytes),
      );
      stage = 'forge';
      const map = this.config.strictCoverage ? this.initialMap : this.narrow(await forge, base);
      const forged = (await forge).forgeScrambledFont(base, map, this.familyName);
      stage = 'face';
      const face = new FontFace(this.familyName, forged);
      await face.load();

      // The service can be destroyed while `face.load()` is in flight - a child
      // injector's service is torn down on every config change. Registering the
      // face after that point would leak it: nothing would ever call
      // `ngOnDestroy` again to remove it.
      if (this.destroyed) return;

      this.face = face;
      this.document.fonts.add(face);
      // Together, so text is re-scrambled with the map the font was forged for
      // in the same change detection pass that reveals it.
      this.currentMap.set(map);
      this.ready.set(true);
    } catch (error) {
      if (this.destroyed) return;
      // Fail open. Unreadable content is worse than unprotected content, so
      // `active()` flips false and every directive restores its original text.
      const failure = describeFailure(error, stage);
      console.error(
        `[veneer] disabled (${failure.code}) - could not build the protective font, so text ` +
          `is shown readable. See ${docsUrl(failure.code)}`,
        error,
      );
      this.failure.set(failure);
      this.ready.set(true);
    }
    this.report();
  }

  /**
   * The initial map, or when the font lacks glyphs for some of its characters,
   * a map rebuilt from the same seed without them. Those characters then pass
   * through unscrambled and render in the fallback font.
   */
  private narrow(forge: Forge, base: BaseFont): ScrambleMap {
    const scrambled = [...this.initialMap.forward.keys()];
    const covered = new Set(forge.coveredCodepoints(base, scrambled));
    const dropped = scrambled
      .filter((cp) => !covered.has(cp))
      .map((cp) => String.fromCodePoint(cp));
    if (dropped.length === 0) return this.initialMap;

    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      const key = dropped.join('');
      if (!warnedUncovered.has(key)) {
        warnedUncovered.add(key);
        console.warn(
          veneerMessage(
            'VNR014',
            `the base font has no glyph for ${dropped.length} charset character(s): ${key}. ` +
              'They are left out of the cipher and shown as they are, in the fallback font. ' +
              'Narrow `charset` to silence this, or set `strictCoverage: true` to fail instead.',
          ),
        );
      }
    }

    const charset = this.config.charset.filter(
      (cp) => covered.has(cp) || !this.initialMap.forward.has(cp),
    );
    try {
      return buildScrambleMap(this.seed, charset);
    } catch {
      throw Object.assign(
        new Error(`[veneer] the base font covers too little of the charset to scramble anything.`),
        { missing: dropped },
      );
    }
  }

  /** Tell the status attribute and the listeners about a status change. */
  private report(): void {
    const status = untracked(this.status);
    if (status === this.reported) return;
    this.reported = status;

    if (this.config.statusAttribute) {
      this.document.documentElement?.setAttribute(STATUS_ATTRIBUTE, status);
    }
    if (!this.isBrowser) return;

    const event = { status, failure: untracked(this.failure), familyName: this.familyName };
    for (const listener of this.config.statusListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[veneer] a status listener threw.', error);
      }
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.face) {
      this.document.fonts.delete(this.face);
      this.face = undefined;
    }
    if (this.config.statusAttribute) {
      this.document.documentElement?.removeAttribute(STATUS_ATTRIBUTE);
    }
  }
}
