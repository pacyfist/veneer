/** Options for {@link findVeneerLeaks}. */
export interface FindVeneerLeaksOptions {
  /**
   * The shortest run of consecutive words reported as a partial leak.
   * Defaults to 4. An original with fewer words is reported only when it is
   * found whole. `Infinity` reports whole originals only.
   */
  minWords?: number;
}

/** One place where protected text appears in readable form. */
export interface VeneerLeak {
  /** The protected original, exactly as passed in. */
  original: string;
  /** The part that leaked, cut from `original`, from its first matched word to its last. */
  fragment: string;
  /** True when every word of `original` was found, in order. */
  whole: boolean;
  /** How many consecutive words matched. */
  words: number;
  /** Where the match starts in the searched text, in UTF-16 code units. */
  start: number;
  /** Where the match ends (exclusive) in the searched text. */
  end: number;
}

interface Token {
  /** NFC, lower case. */
  word: string;
  start: number;
  end: number;
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

/** JavaScript single-character escapes that are not the character itself. */
const SIMPLE: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: ' ',
  f: ' ',
  v: ' ',
  0: ' ',
};

/**
 * HTML character references and JavaScript string escapes. Text can reach
 * HTML attributes, JSON or a bundle in either form, and an escape with letters
 * in it (`&#39;`, `é`) would otherwise split or invent words.
 */
const ESCAPE =
  /&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]{2,8}));|\\u\{([\da-f]{1,6})\}|\\u([\da-f]{4})|\\x([\da-f]{2})|\\([^ux])/gi;

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

function fromCodePoint(cp: number): string | undefined {
  return cp <= 0x10ffff ? String.fromCodePoint(cp) : undefined;
}

/** The text an escape stands for, or undefined to leave it as written. */
function unescape(m: RegExpMatchArray): string | undefined {
  const [, dec, hex, name, braced, u4, x2, simple] = m;
  if (dec !== undefined) return fromCodePoint(Number(dec));
  const code = hex ?? braced ?? u4 ?? x2;
  if (code !== undefined) return fromCodePoint(parseInt(code, 16));
  if (name !== undefined) return NAMED[name.toLowerCase()];
  return SIMPLE[simple] ?? simple;
}

/** Splits `text` into words, keeping each word's span in the undecoded text. */
function tokenize(text: string): Token[] {
  // Decode, remembering where each decoded UTF-16 unit came from.
  let decoded = '';
  const from: number[] = [];
  const to: number[] = [];
  let last = 0;
  const push = (chunk: string, start: number, end: number) => {
    decoded += chunk;
    for (let i = 0; i < chunk.length; i++) {
      from.push(start);
      to.push(end);
    }
  };
  const copy = (start: number, end: number) => {
    decoded += text.slice(start, end);
    for (let i = start; i < end; i++) {
      from.push(i);
      to.push(i + 1);
    }
  };

  for (const m of text.matchAll(ESCAPE)) {
    const value = unescape(m);
    if (value === undefined) continue;
    const end = m.index + m[0].length;
    copy(last, m.index);
    push(value, m.index, end);
    last = end;
  }
  copy(last, text.length);

  const tokens: Token[] = [];
  for (const m of decoded.matchAll(WORD)) {
    // A tag name (`<b>`, `</em>`) is markup, not a word of the text around it.
    const before = decoded.slice(Math.max(0, m.index - 2), m.index);
    if (before.endsWith('<') || before === '</') continue;
    const end = m.index + m[0].length;
    tokens.push({
      word: m[0].normalize('NFC').toLowerCase(),
      start: from[m.index],
      end: to[end - 1],
    });
  }
  return tokens;
}

/**
 * Every place in `text` where a protected original appears in readable form:
 * the whole original, or a run of at least `minWords` consecutive words of it.
 *
 * Built for leak checks over served HTML, transfer-state JSON and JavaScript
 * bundles. Matching is by words, so it ignores case, whitespace, punctuation,
 * line wrapping and tag names between words (`a <b>c</b>` matches "a c"), and
 * it decodes HTML character references and JavaScript string escapes first.
 * Attribute names and values inside a tag still count as words: they are
 * searched too (`alt`, `aria-label`, `value`), and they split a run.
 * Accents are kept: "café" does not match "cafe". Words split across string
 * concatenations in source (`'Copy th' + 'is'`) are not found.
 *
 * Each maximal run is reported once per place it occurs, sorted by position.
 *
 * ```ts
 * const html = await (await fetch(url)).text();
 * expect(findVeneerLeaks(html, [ARTICLE_BODY])).toEqual([]);
 * ```
 */
export function findVeneerLeaks(
  text: string,
  originals: string | Iterable<string>,
  options: FindVeneerLeaksOptions = {},
): VeneerLeak[] {
  const minWords = Math.max(1, Math.floor(options.minWords ?? 4));
  const haystack = tokenize(text);

  const positions = new Map<string, number[]>();
  haystack.forEach((token, i) => {
    const list = positions.get(token.word);
    if (list) list.push(i);
    else positions.set(token.word, [i]);
  });

  const leaks: VeneerLeak[] = [];
  for (const original of typeof originals === 'string' ? [originals] : originals) {
    const needle = tokenize(original);
    const k = needle.length;
    if (k === 0) continue;
    const n = Math.min(minWords, k);

    for (let i = 0; i + n <= k; i++) {
      for (const p of positions.get(needle[i].word) ?? []) {
        // Part of a longer run that starts one word earlier: reported from there.
        if (i > 0 && p > 0 && haystack[p - 1].word === needle[i - 1].word) continue;

        let length = 0;
        while (
          i + length < k &&
          p + length < haystack.length &&
          haystack[p + length].word === needle[i + length].word
        ) {
          length++;
        }
        if (length < n) continue;

        leaks.push({
          original,
          fragment: original.slice(needle[i].start, needle[i + length - 1].end),
          whole: length === k,
          words: length,
          start: haystack[p].start,
          end: haystack[p + length - 1].end,
        });
      }
    }
  }
  return leaks.sort((a, b) => a.start - b.start || b.words - a.words);
}
