import type { BaseFont } from '@pacyfist/veneer/forge';
import type { VeneerFontSource } from './veneer.config';
import { veneerMessage } from './veneer-errors';

/**
 * Loading and parsing the base font, shared by every `provideVeneer` instance
 * on the page.
 *
 * Internal: not part of the public API.
 */

/** Thrown when the base font bytes could not be obtained (fetch or loader). */
export class FontSourceError extends Error {
  constructor(
    message: string,
    /** The URL that was requested, when the source was a URL. */
    readonly url?: string,
  ) {
    super(message);
    this.name = 'FontSourceError';
  }
}

/**
 * Thrown when the forged font the server pointed at could not be fetched, or
 * does not decode against the base font (VNR016).
 */
export class ForgedFontError extends Error {
  constructor(
    message: string,
    /** The URL that was requested. */
    readonly url?: string,
  ) {
    super(message);
    this.name = 'ForgedFontError';
  }
}

/** How long to wait before the one retry of a request that failed for a transient reason. */
export const RETRY_DELAY_MS = 300;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Statuses worth one more try: a timeout, rate limiting, or a server error
 * (often a deploy or restart in progress). A 404 or 403 will not change.
 */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * `fetch`, retried once after a short delay when the request fails at the
 * network level or with a transient status. Returns the last response, or
 * throws the last network error.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  try {
    const response = await fetch(url);
    if (!isTransientStatus(response.status)) return response;
  } catch {
    // Offline for a moment, a dropped connection: try once more below.
  }
  await wait(RETRY_DELAY_MS);
  return fetch(url);
}

/** Fetch a forged font the server rendered with. */
export async function fetchForgedFont(source: string, baseUrl: string): Promise<ArrayBuffer> {
  const url = resolveFontUrl(source, baseUrl);
  const hint =
    'The server rendered this page with that font, so without it the page cannot be decoded. ' +
    'Check that the server mounts veneerFontMiddleware() or, for prerendered pages, that the ' +
    "emitted fonts were copied into the browser output (see provideVeneerServer's `emitDir`).";
  let response: Response;
  try {
    response = await fetchWithRetry(url);
  } catch (cause) {
    const reason = (cause as Error)?.message ?? String(cause);
    throw new ForgedFontError(
      veneerMessage('VNR016', `could not fetch the forged font from ${url} (${reason}). ${hint}`),
      url,
    );
  }
  if (!response.ok) {
    const status = [response.status, response.statusText].filter(Boolean).join(' ');
    throw new ForgedFontError(
      veneerMessage('VNR016', `the forged font request for ${url} failed: ${status}. ${hint}`),
      url,
    );
  }
  return response.arrayBuffer();
}

const SUBPATH_HINT =
  'Check that the file is served at that URL. A relative path such as ' +
  "'fonts/Roboto-Regular.ttf' resolves against the document base URL (<base href>); " +
  "a leading slash ('/fonts/...') ignores it and breaks when the app is deployed under a subpath.";

/** The absolute URL `fetch` would request for `source`, given the document base URL. */
export function resolveFontUrl(source: string, baseUrl: string): string {
  return new URL(source, baseUrl).href;
}

/** Fetch the bytes at an absolute URL, with the URL and a hint in any error. */
async function fetchFont(url: string): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetchWithRetry(url);
  } catch (cause) {
    const reason = (cause as Error)?.message ?? String(cause);
    throw new FontSourceError(
      veneerMessage('VNR010', `could not fetch the base font from ${url} (${reason}).`),
      url,
    );
  }
  if (!response.ok) {
    const status = [response.status, response.statusText].filter(Boolean).join(' ');
    throw new FontSourceError(
      veneerMessage(
        'VNR010',
        `the base font request for ${url} failed: ${status}. ${SUBPATH_HINT}`,
      ),
      url,
    );
  }
  return response.arrayBuffer();
}

/**
 * The base font bytes for a source: fetched for a URL (resolved against
 * `baseUrl`), awaited for a loader, returned as is for bytes.
 */
export async function resolveFontSource(
  source: VeneerFontSource,
  baseUrl: string,
): Promise<ArrayBuffer> {
  if (typeof source === 'string') return fetchFont(resolveFontUrl(source, baseUrl));
  if (typeof source !== 'function') return source;
  try {
    return await source();
  } catch (cause) {
    if (cause instanceof FontSourceError) throw cause;
    const reason = (cause as Error)?.message ?? String(cause);
    throw new FontSourceError(
      veneerMessage('VNR010', `the base font loader rejected (${reason}).`),
    );
  }
}

/** The `@pacyfist/veneer/forge` module. */
export type Forge = typeof import('@pacyfist/veneer/forge');

/** The dynamic import of the forge chunk. Swappable in tests. */
let importForge = (): Promise<Forge> => import('@pacyfist/veneer/forge');

let forge: Promise<Forge> | undefined;

/**
 * The font forge, loaded on first use.
 *
 * A dynamic import of its own entry point, so bundlers put the forge (and
 * WOFF decoding) in a lazy chunk instead of the app's initial bundle. The
 * cipher stays in the main bundle: it has to run synchronously, on the server
 * too. A failed chunk load is retried once after a short delay (a redeploy
 * or a dropped connection), and a final failure is not cached.
 */
export function loadForge(): Promise<Forge> {
  forge ??= importForge()
    .catch(async () => {
      await wait(RETRY_DELAY_MS);
      return importForge();
    })
    .catch((cause) => {
      forge = undefined;
      const reason = (cause as Error)?.message ?? String(cause);
      throw new FontSourceError(
        veneerMessage('VNR010', `could not load the font forge (${reason}).`),
      );
    });
  return forge;
}

/**
 * Replace how the forge chunk is imported (`loadForge` still retries it once).
 * Tests only; returns a function that restores the real import.
 */
export function stubForgeImport(load: () => Promise<Forge>): () => void {
  const real = importForge;
  importForge = load;
  forge = undefined;
  return () => {
    importForge = real;
    forge = undefined;
  };
}

/** Parsed fonts per URL: one fetch and one parse per page, however many instances ask. */
const byUrl = new Map<string, Promise<BaseFont>>();

/** Parsed fonts per ArrayBuffer or loader function, by identity. */
const byObject = new WeakMap<object, Promise<BaseFont>>();

/**
 * The parsed base font for `source`, shared across instances.
 *
 * In-flight and finished loads are cached by resolved URL (a string source) or
 * by identity (bytes or a loader). A load that fails is dropped from the
 * cache, so the next caller retries rather than inheriting the failure.
 */
export function loadBaseFont(
  source: VeneerFontSource,
  baseUrl: string,
  parse: (bytes: ArrayBuffer) => Promise<BaseFont>,
): Promise<BaseFont> {
  const url = typeof source === 'string' ? resolveFontUrl(source, baseUrl) : undefined;
  const cached = url !== undefined ? byUrl.get(url) : byObject.get(source as object);
  if (cached) return cached;

  const pending = resolveFontSource(url ?? source, baseUrl).then(parse);
  if (url !== undefined) byUrl.set(url, pending);
  else byObject.set(source as object, pending);

  pending.catch(() => {
    if (url !== undefined) {
      if (byUrl.get(url) === pending) byUrl.delete(url);
    } else if (byObject.get(source as object) === pending) {
      byObject.delete(source as object);
    }
  });
  return pending;
}

/** Forget every cached font. Tests only. */
export function clearBaseFontCache(): void {
  byUrl.clear();
}
