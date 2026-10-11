import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// opentype.js is a test-only dependency: a cheap way to build a small face.
import * as opentypeNs from 'opentype.js';
import { parseBaseFont } from '@pacyfist/veneer/forge';
import { VeneerFontService } from './veneer-font.service';
import { VeneerConfig, VeneerFeature, provideVeneer, withFaces } from './veneer.config';

const opentype = (
  typeof opentypeNs.parse === 'function' ? opentypeNs : Reflect.get(opentypeNs, 'default')
) as typeof opentypeNs;

function roboto(): ArrayBuffer {
  const bytes = readFileSync(join(__dirname, '../../testing/Roboto-Regular.ttf'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** A CFF face that draws only the lowercase ASCII letters. */
function lowercaseOnlyFace(): ArrayBuffer {
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', advanceWidth: 500, path: new opentype.Path() }),
  ];
  for (const char of 'abcdefghijklmnopqrstuvwxyz') {
    const path = new opentype.Path();
    path.moveTo(50, 0);
    path.lineTo(450, 0);
    path.lineTo(450, 500);
    path.close();
    glyphs.push(
      new opentype.Glyph({ name: char, unicode: char.codePointAt(0), advanceWidth: 500, path }),
    );
  }
  return new opentype.Font({
    familyName: 'Lowercase',
    styleName: 'Bold',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
  }).toArrayBuffer();
}

class FakeFontFace {
  readonly status = 'loaded';
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors: FontFaceDescriptors = {},
  ) {}
  load() {
    return Promise.resolve(this);
  }
}

let registered: FakeFontFace[];

beforeEach(() => {
  registered = [];
  vi.stubGlobal('FontFace', FakeFontFace);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      add: (face: FakeFontFace) => registered.push(face),
      delete: (face: FakeFontFace) => registered.splice(registered.indexOf(face), 1),
    },
  });
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as { fonts?: unknown }).fonts;
});

@Component({ template: '<p>host</p>' })
class Host {}

async function start(config: VeneerConfig, ...features: VeneerFeature[]) {
  TestBed.configureTestingModule({ providers: [provideVeneer(config, ...features)] });
  const service = TestBed.inject(VeneerFontService);
  TestBed.createComponent(Host).detectChanges();
  await vi.waitFor(() => expect(service.status()).not.toBe('loading'));
  return service;
}

describe('withFaces', () => {
  it('forges every face with one seed under one family, with matching descriptors', async () => {
    const service = await start(
      { font: roboto(), seed: 3 },
      withFaces({ src: roboto(), weight: 700 }, { src: roboto(), style: 'italic', stretch: '75%' }),
    );

    expect(service.status()).toBe('active');
    expect(registered.map((face) => face.family)).toEqual(Array(3).fill(service.familyName));
    expect(registered.map((face) => face.descriptors)).toEqual([
      {},
      { weight: '700' },
      { style: 'italic', stretch: '75%' },
    ]);

    // Each face decodes the same map.
    const base = await parseBaseFont(roboto());
    for (const face of registered) {
      const forged = await parseBaseFont(face.source);
      for (const [readable, scrambled] of service.map().forward) {
        expect(forged.glyphId(scrambled)).toBe(base.glyphId(readable));
      }
    }
  });

  it('accepts weights as strings and numbers', async () => {
    await start({ font: roboto() }, withFaces({ src: roboto(), weight: 'bold' }));
    expect(registered[1].descriptors).toEqual({ weight: 'bold' });
  });

  it('keeps only the characters every face can draw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = await start(
      { font: roboto(), seed: 4 },
      withFaces({ src: lowercaseOnlyFace(), weight: 700 }),
    );

    expect(service.status()).toBe('active');
    const kept = [...service.map().forward.keys()].map((cp) => String.fromCodePoint(cp));
    expect(kept.sort().join('')).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(warn.mock.calls[0][0]).toMatch(/VNR014: the base fonts have no glyph/);
  });

  it('fails the whole instance open when one face cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = await start(
      { font: roboto() },
      withFaces({ src: () => Promise.reject(new Error('bold face missing')), weight: 700 }),
    );

    expect(service.status()).toBe('failed');
    expect(service.failed()?.code).toBe('VNR010');
    expect(service.failed()?.message).toContain('bold face missing');
    expect(registered).toHaveLength(0);
  });

  it('removes every face on destroy', async () => {
    await start({ font: roboto() }, withFaces({ src: roboto(), weight: 700 }));
    expect(registered).toHaveLength(2);
    TestBed.resetTestingModule();
    expect(registered).toHaveLength(0);
  });
});

describe('id', () => {
  it('publishes an implicit seed under a key namespaced by id on the server', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        provideVeneer({ font: new ArrayBuffer(0), id: 'sidebar' }),
      ],
    });
    const service = TestBed.inject(VeneerFontService);
    const state = TestBed.inject(TransferState);

    expect(state.get(makeStateKey<number>('veneerSeed:sidebar'), null)).toBe(service.map().seed);
    expect(state.hasKey(makeStateKey<number>('veneerSeed'))).toBe(false);
  });

  it('reads the seed for its own id when hydrating', () => {
    TestBed.configureTestingModule({
      providers: [provideVeneer({ font: new ArrayBuffer(0), id: 'sidebar', disabled: true })],
    });
    const state = TestBed.inject(TransferState);
    state.set(makeStateKey<number>('veneerSeed'), 1);
    state.set(makeStateKey<number>('veneerSeed:sidebar'), 2);

    expect(TestBed.inject(VeneerFontService).map().seed).toBe(2);
  });

  it('keeps the plain key without an id', () => {
    TestBed.configureTestingModule({
      providers: [provideVeneer({ font: new ArrayBuffer(0), disabled: true })],
    });
    TestBed.inject(TransferState).set(makeStateKey<number>('veneerSeed'), 5);
    expect(TestBed.inject(VeneerFontService).map().seed).toBe(5);
  });
});
