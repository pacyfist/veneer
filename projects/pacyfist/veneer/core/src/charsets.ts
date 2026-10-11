/**
 * Ready-made charsets beyond ASCII, and a helper to derive one from content.
 *
 * Combine them by spreading: `charset: [...DEFAULT_CHARSET, ...LATIN_1,
 * ...LATIN_EXT_A]`. Order and duplicates do not matter to `buildScrambleMap`.
 *
 * The cipher deranges letters among letters of the same kind, so accented
 * letters swap with other accented letters and never with ASCII ones (see
 * `scramble-map.ts` for why).
 */

import { isScramblable } from './scramble-map';

function letters(from: number, to: number): readonly number[] {
  const out: number[] = [];
  for (let cp = from; cp <= to; cp++) {
    if (/\p{L}/u.test(String.fromCodePoint(cp))) out.push(cp);
  }
  return Object.freeze(out);
}

/**
 * The letters of Latin-1 Supplement, U+00C0-U+00FF: French, German, Spanish,
 * Portuguese, Nordic and other Western European letters. 62 codepoints; the
 * symbols U+00D7 (×) and U+00F7 (÷) are not letters and are left out.
 */
export const LATIN_1: readonly number[] = letters(0x00c0, 0x00ff);

/**
 * Latin Extended-A, U+0100-U+017F: Central European, Baltic, Turkish and
 * other letters such as ą ć ę ł ń ś ź ż, č ř š ž, ő ű, ğ ı ş. 128 codepoints.
 */
export const LATIN_EXT_A: readonly number[] = letters(0x0100, 0x017f);

/** Options for {@link charsetFromText}. */
export interface CharsetFromTextOptions {
  /** Codepoints to start from, such as `DEFAULT_CHARSET`. Kept as given. */
  readonly base?: Iterable<number>;
}

/**
 * The distinct codepoints in `text` the cipher can scramble, sorted, plus any
 * `base` codepoints.
 *
 * Takes letters of any script, decimal digits and punctuation whose line-break
 * behaviour was measured to have a safe swap partner. Never takes whitespace,
 * the no-break space, the soft hyphen, controls, combining marks, or
 * characters that create line breaks (`- / ? !` and others). The text is
 * NFC-normalized first, so `e` + U+0301 contributes `é`.
 *
 * Meant for build time: run it over your content, check the base font covers
 * the result, and paste the literal into `provideVeneer({ charset })`. Every
 * server and client must use the same charset, or their ciphers differ.
 */
export function charsetFromText(
  text: string,
  options: CharsetFromTextOptions = {},
): readonly number[] {
  const out = new Set<number>(options.base ?? []);
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (isScramblable(cp)) out.add(cp);
  }
  return Object.freeze([...out].sort((a, b) => a - b));
}
