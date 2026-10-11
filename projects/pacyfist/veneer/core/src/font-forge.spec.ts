import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// opentype.js is only a test dependency: an independent reader to check the
// forge's output against, and a cheap way to build a CFF font.
import * as opentypeNs from 'opentype.js';
import { readCmap, writeCmap } from './cmap';
import {
  type BaseFont,
  VeneerFontError,
  charsetFromFont,
  coveredCodepoints,
  forgeScrambledFont,
  parseBaseFont,
} from './font-forge';
import { DEFAULT_CHARSET, buildScrambleMap, type ScrambleMap } from './scramble-map';
import { type Sfnt, readSfnt, tableChecksum, viewOf, writeSfnt } from './sfnt';
import { decodeWoff } from './woff';

const opentype = (
  typeof opentypeNs.parse === 'function' ? opentypeNs : Reflect.get(opentypeNs, 'default')
) as typeof opentypeNs;

/** Travels with the library so its tests never reach into the demo app. */
const FIXTURE = join(__dirname, '../../testing/Roboto-Regular.ttf');

function loadFixture(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
}

/** A map from explicit pairs, for fonts that do not cover the default charset. */
function mapOf(pairs: [string, string][]): ScrambleMap {
  return {
    seed: 0,
    forward: new Map(pairs.map(([r, s]) => [r.codePointAt(0)!, s.codePointAt(0)!])),
  };
}

/** Every check that holds for any forged font, whatever its base. */
function expectFaithfulForge(baseBytes: Uint8Array, forgedBuffer: ArrayBuffer, family: string) {
  const forgedBytes = new Uint8Array(forgedBuffer);
  const base = readSfnt(baseBytes);
  const forged = readSfnt(forgedBytes);

  // Same tables (bar a signature), every one byte for byte except the four the
  // forge edits; head only in checkSumAdjustment.
  const expectedTags = [...base.tables.keys()].filter((t) => t !== 'DSIG').sort();
  expect([...forged.tables.keys()].sort()).toEqual(expectedTags);
  for (const tag of expectedTags) {
    const a = base.tables.get(tag)!;
    const b = forged.tables.get(tag)!;
    if (tag === 'head') {
      expect(b.byteLength).toBe(a.byteLength);
      const mask = (t: Uint8Array) => Uint8Array.from(t, (v, i) => (i >= 8 && i < 12 ? 0 : v));
      expect(sameBytes(mask(a), mask(b)), 'head outside checkSumAdjustment').toBe(true);
    } else if (!['cmap', 'name', 'post'].includes(tag)) {
      expect(sameBytes(a, b), `table ${tag}`).toBe(true);
    }
  }

  // Table checksums, alignment and the whole-file checksum.
  const view = viewOf(forgedBytes);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    expect(offset % 4).toBe(0);
    let data = forgedBytes.subarray(offset, offset + length);
    if (String.fromCharCode(...forgedBytes.subarray(record, record + 4)) === 'head') {
      data = data.slice();
      viewOf(data).setUint32(8, 0);
    }
    expect(view.getUint32(record + 4)).toBe(tableChecksum(data));
  }
  expect(tableChecksum(forgedBytes)).toBe(0xb1b0afba);

  // post format 3: no glyph names.
  const post = forged.tables.get('post');
  if (post) {
    expect(viewOf(post).getUint32(0)).toBe(0x00030000);
    expect(post.byteLength).toBe(32);
  }

  // The family name, read by an independent parser.
  const parsed = opentype.parse(forgedBuffer);
  expect(parsed.getEnglishName('fontFamily')).toBe(family);
  expect(parsed.glyphs.length).toBe(opentype.parse(toArrayBuffer(baseBytes)).glyphs.length);
}

