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
import {
  ScrambleMap,
  buildScrambleMap,
  randomScrambleMap,
  scrambleText,
} from '@pacyfist/veneer/core';
import { VeneerFontState } from './veneer-font-state';
import { readableMode } from './veneer-readable';
import {
  Forge,
  FontSourceError,
  ForgedFontError,
  fetchForgedFont,
  loadBaseFont,
  loadForge,
} from './base-font';
import { VENEER_SERVER_FORGE, VeneerTransfer } from './veneer-server';
import type { BaseFont } from '@pacyfist/veneer/forge';
import { docsUrl, veneerMessage } from './veneer-errors';
import type { VeneerFailure, VeneerStatus } from './veneer-status';

/**
 * Carries the forged fonts' URLs and family name from the server render to the
 * client. Never a seed or a map: those would let a crawler that only reads the
 * HTML rebuild the cipher with the public `buildScrambleMap` and decode every
 * server-rendered element. The client learns the cipher the way an attacker
 * would have to, by fetching a forged font and reading its cmap.
 */
function transferKey(id: string | undefined) {
  // Namespaced by `id`, so several instances in one server render each carry
  // their own fonts instead of the last writer winning.
  return makeStateKey<VeneerTransfer>(id ? `veneer:${id}` : 'veneer');
}

/**
 * A family name for a forged font: random, so it says nothing about the
 * cipher (it is written into every protected element's inline style).
 */
