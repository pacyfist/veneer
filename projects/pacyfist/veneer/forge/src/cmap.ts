/**
 * Reading and writing the `cmap` table: the codepoint -> glyph id mapping.
 *
 * Reads formats 0, 4, 6, 12 and 13 from the best Unicode subtable. Writes
 * format 4 for the BMP plus format 12 when a codepoint above U+FFFF is mapped,
 * and carries a format 14 (variation sequences) subtable along, re-keyed.
 *
 * Internal: not part of the public API.
 */

import { VeneerFontError } from './font-error';
import { viewOf } from './sfnt';

/** A parsed cmap: the Unicode mapping plus the raw format 14 subtable, if any. */
export interface Cmap {
  /** Codepoint -> glyph id. Never contains glyph 0. */
  readonly glyphs: ReadonlyMap<number, number>;
  /** Variation-sequence subtable (platform 0, encoding 5), parsed. */
  readonly variations: readonly VariationSelector[] | null;
}

export interface VariationSelector {
  readonly selector: number;
  /** Base codepoints whose sequence with this selector uses the default glyph. */
  readonly defaults: readonly number[];
  /** Base codepoint -> glyph id for sequences with their own glyph. */
  readonly glyphs: ReadonlyMap<number, number>;
}

/** Unicode subtables, best first: full repertoire before BMP only. */
const PREFERENCE: readonly (readonly [number, number])[] = [
  [3, 10],
  [0, 6],
  [0, 4],
  [3, 1],
  [0, 3],
  [0, 2],
  [0, 1],
  [0, 0],
];

export function readCmap(table: Uint8Array, numGlyphs: number): Cmap {
  const view = viewOf(table);
  const fail = (why: string): never => {
    throw new VeneerFontError(`[veneer] the base font's cmap table is unusable: ${why}.`);
  };
  if (table.byteLength < 4) fail('truncated');

  const records = new Map<string, number>();
  const count = view.getUint16(2);
  if (table.byteLength < 4 + count * 8) fail('truncated');
  for (let i = 0; i < count; i++) {
    const r = 4 + i * 8;
    const offset = view.getUint32(r + 4);
    if (offset + 2 > table.byteLength) fail('subtable offset out of range');
    records.set(`${view.getUint16(r)},${view.getUint16(r + 2)}`, offset);
  }

  let glyphs: Map<number, number> | null = null;
  for (const [platform, encoding] of PREFERENCE) {
    const offset = records.get(`${platform},${encoding}`);
    if (offset === undefined) continue;
    glyphs = readSubtable(view, offset, numGlyphs);
    if (glyphs) break;
  }
  if (!glyphs) fail('no Unicode subtable in format 0, 4, 6, 12 or 13');

  const uvsOffset = records.get('0,5');
  const variations =
    uvsOffset !== undefined && view.getUint16(uvsOffset) === 14
      ? readFormat14(view, uvsOffset, numGlyphs)
      : null;

  return { glyphs: glyphs!, variations };
}

/** Returns null for a format this reader does not handle. */
function readSubtable(view: DataView, at: number, numGlyphs: number): Map<number, number> | null {
  const map = new Map<number, number>();
  const put = (cp: number, gid: number) => {
    if (gid > 0 && gid < numGlyphs && cp <= 0x10ffff) map.set(cp, gid);
  };

  switch (view.getUint16(at)) {
    case 0:
      for (let c = 0; c < 256; c++) put(c, view.getUint8(at + 6 + c));
      return map;

    case 4: {
      const segCount = view.getUint16(at + 6) >> 1;
      const ends = at + 14;
      const starts = ends + segCount * 2 + 2;
      const deltas = starts + segCount * 2;
      const rangeOffsets = deltas + segCount * 2;
      for (let i = 0; i < segCount; i++) {
        const end = view.getUint16(ends + i * 2);
        const start = view.getUint16(starts + i * 2);
        const delta = view.getUint16(deltas + i * 2);
        const rangeOffsetAt = rangeOffsets + i * 2;
        const rangeOffset = view.getUint16(rangeOffsetAt);
        for (let c = start; c <= end && c < 0xffff; c++) {
          if (rangeOffset === 0) {
            put(c, (c + delta) & 0xffff);
          } else {
            const g = view.getUint16(rangeOffsetAt + rangeOffset + (c - start) * 2);
            if (g !== 0) put(c, (g + delta) & 0xffff);
          }
        }
      }
      return map;
    }

    case 6: {
      const first = view.getUint16(at + 6);
      const count = view.getUint16(at + 8);
      for (let i = 0; i < count; i++) put(first + i, view.getUint16(at + 10 + i * 2));
      return map;
    }

    case 12:
    case 13: {
      const constant = view.getUint16(at) === 13;
      const groups = view.getUint32(at + 12);
      for (let i = 0; i < groups; i++) {
        const g = at + 16 + i * 12;
        const start = view.getUint32(g);
        const end = Math.min(view.getUint32(g + 4), 0x10ffff);
        const gid = view.getUint32(g + 8);
        for (let c = start; c <= end; c++) put(c, constant ? gid : gid + (c - start));
      }
      return map;
    }

    default:
      return null;
  }
}

