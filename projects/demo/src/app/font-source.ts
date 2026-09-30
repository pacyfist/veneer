/** The base font, relative to `<base href>`. */
const FONT_PATH = 'fonts/Roboto-Regular.ttf';

let pending: Promise<ArrayBuffer> | undefined;

/**
 * Resolve an asset path against `<base href>`.
 *
 * `fetch` resolves relative strings against the document URL rather than the
 * base href, which differ the moment the app is served from a subpath such as
 * /no-ai/. Going through `document.baseURI` keeps one string correct on both.
 */
export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/**
 * The base font bytes, fetched at most once per page.
 *
 * The shell and every config-lab card forge their own font from these same
 * bytes, so the .ttf crosses the network a single time. A failed fetch is not
 * cached — the next caller retries.
 */
export function baseFontBuffer(): Promise<ArrayBuffer> {
  pending ??= fetch(assetUrl(FONT_PATH))
    .then((response) => {
      if (!response.ok) {
        throw new Error(`base font request failed: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .catch((error) => {
      pending = undefined;
      throw error;
    });

  return pending;
}

/** Drops the cached fetch. Tests only. */
export function resetBaseFontBuffer(): void {
  pending = undefined;
}
