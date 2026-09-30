import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'opentype.js';
import { NoAiFontError, forgeScrambledFont, parseBaseFont } from './font-forge';
import { DEFAULT_CHARSET, buildScrambleMap } from './scramble-map';

/** Travels with the library so its tests never reach into the demo app. */
const FIXTURE = join(__dirname, '../../testing/Roboto-Regular.ttf');

function loadFixture(): ArrayBuffer {
  const buf = readFileSync(FIXTURE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('parseBaseFont', () => {
  it('parses a TrueType file', () => {
    const font = parseBaseFont(loadFixture());
    expect(font.unitsPerEm).toBe(2048);
    expect(font.glyphs.length).toBeGreaterThan(200);
  });

  it('reports an unusable font clearly instead of throwing something opaque', () => {
    expect(() => parseBaseFont(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow(NoAiFontError);
    expect(() => parseBaseFont(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow(/\.ttf or \.otf/);
  });
});

describe('forgeScrambledFont', () => {
  const base = parseBaseFont(loadFixture());
  const map = buildScrambleMap(2024);
  const forged = parse(forgeScrambledFont(base, map, 'NoAi-test'));

  it('renders the readable glyph when asked for the scrambled codepoint', () => {
    for (const [readable, scrambled] of map.forward) {
      const expected = base.charToGlyph(String.fromCodePoint(readable));
      const actual = forged.charToGlyph(String.fromCodePoint(scrambled));

      const a = expected.getBoundingBox();
      const b = actual.getBoundingBox();
      const label = `${String.fromCodePoint(readable)} -> ${String.fromCodePoint(scrambled)}`;

      // Serialising rounds coordinates to integer font units, so allow one unit
      // of slack on a 2048-unit em — about 0.05% of a character's height.
      expect(Math.abs(a.x1 - b.x1), label).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y1 - b.y1), label).toBeLessThanOrEqual(1);
      expect(Math.abs(a.x2 - b.x2), label).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y2 - b.y2), label).toBeLessThanOrEqual(1);
    }
  });

  it('keeps advance widths identical, so protected text occupies the same space', () => {
    for (const [readable, scrambled] of map.forward) {
      expect(forged.charToGlyph(String.fromCodePoint(scrambled)).advanceWidth).toBe(
        base.charToGlyph(String.fromCodePoint(readable)).advanceWidth,
      );
    }
  });

  it('does NOT render the readable glyph for its own codepoint', () => {
    // The whole point: asking the forged font for "a" must not draw an "a".
    const a = 'a'.codePointAt(0)!;
    const viaOriginal = forged.charToGlyph('a');
    const expected = base.charToGlyph('a');
    expect(map.forward.get(a)).not.toBe(a);
    expect(viaOriginal.getBoundingBox()).not.toEqual(expected.getBoundingBox());
  });

  it('carries one glyph per charset entry, plus .notdef', () => {
    expect(forged.glyphs.length).toBe(DEFAULT_CHARSET.length + 1);
  });

  it('refuses to forge when the base font cannot draw a charset character', () => {
    // U+4E2D is a CJK ideograph Roboto has no glyph for.
    const cjkMap = buildScrambleMap(1, [0x61, 0x62, 0x4e2d]);
    expect(() => forgeScrambledFont(base, cjkMap, 'NoAi-test')).toThrow(NoAiFontError);
    try {
      forgeScrambledFont(base, cjkMap, 'NoAi-test');
    } catch (e) {
      expect((e as NoAiFontError).missing).toEqual(['中']);
    }
  });
});