function randomFamilyName(): string {
  const words = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(words);
  else words.forEach((_, i) => (words[i] = Math.floor(Math.random() * 0x100000000)));
  return `Veneer-${[...words].map((w) => w.toString(16).padStart(8, '0')).join('')}`;
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

/** How an instance gets its cipher. */
type Mode =
  /** No SSR state: the browser draws its own map and forges its own font. */
  | 'client'
  /** Hydrating a server render: the map comes from the server's forged font. */
  | 'hydrate'
  /** Rendering on the server. */
  | 'server';

declare const ngDevMode: boolean | undefined;

/** Server failures already logged, so each is reported once per process. */
const loggedServerFailures = new Set<string>();

/** Dropped-character sets already warned about, so each is reported once per page. */
const warnedUncovered = new Set<string>();

/**
 * Forget which dropped-character sets were warned about. Tests only: the set is
 * module-level, so specs that drop the same characters would otherwise depend on
 * the order they run in. Not exported from the package.
 */
export function resetUncoveredWarnings(): void {
  warnedUncovered.clear();
}

/** Turn whatever `load()` caught into a structured failure with a stable code. */
function describeFailure(error: unknown, stage: Stage): VeneerFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof FontSourceError) return { code: 'VNR010', message, cause: error };
  if (error instanceof ForgedFontError) return { code: 'VNR016', message, cause: error };
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
 * The map is known synchronously wherever text is first scrambled: on the
 * server (from `provideVeneerServer()`) and in a client-only app (drawn in the
 * browser). When hydrating a server render, the client does not know the
 * server's map until it has fetched the server's forged font and read its
 * cmap; `initialMap()` stays null until then.
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

  private readonly mode: Mode;

  /**
   * Protection is off for this instance: `disabled` in the config, or the
   * server's `shouldProtect` hook said no for this page's request (on the
   * server, and in the browser that hydrates that page).
   */
  private readonly off: boolean;

  /** When hydrating: the URLs of the server's forged faces. */
  private readonly serverFonts: readonly string[] = [];

  private readonly serverMap: WritableSignal<ScrambleMap | null>;

  /**
   * The map server-rendered text was scrambled with, so the one hydration
   * inverts. Null in the browser until the server's forged font has been
   * fetched and its cmap read; do not invert server-rendered text before. In
   * a client-only app it is the browser's own map from the start.
   */
  readonly initialMap: Signal<ScrambleMap | null>;

  private readonly currentMap: WritableSignal<ScrambleMap>;

  /**
   * The substitution in force. On the server and in a client-only app it
   * starts as `initialMap()`. In a client-only app it is redrawn without the
   * characters the base font lacks (when `strictCoverage` is off), once the
   * font has loaded. When hydrating it starts as a throwaway map (so text the
   * client renders before the font arrives is never plaintext) and becomes the
   * server's map, in the same tick as `initialMap()`.
   */
  readonly map: Signal<ScrambleMap>;

  /** Family name of the forged font. Random, and the same on server and client. */
  readonly familyName: string;

  private readonly isReady = signal(false);

  /** True once the forged font is registered and text is safe to show. */
  readonly ready = this.isReady.asReadonly();

  /** Set when the font could not be built. The library fails open when this happens. */
  readonly failed = this.failure.asReadonly();

  /** `loading`, `active`, `failed` or `disabled`. */
  readonly status = computed<VeneerStatus>(() =>
    this.off ? 'disabled' : this.failure() ? 'failed' : this.ready() ? 'active' : 'loading',
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
  readonly active = computed(() => !this.off && this.failed() === null && !this.readable());

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
    const key = transferKey(this.config.id);
    let familyName = randomFamilyName();
    let known: ScrambleMap | null;
    let failure: VeneerFailure | null = null;
    let off = this.config.disabled;

    if (off) {
      this.mode = 'client';
      known = this.drawMap(this.config.charset);
    } else if (!this.isBrowser) {
      this.mode = 'server';
      const forge = inject(VENEER_SERVER_FORGE, { optional: true });
      known = null;
      if (forge && !forge.protects()) {
        // shouldProtect said no for this request: readable text, no font, and
        // a note so the hydrating client does not scramble it either.
        off = true;
        this.transferState.set(key, { protect: false });
      } else if (forge) {
        try {
          const prepared = forge.prepare(this.config);
          known = prepared.map;
          familyName = prepared.familyName;
          this.transferState.set(key, { family: familyName, fonts: [...prepared.urls] });
        } catch (error) {
          failure = describeServerFailure(error);
        }
      } else if (this.config.seed !== undefined) {
        // A fixed seed is in the app's own code, so server and client agree
        // without anything in the HTML. Solvable; tests and demos only.
        known = buildScrambleMap(this.config.seed, this.config.charset);
      } else {
        failure = {
          code: 'VNR015',
          message: veneerMessage(
            'VNR015',
            'server rendering needs provideVeneerServer() from @pacyfist/veneer/server, so the ' +
              'server can forge the font itself. Without it the server cannot scramble without ' +
              'putting the key into the page, so protected text is rendered readable.',
          ),
        };
      }
      // Once per process and message: a misconfigured server would otherwise
      // log on every request.
      if (failure && !loggedServerFailures.has(failure.message)) {
        loggedServerFailures.add(failure.message);
        console.error(
          `[veneer] disabled (${failure.code}) on the server - protected text is rendered ` +
            `readable. See ${docsUrl(failure.code)}`,
          failure.cause ?? failure.message,
        );
      }
      // Scrambles nothing while failed; only there to keep `map` non-null.
      known ??= this.drawMap(this.config.charset);
    } else {
      const transfer = this.transferState.get(key, null);
      if (transfer) {
        // Taken once: the instance hydrating the server render owns it. One
        // created later in the browser (with the same id or none) did not
        // render on the server and draws its own cipher.
        this.transferState.remove(key);
        if ('protect' in transfer) {
          // The server left this page unprotected (shouldProtect): keep its
          // readable text as it is, with no font and no hiding.
          this.mode = 'client';
          off = true;
          known = this.drawMap(this.config.charset);
        } else {
          this.mode = 'hydrate';
          familyName = transfer.family;
          this.serverFonts = transfer.fonts;
          known = null;
        }
      } else {
        this.mode = 'client';
        known = this.drawMap(this.config.charset);
      }
    }

    this.serverMap = signal(known);
    this.initialMap = this.serverMap.asReadonly();
    this.currentMap = signal(known ?? this.drawMap(this.config.charset));
    this.map = this.currentMap.asReadonly();
    this.familyName = familyName;
    this.off = off;
    if (failure) this.failure.set(failure);

    if (off) {
      this.isReady.set(true);
    } else if (this.isBrowser) {
      afterNextRender(() => void (this.mode === 'hydrate' ? this.hydrate() : this.load()));
    }
    this.report();
  }

  /** A fresh map: from the configured seed when there is one, else from the CSPRNG. */
  private drawMap(charset: readonly number[]): ScrambleMap {
    return this.config.seed !== undefined
      ? buildScrambleMap(this.config.seed, charset)
      : randomScrambleMap(charset);
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
      const initial = this.currentMap();
      const map = this.config.strictCoverage
        ? initial
        : this.narrow(coveredCodepoints, bases, initial);
      // One map, one family: every face is forged from the same map, and the
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
      this.isReady.set(true);
    } catch (error) {
      if (this.destroyed) return;
      // Fail open. Unreadable content is worse than unprotected content.
      this.fail(error, stage);
    }
    this.report();
  }

  /**
   * Hydrating a server render: fetch the forged faces the server rendered
   * with, read the cipher out of the first one against the base font, then
   * register them all. Directives can recover readable text as soon as the
   * map is known, so it is published before the faces load: if the browser
   * then rejects a face, text still fails open readable.
   */
  private async hydrate(): Promise<void> {
    let stage: Stage = 'source';
    try {
      const forge = loadForge();
      const faces: VeneerFace[] = [{ src: this.config.font }, ...this.config.faces];
      if (this.serverFonts.length !== faces.length) {
        throw new ForgedFontError(
          veneerMessage(
            'VNR016',
            `the server sent ${this.serverFonts.length} forged font(s) for ${faces.length} face(s).`,
          ),
        );
      }
      const [base, ...forged] = await Promise.all([
        loadBaseFont(this.config.font, this.document.baseURI, async (bytes) =>
          (await forge).parseBaseFont(bytes),
        ),
        ...this.serverFonts.map((url) => fetchForgedFont(url, this.document.baseURI)),
      ]);
      stage = 'forge';
      const { parseBaseFont, readScrambleMap } = await forge;
      let map: ScrambleMap;
      try {
        map = { forward: readScrambleMap(base, await parseBaseFont(forged[0])).forward };
      } catch (cause) {
        throw new ForgedFontError(
          veneerMessage(
            'VNR016',
            `could not read the cipher from the forged font ${this.serverFonts[0]} ` +
              `(${(cause as Error)?.message ?? cause}).`,
          ),
          this.serverFonts[0],
        );
      }
      if (this.destroyed) return;
      // Together: text is re-scrambled with the server's map in the same pass
      // that lets directives invert the server's ciphertext.
      this.serverMap.set(map);
      this.currentMap.set(map);

      stage = 'face';
      const loaded = await Promise.all(
        forged.map((bytes, i) =>
          new FontFace(this.familyName, bytes, descriptorsOf(faces[i])).load(),
        ),
      );
      if (this.destroyed) return;
      this.faces = loaded;
      for (const face of loaded) this.document.fonts.add(face);
      this.isReady.set(true);
    } catch (error) {
      if (this.destroyed) return;
      this.fail(error, stage);
    }
    this.report();
  }

  /** Fail open: `active()` flips false and every directive restores readable text. */
  private fail(error: unknown, stage: Stage): void {
    const failure = describeFailure(error, stage);
    console.error(
      `[veneer] disabled (${failure.code}) - could not build the protective font, so text ` +
        `is shown readable. See ${docsUrl(failure.code)}`,
      error,
    );
    this.failure.set(failure);
    this.isReady.set(true);
  }

  /**
   * The initial map, or when a face lacks glyphs for some of its characters,
   * a map redrawn without them (from the same seed, when one is configured).
   * Those characters then pass through unscrambled and render in the fallback
   * font. With several faces, only characters every face can draw stay in the
   * cipher.
   */
  private narrow(
    coveredCodepoints: Forge['coveredCodepoints'],
    bases: BaseFont[],
    initial: ScrambleMap,
  ): ScrambleMap {
    const scrambled = [...initial.forward.keys()];
    const covered = new Set(
      bases.reduce((candidates, base) => coveredCodepoints(base, candidates), scrambled),
    );
    const dropped = scrambled
      .filter((cp) => !covered.has(cp))
      .map((cp) => String.fromCodePoint(cp));
    if (dropped.length === 0) return initial;

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

    const charset = this.config.charset.filter((cp) => covered.has(cp) || !initial.forward.has(cp));
    try {
      return this.drawMap(charset);
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

/** A failure while building the cipher on the server. */
function describeServerFailure(error: unknown): VeneerFailure {
  const message = error instanceof Error ? error.message : String(error);
  const missing = (error as { missing?: unknown } | null)?.missing;
  if (Array.isArray(missing) && missing.length > 0) {
    return { code: 'VNR012', message, missing: [...missing], cause: error };
  }
  return { code: 'VNR015', message, cause: error };
}
