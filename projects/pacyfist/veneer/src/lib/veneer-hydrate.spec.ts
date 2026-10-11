import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, TransferState, makeStateKey } from '@angular/core';
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
let release: () => void;

beforeEach(() => {
  registered = [];
  served = new Map();
  vi.stubGlobal('FontFace', FakeFontFace);
  // Fonts are held back until `release()`, so a test can look at the page
  // before the server's map is known.
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      await gate;
      const bytes = served.get(new URL(url).pathname);
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
  fonts = ['veneer/a.ttf'],
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
    const { service, serverMap } = await hydrate(
      {},
      ['veneer/a.ttf', 'veneer/b.ttf'],
      [{ src: ROBOTO, weight: 700 }],
    );
    await serveForged(serverMap, 'veneer/b.ttf');
    release();
    await vi.waitFor(() => expect(service.status()).toBe('active'));
    expect(registered.map((f) => f.descriptors)).toEqual([{}, { weight: '700' }]);
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

  it('fails with VNR016 when the server sent fonts for different faces', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service } = await hydrate({}, ['veneer/a.ttf', 'veneer/a.ttf']);
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
});
