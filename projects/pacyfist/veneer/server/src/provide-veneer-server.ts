/// <reference types="node" />
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  EnvironmentProviders,
  InjectionToken,
  REQUEST,
  REQUEST_CONTEXT,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import {
  type VeneerFontSource,
  type ɵResolvedVeneerConfig as ResolvedVeneerConfig,
  type ɵVeneerServerCipher as VeneerServerCipher,
  type ɵVeneerServerForge as VeneerServerForge,
  ɵVENEER_SERVER_FORGE as VENEER_SERVER_FORGE,
} from '@pacyfist/veneer';
import { type ScrambleMap, buildScrambleMap, randomScrambleMap } from '@pacyfist/veneer/core';
import {
  type BaseFont,
  VeneerFontError,
  coveredCodepoints,
  forgeScrambledFont,
  parseBaseFontSync,
} from '@pacyfist/veneer/forge';
import { storeFont } from './font-store';

/** Reads a base font on the server, given the source written in `provideVeneer()`. */
export type VeneerServerFontReader = (source: VeneerFontSource) => ArrayBuffer | Uint8Array;

/**
 * Decides, per request, whether a dynamic server render is protected. Gets the
 * request Angular renders (`REQUEST`) and whatever server.ts passed as the
 * second argument of `angularApp.handle(req, context)` (`REQUEST_CONTEXT`).
 * Return (or resolve to) `false` to render that page readable; anything else
 * protects it.
 */
export type VeneerShouldProtect = (
  request: Request,
  context: unknown,
) => boolean | Promise<boolean>;

export interface VeneerServerOptions {
  /**
   * Where the server reads base fonts. The browser fetches `font` (and every
   * `withFaces()` source) by URL, which a server render cannot do.
   *
   * - A directory: each relative URL source, such as
   *   `'fonts/Roboto-Regular.ttf'`, is read from that directory, so point it
   *   at the folder the URL is served from (your `public` folder, or the
   *   browser build output: `join(import.meta.dirname, '../browser')` from
   *   the server bundle). Sources given as bytes are used as they are.
   * - A function: returns the bytes for a source, synchronously.
   *
   * TrueType (.ttf) or CFF OpenType (.otf) only; WOFF needs an asynchronous
   * decoder that a synchronous render cannot wait for.
   */
  fonts: string | VeneerServerFontReader;

  /**
   * The URL path, relative to the document base URL, the page fetches forged
   * fonts from: `<path>/<random id>.ttf`. Defaults to `'veneer'`.
   */
  path?: string;

  /**
   * Also write every forged font to `<emitDir>/<path>/<id>.ttf`. For
   * prerendered (static) output, where no server is left to serve them: copy
   * the folder's contents into the browser output after the build. Use a
   * folder outside the build output, because the Angular builder empties its
   * output after prerendering.
   */
  emitDir?: string;

  /**
   * Decide per request whether to protect the page, typically to serve
   * verified search crawlers readable text (see `verifyCrawler()`).
   *
   * Dynamic SSR only (`RenderMode.Server`, with `AngularNodeAppEngine` or
   * `AngularAppEngine`). It is never called when there is no request:
   * prerendered (SSG) pages, route extraction at build time, and
   * `CommonEngine`, which provides no `REQUEST`. Those are always protected,
   * so a prerendered page cannot be unprotected for a crawler.
   *
   * When it returns `false` the render scrambles nothing, forges no font,
   * puts no font URL in the page, and the browser that hydrates the page
   * keeps the text readable (status `disabled`). Only an explicit `false`
   * turns protection off. If it throws or rejects, the page is protected
   * (VNR017): an error means the visitor could not be verified, and failing
   * towards readable text would let anyone who can make the check fail read
   * the page. Protected pages look the same to people, so the cost of that
   * choice is a crawler occasionally seeing protected text.
   *
   * The request Angular sees is a Fetch `Request`, without the client's IP
   * address. To check the IP, do it in server.ts and pass the result as
   * context: `angularApp.handle(req, { crawler: await verifyCrawler(...) })`.
   *
   * Serving crawlers something users do not get can count as cloaking. Here
   * the visible text is the same, only its encoding differs, but whether a
   * search engine agrees is its call: verify with your SEO team. And text you
   * unprotect for a crawler is also readable to that operator's other uses,
   * such as AI training.
   */
  shouldProtect?: VeneerShouldProtect;
}

/** Whether this application's render is protected; one per application (request). */
interface ProtectDecision {
  protect: boolean;
}

const PROTECT_DECISION = new InjectionToken<ProtectDecision>('VENEER_PROTECT_DECISION');

/** shouldProtect errors already logged, so each is reported once per process. */
const loggedHookErrors = new Set<string>();

/**
 * Runs the hook for this application's request, before the app renders.
 * Without a request (prerendering, build-time route extraction, CommonEngine)
 * it does nothing, and the page stays protected.
 */
