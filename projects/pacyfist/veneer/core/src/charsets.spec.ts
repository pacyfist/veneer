import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'opentype.js';
import { LATIN_1, LATIN_EXT_A, charsetFromText } from './charsets';
import { DEFAULT_CHARSET, buildScrambleMap, isScramblable, scrambleText } from './scramble-map';

/** Travels with the library so its tests never reach into the demo app. */
const ROBOTO = join(__dirname, '../../testing/Roboto-Regular.ttf');

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const cps = (s: string): number[] => Array.from(s, (ch) => ch.codePointAt(0)!);
const PRESETS = { LATIN_1, LATIN_EXT_A };

describe('presets', () => {
  it('LATIN_1 is U+00C0-U+00FF without the two symbols', () => {
    expect(LATIN_1).toEqual(range(0xc0, 0xff).filter((cp) => cp !== 0xd7 && cp !== 0xf7));
    expect(LATIN_1).toHaveLength(62);
  });

  it('LATIN_EXT_A is all of U+0100-U+017F', () => {
    expect(LATIN_EXT_A).toEqual(range(0x100, 0x17f));
    expect(LATIN_EXT_A).toHaveLength(128);
  });

  it('covers the letters of common European languages', () => {
    const covered = new Set([...LATIN_1, ...LATIN_EXT_A]);
    for (const ch of 'éèêëàâäçîïôöùûüÿœæßñõãåøłąęćńśźżčřšžďťňůőűğış') {
      expect(covered.has(ch.codePointAt(0)!), ch).toBe(true);
    }
  });

  for (const [name, preset] of Object.entries(PRESETS)) {
    it(`${name} holds only scramblable, NFC-stable letters`, () => {
      for (const cp of preset) {
        const ch = String.fromCodePoint(cp);
        expect(/\p{L}/u.test(ch), ch).toBe(true);
        expect(ch.normalize('NFC'), ch).toBe(ch);
        expect(isScramblable(cp), ch).toBe(true);
      }
    });

    it(`${name} never holds the no-break space or the soft hyphen`, () => {
      expect(preset).not.toContain(0xa0);
      expect(preset).not.toContain(0xad);
    });

    it(`${name} is frozen`, () => {
      expect(Object.isFrozen(preset)).toBe(true);
    });

    it(`${name} is fully covered by the bundled Roboto`, () => {
      const buf = readFileSync(ROBOTO);
      const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const missing = preset.filter((cp) => font.charToGlyph(String.fromCodePoint(cp)).index === 0);
      expect(missing.map((cp) => String.fromCodePoint(cp))).toEqual([]);
    });
  }

  it('combine by spreading, deranging accented letters among themselves', () => {
    const charset = [...DEFAULT_CHARSET, ...LATIN_1, ...LATIN_EXT_A];
    const accented = new Set([...LATIN_1, ...LATIN_EXT_A]);
    for (let seed = 0; seed < 200; seed++) {
      const { forward } = buildScrambleMap(seed, charset);
      expect(forward.size).toBe(charset.length);
      for (const [from, to] of forward) {
        const label = `seed ${seed}: ${String.fromCodePoint(from)} -> ${String.fromCodePoint(to)}`;
        expect(to, label).not.toBe(from);
        expect(accented.has(to), label).toBe(accented.has(from));
      }
    }
  });

  it('scrambles accented text with the combined charset', () => {
    const map = buildScrambleMap(77, [...DEFAULT_CHARSET, ...LATIN_1, ...LATIN_EXT_A]);
    const original = 'Zażółć gęślą jaźń. Größe, façade, naïve café.';
    const scrambled = scrambleText(original, map);
    [...original].forEach((ch, i) => {
      if (/\p{L}/u.test(ch)) expect([...scrambled][i], ch).not.toBe(ch);
    });
  });
});

describe('charsetFromText', () => {
  it('returns the distinct scramblable codepoints, sorted', () => {
    expect(charsetFromText('banana, Ä 42')).toEqual([...cps(',24abn'), 0xc4]);
  });

  it('never takes whitespace, NBSP, soft hyphen or break-significant characters', () => {
    const charset = charsetFromText('a b\tc d­e-f/g?h!i|j}k—l…m​n');
    expect(charset).toEqual(cps('abcdefghijklmn'));
  });

  it('skips punctuation with no layout-safe partner and unmeasured symbols', () => {
    expect(charsetFromText(`"it's" $5 <b 😀 、`)).toEqual(cps('5bist'));
  });

  it('normalizes first, so decomposed letters contribute the precomposed form', () => {
    expect(charsetFromText('é')).toEqual([0xe9]);
    expect(charsetFromText('ño')).toEqual([0x6f, 0xf1]);
  });

  it('extends a base charset', () => {
    const charset = charsetFromText('Łódź', { base: DEFAULT_CHARSET });
    expect(charset).toEqual([...DEFAULT_CHARSET, 0xf3, 0x141, 0x17a].sort((a, b) => a - b));
  });

  it('takes letters of other scripts too', () => {
    expect(charsetFromText('Ωμέγα')).toEqual(cps('Ωαγέμ').sort((a, b) => a - b));
  });

  it('returns a frozen array', () => {
    expect(Object.isFrozen(charsetFromText('abc'))).toBe(true);
  });
});
