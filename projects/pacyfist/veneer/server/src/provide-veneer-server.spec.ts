import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EnvironmentInjector, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VeneerConfig,
  VeneerFontService,
  provideVeneer,
  ɵVENEER_SERVER_FORGE as VENEER_SERVER_FORGE,
  ɵResolvedVeneerConfig as ResolvedVeneerConfig,
  ɵVeneerServerCipher as VeneerServerCipher,
} from '@pacyfist/veneer';
import { DEFAULT_CHARSET, scrambleText } from '@pacyfist/veneer/core';
import { parseBaseFont, readScrambleMap } from '@pacyfist/veneer/forge';
import { VeneerServerOptions, provideVeneerServer } from './provide-veneer-server';
import { getVeneerFont, veneerFontMiddleware } from './font-store';

const FIXTURE = join(__dirname, '../../testing/Roboto-Regular.ttf');
const FONT_DIR = dirname(FIXTURE);
const FONT_URL = 'Roboto-Regular.ttf';

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

/** A server-side injector with the server provider and one veneer instance. */
function serverInstance(
  config: Partial<VeneerConfig> = {},
  options: Partial<VeneerServerOptions> = {},
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'server' },
      provideVeneerServer({ fonts: FONT_DIR, ...options }),
      provideVeneer({ font: FONT_URL, ...config }),
    ],
  });
  return {
    service: TestBed.inject(VeneerFontService),
    state: TestBed.inject(TransferState),
  };
}

function prepare(
  config: Partial<ResolvedVeneerConfig> = {},
  options: Partial<VeneerServerOptions> = {},
) {
  TestBed.configureTestingModule({
    providers: [provideVeneerServer({ fonts: FONT_DIR, ...options })],
  });
  const forge = TestBed.inject(EnvironmentInjector).get(VENEER_SERVER_FORGE);
  return forge.prepare({
    font: FONT_URL,
    fallbackFontFamily: 'sans-serif',
    charset: DEFAULT_CHARSET,
    hideUntilReady: true,
    hideWith: 'stylesheet',
    disabled: false,
    strictCoverage: false,
    faces: [],
    statusListeners: [],
    statusAttribute: false,
    a11y: 'none',
    readableCopy: null,
    ...config,
  });
}

async function readBack(cipher: VeneerServerCipher, index = 0) {
  const base = await parseBaseFont(readFileSync(FIXTURE));
  const forged = await parseBaseFont(getVeneerFont(cipher.urls[index])!);
  return readScrambleMap(base, forged).forward;
}

