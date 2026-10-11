import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CHARSET,
  buildScrambleMap,
  invertScrambleMap,
  isScramblable,
  randomScrambleMap,
  randomSeed,
  scrambleText,
} from './scramble-map';

const cps = (s: string): number[] => Array.from(s, (ch) => ch.codePointAt(0)!);
const str = (list: Iterable<number>): string => String.fromCodePoint(...list);

const ASCII_LETTERS = cps('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
const ASCII_DIGITS = cps('0123456789');
/** The measured interchangeable ASCII punctuation classes. */
const ASCII_PUNCTUATION_CLASSES = ['#&*=>~', '%+\\', '([{', ')]', ',.:;', '@^_`'];

/** Assert every pair stays inside one of `groups`, and moves. */
function expectWithinGroups(forward: ReadonlyMap<number, number>, groups: string[], seed: number) {
  const groupOf = new Map<number, number>();
  groups.forEach((g, i) => cps(g).forEach((cp) => groupOf.set(cp, i)));
  for (const [from, to] of forward) {
    const label = `seed ${seed}: ${str([from])} -> ${str([to])}`;
    expect(groupOf.has(from), label).toBe(true);
    expect(groupOf.get(to), label).toBe(groupOf.get(from));
    expect(to, label).not.toBe(from);
  }
}

describe('DEFAULT_CHARSET', () => {
  it('is printable ASCII minus the characters that would move line breaks', () => {
    expect(str(DEFAULT_CHARSET)).toBe(
      '#%&()*+,.0123456789:;=>@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{~',
    );
    expect(DEFAULT_CHARSET).toHaveLength(84);
  });

  it('excludes the space, so the browser can still break lines', () => {
    expect(DEFAULT_CHARSET).not.toContain(0x20);
  });

  it('excludes characters that create a break opportunity in some engine', () => {
    for (const ch of '-/?!|}') expect(DEFAULT_CHARSET, ch).not.toContain(ch.codePointAt(0));
  });

  it('excludes punctuation with no layout-safe partner', () => {
    for (const ch of `"'$<`) expect(DEFAULT_CHARSET, ch).not.toContain(ch.codePointAt(0));
  });

  it('is frozen and sorted', () => {
    expect(Object.isFrozen(DEFAULT_CHARSET)).toBe(true);
    expect([...DEFAULT_CHARSET].sort((a, b) => a - b)).toEqual([...DEFAULT_CHARSET]);
  });
});

describe('isScramblable', () => {
  it('accepts letters of any script and decimal digits', () => {
    for (const ch of 'aZéŁßжΩ中٣5') expect(isScramblable(ch.codePointAt(0)!), ch).toBe(true);
  });

  it('rejects whitespace, NBSP, soft hyphen, controls and combining marks', () => {
    for (const cp of [0x20, 0x09, 0x0a, 0xa0, 0xad, 0x200b, 0x2028, 0x0301, 0x00, 0x7f]) {
      expect(isScramblable(cp), cp.toString(16)).toBe(false);
    }
  });

  it('rejects break-significant punctuation', () => {
    for (const ch of '-/?!|}‐–—…´') {
      expect(isScramblable(ch.codePointAt(0)!), ch).toBe(false);
    }
  });

  it('rejects codepoints NFC would rewrite', () => {
    // KELVIN SIGN normalizes to K, ANGSTROM SIGN to Å, GREEK QUESTION MARK to ;
    for (const cp of [0x212a, 0x212b, 0x037e]) expect(isScramblable(cp)).toBe(false);
  });

  it('rejects punctuation whose line breaking was not measured', () => {
    expect(isScramblable(0x3001)).toBe(false); // IDEOGRAPHIC COMMA
    expect(isScramblable(0x1f600)).toBe(false); // an emoji
  });
});

describe('buildScrambleMap', () => {
  it('maps every default charset character exactly once', () => {
    const { forward } = buildScrambleMap(1234);
    expect(forward.size).toBe(DEFAULT_CHARSET.length);
    for (const cp of DEFAULT_CHARSET) expect(forward.has(cp)).toBe(true);
  });

  it('is bijective, so no two characters collide on the same target', () => {
    const { forward } = buildScrambleMap(1234);
    expect(new Set(forward.values()).size).toBe(forward.size);
  });

  it('keeps letters, digits and each punctuation class apart, with no fixed points, across many seeds', () => {
    const groups = [str(ASCII_LETTERS), str(ASCII_DIGITS), ...ASCII_PUNCTUATION_CLASSES];
    for (let seed = 0; seed < 500; seed++) {
      expectWithinGroups(buildScrambleMap(seed).forward, groups, seed);
    }
  });

  it('mixes upper and lower case, so the case pattern does not leak', () => {
    const crossings = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      for (const [from, to] of buildScrambleMap(seed).forward) {
        const a = str([from]);
        const b = str([to]);
        if (/[a-z]/.test(a) && /[A-Z]/.test(b)) crossings.add('lower->upper');
        if (/[A-Z]/.test(a) && /[a-z]/.test(b)) crossings.add('upper->lower');
      }
    }
    expect(crossings).toEqual(new Set(['lower->upper', 'upper->lower']));
  });

  it('maps only into the charset', () => {
    const charset = new Set(DEFAULT_CHARSET);
    for (const to of buildScrambleMap(99).forward.values()) {
      expect(charset.has(to)).toBe(true);
    }
  });

  it('is deterministic, which is what lets SSR and the client agree', () => {
    expect([...buildScrambleMap(7).forward]).toEqual([...buildScrambleMap(7).forward]);
  });

  it('pins the output for a fixed seed, so a change to the cipher is a conscious one', () => {
    // If this fails, ciphertext for a fixed seed changed: note it in the changelog.
    const map = buildScrambleMap(12345);
    expect(scrambleText('Hello, world (2024)', map)).toBe('qiBBA; kAoBj {8986]');
  });

  it('depends on the set of codepoints, not their order or duplicates', () => {
    const shuffled = [...DEFAULT_CHARSET].reverse().concat(DEFAULT_CHARSET.slice(0, 10));
    expect([...buildScrambleMap(5, shuffled).forward].sort()).toEqual(
      [...buildScrambleMap(5).forward].sort(),
    );
  });

  it('produces different substitutions for different seeds', () => {
    expect([...buildScrambleMap(7).forward]).not.toEqual([...buildScrambleMap(8).forward]);
  });

  it('honours a custom charset', () => {
    const { forward } = buildScrambleMap(3, [0x61, 0x62, 0x63]);
    expect([...forward.keys()]).toEqual([0x61, 0x62, 0x63]);
  });

  it('swaps a class of two', () => {
    const { forward } = buildScrambleMap(3, cps('xy'));
    expect(forward).toEqual(
      new Map([
        [0x78, 0x79],
        [0x79, 0x78],
      ]),
    );
  });

  it('leaves a class with a single member out of the map', () => {
    // One digit among letters cannot be deranged without leaving the class.
    const { forward } = buildScrambleMap(3, cps('abc7'));
    expect([...forward.keys()].sort()).toEqual(cps('abc'));
    expect(scrambleText('7', { seed: 3, forward })).toBe('7');
  });

  it('drops break-significant characters and whitespace from a custom charset', () => {
    const { forward } = buildScrambleMap(9, cps('abc-/?! \u00a0\u00ad'));
    expect([...forward.keys()].sort()).toEqual(cps('abc'));
  });

  it('rejects a charset with nothing it can derange', () => {
    expect(() => buildScrambleMap(1, [0x61])).toThrow(/at least 2/);
    expect(() => buildScrambleMap(1, cps('a1('))).toThrow(/at least 2/);
    expect(() => buildScrambleMap(1, cps('-/?!'))).toThrow(/at least 2/);
  });

  it('keeps ASCII letters apart from accented ones', () => {
    // Chromium breaks `/à` but not `/a`: an ASCII letter after a slash must
    // stay ASCII.
    const charset = [...cps('abcdefXYZ'), ...cps('àéîõüĄŁŻ')];
    for (let seed = 0; seed < 200; seed++) {
      expectWithinGroups(buildScrambleMap(seed, charset).forward, ['abcdefXYZ', 'àéîõüĄŁŻ'], seed);
    }
  });

  it('keeps scripts apart in a custom charset', () => {
    const charset = cps('абвгдαβγδ中文字');
    for (let seed = 0; seed < 100; seed++) {
      expectWithinGroups(
        buildScrambleMap(seed, charset).forward,
        ['абвгд', 'αβγδ', '中文字'],
        seed,
      );
    }
  });

  it('groups unmeasured symbols by category, so a custom charset can still cover them', () => {
    const { forward } = buildScrambleMap(4, [...cps('ab'), 0x1f600, 0x1f603]);
    expect(forward.get(0x1f600)).toBe(0x1f603);
    expect(forward.get(0x1f603)).toBe(0x1f600);
  });
});

