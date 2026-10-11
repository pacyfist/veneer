/**
 * The substitution cipher that sits underneath everything else. Framework-free:
 * it runs in the browser, in SSR and in plain Node.
 *
 * Layout safety: browsers pick line breaks from the codepoints in the DOM, not
 * from the glyphs drawn, so a letter mapped to `-` lets a word wrap mid-word.
 * The cipher therefore only swaps characters the line breaker treats alike
 * (letters, digits, and punctuation classes measured pairwise in a zero-width
 * box in Chromium 151 and Firefox 153, 2026-10-11), and never touches
 * characters that break in any measured engine. WebKit was not measured.
 */

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

const codepoints = (s: string): number[] => Array.from(s, (ch) => ch.codePointAt(0)!);

/**
 * Break inside a word in Chromium (`-` `?`, soft hyphen, U+00B4, dashes,
 * ellipsis, `‼`...) or additionally in Firefox (`!` `/` `|` `}`). Never swapped.
 */
const BREAKING: ReadonlySet<number> = new Set(
  codepoints(
    '!-/?|}\u00ad\u00b4\u2010\u2012\u2013\u2014\u2024\u2025\u2026\u2027\u203c\u203d\u2046\u2047\u2048\u2049\u2056\u2058\u2059\u205a\u205b\u205d\u205e',
  ),
);

/**
 * Punctuation that line-breaks identically next to every measured candidate.
 * Other punctuation in the measured ranges either breaks or has no partner
 * (`"` `'` `$` `<`, U+2011, U+2044): `"(` breaks in Chromium, `'(` does not.
 */
const PUNCTUATION_CLASSES: readonly string[] = [
  '#&*=>~',
  '%+\\',
  '([{',
  ')]',
  ',.:;',
  '@^_`',
  '\u00a1\u00bf', // ¡ ¿
  '\u00a2\u00a3\u00a4\u00a5\u00b0\u00b1', // ¢ £ ¤ ¥ ° ±
  '\u00b2\u00b3\u00b9\u00bc\u00bd\u00be', // ² ³ ¹ ¼ ½ ¾
  '\u00ab\u00bb\u2018\u2019\u201b\u201c\u201d\u201f\u2039\u203a', // « » ‘ ’ ‛ “ ” ‟ ‹ ›
  '\u201a\u201e\u2045', // ‚ „ ⁅
  '\u2030\u2031\u2032\u2033\u2034\u2035\u2036\u2037\u2057\u20ac', // ‰ ‱ ′ ″ ‴ ‵ ‶ ‷ ⁗ €
  '\u00a6\u00a7\u00a8\u00a9\u00ac\u00ae\u00af\u00b6\u00b7\u00b8\u00d7\u00f7\u2015\u2016\u2017\u2020\u2021\u2022\u2023\u2038\u203b\u203e\u203f\u2040\u2041\u2042\u2043\u204a\u204b\u204c\u204d\u204e\u204f\u2050\u2051\u2052\u2053\u2054\u2055\u205c\u2122', // ¦ § ¨ © ¬ ® ¯ ¶ · ¸ × ÷ † ‡ • ™ and more
];

const PUNCTUATION_CLASS: ReadonlyMap<number, string> = new Map(
  PUNCTUATION_CLASSES.flatMap((members, i) => codepoints(members).map((cp) => [cp, `P${i}`])),
);

/** The ranges the measurement covered. Unlisted punctuation here has no partner. */
function inMeasuredRange(cp: number): boolean {
  return (
    (cp >= 0x21 && cp <= 0x7e) ||
    (cp >= 0xa1 && cp <= 0xbf) ||
    cp === 0xd7 ||
    cp === 0xf7 ||
    (cp >= 0x2010 && cp <= 0x205e) ||
    cp === 0x20ac ||
    cp === 0x2122
  );
}

const NEVER = /[\s\p{Z}\p{C}\p{M}]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const SCRIPTS = [
  'Latin',
  'Greek',
  'Cyrillic',
  'Armenian',
  'Hebrew',
  'Arabic',
  'Devanagari',
  'Thai',
  'Hangul',
  'Hiragana',
  'Katakana',
  'Han',
].map((name) => [name, new RegExp(`\\p{Script=${name}}`, 'u')] as const);
const CATEGORIES = ['Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po', 'Sm', 'Sc', 'Sk', 'So'].map(
  (name) => [name, new RegExp(`\\p{${name}}`, 'u')] as const,
);