describe('parseBaseFont', () => {
  it('parses a TrueType file', async () => {
    const font = await parseBaseFont(toArrayBuffer(loadFixture()));
    expect(font.outlines).toBe('truetype');
    expect(font.unitsPerEm).toBe(2048);
    expect(font.numGlyphs).toBeGreaterThan(200);
    expect(font.familyName).toBe('Roboto');
    expect(font.glyphId(0x41)).toBeGreaterThan(0);
    expect(font.glyphId(0x4e2d)).toBe(0);
  });

  it('agrees with an independent parser on every mapped codepoint', async () => {
    const bytes = loadFixture();
    const font = await parseBaseFont(bytes);
    const reference = opentype.parse(toArrayBuffer(bytes));
    const codepoints = font.codepoints();
    expect(codepoints.length).toBeGreaterThan(800);
    for (const cp of codepoints) {
      expect(font.glyphId(cp)).toBe(reference.charToGlyphIndex(String.fromCodePoint(cp)));
    }
  });

  it('reports an unusable font clearly instead of throwing something opaque', async () => {
    const junk = new Uint8Array([1, 2, 3, 4]).buffer;
    await expect(parseBaseFont(junk)).rejects.toThrow(VeneerFontError);
    await expect(parseBaseFont(junk)).rejects.toThrow(/\.ttf, \.otf or \.woff/);
  });

  it('explains how to supply a WOFF2 font', async () => {
    const woff2 = new Uint8Array(64);
    woff2.set([0x77, 0x4f, 0x46, 0x32]);
    await expect(parseBaseFont(woff2)).rejects.toThrow(/WOFF2[\s\S]*font: \(\) =>/);
  });

  it('rejects a font without a cmap', async () => {
    const sfnt = readSfnt(loadFixture());
    const tables = new Map(sfnt.tables);
    tables.delete('cmap');
    const stripped = writeSfnt({ flavor: sfnt.flavor, tables });
    await expect(parseBaseFont(stripped)).rejects.toThrow(/'cmap'/);
  });
});

describe('parseBaseFont on a malformed font', () => {
  it('reports a truncated cmap subtable as a VeneerFontError', async () => {
    const sfnt = readSfnt(loadFixture());
    const tables = new Map(sfnt.tables);
    tables.set('cmap', sfnt.tables.get('cmap')!.subarray(0, 40));
    const broken = writeSfnt({ flavor: sfnt.flavor, tables });
    await expect(parseBaseFont(broken)).rejects.toThrow(VeneerFontError);
    await expect(parseBaseFont(broken)).rejects.toThrow(/malformed/);
  });
});

describe('forgeScrambledFont (TrueType)', async () => {
  const bytes = loadFixture();
  const base = await parseBaseFont(toArrayBuffer(bytes));
  const map = buildScrambleMap(2024);
  const forgedBuffer = forgeScrambledFont(base, map, 'Veneer-test');
  const forged = await parseBaseFont(forgedBuffer);

  it('copies every table except cmap, name, post and head byte for byte, with valid checksums', () => {
    expectFaithfulForge(bytes, forgedBuffer, 'Veneer-test');
  });

  it('points each scrambled codepoint at the readable glyph', () => {
    for (const [readable, scrambled] of map.forward) {
      expect(forged.glyphId(scrambled)).toBe(base.glyphId(readable));
    }
  });

  it('agrees with an independent parser', () => {
    const reference = opentype.parse(forgedBuffer);
    for (const [readable, scrambled] of map.forward) {
      expect(reference.charToGlyphIndex(String.fromCodePoint(scrambled))).toBe(
        base.glyphId(readable),
      );
    }
  });

  it('leaves every codepoint outside the charset on its base glyph', () => {
    const charset = new Set(map.forward.keys());
    const outside = base.codepoints().filter((cp) => !charset.has(cp));
    expect(outside).toContain(0x20);
    expect(outside).toContain(0xe9);
    for (const cp of outside) expect(forged.glyphId(cp)).toBe(base.glyphId(cp));
    expect(forged.codepoints()).toEqual(base.codepoints());
  });

  it('does NOT render the readable glyph for its own codepoint', () => {
    const a = 'a'.codePointAt(0)!;
    expect(map.forward.get(a)).not.toBe(a);
    expect(forged.glyphId(a)).not.toBe(base.glyphId(a));
  });

  it('renames the family', () => {
    expect(forged.familyName).toBe('Veneer-test');
  });

  it('is deterministic', () => {
    const again = new Uint8Array(forgeScrambledFont(base, map, 'Veneer-test'));
    expect(sameBytes(again, new Uint8Array(forgedBuffer))).toBe(true);
  });

  it('refuses to forge when the base font cannot draw a charset character', () => {
    // U+4E2D is a CJK ideograph Roboto has no glyph for.
    const cjkMap = buildScrambleMap(1, [0x61, 0x62, 0x4e2d]);
    expect(() => forgeScrambledFont(base, cjkMap, 'Veneer-test')).toThrow(VeneerFontError);
    try {
      forgeScrambledFont(base, cjkMap, 'Veneer-test');
    } catch (e) {
      expect((e as VeneerFontError).missing).toEqual(['中']);
    }
  });

  it('refuses a font object it did not parse', () => {
    const fake = { ...base } as BaseFont;
    expect(() => forgeScrambledFont(fake, map, 'x')).toThrow(/parseBaseFont/);
  });

  it('strips post glyph names (format 2) and drops a stale signature', async () => {
    // Give the fixture a format 2 post naming two glyphs, and a DSIG.
    const sfnt = readSfnt(bytes);
    const numGlyphs = base.numGlyphs;
    const names = ['A', 'B'];
    const post = new Uint8Array(
      32 + 2 + numGlyphs * 2 + names.reduce((n, s) => n + 1 + s.length, 0),
    );
    post.set(sfnt.tables.get('post')!.subarray(0, 32));
    const pv = viewOf(post);
    pv.setUint32(0, 0x00020000);
    pv.setUint16(32, numGlyphs);
    for (let g = 0; g < numGlyphs; g++) pv.setUint16(34 + g * 2, g < 2 ? 258 + g : 0);
    let at = 34 + numGlyphs * 2;
    for (const n of names) {
      post[at++] = n.length;
      for (const c of n) post[at++] = c.charCodeAt(0);
    }
    const tables = new Map(sfnt.tables);
    tables.set('post', post);
    tables.set('DSIG', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]));
    const withNames = new Uint8Array(writeSfnt({ flavor: sfnt.flavor, tables }));

    const out = forgeScrambledFont(await parseBaseFont(withNames), map, 'Veneer-test');
    expectFaithfulForge(withNames, out, 'Veneer-test');
    const forgedPost = readSfnt(new Uint8Array(out)).tables.get('post')!;
    expect(sameBytes(forgedPost.subarray(4), post.subarray(4, 32))).toBe(true);
  });
});

