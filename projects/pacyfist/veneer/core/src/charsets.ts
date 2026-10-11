/**
 * Letter presets beyond ASCII, and a helper that derives a charset from content.
 * Combine by spreading: `[...DEFAULT_CHARSET, ...LATIN_1, ...LATIN_EXT_A]`.
 */

import { isScramblable } from './scramble-map';

function letters(from: number, to: number): readonly number[] {
  const out: number[] = [];
  for (let cp = from; cp <= to; cp++) {
    if (/\p{L}/u.test(String.fromCodePoint(cp))) out.push(cp);
  }
  return Object.freeze(out);
}

/** Letters of U+00C0-U+00FF, without the symbols × and ÷: 62 codepoints. */
export const LATIN_1: readonly number[] = letters(0x00c0, 0x00ff);

/** Latin Extended-A, U+0100-U+017F (ą ł ő č ğ ...): 128 codepoints. */
export const LATIN_EXT_A: readonly number[] = letters(0x0100, 0x017f);

/** Options for {@link charsetFromText}. */
export interface CharsetFromTextOptions {
  /** Codepoints to start from, such as `DEFAULT_CHARSET`. Kept as given. */
  readonly base?: Iterable<number>;
}

/**
 * The distinct codepoints in NFC-normalized `text` that {@link isScramblable}
 * accepts, plus `base`, sorted. A build-time helper: check the font covers the
 * result, then paste it into the config, since server and client must agree.
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
