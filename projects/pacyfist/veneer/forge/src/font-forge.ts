/**
 * Builds the font that undoes the cipher at render time.
 *
 * The forged font is the base font with one change: its `cmap`. Every charset
 * codepoint is pointed at the glyph of the readable character it stands for, so
 * text that reads as gibberish in the DOM paints as the original words. Every
 * other table (outlines, hinting, kerning, ligatures, metrics, variations) is
 * copied byte for byte, so protected text shapes exactly like the base font.
 * The family is renamed and `post` glyph names are dropped.
 *
 * Framework-free and dependency-free, like the cipher in `@pacyfist/veneer/core`.
 * Published as its own entry point, `@pacyfist/veneer/forge`, so the Angular
 * service can load it lazily.
 */

import { VeneerFontError } from './font-error';
import { Cmap, readCmap, writeCmap } from './cmap';
import { readFamilyName, renameFamily, stripGlyphNames } from './name-post';
import { FLAVOR_CFF, Sfnt, isSfntFlavor, readSfnt, viewOf, writeSfnt } from './sfnt';
import { WOFF2_SIGNATURE, WOFF_SIGNATURE, decodeWoff } from './woff';

export { VeneerFontError } from './font-error';

/**
 * The part of a `ScrambleMap` (from `@pacyfist/veneer/core`) the forge reads.
 * Declared here so the forge does not depend on the cipher's entry point.
 */
export interface ForgeMap {
  /** Readable codepoint -> codepoint that appears in the DOM. */
  readonly forward: ReadonlyMap<number, number>;
}

/** A parsed base font, ready to forge from. Create one with {@link parseBaseFont}. */
export interface BaseFont {
  /** Outline format: TrueType (`glyf`), CFF or CFF2. */
  readonly outlines: 'truetype' | 'cff' | 'cff2';
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  /** The family name in the font's `name` table, or `''`. */
  readonly familyName: string;
  /** Glyph id the base font draws `codepoint` with, or 0 (`.notdef`) when it has none. */
  glyphId(codepoint: number): number;
  /** Every codepoint the base font maps to a glyph, ascending. */
  codepoints(): number[];
}

interface Internals {
  readonly sfnt: Sfnt;
  readonly cmap: Cmap;
}

/** What a BaseFont is made of. Kept out of the public object on purpose. */
const internals = new WeakMap<BaseFont, Internals>();

/**
 * Tables dropped from the forged font: a digital signature the edit would
 * invalidate, and font-tool source/debug tables that can carry glyph names.
 */
const DROPPED_TABLES = new Set([
  'DSIG',
  'Debg',
  'TSI0',
  'TSI1',
  'TSI2',
  'TSI3',
  'TSI5',
  'TSIB',
  'TSID',
  'TSIJ',
  'TSIP',
  'TSIS',
  'TSIV',
]);

const WOFF2_HELP =
  '[veneer] the base font is WOFF2, which veneer does not decode itself (it would need a ' +
  'Brotli decoder in every bundle). Either convert it to .ttf at build time ' +
  '(e.g. `woff2_decompress font.woff2`, or fontTools: `fonttools ttLib.woff2 decompress font.woff2`), ' +
  'or decode it in the app and pass the bytes through the loader: ' +
  '`font: () => fetch(url).then((r) => r.arrayBuffer()).then(myWoff2Decoder)`.';

/** Run `work`, reporting a malformed table (a read past its end) as a VeneerFontError. */
function guarded<T>(what: string, work: () => T): T {
  try {
    return work();
  } catch (cause) {
    if (cause instanceof VeneerFontError) throw cause;
    throw new VeneerFontError(
      `[veneer] could not ${what}: the base font is malformed (${(cause as Error)?.message ?? cause}).`,
    );
  }
}

