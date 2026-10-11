import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { charsetFromFont } from './charset-from-font';
import { DEFAULT_CHARSET } from './scramble-map';

/** Travels with the library so its tests never reach into the demo app. */
const bytes = new Uint8Array(readFileSync(join(__dirname, '../../testing/Roboto-Regular.ttf')));

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

describe('charsetFromFont', () => {
  it('returns covered, eligible codepoints from a candidate', async () => {
    const candidate = [0x20, 0x41, 0xa0, 0xad, 0x09, 0x0a, 0x7f, 0x301, 0x200b, 0x4e2d, 0xe9];
    expect(await charsetFromFont(bytes, candidate)).toEqual([0x41, 0xe9]);
  });

  it('defaults to everything the font draws, minus ineligible characters', async () => {
    const charset = await charsetFromFont(toArrayBuffer(bytes));
    expect(charset.length).toBeGreaterThan(500);
    // Whitespace, NBSP, soft hyphen, controls, marks, and break-significant
    // characters (`- / ? ! | }`, en dash, ellipsis), which would move line breaks.
    for (const excluded of [
      0x20,
      0xa0,
      0xad,
      0x0d,
      0x2009,
      0x300,
      ...[...'-/?!|}–…'].map((c) => c.codePointAt(0)!),
    ]) {
      expect(charset).not.toContain(excluded);
    }
    for (const included of DEFAULT_CHARSET) expect(charset).toContain(included);
  });
});
