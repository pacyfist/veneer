/*
 * Public API Surface of @pacyfist/veneer/server
 *
 * Server rendering without the key in the HTML. The server builds the cipher
 * from the CSPRNG, forges the font itself and serves it at a URL; the page
 * carries only that URL. Node only: it reads fonts from disk. Import it from
 * your server config and server.ts, never from browser code.
 */

export { provideVeneerServer } from './provide-veneer-server';
export type { VeneerServerOptions, VeneerServerFontReader } from './provide-veneer-server';
export { veneerFontMiddleware, getVeneerFont } from './font-store';
