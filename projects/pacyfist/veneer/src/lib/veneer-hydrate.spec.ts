import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CHARSET,
  ScrambleMap,
  invertScrambleMap,
  randomScrambleMap,
  scrambleText,
} from '@pacyfist/veneer/core';
import { forgeScrambledFont, parseBaseFont } from '@pacyfist/veneer/forge';
import { VeneerDirective } from './veneer.directive';
import { VeneerFontService } from './veneer-font.service';
import { VeneerConfig, provideVeneer, withFaces } from './veneer.config';
import { FontSourceError, clearBaseFontCache, stubForgeImport } from './base-font';
import { VENEER_SERVER_FORGE, VeneerServerForge, VeneerTransferFont } from './veneer-server';

/**
 * Hydrating a server render without a key in the page: the client fetches the
 * server's forged font, reads the map out of its cmap and only then inverts
 * the server's ciphertext. FontFace and fetch are stand-ins (jsdom has
 * neither).
 */

const ROBOTO = (() => {
  const bytes = readFileSync(join(__dirname, '../../testing/Roboto-Regular.ttf'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
})();

const TEXT = 'Hello, server world 42';

class FakeFontFace {
  readonly status = 'loaded';
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors?: FontFaceDescriptors,
  ) {}
  load() {
    return Promise.resolve(this);
  }
}

let registered: FakeFontFace[];
let served: Map<string, ArrayBuffer>;
/** Paths whose next N requests fail at the network level. */
let flaky: Map<string, number>;
let release: () => void;

beforeEach(() => {
  registered = [];
  served = new Map();
  flaky = new Map();
  vi.stubGlobal('FontFace', FakeFontFace);
  // Fonts are held back until `release()`, so a test can look at the page
  // before the server's map is known.
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      await gate;
      const path = new URL(url).pathname;
      const failures = flaky.get(path) ?? 0;
      if (failures > 0) {
        flaky.set(path, failures - 1);
        throw new TypeError('Failed to fetch');
      }
      const bytes = served.get(path);
      return bytes
        ? new Response(bytes)
        : new Response('missing', { status: 404, statusText: 'Not Found' });
    }),
  );
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
  clearBaseFontCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as { fonts?: unknown }).fonts;
});

@Component({ template: '<p veneer></p>', imports: [VeneerDirective] })
class Host {}

/** What the server would have done: forge a font for `map` and serve it. */
async function serveForged(map: ScrambleMap, path: string) {
  served.set(`/${path}`, forgeScrambledFont(await parseBaseFont(ROBOTO), map, 'Veneer-x'));
}

/** Render a `veneer` element as a server-rendered page hydrates it. */
async function hydrate(
  config: Partial<VeneerConfig> = {},
  fonts: VeneerTransferFont[] = ['veneer/a.ttf'],
  ...features: Parameters<typeof withFaces>[]
) {
  const serverMap = randomScrambleMap(DEFAULT_CHARSET);
  await serveForged(serverMap, 'veneer/a.ttf');
  TestBed.configureTestingModule({
    providers: [
      provideVeneer({ font: ROBOTO, ...config }, ...features.map((f) => withFaces(...f))),
    ],
  });
  TestBed.inject(TransferState).set(makeStateKey<unknown>('veneer'), {
    family: 'Veneer-0123456789abcdef',
    fonts,
  });
  const service = TestBed.inject(VeneerFontService);
  const fixture = TestBed.createComponent(Host);
  const el = fixture.nativeElement.querySelector('p') as HTMLElement;
  const ciphertext = scrambleText(TEXT, serverMap);
  el.textContent = ciphertext;
  el.setAttribute('data-veneer-ssr', '');
  el.style.visibility = 'hidden';
  el.style.fontFamily = '"Veneer-0123456789abcdef", sans-serif';
  fixture.detectChanges();
  return { fixture, service, el, serverMap, ciphertext };
}

