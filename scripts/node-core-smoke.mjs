// Loads the built `@pacyfist/veneer/core` and `@pacyfist/veneer/forge` bundles
// in plain Node (no bundler, no Angular) and checks the cipher and the font
// forge end to end. `charsetFromFont` (core) imports the forge dynamically
// through the package's own `exports`, which this also exercises.
//
// Run after `npm run build:lib`: `npm run test:node-core`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist/pacyfist/veneer/fesm2022/pacyfist-veneer-core.mjs');
const forgeBundle = join(root, 'dist/pacyfist/veneer/fesm2022/pacyfist-veneer-forge.mjs');
const fixture = join(root, 'projects/pacyfist/veneer/testing/Roboto-Regular.ttf');

// Neither may reach Angular, directly or through anything they import.
for (const file of [bundle, forgeBundle]) {
  assert.doesNotMatch(readFileSync(file, 'utf8'), /@angular\//, `${file} imports Angular`);
}
// The forge stands alone, and the cipher never imports it statically.
assert.doesNotMatch(readFileSync(forgeBundle, 'utf8'), /^import /m, 'the forge has imports');
assert.doesNotMatch(readFileSync(bundle, 'utf8'), /^(import|export) .* from /m, 'core imports');

const core = {
  ...(await import(pathToFileURL(bundle).href)),
  ...(await import(pathToFileURL(forgeBundle).href)),
};
const {
  DEFAULT_CHARSET,
  buildScrambleMap,
  invertScrambleMap,
  scrambleText,
  parseBaseFont,
  forgeScrambledFont,
  coveredCodepoints,
  charsetFromFont,
  randomScrambleMap,
  readScrambleMap,
  parseBaseFontSync,
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

// Forge round trip: the glyph addre// Forge round trip: the glyph addressed by each scrambled codepoint must be the
// base font's glyph for the readable character, and everything else unchanged.
const bytes = readFileSync(fixture);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
let started = performance.now();
const base = await parseBaseFont(buffer);
const forgedBytes = forgeScrambledFont(base, map, 'Veneer-smoke');
const firstRun = performance.now() - started;
assert.ok(forgedBytes instanceof ArrayBuffer && forgedBytes.byteLength > 0, 'empty forged font');

const forged = await parseBaseFont(forgedBytes);
assert.equal(forged.familyName, 'Veneer-smoke');
assert.equal(forged.numGlyphs, base.numGlyphs, 'glyph count changed');
for (const cp of DEFAULT_CHARSET) {
  const readable = String.fromCodePoint(cp);
  const want = base.glyphId(cp);
  assert.ok(want !== 0, `no base glyph for ${JSON.stringify(readable)}`);
  assert.equal(forged.glyphId(map.forward.get(cp)), want, `glyph of ${JSON.stringify(readable)}`);
}
const charset = new Set(DEFAULT_CHARSET);
for (const cp of base.codepoints()) {
  if (!charset.has(cp)) assert.equal(forged.glyphId(cp), base.glyphId(cp), `U+${cp.toString(16)}`);
}

// What a browser hydrating a server render does: read the map back out of
// the forged font. Here with a CSPRNG map, as the server entry point draws.
const drawn = randomScrambleMap();
assert.equal(drawn.seed, undefined, 'a CSPRNG map carries a seed');
const read = readScrambleMap(
  parseBaseFontSync(bytes),
  parseBaseFontSync(forgeScrambledFont(base, drawn, 'Veneer-read')),
);
assert.deepEqual(
  [...read.forward].sort((a, b) => a[0] - b[0]),
  [...drawn.forward].sort((a, b) => a[0] - b[0]),
  'the map read back from the forged font differs',
);

// DecompressionStream exists in Node 18+, so WOFF input must work here too.
assert.deepEqual(coveredCodepoints(base, [0x61, 0x4e2d]), [0x61]);
assert.ok((await charsetFromFont(bytes, DEFAULT_CHARSET)).length === DEFAULT_CHARSET.length);

started = performance.now();
const runs = 20;
for (let i = 0; i < runs; i++) forgeScrambledFont(await parseBaseFont(buffer), map, 'Veneer-smoke');
const warm = (performance.now() - started) / runs;

console.log(
  `node-core smoke: ok (${DEFAULT_CHARSET.length} glyphs remapped, ` +
    `${forgedBytes.byteLength} bytes forged from ${bytes.byteLength}, ` +
    `parse+forge ${firstRun.toFixed(1)} ms first run, ${warm.toFixed(2)} ms warm)`,
);
