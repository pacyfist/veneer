/// <reference types="node" />
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  ɵwarnUncovered as warnUncovered,
} from '@pacyfist/veneer';
import { type ScrambleMap, buildScrambleMap, randomScrambleMap } from '@pacyfist/veneer/core';
import {
  type BaseFont,
  VeneerFontError,
  forgeScrambledFont,
  parseBaseFontSync,
  uncoveredCodepoints,
} from '@pacyfist/veneer/forge';
import { type FontGroup, storeFonts, touchFonts, trimPath } from './font-store';

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
   * fonts from: `<path>/<id>.ttf`. Defaults to `'veneer'`.
   */
  path?: string;

  /**
   * Also write every forged font to `<emitDir>/<path>/<id>.ttf`.
   *
   * - Prerendered (static) output, where no server is left to serve them:
   *   copy the folder's contents into the browser output after the build. Use
   *   a folder outside the build output, because the Angular builder empties
   *   its output after prerendering.
   * - Dynamic SSR with several instances or restarts: point it at storage
   *   every instance shares and pass the same folder to
   *   `veneerFontMiddleware({ dir })`, so an instance that never rendered a
   *   page can still serve its font.
   *
   * Each file is written once, atomically (a temporary file, then a rename).
   */
  emitDir?: string;

  /**
   * A server-side secret that makes the cipher deterministic: the map, the
   * family name and the font ids become HMAC-SHA256 derivations of the
   * secret, the base font bytes and the configuration. Every process, every
   * restart and every replica with the same secret then forges byte-identical
   * fonts at identical URLs, so a page rendered by one instance decodes with
   * the font from any other, and a rebuilt static site keeps its font URLs.
   *
   * Read it from the environment: `secret: process.env['VENEER_SECRET']`.
   * Use 32 random bytes (`openssl rand -hex 32`); shorter than 16 bytes
   * throws. An empty string counts as no secret, so an unset CI secret
   * builds the random way instead of failing.
   *
   * The cipher stays the same until the secret, a base font or the
   * configuration (charset, faces, seed, strictCoverage) changes: as strong
   * as one cipher per build, which prerendering has anyway. Rotate the secret
   * to rotate every cipher; pages rendered before then need the old fonts
   * (keep them in `emitDir`, or let cached HTML expire first). Keep it out of
   * the browser bundle: only server code (app.config.server.ts, server.ts)
   * may read it, and the browser never needs it.
   *
   * Without a secret each process draws its cipher, family name and font ids
   * from the CSPRNG, so a page decodes only with the font of the process that
   * rendered it: use sticky sessions, or a shared `emitDir`.
   */
  secret?: string | Uint8Array;

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

/** A parsed base font and the SHA-256 of its bytes. */
interface LoadedBase {
  readonly base: BaseFont;
  readonly digest: string;
}

/** Parsed base fonts per absolute path: one read and one parse per process. */
const byPath = new Map<string, LoadedBase>();
/** Parsed base fonts per content hash. */
const byDigest = new Map<string, LoadedBase>();
/** Content hashes per byte buffer, by identity, so a buffer is hashed once. */
const digests = new WeakMap<object, string>();

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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The SHA-256 of a byte source, cached per object. */
function digestOf(data: ArrayBuffer | ArrayBufferView): string {
  let digest = digests.get(data);
  if (digest === undefined) digests.set(data, (digest = sha256(toBytes(data))));
  return digest;
}

