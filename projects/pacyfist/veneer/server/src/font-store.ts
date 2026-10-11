/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'node:http';

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

/** A forged-font file name: 128 random bits in hex. */
const FILE = /\/([0-9a-f]{32})\.ttf$/;

/**
 * The bytes of a forged font this process built, by the path or URL the page
 * references (`.../veneer/<id>.ttf`), or undefined. For servers that are not
 * Express or Connect: serve the bytes as `font/ttf`.
 */
export function getVeneerFont(path: string): Uint8Array | undefined {
  const id = FILE.exec(path.split(/[?#]/)[0])?.[1];
  return id ? store().get(id) : undefined;
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
 * this process built, and passes every other request on. Font URLs never
 * change content, so they are sent as cacheable for a year.
 *
 * The fonts live in this process's memory: behind a load balancer, a font
 * request must reach the instance that rendered the page (sticky sessions),
 * or prerender instead. See the README.
 */
export function veneerFontMiddleware(): (
  req: IncomingMessage,
  res: ServerResponse,
  next?: (error?: unknown) => void,
) => void {
  return (req, res, next) => {
    const bytes =
      req.method === 'GET' || req.method === 'HEAD' ? getVeneerFont(req.url ?? '') : undefined;
    if (!bytes) {
      next?.();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'font/ttf',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  };
}
