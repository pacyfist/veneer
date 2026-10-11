/**
 * A minimal sfnt (TrueType / OpenType) container reader and writer.
 *
 * It only knows the table directory: tables are opaque byte ranges that are
 * read as views and written back unchanged. The few tables the forge edits
 * (cmap, name, post) are handled in their own modules.
 *
 * Internal: not part of the public API.
 */

import { VeneerFontError } from './font-error';

/** `\0\1\0\0`: TrueType outlines. */
export const FLAVOR_TRUETYPE = 0x00010000;
/** `OTTO`: CFF or CFF2 outlines. */
export const FLAVOR_CFF = 0x4f54544f;
/** `true`: TrueType outlines, the old Apple signature. */
export const FLAVOR_APPLE = 0x74727565;

/** A font as its table directory: the sfnt version plus every table's bytes, keyed by tag. */
export interface Sfnt {
  readonly flavor: number;
  readonly tables: ReadonlyMap<string, Uint8Array>;
}

export function tagAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

export function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function isSfntFlavor(flavor: number): boolean {
  return flavor === FLAVOR_TRUETYPE || flavor === FLAVOR_CFF || flavor === FLAVOR_APPLE;
}

/** Read the table directory of an uncompressed sfnt. Table bytes are views into `bytes`. */
export function readSfnt(bytes: Uint8Array): Sfnt {
  if (bytes.byteLength < 12) throw new VeneerFontError('[veneer] the base font is truncated.');
  const view = viewOf(bytes);
  const flavor = view.getUint32(0);
  const numTables = view.getUint16(4);
  if (bytes.byteLength < 12 + numTables * 16) {
    throw new VeneerFontError('[veneer] the base font table directory is truncated.');
  }

  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    const tag = tagAt(bytes, record);
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (offset + length > bytes.byteLength) {
      throw new VeneerFontError(`[veneer] the base font's '${tag}' table runs past the file end.`);
    }
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  return { flavor, tables };
}

/** Sum of the data as big-endian uint32 words, zero-padded to a multiple of four. */
export function tableChecksum(bytes: Uint8Array): number {
  const view = viewOf(bytes);
  const whole = bytes.byteLength & ~3;
  let sum = 0;
  for (let i = 0; i < whole; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  if (whole < bytes.byteLength) {
    let last = 0;
    for (let i = whole; i < whole + 4; i++)
      last = (last << 8) | (i < bytes.byteLength ? bytes[i] : 0);
    sum = (sum + (last >>> 0)) >>> 0;
  }
  return sum;
}

/**
 * Serialise a font: tables sorted by tag, each starting on a four-byte
 * boundary, every table checksum recomputed and `head.checkSumAdjustment` set
 * so the whole file sums to 0xB1B0AFBA.
 */
export function writeSfnt(sfnt: Sfnt): ArrayBuffer {
  const tags = [...sfnt.tables.keys()].sort();
  const numTables = tags.length;
  const entrySelector = numTables ? Math.floor(Math.log2(numTables)) : 0;
  const searchRange = 2 ** entrySelector * 16;

  let size = 12 + numTables * 16;
  const offsets: number[] = [];
  for (const tag of tags) {
    offsets.push(size);
    size += (sfnt.tables.get(tag)!.byteLength + 3) & ~3;
  }

  const out = new Uint8Array(size);
  const view = viewOf(out);
  view.setUint32(0, sfnt.flavor);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, numTables * 16 - searchRange);

  let headOffset = -1;
  tags.forEach((tag, i) => {
    const data = sfnt.tables.get(tag)!;
    const offset = offsets[i];
    out.set(data, offset);
    if (tag === 'head') {
      if (data.byteLength < 54)
        throw new VeneerFontError("[veneer] the base font's 'head' table is truncated.");
      headOffset = offset;
      view.setUint32(offset + 8, 0);
    }
    const record = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[record + k] = tag.charCodeAt(k);
    view.setUint32(record + 4, tableChecksum(out.subarray(offset, offset + data.byteLength)));
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, data.byteLength);
  });

  if (headOffset >= 0) {
    view.setUint32(headOffset + 8, (0xb1b0afba - tableChecksum(out)) >>> 0);
  }
  return out.buffer;
}