async function decide(shouldProtect: VeneerShouldProtect): Promise<void> {
  const decision = inject(PROTECT_DECISION);
  const request = inject(REQUEST, { optional: true });
  if (!request) return;
  const context = inject(REQUEST_CONTEXT, { optional: true });
  try {
    decision.protect = (await shouldProtect(request, context)) !== false;
  } catch (error) {
    decision.protect = true;
    const key = error instanceof Error ? error.message : String(error);
    if (!loggedHookErrors.has(key)) {
      loggedHookErrors.add(key);
      if (loggedHookErrors.size > 64) loggedHookErrors.clear();
      console.error(
        '[veneer] VNR017: shouldProtect threw, so this page is rendered protected. See ' +
          'https://github.com/pacyfist/veneer/blob/main/projects/pacyfist/veneer/README.md#vnr017',
        error,
      );
    }
  }
}

/** Parsed base fonts per absolute path: one read and one parse per process. */
const byPath = new Map<string, BaseFont>();
/** Parsed base fonts per byte buffer, by identity. */
const byBytes = new WeakMap<object, BaseFont>();

/** Dropped-character sets already warned about. */
const warned = new Set<string>();

declare const ngDevMode: boolean | undefined;

function message(text: string): string {
  return `[veneer] VNR015: ${text} See https://github.com/pacyfist/veneer/blob/main/projects/pacyfist/veneer/README.md#vnr015`;
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return data instanceof Uint8Array
    ? data
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
}

/** The file a relative URL names inside `root`, refusing anything outside it. */
function fileFor(root: string, url: string): string {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)) {
    throw new Error(
      message(
        `the font '${url}' is an absolute URL, and the server reads fonts from disk. Pass ` +
          '`fonts` to provideVeneerServer() as a function that returns its bytes.',
      ),
    );
  }
  const base = resolve(root);
  const file = resolve(base, decodeURIComponent(url.split(/[?#]/)[0]).replace(/^\/+/, ''));
  if (!file.startsWith(base + sep)) {
    throw new Error(message(`the font '${url}' resolves outside ${base}.`));
  }
  return file;
}

function loadBase(source: VeneerFontSource, fonts: string | VeneerServerFontReader): BaseFont {
  if (typeof fonts === 'function') {
    const bytes = fonts(source);
    const cached = byBytes.get(bytes);
    if (cached) return cached;
    const base = parseBaseFontSync(bytes);
    byBytes.set(bytes, base);
    return base;
  }
  if (typeof source === 'string') {
    const file = fileFor(fonts, source);
    let base = byPath.get(file);
    if (!base) {
      let bytes: Uint8Array;
      try {
        bytes = readFileSync(file);
      } catch (cause) {
        throw new Error(
          message(
            `could not read the base font '${source}' from ${file} ` +
              `(${(cause as Error)?.message ?? cause}). Set provideVeneerServer({ fonts }) to the ` +
              'folder that holds your public font files.',
          ),
        );
      }
      base = parseBaseFontSync(bytes);
      byPath.set(file, base);
    }
    return base;
  }
  if (typeof source === 'function') {
    throw new Error(
      message(
        'a font loader function cannot be awaited during a server render. Pass `fonts` to ' +
          'provideVeneerServer() as a function that returns the bytes synchronously.',
      ),
    );
  }
  let base = byBytes.get(source);
  if (!base) {
    base = parseBaseFontSync(toBytes(source));
    byBytes.set(source, base);
  }
  return base;
}

/**
 * The map the server renders with. From the CSPRNG (or the configured seed),
 * over the charset the base fonts can draw, and without two scrambled
 * codepoints on one glyph of the regular face, which the browser could not
 * tell apart when it reads the map back from the font.
 */
function buildMap(config: ResolvedVeneerConfig, bases: readonly BaseFont[]): ScrambleMap {
  const draw = (charset: readonly number[]) =>
    config.seed !== undefined ? buildScrambleMap(config.seed, charset) : randomScrambleMap(charset);

  const first = draw(config.charset);
  const scrambled = [...first.forward.keys()];
  const covered = new Set(
    bases.reduce((candidates, base) => coveredCodepoints(base, candidates), scrambled),
  );
  const missing = scrambled.filter((cp) => !covered.has(cp));
  const chars = (cps: number[]) => cps.map((cp) => String.fromCodePoint(cp));
  if (missing.length && config.strictCoverage) {
    throw new VeneerFontError(
      `[veneer] the base font has no glyph for ${missing.length} character(s) in the charset: ` +
        `${chars(missing).join('')}.`,
      chars(missing),
    );
  }
  if (missing.length && (typeof ngDevMode === 'undefined' || ngDevMode)) {
    const key = chars(missing).join('');
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        `[veneer] VNR014: the base font${bases.length > 1 ? 's have' : ' has'} no glyph for ` +
          `${missing.length} charset character(s): ${key}. They are left out of the cipher.`,
      );
    }
  }

  const dropped = new Set(missing);
  let map = first;
  for (;;) {
    if (dropped.size) {
      try {
        map = draw(config.charset.filter((cp) => !dropped.has(cp)));
      } catch {
        throw new VeneerFontError(
          '[veneer] the base font covers too little of the charset to scramble anything.',
          chars(missing),
        );
      }
    }
    const owners = new Map<number, number[]>();
    for (const cp of map.forward.keys()) {
      const glyph = bases[0].glyphId(cp);
      owners.set(glyph, [...(owners.get(glyph) ?? []), cp]);
    }
    const shared = [...owners.values()].filter((list) => list.length > 1).flat();
    if (shared.length === 0) return map;
    for (const cp of shared) dropped.add(cp);
  }
}

/** A stable key for one configuration, so each is forged once per process. */
function fingerprint(config: ResolvedVeneerConfig, idOf: (source: object) => number): string {
  const source = (src: VeneerFontSource) =>
    typeof src === 'string' ? `url:${src}` : `object:${idOf(src)}`;
  return JSON.stringify([
    source(config.font),
    config.faces.map((f) => [source(f.src), f.weight ?? null, f.style ?? null, f.stretch ?? null]),
    [...config.charset],
    config.strictCoverage,
    config.seed ?? null,
  ]);
}

function trimPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed || 'veneer';
}

