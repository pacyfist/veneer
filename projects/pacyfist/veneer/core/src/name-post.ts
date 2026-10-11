/**
 * The `name` and `post` edits the forge makes.
 *
 * Internal: not part of the public API.
 */

import { viewOf } from './sfnt';

/** Name IDs that carry the family name, or something derived from it. */
const FAMILY_IDS = new Set([1, 3, 4, 16, 18, 21]);
/** Name IDs that carry a PostScript name, which has a restricted alphabet. */
const POSTSCRIPT_IDS = new Set([6, 25]);

/** A PostScript name: printable ASCII without `[](){}<>/%`, at most 63 characters. */
export function postScriptName(family: string): string {
  return family.replace(/[^\x21-\x7e]|[[\](){}<>/%]/g, '').slice(0, 63) || 'Veneer';
}

function encodeName(platform: number, text: string): Uint8Array {
  if (platform === 0 || platform === 3) {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      out[i * 2] = text.charCodeAt(i) >> 8;
      out[i * 2 + 1] = text.charCodeAt(i) & 0xff;
    }
    return out;
  }
  // Macintosh and ISO records: keep to ASCII, which every 8-bit encoding shares.
  return Uint8Array.from(text, (c) => (c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : 0x3f));
}

function decodeName(platform: number, bytes: Uint8Array): string {
  if (platform === 0 || platform === 3) {
    let text = '';
    for (let i = 0; i + 1 < bytes.byteLength; i += 2) {
      text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return text;
  }
  return String.fromCharCode(...bytes);
}

/** The family name a font calls itself, preferring the typographic family (ID 16). */
export function readFamilyName(table: Uint8Array | undefined): string {
  if (!table || table.byteLength < 6) return '';
  const view = viewOf(table);
  const count = view.getUint16(2);
  const storage = view.getUint16(4);
  let best = '';
  let bestRank = Infinity;
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > table.byteLength) break;
    const platform = view.getUint16(r);
    const nameId = view.getUint16(r + 6);
    if (nameId !== 1 && nameId !== 16) continue;
    // Prefer ID 16 over 1, Windows over Unicode over Macintosh.
    const rank = (nameId === 16 ? 0 : 10) + (platform === 3 ? 0 : platform === 0 ? 1 : 2);
    if (rank >= bestRank) continue;
    const start = storage + view.getUint16(r + 10);
    const end = start + view.getUint16(r + 8);
    if (end > table.byteLength) continue;
    best = decodeName(platform, table.subarray(start, end));
    bestRank = rank;
  }
  return best;
}

/**
 * Replace every family-derived string with `family`, keeping all other records
 * (copyright, license, version, designer...) byte for byte.
 */
export function renameFamily(table: Uint8Array, family: string): Uint8Array {
  const view = viewOf(table);
  const format = view.getUint16(0);
  const count = view.getUint16(2);
  const storage = view.getUint16(4);
  const postScript = postScriptName(family);

  const records: { header: number[]; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = view.getUint16(r);
    const nameId = view.getUint16(r + 6);
    const start = storage + view.getUint16(r + 10);
    const data = FAMILY_IDS.has(nameId)
      ? encodeName(platform, family)
      : POSTSCRIPT_IDS.has(nameId)
        ? encodeName(platform, postScript)
        : table.subarray(start, start + view.getUint16(r + 8));
    records.push({
      header: [platform, view.getUint16(r + 2), view.getUint16(r + 4), nameId],
      data,
    });
  }

  // Format 1 adds language-tag strings after the records.
  const langTags: Uint8Array[] = [];
  if (format === 1) {
    const at = 6 + count * 12;
    const langCount = view.getUint16(at);
    for (let i = 0; i < langCount; i++) {
      const length = view.getUint16(at + 2 + i * 4);
      const start = storage + view.getUint16(at + 4 + i * 4);
      langTags.push(table.subarray(start, start + length));
    }
  }

  const headerSize = 6 + count * 12 + (format === 1 ? 2 + langTags.length * 4 : 0);
  const strings = [...records.map((r) => r.data), ...langTags];
  const total = headerSize + strings.reduce((n, s) => n + s.byteLength, 0);
  const out = new Uint8Array(total);
  const w = viewOf(out);
  w.setUint16(0, format);
  w.setUint16(2, count);
  w.setUint16(4, headerSize);

  let offset = 0;
  const place = (data: Uint8Array) => {
    out.set(data, headerSize + offset);
    const at = offset;
    offset += data.byteLength;
    return at;
  };
  records.forEach((record, i) => {
    const r = 6 + i * 12;
    record.header.forEach((v, k) => w.setUint16(r + k * 2, v));
    w.setUint16(r + 8, record.data.byteLength);
    w.setUint16(r + 10, place(record.data));
  });
  if (format === 1) {
    const at = 6 + count * 12;
    w.setUint16(at, langTags.length);
    langTags.forEach((tag, i) => {
      w.setUint16(at + 2 + i * 4, tag.byteLength);
      w.setUint16(at + 4 + i * 4, place(tag));
    });
  }
  return out;
}

/**
 * Convert `post` to format 3, which carries no glyph names. Format 2 names
 * would tell an attacker the readable character behind every glyph.
 */
export function stripGlyphNames(table: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  out.set(table.subarray(0, 32));
  viewOf(out).setUint32(0, 0x00030000);
  return out;
}