function loadBytes(data: ArrayBuffer | ArrayBufferView): LoadedBase {
  const digest = digestOf(data);
  let loaded = byDigest.get(digest);
  if (!loaded) {
    loaded = { base: parseBaseFontSync(toBytes(data)), digest };
    byDigest.set(digest, loaded);
  }
  return loaded;
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

function loadBase(source: VeneerFontSource, fonts: string | VeneerServerFontReader): LoadedBase {
  if (typeof fonts === 'function') return loadBytes(fonts(source));
  if (typeof source === 'string') {
    const file = fileFor(fonts, source);
    let loaded = byPath.get(file);
    if (!loaded) {
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
      loaded = { base: parseBaseFontSync(bytes), digest: sha256(bytes) };
      byPath.set(file, loaded);
    }
    return loaded;
  }
  if (typeof source === 'function') {
    throw new Error(
      message(
        'a font loader function cannot be awaited during a server render. Pass `fonts` to ' +
          'provideVeneerServer() as a function that returns the bytes synchronously.',
      ),
    );
  }
  return loadBytes(source);
}

/**
 * The map the server renders with. From the CSPRNG, a stream derived from
 * the secret, or the configured seed,
 * over the charset the base fonts can draw, and without two scrambled
 * codepoints on one glyph of the regular face, which the browser could not
 * tell apart when it reads the map back from the font.
 */
function buildMap(
  config: ResolvedVeneerConfig,
  bases: readonly BaseFont[],
  random?: () => () => number,
): ScrambleMap {
  // A fresh stream per draw, so a redraw without some characters is as
  // reproducible as the first one when the stream comes from the secret.
  const draw = (charset: readonly number[]) =>
    config.seed !== undefined
      ? buildScrambleMap(config.seed, charset)
      : randomScrambleMap(charset, random?.());

  const first = draw(config.charset);
  const missing = uncoveredCodepoints(bases, first.forward.keys());
  const chars = (cps: number[]) => cps.map((cp) => String.fromCodePoint(cp));
  if (missing.length && config.strictCoverage) {
    throw new VeneerFontError(
      `[veneer] the base font has no glyph for ${missing.length} character(s) in the charset: ` +
        `${chars(missing).join('')}.`,
      chars(missing),
    );
  }
  // The same VNR014 warning, once per character set, as the browser gives.
  warnUncovered(missing, bases.length);

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

/**
 * A key for one configuration, so each is forged once per process. Byte
 * sources count by content, so a fresh copy of the same font is a cache hit.
 */
function fingerprint(config: ResolvedVeneerConfig, idOf: (source: object) => number): string {
  const source = (src: VeneerFontSource) =>
    typeof src === 'string'
      ? `url:${src}`
      : typeof src === 'function'
        ? `loader:${idOf(src)}`
        : `bytes:${digestOf(src)}`;
  return JSON.stringify([
    source(config.font),
    config.faces.map((f) => [source(f.src), f.weight ?? null, f.style ?? null, f.stretch ?? null]),
    [...config.charset],
    config.strictCoverage,
    config.seed ?? null,
  ]);
}

/** Bumped when the derivation changes, so old and new never share a font URL. */
const DERIVATION = 'veneer/server/v1';

/** The secret as bytes, or undefined when there is none. */
function secretKey(secret: string | Uint8Array | undefined): Buffer | undefined {
  if (secret === undefined || secret === null) return undefined;
  const bytes = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret);
  if (bytes.byteLength === 0) return undefined;
  if (bytes.byteLength < 16) {
    throw new Error(
      `[veneer] provideVeneerServer({ secret }) needs at least 16 bytes, got ${bytes.byteLength}. ` +
        'Use 32 random bytes, such as the output of `openssl rand -hex 32`.',
    );
  }
  return bytes;
}

/**
 * The per-configuration key: HMAC-SHA256 of the secret over what decides the
 * forged fonts, by content (base font bytes, not URLs or object identity), so
 * every process derives the same one.
 */
function configKey(secret: Buffer, config: ResolvedVeneerConfig, bases: LoadedBase[]): Buffer {
  const material = JSON.stringify([
    bases.map((loaded) => loaded.digest),
    config.faces.map((f) => [f.weight ?? null, f.style ?? null, f.stretch ?? null]),
    [...new Set(config.charset)].sort((a, b) => a - b),
    config.strictCoverage,
    config.seed ?? null,
  ]);
  return createHmac('sha256', secret).update(`${DERIVATION}\0config\0${material}`).digest();
}

/** The first `bytes` bytes of HMAC-SHA256(key, label), in hex. */
function derive(key: Buffer, label: string, bytes: number): string {
  return createHmac('sha256', key)
    .update(label)
    .digest('hex')
    .slice(0, bytes * 2);
}

/**
 * Numbers in [0, 1) from HMAC-SHA256(key, label || counter), 32 bits each: a
 * deterministic stand-in for the CSPRNG that `randomScrambleMap` shuffles with.
 */
function keyedRandom(key: Buffer, label: string): () => number {
  let counter = 0;
  let block = Buffer.alloc(0);
  let next = 0;
  return () => {
    if (next === block.byteLength) {
      block = createHmac('sha256', key).update(`${label}\0${counter++}`).digest();
      next = 0;
    }
    const word = block.readUInt32BE(next);
    next += 4;
    return word / 4294967296;
  };
}

/** Writes a font once, atomically, so a reader never sees half a file. */
function emit(dir: string, id: string, bytes: Uint8Array): void {
  const file = join(dir, `${id}.ttf`);
  // With a secret the id covers the bytes, so an existing file is this font.
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, file);
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
 * During a render the server draws the cipher from the CSPRNG (or derives it
 * from `secret`), forges the font (the base font with only its cmap replaced)
 * and scrambles with it. The page carries only the forged font's URL and the
 * family name. The browser fetches that font, reads the cipher out of its
 * cmap, and only then recovers the readable text. A crawler that reads the
 * HTML gets ciphertext and no key; it has to fetch and parse the font, as a
 * browser does.
 *
 * Each configuration gets one cipher per server process (per build, when
 * prerendering), shared by every request, so the font is fetched once per
 * visitor and cached. With `secret`, every process and every build derives
 * the same one. See the README for why not one per request.
 */
export function provideVeneerServer(options: VeneerServerOptions): EnvironmentProviders {
  const path = trimPath(options.path ?? 'veneer');
  /** Per configuration, its cipher and the stored fonts it hands out. */
  const ciphers = new Map<string, { cipher: VeneerServerCipher; fonts: FontGroup }>();
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const idOf = (source: object) => {
    let id = ids.get(source);
    if (id === undefined) ids.set(source, (id = ++nextId));
    return id;
  };

  const secret = secretKey(options.secret);

  const forge: Omit<VeneerServerForge, 'protects'> = {
    prepare(config) {
      const key = fingerprint(config, idOf);
      const cached = ciphers.get(key);
      if (cached) {
        touchFonts(cached.fonts);
        return cached.cipher;
      }

      const sources = [config.font, ...config.faces.map((face) => face.src)];
      const loaded = sources.map((source) => loadBase(source, options.fonts));
      const bases = loaded.map((entry) => entry.base);
      const derived = secret && configKey(secret, config, loaded);

      const map = buildMap(config, bases, derived ? () => keyedRandom(derived, 'map') : undefined);
      const familyName = `Veneer-${derived ? derive(derived, 'family', 8) : randomBytes(8).toString('hex')}`;
      const fonts = bases.map((base, i) => {
        const bytes = new Uint8Array(forgeScrambledFont(base, map, familyName));
        // With a secret the id covers the forged bytes too, so a font URL
        // never changes content, even across library versions.
        const id = derived
          ? derive(derived, `font\0${i}\0${sha256(bytes)}`, 16)
          : randomBytes(16).toString('hex');
        if (options.emitDir) emit(join(options.emitDir, path), id, bytes);
        return { id, bytes };
      });

      const cipher = { map, familyName, urls: fonts.map(({ id }) => `${path}/${id}.ttf`) };
      // The cipher lives exactly as long as its fonts: when the store evicts
      // them (least recently used first), the cipher goes too, and the next
      // render forges it again (with a secret, at the same URLs). So a cached
      // cipher never hands out a URL whose font is gone.
      const entry: { cipher: VeneerServerCipher; fonts: FontGroup } = {
        cipher,
        fonts: storeFonts(fonts, () => {
          if (ciphers.get(key) === entry) ciphers.delete(key);
        }),
      };
      ciphers.set(key, entry);
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