function scriptOf(ch: string): string {
  return SCRIPTS.find(([, re]) => re.test(ch))?.[0] ?? 'other';
}

/**
 * The class a codepoint is deranged within, or `null` when it must stay put.
 * Letters and digits group by script; ASCII letters stay apart from accented
 * ones (Chromium breaks `/à` but not `/a`). Case is merged: split classes would
 * leak the case pattern and still not fix `text-transform` (a deferred
 * case-aware mode). Codepoints NFC rewrites are excluded. Unmeasured
 * punctuation groups by general category, a best guess.
 */
function classOf(cp: number): string | null {
  const ch = String.fromCodePoint(cp);
  if (BREAKING.has(cp) || NEVER.test(ch) || ch.normalize('NFC') !== ch) return null;
  const width = cp >= 0xff00 && cp <= 0xffef ? ':fullwidth' : '';
  if (LETTER.test(ch)) return `L:${scriptOf(ch)}${cp < 0x80 ? ':ascii' : ''}${width}`;
  if (DIGIT.test(ch)) return `N:${cp < 0x80 ? 'ascii' : scriptOf(ch)}${width}`;
  const measured = PUNCTUATION_CLASS.get(cp);
  if (measured !== undefined) return measured;
  if (inMeasuredRange(cp)) return null;
  return `S:${CATEGORIES.find(([, re]) => re.test(ch))?.[0] ?? 'other'}${width}`;
}

/**
 * True when `cp` can take part in the cipher: a letter, a decimal digit, or
 * measured punctuation with a swap partner. Never whitespace, NBSP, soft
 * hyphen, controls, combining marks or characters that create line breaks.
 */
export function isScramblable(cp: number): boolean {
  const key = classOf(cp);
  return key !== null && !key.startsWith('S:');
}

/**
 * The 84 ASCII characters the cipher can swap without moving line breaks.
 * Left out: the space, `- / ? ! | }` (break in some engine) and `" ' $ <` (no
 * safe partner). Add `LATIN_1` and `LATIN_EXT_A` for accented letters.
 */
export const DEFAULT_CHARSET: readonly number[] = Object.freeze(
  Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => 0x21 + i).filter(isScramblable),
);

/** A bijective, fixed-point-free codepoint substitution. */
export interface ScrambleMap {
  /**
   * The seed the map was derived from with {@link buildScrambleMap}; the same
   * seed always yields the same map. Absent on maps drawn from the CSPRNG
   * ({@link randomScrambleMap}) or read back from a forged font, which have no
   * seed.
   */
  readonly seed?: number;
  /** Readable codepoint -> codepoint that appears in the DOM. */
  readonly forward: ReadonlyMap<number, number>;
  /** Set by {@link invertScrambleMap}: decoding must not normalize ciphertext. */
  readonly inverse?: boolean;
}

/**
 * A 32-bit seed drawn from the CSPRNG when there is one.
 *
 * Only 2^32 maps can come from a seed, and `buildScrambleMap` is public, so a
 * map built from a seed can be found by trying every seed against some
 * ciphertext (about 48 CPU-hours untuned). Use {@link randomScrambleMap} for a
 * cipher that has to resist that.
 */