/**
 * Server rendering with the key kept out of the HTML. Add it to your server
 * config, next to `provideServerRendering()`:
 *
 * ```ts
 * // app.config.server.ts
 * provideVeneerServer({ fonts: join(import.meta.dirname, '../browser') }),
 * ```
 *
 * and serve the fonts from server.ts with `veneerFontMiddleware()`.
 *
 * During a render the server draws the cipher from the CSPRNG, forges the
 * font (the base font with only its cmap replaced) and scrambles with it. The
 * page carries only the forged font's URL and a random family name. The
 * browser fetches that font, reads the cipher out of its cmap, and only then
 * recovers the readable text. A crawler that reads the HTML gets ciphertext
 * and no key; it has to fetch and parse the font, as a browser does.
 *
 * Each configuration gets one cipher per server process (per build, when
 * prerendering), shared by every request, so the font is fetched once per
 * visitor and cached. See the README for why not one per request.
 */
export function provideVeneerServer(options: VeneerServerOptions): EnvironmentProviders {
  const path = trimPath(options.path ?? 'veneer');
  const ciphers = new Map<string, VeneerServerCipher>();
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const idOf = (source: object) => {
    let id = ids.get(source);
    if (id === undefined) ids.set(source, (id = ++nextId));
    return id;
  };

  const forge: Omit<VeneerServerForge, 'protects'> = {
    prepare(config) {
      const key = fingerprint(config, idOf);
      const cached = ciphers.get(key);
      if (cached) return cached;

      const sources = [config.font, ...config.faces.map((face) => face.src)];
      const bases = sources.map((source) => loadBase(source, options.fonts));
      const map = buildMap(config, bases);
      const familyName = `Veneer-${randomBytes(8).toString('hex')}`;
      const urls = bases.map((base) => {
        const bytes = new Uint8Array(forgeScrambledFont(base, map, familyName));
        const id = randomBytes(16).toString('hex');
        storeFont(id, bytes);
        if (options.emitDir) {
          const dir = join(options.emitDir, path);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `${id}.ttf`), bytes);
        }
        return `${path}/${id}.ttf`;
      });

      const cipher = { map, familyName, urls };
      ciphers.set(key, cipher);
      // Only an app that builds a new configuration per request gets here
      // often; keep its memory bounded (the font store is capped too).
      if (ciphers.size > 256) ciphers.delete(ciphers.keys().next().value!);
      return cipher;
    },
  };

  const shouldProtect = options.shouldProtect;
  if (!shouldProtect) {
    return makeEnvironmentProviders([
      { provide: VENEER_SERVER_FORGE, useValue: { ...forge, protects: () => true } },
    ]);
  }
  return makeEnvironmentProviders([
    // A fresh decision per application, and the server bootstraps one
    // application per request. Protected until the hook says otherwise, so
    // anything that renders before it settles is protected.
    { provide: PROTECT_DECISION, useFactory: (): ProtectDecision => ({ protect: true }) },
    {
      provide: VENEER_SERVER_FORGE,
      useFactory: (): VeneerServerForge => {
        const decision = inject(PROTECT_DECISION);
        return { ...forge, protects: () => decision.protect };
      },
    },
    provideAppInitializer(() => decide(shouldProtect)),
  ]);
}