describe('scrambleText', () => {
  const map = buildScrambleMap(42);

  it('replaces every charset character', () => {
    const original = 'Hello world 2024 (a, b; c: d.)';
    const scrambled = scrambleText(original, map);
    [...original].forEach((ch, i) => {
      if (map.forward.has(ch.codePointAt(0)!)) expect(scrambled[i], ch).not.toBe(ch);
    });
  });

  it('preserves spaces and word boundaries', () => {
    const scrambled = scrambleText('one two three', map);
    expect(scrambled.split(' ').map((w) => w.length)).toEqual([3, 3, 5]);
  });

  it('keeps break-significant characters where they were', () => {
    const original = 'well-known and/or not? yes! a|b {c}';
    const scrambled = scrambleText(original, map);
    [...original].forEach((ch, i) => {
      if ('-/?!|} '.includes(ch)) expect(scrambled[i]).toBe(ch);
    });
  });

  it('keeps every word the same shape: letters stay letters, digits stay digits', () => {
    const original = 'Call 555-0199 at 9:30, or e-mail jo@example.com (ref. A7).';
    const scrambled = scrambleText(original, map);
    const groups = [str(ASCII_LETTERS), str(ASCII_DIGITS), ...ASCII_PUNCTUATION_CLASSES];
    const shape = (s: string) =>
      [...s].map((ch) => {
        const i = groups.findIndex((g) => g.includes(ch));
        return i < 0 ? ch : String(i);
      });
    expect(shape(scrambled)).toEqual(shape(original));
  });

  it('passes characters outside the charset through untouched', () => {
    expect(scrambleText('— ünïcodé 😀', map)).toContain('—');
    expect(scrambleText('— ünïcodé 😀', map)).toContain('😀');
  });

  it('round-trips through the inverted map', () => {
    const original = 'The quick brown fox! 0123456789 #$%& "quoted" it\'s <tag>';
    const back = scrambleText(scrambleText(original, map), invertScrambleMap(map));
    expect(back).toBe(original);
  });

  it('handles the empty string', () => {
    expect(scrambleText('', map)).toBe('');
  });
});

