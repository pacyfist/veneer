import { isScramblable } from './scramble-map';

/**
 * Build-time helper: the codepoints of `candidate` (default: every codepoint
 * the font maps) that the font can draw and that are safe to scramble.
 *
 * Eligibility is {@link isScramblable}: letters, decimal digits and
 * punctuation with a layout-safe swap partner. Always leaves out whitespace
 * (including U+00A0), U+00AD, control and format characters, combining marks
 * and characters that create line breaks (`- / ? !`...). Print the result as a
 * charset literal:
 *
 * ```ts
 * const charset = await charsetFromFont(readFileSync('Font.ttf'), DEFAULT_CHARSET);
 * console.log(JSON.stringify(charset));
 * ```
 *
 * Loads `@pacyfist/veneer/forge` on first call, so the cipher entry point
 * never pulls the forge into a bundle statically.
 */
export async function charsetFromFont(
  bytes: ArrayBuffer | Uint8Array,
  candidate?: Iterable<number>,
): Promise<number[]> {
  const { coveredCodepoints, parseBaseFont } = await import('@pacyfist/veneer/forge');
  const base = await parseBaseFont(bytes);
  return coveredCodepoints(base, candidate ?? base.codepoints()).filter(isScramblable);
}
