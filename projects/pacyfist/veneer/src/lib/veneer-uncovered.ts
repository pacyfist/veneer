import { veneerMessage } from './veneer-errors';

declare const ngDevMode: boolean | undefined;

/**
 * Dropped-character sets already warned about, so each set is reported once
 * per page (browser) or per process (server).
 */
const warned = new Set<string>();

/**
 * Forget which dropped-character sets were warned about. Tests only: the set is
 * module-level, so specs that drop the same characters would otherwise depend on
 * the order they run in. Not exported from the package.
 */
export function resetUncoveredWarnings(): void {
  warned.clear();
}

/**
 * The dev-mode VNR014 warning: the base fonts have no glyph for `dropped`, so
 * the cipher leaves those characters out. Shared by the browser and the server
 * (`provideVeneerServer`), so both say the same thing once per character set.
 */
export function warnUncovered(dropped: readonly number[], faces: number): void {
  if (dropped.length === 0 || (typeof ngDevMode !== 'undefined' && !ngDevMode)) return;
  const key = dropped.map((cp) => String.fromCodePoint(cp)).join('');
  if (warned.has(key)) return;
  // Bounded: an app that narrows a new charset per request would otherwise
  // grow it forever on a long-running server.
  if (warned.size >= 64) warned.clear();
  warned.add(key);
  console.warn(
    veneerMessage(
      'VNR014',
      `the base font${faces > 1 ? 's have' : ' has'} no glyph for ${dropped.length} charset character(s): ${key}. ` +
        'They are left out of the cipher and shown as they are, in the fallback font. ' +
        'Narrow `charset` to silence this, or set `strictCoverage: true` to fail instead.',
    ),
  );
}
