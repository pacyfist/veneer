/**
 * Builds the font that undoes the cipher at render time.
 *
 * For every pair `readable -> scrambled` in the map, the forged font contains
 * the base font's outline for `readable`, addressed by the codepoint
 * `scrambled`. Text that reads as gibberish in the DOM therefore paints as the
 * original words on screen.
 *
 * Framework-free, like scramble-map.ts. Only opentype.js is required.
 */

import { Font, Glyph, Path, parse } from 'opentype.js';
import type { ScrambleMap } from './scramble-map';

/** Thrown when the base font cannot back the configured charset. */
export class NoAiFontError extends Error {
  constructor(
    message: string,
    readonly missing: readonly string[] = [],
  ) {
    super(message);
    this.name = 'NoAiFontError';
  }
}

/** Parse a base font binary. Accepts TrueType or CFF OpenType, not WOFF/WOFF2. */
export function parseBaseFont(buffer: ArrayBuffer): Font {
  try {
    return parse(buffer);
  } catch (cause) {
    throw new NoAiFontError(
      `[no-ai] could not parse the base font. It must be a .ttf or .otf file — ` +
        `opentype.js cannot read WOFF or WOFF2. (${(cause as Error)?.message ?? cause})`,
    );
  }
}

/**
 * Produce a font binary whose cmap is the scrambled one.
 *
 * @throws NoAiFontError if the base font is missing a glyph for any character
 * in the map. Failing here is deliberate: silently dropping a character would
 * make that character render as its scrambled self, showing the reader the
 * wrong letter with no other symptom.
 */
export function forgeScrambledFont(base: Font, map: ScrambleMap, familyName: string): ArrayBuffer {
  const notdefWidth = Math.round(base.unitsPerEm / 2);
  const glyphs: Glyph[] = [
    new Glyph({ name: '.notdef', unicode: 0, advanceWidth: notdefWidth, path: new Path() }),
  ];

  const missing: string[] = [];
  for (const [readable, scrambled] of map.forward) {
    const char = String.fromCodePoint(readable);
    const source = base.charToGlyph(char);
    // charToGlyph falls back to .notdef (index 0) for characters it cannot render.
    if (!source || source.index === 0) {
      missing.push(char);
      continue;
    }
    glyphs.push(
      new Glyph({
        name: `uni${scrambled.toString(16).padStart(4, '0')}`,
        unicode: scrambled,
        advanceWidth: source.advanceWidth ?? notdefWidth,
        path: source.path,
      }),
    );
  }

  if (missing.length) {
    throw new NoAiFontError(
      `[no-ai] the base font has no glyph for ${missing.length} character(s) in the ` +
        `charset: ${missing.join('')}. Use a base font that covers the charset, or ` +
        `narrow the charset in provideNoAi().`,
      missing,
    );
  }

  return new Font({
    familyName,
    styleName: 'Regular',
    unitsPerEm: base.unitsPerEm,
    ascender: base.ascender,
    descender: base.descender,
    glyphs,
  }).toArrayBuffer();
}
