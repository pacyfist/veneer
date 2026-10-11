/**
 * WOFF 1.0 decoding with the platform's `DecompressionStream`, so no inflate
 * implementation ships with the library.
 *
 * Internal: not part of the public API.
 */

import { VeneerFontError } from './font-error';
import { Sfnt, isSfntFlavor, tagAt, viewOf } from './sfnt';

/** `wOFF` */
export const WOFF_SIGNATURE = 0x774f4646;
/** `wOF2` */
export const WOFF2_SIGNATURE = 0x774f4632;

async function inflate(data: Uint8Array, expected: number, tag: string): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new VeneerFontError(
      '[veneer] this environment has no DecompressionStream, so it cannot read WOFF. ' +
        'Supply the font as .ttf or .otf.',
    );
  }
  // Write and read concurrently: awaiting the write first can deadlock on
  // backpressure once the output exceeds the stream's queue.
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined);
  writer.close().catch(() => undefined);

  const out = new Uint8Array(expected);
  let length = 0;
  const reader = stream.readable.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > expected) throw new Error('longer than declared');
      out.set(value, length);
      length += value.byteLength;
    }
  } catch (cause) {
    throw new VeneerFontError(
      `[veneer] the WOFF font's '${tag}' table does not decompress (${(cause as Error)?.message ?? cause}).`,
    );
  }
  if (length !== expected) {
    throw new VeneerFontError(`[veneer] the WOFF font's '${tag}' table is shorter than declared.`);
  }
  return out;
}

/** Decode a WOFF 1.0 file into its sfnt tables. */
export async function decodeWoff(bytes: Uint8Array): Promise<Sfnt> {
  const fail = (why: string): never => {
    throw new VeneerFontError(`[veneer] the WOFF base font is malformed: ${why}.`);
  };
  if (bytes.byteLength < 44) fail('truncated header');
  const view = viewOf(bytes);
  if (view.getUint32(0) !== WOFF_SIGNATURE) fail('bad signature');
  const flavor = view.getUint32(4);
  if (!isSfntFlavor(flavor)) fail('unknown flavor');
  const numTables = view.getUint16(12);
  if (bytes.byteLength < 44 + numTables * 20) fail('truncated table directory');

  const pending: Promise<[string, Uint8Array]>[] = [];
  for (let i = 0; i < numTables; i++) {
    const record = 44 + i * 20;
    const tag = tagAt(bytes, record);
    const offset = view.getUint32(record + 4);
    const compLength = view.getUint32(record + 8);
    const origLength = view.getUint32(record + 12);
    if (offset + compLength > bytes.byteLength) fail(`'${tag}' runs past the file end`);
    if (compLength > origLength) fail(`'${tag}' is larger compressed than uncompressed`);
    const data = bytes.subarray(offset, offset + compLength);
    pending.push(
      compLength === origLength
        ? Promise.resolve([tag, data])
        : inflate(data, origLength, tag).then((table) => [tag, table]),
    );
  }
  return { flavor, tables: new Map(await Promise.all(pending)) };
}
