import { describe, expect, it } from 'vitest';
import { buildScrambleMap, scrambleText } from '@pacyfist/veneer/core';
import { findVeneerLeaks } from '@pacyfist/veneer/testing';

const SECRET = 'This paragraph looks perfectly normal to you. Copy it, search it, or feed it.';

describe('findVeneerLeaks', () => {
  it('finds a whole original despite case, whitespace, punctuation and markup', () => {
    const html = `<p>this   paragraph LOOKS
      perfectly <b>normal</b> to you — copy it; search it or feed it</p>`;

    const [leak, ...rest] = findVeneerLeaks(html, [SECRET]);

    expect(rest).toEqual([]);
    expect(leak.whole).toBe(true);
    expect(leak.words).toBe(14);
    expect(leak.fragment).toBe(SECRET.slice(0, -1));
    expect(html.slice(leak.start, leak.end)).toMatch(/^this {3}paragraph[\s\S]*feed it$/);
  });

  it('searches attribute values', () => {
    const html = '<img alt="Perfectly normal to you" src="x.png" />';
    expect(findVeneerLeaks(html, [SECRET])).toMatchObject([{ words: 4 }]);
  });

  it('reports a run of four consecutive words, and not three', () => {
    expect(findVeneerLeaks('… perfectly normal to you …', [SECRET])).toMatchObject([
      { fragment: 'perfectly normal to you', whole: false, words: 4 },
    ]);
    expect(findVeneerLeaks('… perfectly normal to …', [SECRET])).toEqual([]);
  });

  it('takes the run length from minWords', () => {
    expect(findVeneerLeaks('normal to you', [SECRET], { minWords: 3 })).toHaveLength(1);
    expect(findVeneerLeaks('perfectly normal to you', [SECRET], { minWords: 5 })).toEqual([]);
  });

  it('reports only whole originals when minWords is Infinity', () => {
    const text = 'Copy it, search it, or feed it, but not the rest.';
    expect(findVeneerLeaks(text, [SECRET], { minWords: Infinity })).toEqual([]);
    expect(findVeneerLeaks(SECRET, [SECRET], { minWords: Infinity })).toHaveLength(1);
  });

  it('reports a short original only when it is found whole, as whole words', () => {
    expect(findVeneerLeaks('find the haystack', ['haystack'])).toMatchObject([
      { whole: true, words: 1 },
    ]);
    expect(findVeneerLeaks('find the haystacks', ['haystack'])).toEqual([]);
    expect(findVeneerLeaks('two words', ['two words here'])).toEqual([]);
  });

  it('reports each maximal run once, at every place it occurs, in order', () => {
    const text = 'Nothing here. Copy it, search it, or feed. this paragraph looks perfectly';
    const leaks = findVeneerLeaks(text, [SECRET]);

    expect(leaks.map((l) => l.fragment)).toEqual([
      'Copy it, search it, or feed',
      'This paragraph looks perfectly',
    ]);
    expect(leaks[0].start).toBeLessThan(leaks[1].start);
  });

  it('decodes HTML character references', () => {
    const html = 'Don&#39;t &amp; won&#x27;t panic&nbsp;now';
    const [leak] = findVeneerLeaks(html, ["Don't & won't panic now"]);

    expect(leak.whole).toBe(true);
    expect(leak.start).toBe(0);
    expect(leak.end).toBe(html.length);
  });

  it('decodes JavaScript string escapes', () => {
    const js = String.raw`const a = 'Café au lait, don\'t\nworry';`;
    expect(findVeneerLeaks(js, ["Café au lait, don't worry"])).toMatchObject([{ whole: true }]);
  });

  it('keeps accents apart and folds NFC forms together', () => {
    expect(findVeneerLeaks('cafe au lait', ['café au lait'])).toEqual([]);
    expect(findVeneerLeaks('café au lait', ['café au lait'])).toHaveLength(1);
  });

  it('takes a single string and ignores originals without words', () => {
    expect(findVeneerLeaks(SECRET, SECRET)).toHaveLength(1);
    expect(findVeneerLeaks(SECRET, ['', ' … '])).toEqual([]);
  });

  it('finds nothing in the scrambled form', () => {
    const scrambled = scrambleText(SECRET, buildScrambleMap(0x5eed));
    expect(findVeneerLeaks(scrambled, [SECRET], { minWords: 2 })).toEqual([]);
  });
});
