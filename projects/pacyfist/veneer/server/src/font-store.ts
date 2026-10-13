/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';

/**
 * The forged fonts this process has built, by id, for the middleware to serve.
 *
 * Kept on `globalThis` under a registered symbol, so server.ts and the app
 * share one store even if a bundler gives them separate copies of this module.
 */
const STORE = Symbol.for('@pacyfist/veneer/server:fonts');

/**
 * Fonts are built once per configuration per process (see
 * `provideVeneerServer`), so the store stays small. The cap only guards
 * against an app that creates a new configuration per request.
 */
const MAX_FONTS = 256;

function store(): Map<string, Uint8Array> {
  const holder = globalThis as { [STORE]?: Map<string, Uint8Array> };
  return (holder[STORE] ??= new Map());
}

/** @internal */
export function storeFont(id: string, bytes: Uint8Array): void {
  const fonts = store();
  fonts.set(id, bytes);
  while (fonts.size > MAX_FONTS) fonts.delete(fonts.keys().next().value!);
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
 * `dir` from that folder (a synchronous read). For servers that are not
 * Express or Connect: serve the bytes as `font/ttf`.
 */
export function getVeneerFont(
  path: string,
  options: VeneerFontDiskOptions = {},
): Uint8Array | undefined {
  const id = idOf(path);
  if (!id) return undefined;
  const bytes = store().get(id);
  if (bytes) return bytes;
  const file = fileOf(id, options);
  if (!file) return undefined;
  try {
    return readFileSync(file);
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
    const bytes = id && store().get(id);
    if (bytes) return send(req, res, bytes);
    const file = id && fileOf(id, options);
    if (!file) return next?.();
    readFile(file).then(
      (data) => send(req, res, data),
      () => next?.(),
    );
  };
}
