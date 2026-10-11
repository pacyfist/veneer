/**
 * The substitution cipher that sits underneath everything else.
 *
 * Framework-free on purpose: the same functions run in the browser, in an SSR
 * process, and in a plain Node script that pre-scrambles static content.
 *
 * ## Layout safety
 *
 * The browser decides where a line may wrap from the *codepoints* in the DOM,
 * not from the glyphs the forged font draws. If a letter maps to `-`, the
 * browser sees a hyphen and may wrap the word there, while the reader sees an
 * ordinary letter: a word split in half. So the cipher only swaps characters
 * that the line breaker treats identically:
 *
 * - letters among letters, digits among digits, and punctuation among
 *   punctuation of the same measured line-break behaviour;
 * - characters that create a break opportunity in some engine (`- / ? ! | }`,
 *   soft hyphen, dashes, ellipsis...) are never substituted, like the space;
 * - a class with one member cannot be deranged, so that character passes
 *   through unchanged too.
 *
 * The punctuation table below was measured, not guessed: every pair of
 * candidate characters was rendered between letters and digits in a
 * zero-width box (so each break opportunity becomes a line), in Chromium 151
 * and Firefox 153 (2026-10-11). Characters share a class only when they broke
 * identically next to every other candidate in both engines. WebKit could not
 * be launched on the measuring machine; the classes also never mix UAX #14
 * line-break classes in a way that matters for Latin text, which WebKit
 * follows.
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
 * Characters that create a line-break opportunity inside a word in at least
 * one measured engine. Never substituted.
 *
 * - Chromium 151: `-` `?`, soft hyphen, U+00B4, U+2010, U+2012-U+2014,
 *   U+2024-U+2027, U+203C, U+203D, U+2046-U+2049, U+2056, U+2058-U+205B,
 *   U+205D, U+205E.
 * - Firefox 153: all of the above, plus `!` `/` `|` `}`.
 */
const BREAKING: ReadonlySet<number> = new Set(codepoints('!-/?|}­´‐‒–—․‥…‧' + '‼‽⁆⁇⁈⁉⁖⁘⁙⁚⁛⁝⁞'));

/**
 * Punctuation and symbols that line-break identically, measured pairwise (see
 * the file comment). Every other non-alphanumeric codepoint in the measured
 * ranges behaved unlike anything else (`"` `'` `$` `<`, U+2011, U+2044) or
 * breaks, so it has no partner and passes through.
 *
 * `"` and `'` differ in Chromium: `"(` breaks, `'(` does not. `<` acts as an
 * opening bracket in Chromium. `$` differs from `%` before brackets.
 */
const PUNCTUATION_CLASSES: readonly string[] = [
  '#&*=>~',
  '%+\\',
  '([{',
  ')]',
  ',.:;',
  '@^_`',
  '¡¿', // ¡ ¿
  '¢£¤¥°±', // ¢ £ ¤ ¥ ° ±
  '²³¹¼½¾', // ² ³ ¹ ¼ ½ ¾
  '«»‘’‛“”‟‹›', // « » ‘ ’ ‛ “ ” ‟ ‹ ›
  '‚„⁅', // ‚ „ ⁅
  '‰‱′″‴‵‶‷⁗€', // ‰ ‱ ′ ″ ‴ ‵ ‶ ‷ ⁗ €
  // ¦ § ¨ © ¬ ® ¯ ¶ · ¸ × ÷ ― ‖ ‗ † ‡ • ‣ ‸ ※ ‾ ‿ ⁀ ⁁ ⁂ ⁃ ⁊ ⁋ ⁌ ⁍ ⁎ ⁏ ⁐ ⁑ ⁒ ⁓ ⁔ ⁕ ⁜ ™
  '¦§¨©¬®¯¶·¸×÷' + '―‖‗†‡•‣‸※‾‿⁀⁁⁂' + '⁃⁊⁋⁌⁍⁎⁏⁐⁑⁒⁓⁔⁕⁜™',
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
 *
 * Letters and digits are grouped by script. ASCII and non-ASCII letters are
 * kept apart because Chromium breaks ASCII pairs with its own table: `/a` does
 * not break there, `/à` does. Fullwidth forms are kept apart because they
 * break around every character.
 *
 * Upper and lower case share a class. Splitting them would leak the case
 * pattern (sentence starts, proper nouns) to frequency analysis, and would
 * not fix `text-transform` on its own: that needs a "case-aware" mode where
 * the same permutation drives both cases, which is deferred.
 *
 * Codepoints NFC would rewrite (the Kelvin sign, U+037E...) never occur in
 * normalized text and are left out, so ciphertext never contains them either.
 *
 * Punctuation outside the measured ranges is grouped by general category.
 * That is a best guess, not a measurement.
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
 * True when `cp` can take part in the cipher: it is a letter, a decimal digit
 * or punctuation with a known partner, and it never creates a line break.
 * Whitespace, NBSP, soft hyphen, controls, combining marks and the
 * break-significant characters are never scramblable.
 *
 * Punctuation outside the measured ranges (Latin-1 and General Punctuation)
 * counts as not scramblable here, because its line-break behaviour is
 * unverified.
 */
export function isScramblable(cp: number): boolean {
  const key = classOf(cp);
  return key !== null && !key.startsWith('S:');
}

/**
 * The ASCII characters the cipher can scramble without moving line breaks:
 * letters, digits and the punctuation in `# & * = > ~ % + \ ( [ { ) ] , . : ;
 * @ ^ _ \``. 84 codepoints, in ascending order.
 *
 * Left out, and therefore shown as themselves:
 *
 * - the space, the only character text normally wraps at;
 * - `- / ? ! | }`, which create a line-break opportunity inside a word in at
 *   least one browser engine;
 * - `" ' $ <`, which break differently from every other character next to
 *   brackets, so no swap partner keeps the layout intact.
 *
 * Combine with `LATIN_1` and `LATIN_EXT_A` to cover accented letters.
 */
export const DEFAULT_CHARSET: readonly number[] = Object.freeze(
  Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => 0x21 + i).filter(isScramblable),
);