function readFormat14(view: DataView, at: number, numGlyphs: number): VariationSelector[] {
  const uint24 = (o: number) => (view.getUint8(o) << 16) | view.getUint16(o + 1);
  const selectors: VariationSelector[] = [];
  const count = view.getUint32(at + 6);
  for (let i = 0; i < count; i++) {
    const r = at + 10 + i * 11;
    const defaultsAt = view.getUint32(r + 3);
    const glyphsAt = view.getUint32(r + 7);

    const defaults: number[] = [];
    if (defaultsAt) {
      const ranges = view.getUint32(at + defaultsAt);
      for (let k = 0; k < ranges; k++) {
        const e = at + defaultsAt + 4 + k * 4;
        const start = uint24(e);
        for (let c = start; c <= start + view.getUint8(e + 3); c++) defaults.push(c);
      }
    }

    const glyphs = new Map<number, number>();
    if (glyphsAt) {
      const mappings = view.getUint32(at + glyphsAt);
      for (let k = 0; k < mappings; k++) {
        const e = at + glyphsAt + 4 + k * 5;
        const gid = view.getUint16(e + 3);
        if (gid < numGlyphs) glyphs.set(uint24(e), gid);
      }
    }
    selectors.push({ selector: uint24(r), defaults, glyphs });
  }
  return selectors;
}

/** Big-endian byte sink. */
class Writer {
  private bytes = new Uint8Array(1024);
  private view = new DataView(this.bytes.buffer);
  length = 0;

  private reserve(n: number): number {
    const at = this.length;
    if (at + n > this.bytes.byteLength) {
      const grown = new Uint8Array(Math.max(this.bytes.byteLength * 2, at + n));
      grown.set(this.bytes);
      this.bytes = grown;
      this.view = new DataView(grown.buffer);
    }
    this.length += n;
    return at;
  }