describe('NFC normalization', () => {
  // é and ñ precomposed, plus letters without a precomposed accented form.
  const charset = [...DEFAULT_CHARSET, 0xe9, 0xf1, 0xe0, 0xfc];
  const map = buildScrambleMap(2026, charset);
  const decomposed = 'Cafe\u0301 man\u0303ana';
  const composed = 'Café mañana';

  it('scrambles decomposed input exactly like its precomposed form', () => {
    expect(decomposed).not.toBe(composed);
    expect(scrambleText(decomposed, map)).toBe(scrambleText(composed, map));
  });

  it('scrambles the accented letter, not the bare letter plus a visible mark', () => {
    const scrambled = scrambleText(decomposed, map);
    expect(scrambled).not.toContain('\u0301');
    expect([...scrambled]).toHaveLength([...composed].length);
  });

  it('round-trips decomposed input to its NFC form', () => {
    const back = scrambleText(scrambleText(decomposed, map), invertScrambleMap(map));
    expect(back).toBe(composed);
    expect(back).toBe(decomposed.normalize('NFC'));
  });

  it('can be switched off', () => {
    const raw = scrambleText(decomposed, map, { normalize: false });
    expect(raw).toContain('\u0301');
    expect(scrambleText(raw, invertScrambleMap(map))).toBe(decomposed);
  });

  it('marks inverted maps so decoding never normalizes ciphertext', () => {
    const inverse = invertScrambleMap(map);
    expect(inverse.inverse).toBe(true);
    expect(invertScrambleMap(inverse).inverse).toBeUndefined();
    expect([...invertScrambleMap(inverse).forward]).toEqual([...map.forward]);
  });

  it('decodes ciphertext whose marks would compose with the scrambled letter', () => {
    // q + U+0301 has no precomposed form, so NFC keeps the mark. Find a seed
    // where q lands on e, which does compose with U+0301 into é.
    const seed = Array.from({ length: 5000 }, (_, i) => i).find(
      (s) => buildScrambleMap(s, charset).forward.get(0x71) === 0x65,
    )!;
    const m = buildScrambleMap(seed, charset);
    const original = 'q\u0301';
    const scrambled = scrambleText(original, m);
    expect(scrambled).toBe('e\u0301');
    expect(scrambleText(scrambled, invertScrambleMap(m))).toBe(original);
  });

  it('survives the SSR hydration path with decomposed input', () => {
    // The server scrambles the bound text, the browser inverts the server's
    // ciphertext to recover the original, then scrambles it again.
    for (const text of [decomposed, composed, 'A\u030Angstro\u0308m 2026', 'q\u0301 x\u0308']) {
      const server = scrambleText(text, map);
      const recovered = scrambleText(server, invertScrambleMap(map));
      expect(recovered).toBe(text.normalize('NFC'));
      expect(scrambleText(recovered, map)).toBe(server);
    }
  });
});