function toBytes(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

/**
 * Parse a base font binary: TrueType (.ttf), CFF OpenType (.otf) or WOFF 1.0.
 * WOFF2 is rejected with instructions; see the README.
 *
 * Async because WOFF tables are inflated with `DecompressionStream`.
 *
 * @throws VeneerFontError when the bytes are not a font veneer can use.
 */
export async function parseBaseFont(buffer: ArrayBuffer | Uint8Array): Promise<BaseFont> {
  const bytes = toBytes(buffer);
  const signature = bytes.byteLength >= 4 ? viewOf(bytes).getUint32(0) : 0;

  let sfnt: Sfnt;
  if (signature === WOFF_SIGNATURE) {
    sfnt = await decodeWoff(bytes);
  } else if (signature === WOFF2_SIGNATURE) {
    throw new VeneerFontError(WOFF2_HELP);
  } else if (isSfntFlavor(signature)) {
    sfnt = readSfnt(bytes);
  } else if (signature === 0x74746366) {
    throw new VeneerFontError(
      '[veneer] the base font is a TrueType collection (.ttc). Extract the one face you need ' +
        'into a .ttf first.',
    );
  } else {
    throw new VeneerFontError(
      '[veneer] could not parse the base font. It must be a .ttf, .otf or .woff file.',
    );
  }
  return guarded('parse the base font', () => describe(sfnt));
}

function describe(sfnt: Sfnt): BaseFont {
  const { tables } = sfnt;
  const required = (tag: string, minimum: number): DataView => {
    const table = tables.get(tag);
    if (!table || table.byteLength < minimum) {
      throw new VeneerFontError(`[veneer] the base font has no usable '${tag}' table.`);
    }
    return viewOf(table);
  };
  const head = required('head', 54);
  const numGlyphs = required('maxp', 6).getUint16(4);
  required('cmap', 4);

  const outlines = tables.has('glyf') ? 'truetype' : tables.has('CFF2') ? 'cff2' : 'cff';
  if (outlines === 'cff' && !tables.has('CFF ')) {
    throw new VeneerFontError(
      '[veneer] the base font has no outlines (no glyf, CFF or CFF2 table).',
    );
  }
  if (outlines === 'truetype' && sfnt.flavor === FLAVOR_CFF) {
    throw new VeneerFontError("[veneer] the base font says it is CFF but carries 'glyf' outlines.");
  }

  const cmap = readCmap(tables.get('cmap')!, numGlyphs);
  const base: BaseFont = Object.freeze({
    outlines,
    unitsPerEm: head.getUint16(18),
    numGlyphs,
    familyName: readFamilyName(tables.get('name')),
    glyphId: (codepoint: number) => cmap.glyphs.get(codepoint) ?? 0,
    codepoints: () => [...cmap.glyphs.keys()].sort((a, b) => a - b),
  });
  internals.set(base, { sfnt, cmap });
  return base;
}

/** The codepoints of `candidate` the base font has a glyph for, in candidate order. */
export function coveredCodepoints(base: BaseFont, candidate: Iterable<number>): number[] {
  return [...new Set(candidate)].filter((cp) => base.glyphId(cp) !== 0);
}

/**
 * Produce a font binary whose cmap is the scrambled one.
 *
 * The base cmap is kept, except that each charset codepoint `scrambled` now
 * points at the base glyph of the readable character it stands for. Codepoints
 * outside the charset keep their base glyphs.
 *
 * @throws VeneerFontError if the base font is missing a glyph for any character
 * in the map. Failing here is deliberate: silently dropping a character would
 * make that character render as its scrambled self, showing the reader the
 * wrong letter with no other symptom. Use {@link coveredCodepoints} to narrow
 * a charset first.
 */
export function forgeScrambledFont(base: BaseFont, map: ForgeMap, familyName: string): ArrayBuffer {
  const parsed = internals.get(base);
  if (!parsed) {
    throw new VeneerFontError('[veneer] forgeScrambledFont needs a font from parseBaseFont().');
  }
  const { sfnt, cmap } = parsed;

  const missing: string[] = [];
  const glyphs = new Map(cmap.glyphs);
  for (const [readable, scrambled] of map.forward) {
    const glyph = cmap.glyphs.get(readable);
    if (glyph === undefined) missing.push(String.fromCodePoint(readable));
    else glyphs.set(scrambled, glyph);
  }
  if (missing.length) {
    throw new VeneerFontError(
      `[veneer] the base font has no glyph for ${missing.length} character(s) in the ` +
        `charset: ${missing.join('')}. Use a base font that covers the charset, or ` +
        `narrow the charset in provideVeneer().`,
      missing,
    );
  }

  // Variation sequences are keyed by codepoint too: re-key them the same way,
  // so "scrambled + selector" draws what "readable + selector" drew.
  const variations =
    cmap.variations?.map((v) => {
      const moved = (cp: number) => map.forward.get(cp) ?? cp;
      return {
        selector: v.selector,
        defaults: v.defaults.map(moved),
        glyphs: new Map([...v.glyphs].map(([cp, gid]) => [moved(cp), gid])),
      };
    }) ?? null;

  return guarded('forge the font', () => {
    const tables = new Map<string, Uint8Array>();
    for (const [tag, data] of sfnt.tables) {
      if (DROPPED_TABLES.has(tag)) continue;
      if (tag === 'cmap') tables.set(tag, writeCmap({ glyphs, variations }));
      else if (tag === 'name') tables.set(tag, renameFamily(data, familyName));
      else if (tag === 'post' && data.byteLength >= 32) tables.set(tag, stripGlyphNames(data));
      else tables.set(tag, data);
    }
    return writeSfnt({ flavor: sfnt.flavor, tables });
  });
}
