// Loads the built `@pacyfist/veneer/core` bundle in plain Node (no bundler, no
// Angular) and checks the cipher and the font forge end to end.
//
// Run after `npm run build:lib`: `npm run test:node-core`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import opentype from 'opentype.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist/pacyfist/veneer/fesm2022/pacyfist-veneer-core.mjs');
const fixture = join(root, 'projects/pacyfist/veneer/testing/Roboto-Regular.ttf');

// The core must not reach Angular, directly or through anything it imports.
const source = readFileSync(bundle, 'utf8');
assert.doesNotMatch(source, /@angular\//, 'the core bundle imports Angular');

const core = await import(pathToFileURL(bundle).href);
const {
  DEFAULT_CHARSET,
  buildScrambleMap,
  invertScrambleMap,
  scrambleText,
  parseBaseFont,
  forgeScrambledFont,
} = core;

// Cipher round trip.
const text = 'The quick brown fox jumps over the lazy dog. 0123456789 !?';
const map = buildScrambleMap(2024);
const scrambled = scrambleText(text, map);
assert.notEqual(scrambled, text, 'scrambleText left the text unchanged');
assert.equal(scrambleText(scrambled, invertScrambleMap(map)), text, 'inverting did not restore');
assert.deepEqual(
  [...buildScrambleMap(2024).forward],
  [...map.forward],
  'the same seed built a different map',
);

// Forge round trip: the glyph addressed by each scrambled codepoint must be the
// base font's glyph for the readable character.
const bytes = readFileSync(fixture);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const base = parseBaseFont(buffer);
const forgedBytes = forgeScrambledFont(base, map, 'Veneer-smoke');
assert.ok(forgedBytes instanceof ArrayBuffer && forgedBytes.byteLength > 0, 'empty forged font');

const forged = opentype.parse(forgedBytes);
assert.equal(forged.getEnglishName('fontFamily'), 'Veneer-smoke');
for (const cp of DEFAULT_CHARSET) {
  const readable = String.fromCodePoint(cp);
  const target = String.fromCodePoint(map.forward.get(cp));
  const want = base.charToGlyph(readable);
  const got = forged.charToGlyph(target);
  assert.ok(got && got.index !== 0, `no glyph for ${JSON.stringify(readable)}`);
  assert.equal(got.advanceWidth, want.advanceWidth, `advance of ${JSON.stringify(readable)}`);
  // The forge writes CFF (cubic) outlines from TrueType (quadratic) ones, so
  // compare the drawn extent rather than the path data.
  const a = got.path.getBoundingBox();
  const b = want.path.getBoundingBox();
  for (const k of ['x1', 'y1', 'x2', 'y2']) {
    assert.ok(Math.abs(a[k] - b[k]) <= 1, `outline of ${JSON.stringify(readable)} (${k})`);
  }
}

console.log(
  `node-core smoke: ok (${DEFAULT_CHARSET.length} glyphs, ${forgedBytes.byteLength} bytes forged)`,
);