/** A small CFF font with a codepoint above U+FFFF, built with opentype.js. */
function buildCffFont(): Uint8Array {
  const box = (w: number) => {
    const path = new opentype.Path();
    path.moveTo(50, 0);
    path.lineTo(w - 50, 0);
    path.lineTo(w - 50, 700);
    path.lineTo(50, 700);
    path.close();
    return path;
  };
  const glyphs = [
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 500,
      path: new opentype.Path(),
    }),
  ];
  const chars = ['a', 'b', 'c', 'd', 'é', '😀'];
  chars.forEach((char, i) => {
    glyphs.push(
      new opentype.Glyph({
        name: `g${i}`,
        unicode: char.codePointAt(0)!,
        advanceWidth: 400 + i * 50,
        path: box(400 + i * 50),
      }),
    );
  });
  const font = new opentype.Font({
    familyName: 'TinyCff',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
  });
  return new Uint8Array(font.toArrayBuffer());
}

describe('forgeScrambledFont (CFF, above U+FFFF)', async () => {
  const bytes = buildCffFont();
  const base = await parseBaseFont(bytes);
  // A three-cycle that includes the astral emoji.
  const map = mapOf([
    ['a', '😀'],
    ['😀', 'b'],
    ['b', 'a'],
  ]);
  const forgedBuffer = forgeScrambledFont(base, map, 'Veneer-cff');
  const forged = await parseBaseFont(forgedBuffer);

  it('reads the CFF base font', () => {
    expect(base.outlines).toBe('cff');
    expect(base.glyphId(0x1f600)).toBeGreaterThan(0);
  });

  it('copies the CFF table and the rest byte for byte', () => {
    expectFaithfulForge(bytes, forgedBuffer, 'Veneer-cff');
  });

  it('writes format 4 and format 12 subtables with the right encodings', () => {
    const cmap = readSfnt(new Uint8Array(forgedBuffer)).tables.get('cmap')!;
    const view = viewOf(cmap);
    const records: string[] = [];
    for (let i = 0; i < view.getUint16(2); i++) {
      const r = 4 + i * 8;
      const format = view.getUint16(view.getUint32(r + 4));
      records.push(`${view.getUint16(r)},${view.getUint16(r + 2)}:${format}`);
    }
    expect(records).toEqual(['0,3:4', '0,4:12', '3,1:4', '3,10:12']);
  });

  it('maps the astral codepoint both ways', () => {
    for (const [readable, scrambled] of map.forward) {
      expect(forged.glyphId(scrambled)).toBe(base.glyphId(readable));
    }
    for (const cp of [0x63, 0x64, 0xe9]) expect(forged.glyphId(cp)).toBe(base.glyphId(cp));
    const reference = opentype.parse(forgedBuffer);
    expect(reference.charToGlyphIndex('b')).toBe(base.glyphId(0x1f600));
    expect(reference.charToGlyphIndex('😀')).toBe(base.glyphId(0x61));
  });

  it('writes only format 4 when nothing is above U+FFFF', async () => {
    const font = await parseBaseFont(forgedBuffer);
    expect(font.codepoints().some((cp) => cp > 0xffff)).toBe(true);
    const roboto = forgeScrambledFont(
      await parseBaseFont(loadFixture()),
      buildScrambleMap(3),
      'Veneer-bmp',
    );
    const cmap = viewOf(readSfnt(new Uint8Array(roboto)).tables.get('cmap')!);
    expect(cmap.getUint16(2)).toBe(2);
    expect(cmap.getUint16(4 + 2)).toBe(3);
    expect(cmap.getUint16(12 + 2)).toBe(1);
  });
});

