/**
 * The substitution cipher that sits underneath everything else.
 *
 * Framework-free on purpose: the same functions run in the browser, in an SSR
 * process, and in a plain Node script that pre-scrambles static content.
 */

/**
 * Printable ASCII, minus the space.
 *
 * Space is left out deliberately. It is the only character the browser can
 * break a line at, so mapping it to something else would collapse a paragraph
 * into one unbreakable word.
 */
export const DEFAULT_CHARSET: readonly number[] = Object.freeze(
  Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => 0x21 + i),
);

/** A bijective, fixed-point-free codepoint substitution. */
export interface ScrambleMap {
  /** The value the map was derived from. The same seed always yields the same map. */
  readonly seed: number;
  /** Readable codepoint -> codepoint that appears in the DOM. */
  readonly forward: ReadonlyMap<number, number>;
}

/** Small seeded PRNG. Deterministic across platforms, which SSR relies on. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed drawn from the CSPRNG when there is one, so page loads don't share a cipher. */
export function randomSeed(): number {
  const c: Crypto | undefined = globalThis.crypto;
  if (c?.getRandomValues) {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * Build the substitution for `charset`.
 *
 * The result is a derangement: every character maps to a *different*
 * character, so no letter survives untouched.
 *
 * @throws if the charset has fewer than two distinct codepoints, where no
 * derangement exists.
 */
export function buildScrambleMap(
  seed: number,
  charset: readonly number[] = DEFAULT_CHARSET,
): ScrambleMap {
  const source = [...new Set(charset)];
  if (source.length < 2) {
    throw new Error(`[no-ai] charset needs at least 2 distinct codepoints, got ${source.length}.`);
  }

  const target = [...source];
  const rand = mulberry32(seed);
  for (let i = target.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [target[i], target[j]] = [target[j], target[i]];
  }

  // A plain shuffle leaves some characters on themselves. Swap each of those
  // with a partner chosen so the swap doesn't create a new fixed point.
  for (let i = 0; i < target.length; i++) {
    if (target[i] !== source[i]) continue;
    for (let k = 1; k < target.length; k++) {
      const j = (i + k) % target.length;
      if (target[j] !== source[i] && target[i] !== source[j]) {
        [target[i], target[j]] = [target[j], target[i]];
        break;
      }
    }
  }

  const forward = new Map<number, number>();
  source.forEach((cp, i) => forward.set(cp, target[i]));
  return { seed, forward };
}

/** Apply a map. Characters outside the charset pass through unchanged. */
export function scrambleText(text: string, map: ScrambleMap): string {
  let out = '';
  for (const ch of text) {
    const mapped = map.forward.get(ch.codePointAt(0)!);
    out += mapped === undefined ? ch : String.fromCodePoint(mapped);
  }
  return out;
}

/** The reverse substitution. Useful in tests, and for decoding your own output. */
export function invertScrambleMap(map: ScrambleMap): ScrambleMap {
  const forward = new Map<number, number>();
  for (const [from, to] of map.forward) forward.set(to, from);
  return { seed: map.seed, forward };
}