describe('hydrating a server render', () => {
  it('leaves the server text alone and initialMap null until the forged font arrives', async () => {
    const { fixture, service, el, ciphertext } = await hydrate();
    fixture.detectChanges();

    expect(service.initialMap()).toBeNull();
    expect(service.familyName).toBe('Veneer-0123456789abcdef');
    expect(service.status()).toBe('loading');
    expect(el.textContent).toBe(ciphertext);
    expect(el.style.visibility).toBe('hidden');
  });

  it('reads the server map from the forged font, then shows the same ciphertext', async () => {
    const { fixture, service, el, serverMap, ciphertext } = await hydrate();
    release();
    await vi.waitFor(() => expect(service.status()).toBe('active'));
    fixture.detectChanges();

    expect(new Map([...service.initialMap()!.forward].sort())).toEqual(
      new Map([...serverMap.forward].sort()),
    );
    expect(service.map()).toBe(service.initialMap());
    expect(el.textContent).toBe(ciphertext);
    expect(scrambleText(el.textContent!, invertScrambleMap(service.map()))).toBe(TEXT);
    expect(el.style.visibility).toBe('');
    expect(registered.map((f) => f.family)).toEqual(['Veneer-0123456789abcdef']);
  });

  it('fetches the forged font once, against the document base URL', async () => {
    const { service } = await hydrate();
    release();
    await vi.waitFor(() => expect(service.status()).toBe('active'));
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([new URL('veneer/a.ttf', document.baseURI).href]);
  });

  it('scrambles client-rendered text with a throwaway map, never plaintext, while waiting', async () => {
    const { service, serverMap } = await hydrate();
    const before = service.scramble(TEXT);
    expect(before).not.toBe(TEXT);
    release();
    await vi.waitFor(() => expect(service.status()).toBe('active'));
    expect(service.scramble(TEXT)).toBe(scrambleText(TEXT, serverMap));
  });

  it('registers every face the server forged, with its descriptors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service, serverMap } = await hydrate(
      {},
      ['veneer/a.ttf', { url: 'veneer/b.ttf', weight: '700' }],
      [{ src: ROBOTO, weight: 700 }],
    );
    await serveForged(serverMap, 'veneer/b.ttf');
    release();
    await vi.waitFor(() => expect(service.status()).toBe('active'));
    expect(registered.map((f) => f.descriptors)).toEqual([{}, { weight: '700' }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts a plain URL list, registering each face with default descriptors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service, serverMap } = await hydrate({}, ['veneer/a.ttf', 'veneer/b.ttf']);
    await serveForged(serverMap, 'veneer/b.ttf');
    release();
    await vi.waitFor(() => expect(service.status()).toBe('active'));
    expect(registered.map((f) => f.descriptors)).toEqual([{}, {}]);
  });

  it('fails with VNR016 when the forged font is missing, and stops hiding the text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fixture, service, el, ciphertext } = await hydrate({}, ['veneer/gone.ttf']);
    release();
    await vi.waitFor(() => expect(service.status()).toBe('failed'));
    fixture.detectChanges();

    expect(service.failed()?.code).toBe('VNR016');
    expect(service.failed()?.message).toContain('veneer/gone.ttf');
    // The map never arrived, so the text cannot be recovered; it is shown.
    expect(service.initialMap()).toBeNull();
    expect(el.textContent).toBe(ciphertext);
    expect(el.style.visibility).toBe('');
  });

  describe("registers the server's faces whatever the browser config lists", () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => (warn = vi.spyOn(console, 'warn').mockImplementation(() => {})));

    it('two server faces, one in the browser config', async () => {
      const { fixture, service, el, serverMap } = await hydrate({}, [
        'veneer/a.ttf',
        { url: 'veneer/b.ttf', weight: '700', style: 'italic' },
      ]);
      await serveForged(serverMap, 'veneer/b.ttf');
      release();
      await vi.waitFor(() => expect(service.status()).toBe('active'));
      fixture.detectChanges();

      expect(registered.map((f) => f.descriptors)).toEqual([
        {},
        { weight: '700', style: 'italic' },
      ]);
      expect(scrambleText(el.textContent!, invertScrambleMap(service.map()))).toBe(TEXT);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(
        /VNR018: the server rendered this page with 2 face\(s\) \(regular, style italic weight 700\), but the browser config lists 1 \(regular\)/,
      );
    });

    it('one server face, two in the browser config', async () => {
      const { fixture, service, el } = await hydrate(
        {},
        ['veneer/a.ttf'],
        [{ src: ROBOTO, weight: 700 }],
      );
      release();
      await vi.waitFor(() => expect(service.status()).toBe('active'));
      fixture.detectChanges();

      expect(registered.map((f) => f.descriptors)).toEqual([{}]);
      expect(scrambleText(el.textContent!, invertScrambleMap(service.map()))).toBe(TEXT);
      expect(String(warn.mock.calls[0]?.[0])).toContain('VNR018');
    });

    it('stays quiet when the configs agree', async () => {
      const { service } = await hydrate();
      release();
      await vi.waitFor(() => expect(service.status()).toBe('active'));
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('fails with VNR016 when the server sent no forged font', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service } = await hydrate({}, []);
    release();
    await vi.waitFor(() => expect(service.status()).toBe('failed'));
    expect(service.failed()?.code).toBe('VNR016');
  });

  it('still restores readable text when the browser rejects the face', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'FontFace',
      class {
        load() {
          return Promise.reject(new Error('OTS parsing error'));
        }
      },
    );
    const { fixture, service, el } = await hydrate();
    release();
    await vi.waitFor(() => expect(service.status()).toBe('failed'));
    fixture.detectChanges();

    expect(service.failed()?.code).toBe('VNR013');
    expect(el.textContent).toBe(TEXT);
  });

  describe('any failure before the server map is known is VNR016', () => {
    /** Hydrate with the base font fetched from a URL rather than handed over as bytes. */
    async function hydrateFromUrl() {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const page = await hydrate({ font: 'fonts/base.ttf' });
      release();
      await vi.waitFor(() => expect(page.service.status()).toBe('failed'));
      page.fixture.detectChanges();
      return page;
    }

    it('when the base font cannot be fetched, keeping VNR010 as the cause', async () => {
      const { service, el, ciphertext } = await hydrateFromUrl();
      const failure = service.failed()!;
      expect(failure.code).toBe('VNR016');
      expect(failure.message).toMatch(
        /^\[veneer\] VNR016: .*unreadable \(VNR010: .*fonts\/base\.ttf/,
      );
      expect(failure.cause).toBeInstanceOf(FontSourceError);
      expect(el.textContent).toBe(ciphertext);
      expect(el.style.visibility).toBe('');
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('disabled (VNR016)'),
        failure.cause,
      );
    });

    it('when the base font is not a font (VNR011)', async () => {
      served.set('/fonts/base.ttf', new Uint8Array([1, 2, 3, 4]).buffer);
      const { service } = await hydrateFromUrl();
      expect(service.failed()?.code).toBe('VNR016');
      expect(service.failed()?.message).toContain('(VNR011');
    });

    it('when the forge chunk cannot be loaded (not retried: browsers cache the failure)', async () => {
      served.set('/fonts/base.ttf', ROBOTO);
      const load = vi.fn(() => Promise.reject(new Error('chunk 404')));
      const restore = stubForgeImport(load);
      try {
        const { service } = await hydrateFromUrl();
        expect(service.failed()?.code).toBe('VNR016');
        expect(service.failed()?.message).toContain('could not load the font forge (chunk 404)');
        expect(load).toHaveBeenCalledTimes(1);
      } finally {
        restore();
      }
    });
  });

  describe('retries a transient failure once', () => {
    it('for the forged font', async () => {
      flaky.set('/veneer/a.ttf', 1);
      const { service } = await hydrate();
      release();
      await vi.waitFor(() => expect(service.status()).toBe('active'));
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });

    it('for the base font, and for a server error', async () => {
      served.set('/fonts/base.ttf', ROBOTO);
      flaky.set('/fonts/base.ttf', 1);
      const { service } = await hydrate({ font: 'fonts/base.ttf' });
      release();
      await vi.waitFor(() => expect(service.status()).toBe('active'));
      const paths = vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).pathname);
      expect(paths.filter((p) => p === '/fonts/base.ttf')).toHaveLength(2);
    });

    it('but not a 404, which will not change', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { service } = await hydrate({}, ['veneer/gone.ttf']);
      release();
      await vi.waitFor(() => expect(service.status()).toBe('failed'));
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });
  });
});

describe('on the server', () => {
  it('sends each forged face with its descriptors, the regular face as a bare URL', () => {
    const forge: VeneerServerForge = {
      protects: () => true,
      prepare: (config) => ({
        map: randomScrambleMap(DEFAULT_CHARSET),
        familyName: 'Veneer-test',
        urls: [config.font, ...config.faces.map((f) => f.src)].map((_, i) => `veneer/${i}.ttf`),
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: VENEER_SERVER_FORGE, useValue: forge },
        provideVeneer(
          { font: new ArrayBuffer(0) },
          withFaces(
            { src: new ArrayBuffer(0), weight: 700 },
            { src: new ArrayBuffer(0), style: 'italic', stretch: 'condensed' },
            { src: new ArrayBuffer(0) },
          ),
        ),
      ],
    });
    TestBed.inject(VeneerFontService);

    expect(TestBed.inject(TransferState).get(makeStateKey<unknown>('veneer'), null)).toEqual({
      family: 'Veneer-test',
      fonts: [
        'veneer/0.ttf',
        { url: 'veneer/1.ttf', weight: '700' },
        { url: 'veneer/2.ttf', style: 'italic', stretch: 'condensed' },
        'veneer/3.ttf',
      ],
    });
  });
});