describe('cmap writer', () => {
  it('round-trips a scattered mapping through format 4', () => {
    const glyphs = new Map<number, number>();
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let cp = 0x20; cp < 0x3000; cp++) {
      if (rand() < 0.6)
        glyphs.set(cp, rand() < 0.5 ? (cp % 900) + 1 : Math.floor(rand() * 999) + 1);
    }
    const back = readCmap(writeCmap({ glyphs, variations: null }), 1000);
    expect([...back.glyphs].sort((a, b) => a[0] - b[0])).toEqual(
      [...glyphs].sort((a, b) => a[0] - b[0]),
    );
  });

  it('falls back to format 12 alone when format 4 would overflow', () => {
    const glyphs = new Map<number, number>();
    for (let i = 0; i < 40000; i++) glyphs.set(0x100 + i, ((i * 7919) % 60000) + 1);
    const table = writeCmap({ glyphs, variations: null });
    const view = viewOf(table);
    expect(view.getUint16(2)).toBe(2);
    expect(view.getUint16(view.getUint32(8))).toBe(12);
    const back = readCmap(table, 65535);
    expect(back.glyphs.size).toBe(glyphs.size);
    expect(back.glyphs.get(0x100 + 12345)).toBe(glyphs.get(0x100 + 12345));
  });

  it('re-keys variation sequences along with the cmap', async () => {
    const sfnt = readSfnt(loadFixture());
    const original = readCmap(sfnt.tables.get('cmap')!, 2000);
    const a = 0x61;
    const b = 0x62;
    const withUvs = writeCmap({
      glyphs: original.glyphs,
      variations: [{ selector: 0xfe00, defaults: [a], glyphs: new Map([[b, 5]]) }],
    });
    const tables = new Map(sfnt.tables);
    tables.set('cmap', withUvs);
    const base = await parseBaseFont(writeSfnt({ flavor: sfnt.flavor, tables }));

    const map = mapOf([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ]);
    const forged = readSfnt(new Uint8Array(forgeScrambledFont(base, map, 'Veneer-uvs')));
    const variations = readCmap(forged.tables.get('cmap')!, 2000).variations!;
    expect(variations).toHaveLength(1);
    expect(variations[0].selector).toBe(0xfe00);
    expect(variations[0].defaults).toEqual([b]);
    expect([...variations[0].glyphs]).toEqual([[0x63, 5]]);
  });
});