describe('randomSeed', () => {
  it('returns a 32-bit unsigned integer', () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('does not repeat itself on consecutive calls', () => {
    const seeds = new Set(Array.from({ length: 50 }, () => randomSeed()));
    expect(seeds.size).toBeGreaterThan(45);
  });
});

describe('randomScrambleMap', () => {
  const groups = [str(ASCII_LETTERS), str(ASCII_DIGITS), ...ASCII_PUNCTUATION_CLASSES];

  it('keeps the classes of buildScrambleMap, with no fixed points', () => {
    for (let i = 0; i < 100; i++) {
      expectWithinGroups(randomScrambleMap().forward, groups, i);
    }
  });

  it('covers the same codepoints as a seeded map', () => {
    expect([...randomScrambleMap().forward.keys()].sort()).toEqual(
      [...buildScrambleMap(1).forward.keys()].sort(),
    );
  });

  it('carries no seed', () => {
    const map = randomScrambleMap();
    expect('seed' in map).toBe(false);
    expect('seed' in invertScrambleMap(map)).toBe(false);
  });

  it('draws a different map every time', () => {
    const letters = (m: ReturnType<typeof randomScrambleMap>) =>
      str(ASCII_LETTERS.map((cp) => m.forward.get(cp)!));
    const seen = new Set(Array.from({ length: 20 }, () => letters(randomScrambleMap())));
    expect(seen.size).toBe(20);
  });

  it('reads the CSPRNG, not Math.random', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const math = vi.spyOn(Math, 'random');
    randomScrambleMap();
    expect(spy).toHaveBeenCalled();
    expect(math).not.toHaveBeenCalled();
    spy.mockRestore();
    math.mockRestore();
  });

  it('takes a random source for tests, and round-trips', () => {
    let x = 0;
    const map = randomScrambleMap(DEFAULT_CHARSET, () => (x = (x * 7 + 0.31) % 1));
    const text = 'Hello, World 42';
    expect(scrambleText(scrambleText(text, map), invertScrambleMap(map))).toBe(text);
  });
});
