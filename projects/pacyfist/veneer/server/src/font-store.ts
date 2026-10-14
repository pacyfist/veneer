/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';

/**
 * The forged fonts this process has built, by id, for the middleware to serve,
 * grouped by the cipher they belong to.
 *
 * Kept on `globalThis` under a registered symbol, so server.ts and the app
 * share one store even if a bundler gives them separate copies of this module.
 */
const STORE = Symbol.for('@pacyfist/veneer/server:fonts/v2');

/** One cipher's fonts (one per face). Kept and evicted together. */
export interface FontGroup {
  readonly ids: readonly string[];
  /** Called when the group is evicted, so the cipher is dropped with it. */
  readonly onEvict: () => void;
}

interface Store {
  /** Font bytes by id, with how many groups hold each (a secret repeats ids). */
  readonly fonts: Map<string, { readonly bytes: Uint8Array; refs: number }>;
  /** Groups from least to most recently used. */
  readonly groups: Set<FontGroup>;
}

/**
 * Fonts are built once per configuration per process (see
 * `provideVeneerServer`), so the store stays small. The cap, counted in fonts
 * so `withFaces()` cannot get round it, only matters for an app that creates
 * many configurations, such as a charset per page.
 */
let maxFonts = 256;

function store(): Store {
  const holder = globalThis as { [STORE]?: Store };
  return (holder[STORE] ??= { fonts: new Map(), groups: new Set() });
}

/** @internal Tests only: changes the cap and returns the previous one. */
export function setMaxFonts(max: number): number {
  const previous = maxFonts;
  maxFonts = max;
  return previous;
}

function evict(fonts: Store, group: FontGroup): void {
  fonts.groups.delete(group);
  for (const id of group.ids) {
    const entry = fonts.fonts.get(id);
    if (entry && --entry.refs === 0) fonts.fonts.delete(id);
  }
  group.onEvict();
}

/**
 * Stores one cipher's fonts as a group. While over the cap, the least
 * recently used groups go first, each with its fonts and its cipher
 * (`onEvict`), never a font on its own. The new group is never evicted, even
 * if it alone is over the cap.
 *
 * @internal
 */
export function storeFonts(
  fonts: readonly { readonly id: string; readonly bytes: Uint8Array }[],
  onEvict: () => void,
): FontGroup {
  const held = store();
  for (const { id, bytes } of fonts) {
    const entry = held.fonts.get(id);
    if (entry) entry.refs++;
    else held.fonts.set(id, { bytes, refs: 1 });
  }
  const group: FontGroup = { ids: fonts.map((font) => font.id), onEvict };
  held.groups.add(group);
  for (const oldest of held.groups) {
    if (held.fonts.size <= maxFonts || oldest === group) break;
    evict(held, oldest);
  }
  return group;
}

/** Marks a group as just used, so it is evicted last. @internal */
export function touchFonts(group: FontGroup): void {
  const held = store();
  if (held.groups.delete(group)) held.groups.add(group);
}

/** `path` without trailing slashes; `'veneer'` when nothing is left. */
export function trimPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed || 'veneer';
}

/** Where forged fonts are also found on disk. */
export interface VeneerFontDiskOptions {
  /**
   * The folder `provideVeneerServer({ emitDir })` writes to. A font this
   * process does not hold in memory is then read from
   * `<dir>/<path>/<id>.ttf`, so an instance that never rendered a page (a
   * replica, or this one after a restart) can serve its font when the folder
   * is shared.
   */
  dir?: string;
  /** The `path` given to `provideVeneerServer()`. Defaults to `'veneer'`. */
  path?: string;
}

/**
 * Fonts read from the disk fallback, kept so a repeat request is served from
 * memory instead of the (possibly network) filesystem. A font id never changes
 * content, so a cached copy cannot go stale. Bounded, least recently used out.
 */
const DISK_CACHE_SIZE = 32;
const diskCache = new Map<string, Uint8Array>();

function cachedFromDisk(id: string): Uint8Array | undefined {
  const bytes = diskCache.get(id);
  if (bytes) {
    diskCache.delete(id);
    diskCache.set(id, bytes);
  }
  return bytes;
}

function rememberFromDisk(id: string, bytes: Uint8Array): Uint8Array {
  diskCache.set(id, bytes);
  while (diskCache.size > DISK_CACHE_SIZE) diskCache.delete(diskCache.keys().next().value!);
  return bytes;
}

/** @internal Tests only. */
export function clearDiskCache(): void {
  diskCache.clear();
}

/** A forged-font file name: 128 bits in hex, nothing else. */
const FILE = /\/([0-9a-f]{32})\.ttf$/;

/** The font id a request path names, or undefined. */
function idOf(path: string): string | undefined {
  return FILE.exec(path.split(/[?#]/)[0])?.[1];
}

/**
 * The file a validated id lives in under `dir`. The id is 32 hex digits, so
 * it cannot leave the folder.
 */
function fileOf(id: string, options: VeneerFontDiskOptions): string | undefined {
  return options.dir
    ? join(resolve(options.dir), trimPath(options.path ?? 'veneer'), `${id}.ttf`)
    : undefined;
}

/**
 * The bytes of a forged font by the path or URL the page references
 * (`.../veneer/<id>.ttf`), or undefined: from this process's memory, or with
 * `dir` from that folder (a synchronous read, cached for repeats). For servers that are not
 * Express or Connect: serve the bytes as `font/ttf`.
 */
export function getVeneerFont(
  path: string,
  options: VeneerFontDiskOptions = {},
): Uint8Array | undefined {
  const id = idOf(path);
  if (!id) return undefined;
  const bytes = store().fonts.get(id)?.bytes ?? cachedFromDisk(id);
  if (bytes) return bytes;
  const file = fileOf(id, options);
  if (!file) return undefined;
  try {
    return rememberFromDisk(id, readFileSync(file));
  } catch {
    return undefined;
  }
}

/**
 * Serves the forged fonts `provideVeneerServer()` builds during server
 * rendering. Add it to your server before the Angular request handler:
 *
 * ```ts
 * import { veneerFontMiddleware } from '@pacyfist/veneer/server';
 *
 * app.use(veneerFontMiddleware());
 * ```
 *
 * It answers GET and HEAD for `<anything>/<id>.ttf` where `<id>` is a font
 * this process built, or, with `dir`, a font in `<dir>/<path>/<id>.ttf`, and
 * passes every other request on. Font URLs never change content, so they are
 * sent as cacheable for a year.
 *
 * Without `dir` the fonts live only in this process's memory: behind a load
 * balancer a font request must reach the instance that rendered the page
 * (sticky sessions). With `provideVeneerServer({ secret, emitDir })` and
 * `dir` set to that shared `emitDir`, any instance serves any page's font.
 * See the README.
 */
export function veneerFontMiddleware(
  options: VeneerFontDiskOptions = {},
): (req: IncomingMessage, res: ServerResponse, next?: (error?: unknown) => void) => void {
  const send = (req: IncomingMessage, res: ServerResponse, bytes: Uint8Array) => {
    res.writeHead(200, {
      'Content-Type': 'font/ttf',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  };
  return (req, res, next) => {
    const id = req.method === 'GET' || req.method === 'HEAD' ? idOf(req.url ?? '') : undefined;
    const bytes = id && (store().fonts.get(id)?.bytes ?? cachedFromDisk(id));
    if (bytes) return send(req, res, bytes);
    const file = id && fileOf(id, options);
    if (!file) return next?.();
    readFile(file).then(
      (data) => send(req, res, rememberFromDisk(id, data)),
      () => next?.(),
    );
  };
}