  // Reserve before touching `this.view`: reserving may replace it.
  u8(v: number) {
    const at = this.reserve(1);
    this.view.setUint8(at, v);
  }
  u16(v: number) {
    const at = this.reserve(2);
    this.view.setUint16(at, v & 0xffff);
  }
  u24(v: number) {
    this.u8(v >>> 16);
    this.u16(v);
  }
  u32(v: number) {
    const at = this.reserve(4);
    this.view.setUint32(at, v >>> 0);
  }
  setU32(at: number, v: number) {
    this.view.setUint32(at, v >>> 0);
  }
  append(data: Uint8Array) {
    const at = this.reserve(data.byteLength);
    this.bytes.set(data, at);
  }
  result(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

/** Serialise a cmap table. */
export function writeCmap(cmap: Cmap): Uint8Array {
  const entries = [...cmap.glyphs].filter(([cp]) => cp !== 0xffff).sort((a, b) => a[0] - b[0]);
  const bmp = entries.filter(([cp]) => cp < 0xffff);

  // A format 4 subtable's length is a uint16. A font with tens of thousands of
  // scattered BMP mappings can exceed it; then only format 12 is written.
  const format4 = writeFormat4(bmp);
  const format12 = !format4 || entries.length > bmp.length ? writeFormat12(entries) : null;
  const format14 = cmap.variations?.length ? writeFormat14(cmap.variations) : null;

  // Encoding records must be sorted by platform, then encoding.
  const records: [number, number, Uint8Array][] = [];
  if (format4) records.push([0, 3, format4]);
  if (format12) records.push([0, 4, format12]);
  if (format14) records.push([0, 5, format14]);
  if (format4) records.push([3, 1, format4]);
  if (format12) records.push([3, 10, format12]);

  const w = new Writer();
  w.u16(0);
  w.u16(records.length);
  const offsetSlots: number[] = [];
  for (const [platform, encoding] of records) {
    w.u16(platform);
    w.u16(encoding);
    offsetSlots.push(w.length);
    w.u32(0);
  }
  const written = new Map<Uint8Array, number>();
  records.forEach(([, , subtable], i) => {
    let offset = written.get(subtable);
    if (offset === undefined) {
      offset = w.length;
      written.set(subtable, offset);
      w.append(subtable);
    }
    w.setU32(offsetSlots[i], offset);
  });
  return w.result();
}

interface Segment {
  start: number;
  end: number;
  /** Set for a delta segment; glyph ids come from `glyphs` otherwise. */
  delta: number | null;
  glyphs: number[];
}

/**
 * Format 4, from BMP entries sorted by codepoint (U+FFFF excluded). Null when
 * the subtable would not fit its 16-bit length field.
 */
function writeFormat4(entries: readonly (readonly [number, number])[]): Uint8Array | null {
  const segments: Segment[] = [];

  // Split into runs of consecutive codepoints, then each run into pieces with
  // one constant glyph-minus-codepoint delta. Long pieces become delta
  // segments (8 bytes, however long); short ones are merged into an array
  // segment (2 bytes per codepoint) with their neighbours in the run.
  let i = 0;
  while (i < entries.length) {
    let runEnd = i;
    while (runEnd + 1 < entries.length && entries[runEnd + 1][0] === entries[runEnd][0] + 1)
      runEnd++;

    const pieces: [number, number][] = [];
    for (let p = i; p <= runEnd;) {
      let q = p;
      const delta = entries[p][1] - entries[p][0];
      while (q + 1 <= runEnd && entries[q + 1][1] - entries[q + 1][0] === delta) q++;
      pieces.push([p, q]);
      p = q + 1;
    }

    let array: Segment | null = null;
    for (const [p, q] of pieces) {
      if (q - p + 1 >= 4 || pieces.length === 1) {
        array = null;
        segments.push({
          start: entries[p][0],
          end: entries[q][0],
          delta: (entries[p][1] - entries[p][0]) & 0xffff,
          glyphs: [],
        });
      } else {
        if (!array) {
          array = { start: entries[p][0], end: entries[p][0], delta: null, glyphs: [] };
          segments.push(array);
        }
        for (let k = p; k <= q; k++) array.glyphs.push(entries[k][1]);
        array.end = entries[q][0];
      }
    }
    i = runEnd + 1;
  }
  segments.push({ start: 0xffff, end: 0xffff, delta: 1, glyphs: [] });

  const segCount = segments.length;
  const entrySelector = Math.floor(Math.log2(segCount));
  const searchRange = 2 * 2 ** entrySelector;
  const glyphCount = segments.reduce((n, s) => n + s.glyphs.length, 0);
  const length = 16 + segCount * 8 + glyphCount * 2;
  if (length > 0xffff) return null;

  const w = new Writer();
  w.u16(4);
  w.u16(length);
  w.u16(0); // language
  w.u16(segCount * 2);
  w.u16(searchRange);
  w.u16(entrySelector);
  w.u16(segCount * 2 - searchRange);
  for (const s of segments) w.u16(s.end);
  w.u16(0); // reservedPad
  for (const s of segments) w.u16(s.start);
  for (const s of segments) w.u16(s.delta ?? 0);
  let arrayIndex = 0;
  segments.forEach((s, k) => {
    if (s.delta !== null) {
      w.u16(0);
    } else {
      // Offset in bytes from this idRangeOffset slot to the segment's first glyph id.
      w.u16((segCount - k + arrayIndex) * 2);
      arrayIndex += s.glyphs.length;
    }
  });
  for (const s of segments) for (const g of s.glyphs) w.u16(g);
  return w.result();
}

/** Format 12, from all entries sorted by codepoint. */
function writeFormat12(entries: readonly (readonly [number, number])[]): Uint8Array {
  const groups: [number, number, number][] = [];
  for (const [cp, gid] of entries) {
    const last = groups[groups.length - 1];
    if (last && cp === last[1] + 1 && gid === last[2] + (cp - last[0])) last[1] = cp;
    else groups.push([cp, cp, gid]);
  }
  const w = new Writer();
  w.u16(12);
  w.u16(0);
  w.u32(16 + groups.length * 12);
  w.u32(0); // language
  w.u32(groups.length);
  for (const [start, end, gid] of groups) {
    w.u32(start);
    w.u32(end);
    w.u32(gid);
  }
  return w.result();
}

function writeFormat14(selectors: readonly VariationSelector[]): Uint8Array {
  const sorted = [...selectors].sort((a, b) => a.selector - b.selector);
  const w = new Writer();
  w.u16(14);
  const lengthAt = w.length;
  w.u32(0);
  w.u32(sorted.length);
  const slots: [number, number][] = [];
  for (const s of sorted) {
    w.u24(s.selector);
    slots.push([w.length, w.length + 4]);
    w.u32(0);
    w.u32(0);
  }
  sorted.forEach((s, i) => {
    const defaults = [...new Set(s.defaults)].sort((a, b) => a - b);
    if (defaults.length) {
      const ranges: [number, number][] = [];
      for (const cp of defaults) {
        const last = ranges[ranges.length - 1];
        if (last && cp === last[0] + last[1] + 1 && last[1] < 255) last[1]++;
        else ranges.push([cp, 0]);
      }
      w.setU32(slots[i][0], w.length);
      w.u32(ranges.length);
      for (const [start, extra] of ranges) {
        w.u24(start);
        w.u8(extra);
      }
    }
    const glyphs = [...s.glyphs].sort((a, b) => a[0] - b[0]);
    if (glyphs.length) {
      w.setU32(slots[i][1], w.length);
      w.u32(glyphs.length);
      for (const [cp, gid] of glyphs) {
        w.u24(cp);
        w.u16(gid);
      }
    }
  });
  w.setU32(lengthAt, w.length);
  return w.result();
}