describe('coveredCodepoints and charsetFromFont', async () => {
  const bytes = loadFixture();
  const base = await parseBaseFont(bytes);

  it('keeps only the codepoints the font can draw, in candidate order', () => {
    expect(coveredCodepoints(base, [0x62, 0x4e2d, 0x61, 0x61, 0x1f600])).toEqual([0x62, 0x61]);
    expect(coveredCodepoints(base, DEFAULT_CHARSET)).toEqual([...DEFAULT_CHARSET]);
  });

  it('lets a runtime narrow a map that the font cannot fully back', () => {
    const wanted = [0x61, 0x62, 0x63, 0x4e2d];
    const map = buildScrambleMap(9, coveredCodepoints(base, wanted));
    expect(() => forgeScrambledFont(base, map, 'Veneer-narrow')).not.toThrow();
  });

  it('returns covered, eligible codepoints from a candidate', async () => {
    const candidate = [0x20, 0x41, 0xa0, 0xad, 0x09, 0x0a, 0x7f, 0x301, 0x200b, 0x4e2d, 0xe9];
    expect(await charsetFromFont(bytes, candidate)).toEqual([0x41, 0xe9]);
  });

  it('defaults to everything the font draws, minus ineligible characters', async () => {
    const charset = await charsetFromFont(toArrayBuffer(bytes));
    expect(charset.length).toBeGreaterThan(500);
    for (const excluded of [0x20, 0xa0, 0xad, 0x0d, 0x2009, 0x300]) {
      expect(charset).not.toContain(excluded);
    }
    for (const included of DEFAULT_CHARSET) expect(charset).toContain(included);
  });
});

/** WOFF 1.0 from an sfnt, compressing each table with zlib when that helps. */
function encodeWoff(sfnt: Sfnt, compress = true): Uint8Array {
  const entries = [...sfnt.tables].map(([tag, data]) => {
    const deflated = compress ? new Uint8Array(deflateSync(data)) : data;
    return { tag, data, stored: deflated.byteLength < data.byteLength ? deflated : data };
  });
  const headerSize = 44 + entries.length * 20;
  let size = headerSize;
  const offsets = entries.map((e) => {
    const at = size;
    size += (e.stored.byteLength + 3) & ~3;
    return at;
  });
  const out = new Uint8Array(size);
  const view = viewOf(out);
  view.setUint32(0, 0x774f4646);
  view.setUint32(4, sfnt.flavor);
  view.setUint32(8, size);
  view.setUint16(12, entries.length);
  entries.forEach((e, i) => {
    const r = 44 + i * 20;
    for (let k = 0; k < 4; k++) out[r + k] = e.tag.charCodeAt(k);
    view.setUint32(r + 4, offsets[i]);
    view.setUint32(r + 8, e.stored.byteLength);
    view.setUint32(r + 12, e.data.byteLength);
    view.setUint32(r + 16, tableChecksum(e.data));
    out.set(e.stored, offsets[i]);
  });
  return out;
}

describe('WOFF input', () => {
  const ttf = loadFixture();
  const sfnt = readSfnt(ttf);

  it('decodes a compressed WOFF to the original tables', async () => {
    const woff = encodeWoff(sfnt);
    expect(woff.byteLength).toBeLessThan(ttf.byteLength * 0.8);
    const decoded = await decodeWoff(woff);
    expect(decoded.flavor).toBe(sfnt.flavor);
    expect([...decoded.tables.keys()].sort()).toEqual([...sfnt.tables.keys()].sort());
    for (const [tag, data] of sfnt.tables) {
      expect(sameBytes(decoded.tables.get(tag)!, data), tag).toBe(true);
    }
  });

  it('forges the same bytes from WOFF as from TTF', async () => {
    const map = buildScrambleMap(77);
    const fromTtf = new Uint8Array(forgeScrambledFont(await parseBaseFont(ttf), map, 'V'));
    for (const compress of [true, false]) {
      const woff = encodeWoff(sfnt, compress);
      const fromWoff = new Uint8Array(forgeScrambledFont(await parseBaseFont(woff), map, 'V'));
      expect(sameBytes(fromWoff, fromTtf)).toBe(true);
    }
  });

  it('reports a corrupt WOFF table as a VeneerFontError', async () => {
    const woff = encodeWoff(sfnt);
    const view = viewOf(woff);
    // Scribble over the start of the first compressed table.
    const offset = view.getUint32(44 + 4);
    woff.fill(0xff, offset, offset + 16);
    await expect(parseBaseFont(woff)).rejects.toThrow(VeneerFontError);
  });
});
