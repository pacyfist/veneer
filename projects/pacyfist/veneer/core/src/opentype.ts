/**
 * opentype.js, loaded in a way that works in every environment the core runs in.
 *
 * opentype.js 2 ships a CommonJS/UMD `main`, an ESM `module` and no `exports`
 * map, so the same import resolves to different files:
 *
 * - bundlers (Angular's esbuild, vitest) pick the ESM build or wrap the UMD
 *   build, and the namespace carries `Font`, `Glyph`, `parse` directly;
 * - plain Node ESM loads the UMD build as CommonJS, cannot detect its named
 *   exports, and only offers `module.exports` as `default`.
 *
 * A named import (`import { Font } from 'opentype.js'`) therefore throws
 * "Named export 'Font' not found" in plain Node. A namespace import plus this
 * fallback works in both.
 *
 * Internal: not part of the public API.
 */

import * as namespace from 'opentype.js';

type OpenType = typeof namespace;

// `Reflect.get` rather than `namespace.default`: bundlers that resolve the ESM
// build know it has no default export and warn about a static access.
export const opentype: OpenType =
  typeof namespace.Font === 'function'
    ? namespace
    : (Reflect.get(namespace, 'default') as OpenType);