/** A bijective, fixed-point-free codepoint substitution. */
export interface ScrambleMap {
  /** The value the map was derived from. The same seed always yields the same map. */
  readonly seed: number;
  /** Readable codepoint -> codepoint that appears in the DOM. */
  readonly forward: ReadonlyMap<number, number>;
  /**
   * True for a map made by {@link invertScrambleMap}. `scrambleText` does not
   * NFC-normalize text it decodes: ciphertext must be inverted exactly as it
   * was written.
   */
  readonly inverse?: boolean;
}

/** A seed drawn from the CSPRNG when there is one, so page loads don't share a cipher. */
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

  // A plain shuffle leaves some characters on themselves. Swapping a fixed
  // point with its neighbour never creates a new one: the neighbour receives
  // a character that is not its own, and the fixed point receives one that
  // is not its own either.
  for (let i = 0; i < target.length; i++) {
    if (target[i] !== source[i]) continue;
    const j = (i + 1) % target.length;
    [target[i], target[j]] = [target[j], target[i]];
  }
  return target;
}

/**
 * Build the substitution for `charset`.
 *
 * The result is a derangement within each class (see the file comment): every
 * covered character maps to a *different* character of the same kind, so no
 * letter survives untouched and line breaks stay where they were.
 *
 * Characters that cannot be swapped safely are left out of the map and pass
 * through unchanged: break-significant characters, whitespace, controls,
 * combining marks, and any class with a single member in `charset` (one digit
 * among letters, say). Order and duplicates in `charset` do not matter; the
 * map depends only on the seed and the set of codepoints.
 *
 * Deterministic for a given `(seed, charset)` on every platform, which lets
 * the server and the browser agree. Classes rely on Unicode properties, so a
 * codepoint assigned in a very recent Unicode version may be classified
 * differently by an older engine; the presets only use long-stable ranges.
 *
 * @throws if no class has at least 2 codepoints, so nothing could be
 * scrambled.
 */
export function buildScrambleMap(
  seed: number,
  charset: readonly number[] = DEFAULT_CHARSET,
): ScrambleMap {
  const classes = new Map<string, number[]>();
  for (const cp of [...new Set(charset)].sort((a, b) => a - b)) {
    const key = classOf(cp);
    if (key === null) continue;
    const members = classes.get(key);
    if (members) members.push(cp);
    else classes.set(key, [cp]);
  }

  // Classes iterate in order of their smallest codepoint, since the charset
  // was sorted first, so the PRNG stream is consumed in a fixed order.
  const rand = mulberry32(seed);
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
  return { seed, forward };
}

/** Options for {@link scrambleText}. */
export interface ScrambleTextOptions {
  /**
   * NFC-normalize the text first, so `e` + U+0301 maps like `é`. Defaults to
   * `true`, except for maps from {@link invertScrambleMap}, whose input is
   * ciphertext.
   */
  readonly normalize?: boolean;
}

/**
 * Apply a map. Characters outside the map pass through unchanged.
 *
 * Text is NFC-normalized first (see {@link ScrambleTextOptions}), so
 * decoding scrambled text returns the normalized form of the original, and the
 * server and the browser scramble `e` + U+0301 and `é` the same way. Decoding
 * does not normalize: a combining mark with no precomposed form on its own
 * letter (`q` + U+0301) can land after a scrambled letter that has one
 * (`e` + U+0301), and normalizing that ciphertext would change it.
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

/**
 * The reverse substitution. Useful in tests, and for decoding your own output.
 *
 * The result is marked `inverse`, so `scrambleText` decodes with it without
 * normalizing. Inverting it again gives a regular, normalizing map.
 */
export function invertScrambleMap(map: ScrambleMap): ScrambleMap {
  const forward = new Map<number, number>();
  for (const [from, to] of map.forward) forward.set(to, from);
  return map.inverse ? { seed: map.seed, forward } : { seed: map.seed, forward, inverse: true };
}