describe('provideVeneerServer', () => {
  it('draws the map from the CSPRNG, with no seed', () => {
    const cipher = prepare();
    expect(cipher.map.seed).toBeUndefined();
    expect(cipher.map.forward.size).toBeGreaterThan(50);
  });

  it('names the font randomly and serves it under a random URL', () => {
    const cipher = prepare();
    expect(cipher.familyName).toMatch(/^Veneer-[0-9a-f]{16}$/);
    expect(cipher.urls).toHaveLength(1);
    expect(cipher.urls[0]).toMatch(/^veneer\/[0-9a-f]{32}\.ttf$/);
  });

  it('forges a font the browser can read the exact map back from', async () => {
    const cipher = prepare();
    expect(new Map([...(await readBack(cipher))].sort())).toEqual(
      new Map([...cipher.map.forward].sort()),
    );
  });

  it('builds one cipher per configuration, shared by every render', () => {
    TestBed.configureTestingModule({
      providers: [provideVeneerServer({ fonts: FONT_DIR })],
    });
    const forge = TestBed.inject(EnvironmentInjector).get(VENEER_SERVER_FORGE);
    const config = {
      font: FONT_URL,
      fallbackFontFamily: 'sans-serif',
      charset: DEFAULT_CHARSET,
      hideUntilReady: true,
      hideWith: 'stylesheet' as const,
      disabled: false,
      strictCoverage: false,
      faces: [],
      statusListeners: [],
      statusAttribute: false,
      a11y: 'none' as const,
      readableCopy: null,
    };
    const first = forge.prepare(config);
    expect(forge.prepare({ ...config })).toBe(first);
    expect(forge.prepare({ ...config, charset: [...DEFAULT_CHARSET].slice(10) })).not.toBe(first);
  });

  it('honours a fixed seed (solvable: tests and reproducible builds only)', () => {
    expect(prepare({ seed: 3 }).map.seed).toBe(3);
  });

  it('forges one font per face from one map, under one family', async () => {
    const cipher = prepare({
      faces: [{ src: FONT_URL, weight: 700 }],
    });
    expect(cipher.urls).toHaveLength(2);
    expect(cipher.urls[0]).not.toBe(cipher.urls[1]);
    expect(await readBack(cipher, 1)).toEqual(await readBack(cipher, 0));
  });

  it('accepts a reader function and sources given as bytes', () => {
    const bytes = readFileSync(FIXTURE);
    const reader = vi.fn(() => bytes);
    expect(prepare({}, { fonts: reader }).urls).toHaveLength(1);
    expect(reader).toHaveBeenCalledWith(FONT_URL);

    TestBed.resetTestingModule();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(prepare({ font: buffer as ArrayBuffer }).urls).toHaveLength(1);
  });

  it("leaves out characters the font cannot draw, with the browser's VNR014 warning once", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // ƀ and ƃ: letters Roboto has no glyph for.
    const cipher = prepare({ charset: [...DEFAULT_CHARSET, 0x180, 0x183] });
    expect(cipher.map.forward.has(0x180)).toBe(false);
    expect(cipher.map.forward.has(0x41)).toBe(true);
    TestBed.resetTestingModule();
    prepare({ charset: [...DEFAULT_CHARSET, 0x183, 0x180] });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      '[veneer] VNR014: the base font has no glyph for 2 charset character(s): ƀƃ. They are ' +
        'left out of the cipher and shown as they are, in the fallback font. Narrow `charset` ' +
        'to silence this, or set `strictCoverage: true` to fail instead. See ' +
        'https://github.com/pacyfist/veneer/blob/main/projects/pacyfist/veneer/README.md#vnr014',
    );
  });

  it('with strictCoverage, refuses a charset the font cannot draw, listing the characters', () => {
    expect(() =>
      prepare({ charset: [...DEFAULT_CHARSET, 0x180, 0x183], strictCoverage: true }),
    ).toThrow(expect.objectContaining({ missing: ['ƀ', 'ƃ'] }));
  });

  it('explains a font file it cannot find', () => {
    expect(() => prepare({ font: 'fonts/missing.ttf' })).toThrow(/VNR015.*could not read/);
  });

  it('refuses paths outside the font folder', () => {
    expect(() => prepare({ font: '../../package.json' })).toThrow(/outside/);
  });

  it('refuses absolute URLs', () => {
    expect(() => prepare({ font: 'https://example.com/a.ttf' })).toThrow(/absolute URL/);
  });

  it('refuses a loader function, which a synchronous render cannot await', () => {
    expect(() => prepare({ font: () => Promise.resolve(new ArrayBuffer(0)) })).toThrow(
      /loader function/,
    );
  });

  it('writes the fonts to emitDir for static output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'veneer-emit-'));
    try {
      const cipher = prepare({}, { emitDir: dir, path: 'assets/veneer/' });
      expect(cipher.urls[0]).toMatch(/^assets\/veneer\/[0-9a-f]{32}\.ttf$/);
      const files = readdirSync(join(dir, 'assets/veneer'));
      expect(files).toEqual([cipher.urls[0].split('/').pop()]);
      expect(readFileSync(join(dir, cipher.urls[0]))).toEqual(
        Buffer.from(getVeneerFont(cipher.urls[0])!),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('server rendering with provideVeneerServer', () => {
  it('scrambles with the forged map and puts no seed or map into TransferState', () => {
    const { service, state } = serverInstance();

    expect(service.active()).toBe(true);
    const map = service.initialMap()!;
    expect(map.seed).toBeUndefined();
    expect(service.scramble('Hello')).toBe(scrambleText('Hello', map));

    const transfer = state.get(makeStateKey<unknown>('veneer'), null);
    expect(transfer).toEqual({ family: service.familyName, fonts: [expect.any(String)] });
    expect(state.hasKey(makeStateKey<unknown>('veneerSeed'))).toBe(false);
    // Nothing in the serialized state can rebuild the map.
    const json = state.toJson();
    expect(json).not.toMatch(/seed/i);
    expect(json).not.toContain(String([...map.forward.values()].slice(0, 3)));
  });

  it('fails open with VNR015 when the server cannot forge', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service, state } = serverInstance({ font: 'nope/missing.ttf' });

    expect(service.failed()?.code).toBe('VNR015');
    expect(service.active()).toBe(false);
    expect(service.scramble('Hello')).toBe('Hello');
    expect(state.hasKey(makeStateKey<unknown>('veneer'))).toBe(false);
    expect(error.mock.calls[0][0]).toMatch(/^\[veneer\] disabled \(VNR015\) on the server/);
  });
});

describe('server rendering without provideVeneerServer', () => {
  it('renders readable text with VNR015, since it cannot scramble without leaking the key', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }, provideVeneer({ font: FONT_URL })],
    });
    const service = TestBed.inject(VeneerFontService);
    expect(service.failed()?.code).toBe('VNR015');
    expect(service.scramble('Hello')).toBe('Hello');
  });

  it('uses a fixed seed from the config, transferring nothing', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        provideVeneer({ font: FONT_URL, seed: 11 }),
      ],
    });
    const service = TestBed.inject(VeneerFontService);
    expect(service.active()).toBe(true);
    expect(service.initialMap()?.seed).toBe(11);
    expect(TestBed.inject(TransferState).isEmpty).toBe(true);
  });
});

describe('veneerFontMiddleware', () => {
  function call(method: string, url: string) {
    const res = { writeHead: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    veneerFontMiddleware()({ method, url } as never, res as never, next);
    return { res, next };
  }

  it('serves a forged font as cacheable font/ttf', () => {
    const cipher = prepare();
    const { res, next } = call('GET', `/base/${cipher.urls[0]}?v=1`);
    expect(next).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'font/ttf',
        'Cache-Control': 'public, max-age=31536000, immutable',
      }),
    );
    expect(res.end).toHaveBeenCalledWith(getVeneerFont(cipher.urls[0]));
  });

  it('answers HEAD without a body', () => {
    const cipher = prepare();
    const { res } = call('HEAD', `/${cipher.urls[0]}`);
    expect(res.end).toHaveBeenCalledWith(undefined);
  });

  it('passes on everything else', () => {
    const cipher = prepare();
    expect(call('GET', '/veneer/' + '0'.repeat(32) + '.ttf').next).toHaveBeenCalled();
    expect(call('POST', `/${cipher.urls[0]}`).next).toHaveBeenCalled();
    expect(call('GET', '/index.html').next).toHaveBeenCalled();
  });
});
