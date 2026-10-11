import {
  DOCUMENT,
  Injectable,
  OnDestroy,
  PLATFORM_ID,
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
import {
  ScrambleMap,
  buildScrambleMap,
  forgeScrambledFont,
  parseBaseFont,
  randomSeed,
  scrambleText,
} from '@pacyfist/veneer/core';
import { VeneerFontState } from './veneer-font-state';
import { FontSourceError, loadBaseFont } from './base-font';
import { docsUrl } from './veneer-errors';
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

  /** The substitution in force for this page load. */
  readonly map: ScrambleMap;

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

    this.map = buildScrambleMap(seed, this.config.charset);
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
    return this.active() ? scrambleText(text, this.map) : text;
  }

  private async load(): Promise<void> {
    let stage: Stage = 'source';
    try {
      const base = await loadBaseFont(this.config.font, this.document.baseURI, parseBaseFont);
      stage = 'forge';
      const forged = forgeScrambledFont(base, this.map, this.familyName);
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
