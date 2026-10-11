/**
 * Stable codes for everything veneer reports, each with a README anchor.
 *
 * Internal: the codes appear in messages and in `VeneerFailure.code`; this file
 * is not exported.
 */

/** Where every code is explained. Each code is a heading, so `#vnr003` lands on it. */
const DOCS = 'https://github.com/pacyfist/veneer/blob/main/projects/pacyfist/veneer/README.md';

/** The README anchor for a code. */
export function docsUrl(code: string): string {
  return `${DOCS}#${code.toLowerCase()}`;
}

/** `[veneer] VNR003: <message> See <url>` */
export function veneerMessage(code: string, message: string): string {
  return `[veneer] ${code}: ${message} See ${docsUrl(code)}`;
}