export function randomSeed(): number {
  const c: Crypto | undefined = globalThis.crypto;
  if (c?.getRandomValues) {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}

/** Shuffle `source` into a derangement of itself. `source` needs 2+ entries. */
function derange(source: readonly number[], rand: () => number): number[] {
  const target = [...source];
  for (let i = target.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [target[i], target[j]] = [target[j], target[i]];
  }

  // Swapping a fixed point with its neighbour never creates a new one.
  for (let i = 0; i < target.length; i++) {
    if (target[i] !== source[i]) continue;
    const j = (i + 1) % target.length;
    [target[i], target[j]] = [target[j], target[i]];
  }
  return target;
}

/**
 * Build the substitution for `charset`: a derangement within each class, so no
 * covered character maps to itself and line breaks stay put. Characters that
 * cannot be swapped safely, including any class with one member, are left out
 * and pass through. The map depends only on the seed and the set of codepoints,
 * the same on every platform (codepoints from very recent Unicode versions may
 * classify differently in older engines).
 *
 * @throws if no class has at least 2 codepoints.
 */
export function buildScrambleMap(
  seed: number,
  charset: readonly number[] = DEFAULT_CHARSET,
): ScrambleMap {
  return { seed, forward: derangeClasses(charset, mulberry32(seed)) };
}

/** Random numbers in [0, 1) from the CSPRNG, drawn in batches of 32-bit words. */
function cryptoRandom(): () => number {
  const c: Crypto | undefined = globalThis.crypto;
  if (!c?.getRandomValues) {
    throw new Error(
      '[veneer] randomScrambleMap needs crypto.getRandomValues, which this environment lacks.',
    );
  }
  const words = new Uint32Array(256);
  let next = words.length;
  return () => {
    if (next === words.length) {
      c.getRandomValues(words);
      next = 0;
    }
    return words[next++] / 4294967296;
  };
}

/**
 * Build a substitution for `charset` from the CSPRNG instead of a seed.
 *
 * Same classes and guarantees as {@link buildScrambleMap}, but every shuffle
 * step takes 32 fresh random bits, so there is no seed to leak or search: the
 * map carries as much randomness as its classes allow (about 225 bits for the
 * letters of `DEFAULT_CHARSET` alone). What the server and the client agree on
 * is then the forged font, not a seed.
 *
 * `random` replaces the CSPRNG (numbers in [0, 1)). Tests only.
 *
 * @throws if no class has at least 2 codepoints, or there is no CSPRNG.
 */
export function randomScrambleMap(
  charset: readonly number[] = DEFAULT_CHARSET,
  random: () => number = cryptoRandom(),
): ScrambleMap {
  return { forward: derangeClasses(charset, random) };
}

/** The class-preserving derangement both map builders share. */
function derangeClasses(charset: readonly number[], rand: () => number): Map<number, number> {
  const classes = new Map<string, number[]>();
  for (const cp of [...new Set(charset)].sort((a, b) => a - b)) {
    const key = classOf(cp);
    if (key === null) continue;
    const members = classes.get(key);
    if (members) members.push(cp);
    else classes.set(key, [cp]);
  }

  // Sorted input fixes the class order, and so the PRNG stream.
  const forward = new Map<number, number>();
  for (const members of classes.values()) {
    if (members.length < 2) continue;
    const target = derange(members, rand);
    members.forEach((cp, i) => forward.set(cp, target[i]));
  }

  if (forward.size === 0) {
    throw new Error(
      `[veneer] charset needs at least 2 codepoints of the same class (letters, digits, ` +
        `or interchangeable punctuation); nothing in it can be scrambled.`,
    );
  }
  return forward;
}

/** Options for {@link scrambleText}. */
export interface ScrambleTextOptions {
  /** NFC-normalize first. Defaults to `true`, except for inverted maps. */
  readonly normalize?: boolean;
}

/**
 * Apply a map; characters outside it pass through. Input is NFC-normalized, so
 * `e` + U+0301 maps like `é`. Decoding skips that: `q` + U+0301 can become
 * `e` + U+0301 in ciphertext, which normalizing would change.
 */
export function scrambleText(
  text: string,
  map: ScrambleMap,
  options: ScrambleTextOptions = {},
): string {
  const source = (options.normalize ?? !map.inverse) ? text.normalize('NFC') : text;
  let out = '';
  for (const ch of source) {
    const mapped = map.forward.get(ch.codePointAt(0)!);
    out += mapped === undefined ? ch : String.fromCodePoint(mapped);
  }
  return out;
}

/** The reverse substitution, marked `inverse` so decoding does not normalize. */
export function invertScrambleMap(map: ScrambleMap): ScrambleMap {
  const forward = new Map<number, number>();
  for (const [from, to] of map.forward) forward.set(to, from);
  const seed = map.seed === undefined ? {} : { seed: map.seed };
  return map.inverse ? { ...seed, forward } : { ...seed, forward, inverse: true };
}
