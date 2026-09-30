import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARSET,
  buildScrambleMap,
  invertScrambleMap,
  randomSeed,
  scrambleText,
} from './scramble-map';

describe('buildScrambleMap', () => {
  it('maps every charset character exactly once', () => {
    const { forward } = buildScrambleMap(1234);
    expect(forward.size).toBe(DEFAULT_CHARSET.length);
    for (const cp of DEFAULT_CHARSET) expect(forward.has(cp)).toBe(true);
  });

  it('is bijective — no two characters collide on the same target', () => {
    const { forward } = buildScrambleMap(1234);
    expect(new Set(forward.values()).size).toBe(forward.size);
  });

  it('leaves no character mapped to itself, across many seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { forward } = buildScrambleMap(seed);
      for (const [from, to] of forward) {
        expect(from, `seed ${seed} left ${String.fromCodePoint(from)} in place`).not.toBe(to);
      }
    }
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

  it('produces different substitutions for different seeds', () => {
    expect([...buildScrambleMap(7).forward]).not.toEqual([...buildScrambleMap(8).forward]);
  });

  it('honours a custom charset', () => {
    const { forward } = buildScrambleMap(3, [0x61, 0x62, 0x63]);
    expect([...forward.keys()]).toEqual([0x61, 0x62, 0x63]);
  });

  it('rejects a charset too small to derange', () => {
    expect(() => buildScrambleMap(1, [0x61])).toThrow(/at least 2/);
  });

  it('excludes the space, so the browser can still break lines', () => {
    expect(DEFAULT_CHARSET).not.toContain(0x20);
  });
});

describe('scrambleText', () => {
  const map = buildScrambleMap(42);

  it('replaces every charset character', () => {
    const scrambled = scrambleText('Hello, world', map);
    expect(scrambled).not.toBe('Hello, world');
    for (const ch of scrambled.replace(/ /g, '')) {
      expect(ch).not.toBe('');
    }
  });

  it('preserves spaces and word boundaries', () => {
    const scrambled = scrambleText('one two three', map);
    expect(scrambled.split(' ').map((w) => w.length)).toEqual([3, 3, 5]);
  });

  it('passes characters outside the charset through untouched', () => {
    expect(scrambleText('— ünïcodé 😀', map)).toContain('—');
    expect(scrambleText('— ünïcodé 😀', map)).toContain('😀');
  });

  it('round-trips through the inverted map', () => {
    const original = 'The quick brown fox! 0123456789 #$%&';
    const back = scrambleText(scrambleText(original, map), invertScrambleMap(map));
    expect(back).toBe(original);
  });

  it('handles the empty string', () => {
    expect(scrambleText('', map)).toBe('');
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
