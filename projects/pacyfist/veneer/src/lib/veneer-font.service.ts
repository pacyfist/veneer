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
import { VENEER_CONFIG, VeneerFace } from './veneer.config';
import { ScrambleMap, buildScrambleMap, randomSeed, scrambleText } from '@pacyfist/veneer/core';
import { VeneerFontState } from './veneer-font-state';
import { readableMode } from './veneer-readable';
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
function seedKey(id: string | undefined) {
  // Namespaced by `id`, so several implicit-seed instances in one server
  // render each carry their own seed instead of the last writer winning.
  return makeStateKey<number>(id ? `veneerSeed:${id}` : 'veneerSeed');
}

/** `FontFace` descriptors for a face; unset ones keep the browser defaults. */
function descriptorsOf(face: VeneerFace): FontFaceDescriptors {
  const descriptors: FontFaceDescriptors = {};
  if (face.weight !== undefined) descriptors.weight = String(face.weight);
  if (face.style !== undefined) descriptors.style = face.style;
  if (face.stretch !== undefined) descriptors.stretch = face.stretch;
  return descriptors;
}

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

  /** The faces registered in `document.fonts`, so they can be removed on destroy. */
  private faces: FontFace[] = [];

  /** Set once `ngOnDestroy` runs, so a load already in flight knows not to register its face. */
  private destroyed = false;

  /** The status listeners were last told about, so each change is reported once. */
  private reported: VeneerStatus | undefined;

  private readonly failure = signal<VeneerFailure | null>(null);

  /** The seed the cipher was built from. */
  private readonly seed: number;

  /** The map built at startup over the configured charset. */
  private readonly startMap: ScrambleMap;

  /**
   * The map server-rendered text was scrambled with, and so the one hydration
   * inverts. Null while it is not known yet; directives then leave the
   * server's text in place until it is. Today it is always set: it is the map
   * built at startup, which the server and the client share through the seed.
   */
  readonly initialMap: Signal<ScrambleMap | null>;

  private readonly currentMap: WritableSignal<ScrambleMap>;

  /**
   * The substitution in force. Starts as the map built at startup; when the base font
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

  /**
   * Readable mode: the visitor's choice to switch scrambling off, shared by
   * every instance on the page and remembered in `localStorage`. Offer it
   * with `VeneerReadableToggle`. Always false during server rendering.
   */
  readonly readable: WritableSignal<boolean> = readableMode(this.document, this.isBrowser);

  /** Whether scrambling applies at all: not disabled, not failed, not in readable mode. */
  readonly active = computed(
    () => !this.config.disabled && this.failed() === null && !this.readable(),
  );

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
    const key = seedKey(this.config.id);
    const seed =
      this.config.seed ??
      (this.isBrowser ? this.transferState.get(key, randomSeed()) : randomSeed());

    // Only an instance relying on an implicit seed needs to publish it for
    // hydration. One with an explicit seed is already deterministic across
    // server and client, and publishing would clobber the implicit instance's
    // seed when several instances render on the server.
    if (!this.isBrowser && this.config.seed === undefined) {
      this.transferState.set(key, seed);
    }

    this.seed = seed;
    this.startMap = buildScrambleMap(seed, this.config.charset);
    this.initialMap = signal(this.startMap).asReadonly();
    this.currentMap = signal(this.startMap);
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
      // The forge is a separate chunk: fetch it alongside the fonts. The
      // regular face (`font`) comes first, then any from `withFaces()`.
      const forge = loadForge();
      const faces: VeneerFace[] = [{ src: this.config.font }, ...this.config.faces];
      const bases = await Promise.all(
        faces.map((face) =>
          loadBaseFont(face.src, this.document.baseURI, async (bytes) =>
            (await forge).parseBaseFont(bytes),
          ),
        ),
      );
      stage = 'forge';
      const { coveredCodepoints, forgeScrambledFont } = await forge;
      const map = this.config.strictCoverage
        ? this.startMap
        : this.narrow(coveredCodepoints, bases);
      // One seed, one family: every face is forged from the same map, and the
      // descriptors let the browser pick the right one for bold or italic text.
      const forged = bases.map((base) => forgeScrambledFont(base, map, this.familyName));
      stage = 'face';
      const loaded = await Promise.all(
        forged.map((bytes, i) =>
          new FontFace(this.familyName, bytes, descriptorsOf(faces[i])).load(),
        ),
      );

      // The service can be destroyed while `load()` is in flight - a child
      // injector's service is torn down on every config change. Registering
      // faces after that point would leak them: nothing would ever call
      // `ngOnDestroy` again to remove them.
      if (this.destroyed) return;

      this.faces = loaded;
      for (const face of loaded) this.document.fonts.add(face);
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
   * The initial map, or when a face lacks glyphs for some of its characters,
   * a map rebuilt from the same seed without them. Those characters then pass
   * through unscrambled and render in the fallback font. With several faces,
   * only characters every face can draw stay in the cipher.
   */
  private narrow(coveredCodepoints: Forge['coveredCodepoints'], bases: BaseFont[]): ScrambleMap {
    const scrambled = [...this.startMap.forward.keys()];
    const covered = new Set(
      bases.reduce((candidates, base) => coveredCodepoints(base, candidates), scrambled),
    );
    const dropped = scrambled
      .filter((cp) => !covered.has(cp))
      .map((cp) => String.fromCodePoint(cp));
    if (dropped.length === 0) return this.startMap;

    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      const key = dropped.join('');
      if (!warnedUncovered.has(key)) {
        warnedUncovered.add(key);
        console.warn(
          veneerMessage(
            'VNR014',
            `the base font${bases.length > 1 ? 's have' : ' has'} no glyph for ${dropped.length} charset character(s): ${key}. ` +
              'They are left out of the cipher and shown as they are, in the fallback font. ' +
              'Narrow `charset` to silence this, or set `strictCoverage: true` to fail instead.',
          ),
        );
      }
    }

    const charset = this.config.charset.filter(
      (cp) => covered.has(cp) || !this.startMap.forward.has(cp),
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
    for (const face of this.faces) this.document.fonts.delete(face);
    this.faces = [];
    if (this.config.statusAttribute) {
      this.document.documentElement?.removeAttribute(STATUS_ATTRIBUTE);
    }
  }
}
