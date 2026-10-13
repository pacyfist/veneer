import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EnvironmentInjector, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { getVeneerFont, setMaxFonts, veneerFontMiddleware } from './font-store';

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

describe('provideVeneerServer({ secret })', () => {
  const SECRET = 'a test secret of more than sixteen bytes';

  /** Like a fresh process: a new provider instance with its own cache. */
  function fresh(
    config: Partial<ResolvedVeneerConfig> = {},
    options: Partial<VeneerServerOptions> = {},
  ) {
    TestBed.resetTestingModule();
    return prepare(config, { secret: SECRET, ...options });
  }

  it('derives the same map, family and font URLs in every instance', () => {
    const first = fresh();
    const second = fresh();
    expect(second).not.toBe(first);
    expect(second.familyName).toBe(first.familyName);
    expect(second.urls).toEqual(first.urls);
    expect([...second.map.forward]).toEqual([...first.map.forward]);
    expect(second.map.seed).toBeUndefined();
    expect(first.familyName).toMatch(/^Veneer-[0-9a-f]{16}$/);
    expect(first.urls[0]).toMatch(/^veneer\/[0-9a-f]{32}\.ttf$/);
  });

  it('pins the derivation, so a restart on the next release keeps the family and the map', () => {
    // Changing these values breaks every page rendered before an upgrade: bump
    // DERIVATION in provide-veneer-server.ts instead, on purpose.
    const cipher = fresh();
    expect(cipher.familyName).toBe('Veneer-3539a717a3764839');
    expect(
      String.fromCodePoint(
        ...[...'Hello'].map((ch) => cipher.map.forward.get(ch.codePointAt(0)!)!),
      ),
    ).toBe('RSmmU');
  });

  it('forges byte-identical fonts that read back to the derived map', async () => {
    const first = fresh({ faces: [{ src: FONT_URL, weight: 700 }] });
    const bytes = first.urls.map((url) => Buffer.from(getVeneerFont(url)!));
    const second = fresh({ faces: [{ src: FONT_URL, weight: 700 }] });
    expect(second.urls).toEqual(first.urls);
    expect(second.urls.map((url) => Buffer.from(getVeneerFont(url)!))).toEqual(bytes);
    expect(new Map([...(await readBack(second))].sort())).toEqual(
      new Map([...second.map.forward].sort()),
    );
  });

  it('derives a different cipher for another secret, charset or base font', () => {
    const base = fresh();
    const other = fresh({}, { secret: 'another secret, also long enough' });
    const charset = fresh({ charset: [...DEFAULT_CHARSET].slice(10) });
    const bytes = readFileSync(FIXTURE);
    const changed = fresh({}, { fonts: () => Buffer.concat([bytes, Buffer.alloc(4)]) });
    for (const cipher of [other, charset, changed]) {
      expect(cipher.familyName).not.toBe(base.familyName);
      expect(cipher.urls[0]).not.toBe(base.urls[0]);
    }
    expect([...other.map.forward]).not.toEqual([...base.map.forward]);
  });

  it('counts byte sources by content, not by object', () => {
    const bytes = readFileSync(FIXTURE);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideVeneerServer({ fonts: FONT_DIR, secret: SECRET })],
    });
    const forge = TestBed.inject(EnvironmentInjector).get(VENEER_SERVER_FORGE);
    const config = (font: ArrayBuffer) =>
      ({
        font,
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
      }) as ResolvedVeneerConfig;
    const copy = () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const first = forge.prepare(config(copy()));
    expect(forge.prepare(config(copy()))).toBe(first);
    // The same font by URL or by bytes is the same font.
    expect(fresh().urls).toEqual(first.urls);
  });

  it('treats an empty secret as none, and refuses a short one', () => {
    const a = fresh({}, { secret: '' });
    const b = fresh({}, { secret: '' });
    expect(b.familyName).not.toBe(a.familyName);
    TestBed.resetTestingModule();
    expect(() => provideVeneerServer({ fonts: FONT_DIR, secret: 'short' })).toThrow(
      /at least 16 bytes, got 5/,
    );
    expect(fresh({}, { secret: new Uint8Array(32).fill(7) }).urls).toHaveLength(1);
  });

  it('writes each font to emitDir once, atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'veneer-emit-'));
    try {
      const first = fresh({}, { emitDir: dir });
      const file = join(dir, first.urls[0]);
      const written = statSync(file).mtimeMs;
      fresh({}, { emitDir: dir });
      expect(statSync(file).mtimeMs).toBe(written);
      expect(readdirSync(join(dir, 'veneer'))).toEqual([first.urls[0].split('/').pop()]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the font cap', () => {
  let previous: number;
  beforeEach(() => {
    // Two configurations of two faces each fill it.
    previous = setMaxFonts(4);
  });
  afterEach(() => {
    setMaxFonts(previous);
  });

  /** One provider instance; `charset(n)` is a distinct configuration per n. */
  function instance(options: Partial<VeneerServerOptions> = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideVeneerServer({ fonts: FONT_DIR, ...options })],
    });
    const forge = TestBed.inject(EnvironmentInjector).get(VENEER_SERVER_FORGE);
    return (n: number) =>
      forge.prepare({
        font: FONT_URL,
        fallbackFontFamily: 'sans-serif',
        charset: [...DEFAULT_CHARSET].slice(n),
        hideUntilReady: true,
        hideWith: 'stylesheet',
        disabled: false,
        strictCoverage: false,
        faces: [{ src: FONT_URL, weight: 700 }],
        statusListeners: [],
        statusAttribute: false,
        a11y: 'none',
        readableCopy: null,
      });
  }
  const served = (cipher: VeneerServerCipher) =>
    cipher.urls.every((url) => getVeneerFont(url) !== undefined);

  it('evicts the least recently used cipher together with its fonts, counted per face', () => {
    const prepare = instance();
    const one = prepare(1);
    const two = prepare(2);
    expect(prepare(1)).toBe(one); // used again: now the most recent
    const three = prepare(3); // 6 fonts > 4: the least recent cipher goes, both faces

    expect(served(one)).toBe(true);
    expect(served(three)).toBe(true);
    expect(two.urls.map((url) => getVeneerFont(url))).toEqual([undefined, undefined]);

    // Every cipher still cached hands out fonts that are still served.
    expect(prepare(1)).toBe(one);
    expect(prepare(3)).toBe(three);
    // The evicted one is forged again when needed, with fonts that are served.
    const again = prepare(2);
    expect(again).not.toBe(two);
    expect(served(again)).toBe(true);
    expect(again.urls).not.toEqual(two.urls); // no secret: a new random cipher
  });

  it('with a secret, rebuilds an evicted cipher at the same URLs', () => {
    const prepare = instance({ secret: 'a test secret of more than sixteen bytes' });
    const one = prepare(1);
    prepare(2);
    prepare(3);
    expect(served(one)).toBe(false);
    const again = prepare(1);
    expect(again).not.toBe(one);
    expect(again.urls).toEqual(one.urls);
    expect(again.familyName).toBe(one.familyName);
    expect(served(again)).toBe(true);
  });

  it('keeps a font another instance still holds under the same id', () => {
    const secret = 'a test secret of more than sixteen bytes';
    const first = instance({ secret });
    const one = first(1);
    const second = instance({ secret });
    expect(second(1).urls).toEqual(one.urls);
    second(2);
    second(1); // the second instance's copy is now the most recent
    // Over the cap: the first instance's cipher goes, then config 2. The
    // second instance still holds config 1's fonts under the same ids.
    second(3);
    expect(served(one)).toBe(true);
    const again = first(1);
    expect(again).not.toBe(one);
    expect(again.urls).toEqual(one.urls);
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

  it('with dir, serves a font this process never built from the shared folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veneer-shared-'));
    try {
      const id = 'ab'.repeat(16);
      const bytes = Buffer.from('a font another instance forged');
      mkdirSync(join(dir, 'fonts/v'), { recursive: true });
      writeFileSync(join(dir, `fonts/v/${id}.ttf`), bytes);
      const url = `/app/fonts/v/${id}.ttf`;

      expect(getVeneerFont(url)).toBeUndefined();
      expect(Buffer.from(getVeneerFont(url, { dir, path: 'fonts/v/' })!)).toEqual(bytes);

      const res = { writeHead: vi.fn(), end: vi.fn() };
      const sent = new Promise((done) => res.end.mockImplementation(done));
      const next = vi.fn();
      veneerFontMiddleware({ dir, path: 'fonts/v' })(
        { method: 'GET', url } as never,
        res as never,
        next,
      );
      expect(Buffer.from((await sent) as Uint8Array)).toEqual(bytes);
      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'font/ttf' }),
      );
      expect(next).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with dir, passes on fonts the folder lacks and never leaves it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veneer-shared-'));
    try {
      writeFileSync(join(dir, 'secret.ttf'), 'not a font');
      for (const url of [
        `/veneer/${'cd'.repeat(16)}.ttf`,
        '/veneer/../secret.ttf',
        `/veneer/..%2F${'cd'.repeat(16)}.ttf`,
        `/veneer/${'CD'.repeat(16)}.ttf`,
      ]) {
        expect(getVeneerFont(url, { dir })).toBeUndefined();
        const next = vi.fn();
        const passed = new Promise((done) => next.mockImplementation(done));
        const res = { writeHead: vi.fn(), end: vi.fn() };
        veneerFontMiddleware({ dir })({ method: 'GET', url } as never, res as never, next);
        await passed;
        expect(res.writeHead).not.toHaveBeenCalled();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes on everything else', () => {
    const cipher = prepare();
    expect(call('GET', '/veneer/' + '0'.repeat(32) + '.ttf').next).toHaveBeenCalled();
    expect(call('POST', `/${cipher.urls[0]}`).next).toHaveBeenCalled();
    expect(call('GET', '/index.html').next).toHaveBeenCalled();
  });
});
