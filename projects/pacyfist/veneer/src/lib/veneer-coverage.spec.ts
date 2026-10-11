import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHARSET, scrambleText } from '@pacyfist/veneer/core';
import { parseBaseFont } from '@pacyfist/veneer/forge';
import { VeneerDirective } from './veneer.directive';
import { VeneerFontService } from './veneer-font.service';
import { VeneerConfig, provideVeneer } from './veneer.config';

/**
 * Coverage handling with a real base font and a stand-in FontFace (jsdom has
 * none), so loading runs to the end: parse, narrow, forge, register.
 */

const ROBOTO = (() => {
  const bytes = readFileSync(join(__dirname, '../../testing/Roboto-Regular.ttf'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
})();

/** ƀ and ƃ: Latin Extended-B letters Roboto has no glyph for (two, so they form a class). */
const UNCOVERED = [0x180, 0x183];
const CHARSET = [...DEFAULT_CHARSET, ...UNCOVERED];
const TEXT = 'Hello ƀƃ world';

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
  // Tear the services down while their `document.fonts` stand-in still exists.
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as { fonts?: unknown }).fonts;
});

@Component({ template: '<p veneer></p>', imports: [VeneerDirective] })
class Host {}

/** Render a `veneer` element whose DOM looks server-rendered with the initial map. */
async function hydrate(config: Partial<VeneerConfig>) {
  TestBed.configureTestingModule({
    providers: [provideVeneer({ font: ROBOTO, seed: 7, charset: CHARSET, ...config })],
  });
  const service = TestBed.inject(VeneerFontService);
  const fixture = TestBed.createComponent(Host);
  const el = fixture.nativeElement.querySelector('p') as HTMLElement;
  el.textContent = scrambleText(TEXT, service.initialMap()!);
  el.setAttribute('data-veneer-ssr', '');
  fixture.detectChanges();
  return { fixture, service, el };
}

describe('strictCoverage: false (default)', () => {
  it('drops uncovered characters, rebuilds the map from the seed and re-scrambles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fixture, service, el } = await hydrate({});

    // Hydration inverted the server's ciphertext with the initial map.
    expect(service.map()).toBe(service.initialMap()!);
    expect(el.textContent).toBe(scrambleText(TEXT, service.initialMap()!));

    await vi.waitFor(() => expect(service.status()).toBe('active'));
    fixture.detectChanges();

    const map = service.map();
    expect(map).not.toBe(service.initialMap()!);
    expect(map.seed).toBe(7);
    for (const cp of UNCOVERED) {
      expect(service.initialMap()!.forward.has(cp)).toBe(true);
      expect(map.forward.has(cp)).toBe(false);
    }
    expect(el.textContent).toBe(scrambleText(TEXT, map));
    expect(el.textContent).toContain('ƀƃ');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/VNR014.*2 charset character\(s\): ƀƃ/);
  });

  it('forges the font for the narrowed map', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = await hydrate({});
    await vi.waitFor(() => expect(service.status()).toBe('active'));

    const [face] = registered;
    expect(face.family).toBe(service.familyName);
    const base = await parseBaseFont(ROBOTO);
    const forged = await parseBaseFont(face.source);
    for (const [readable, scrambled] of service.map().forward) {
      expect(forged.glyphId(scrambled)).toBe(base.glyphId(readable));
    }
  });

  it('warns about the same dropped characters once per page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Ɓ and Ɔ: a dropped set no other test uses, since warnings are per page.
    const charset = [...DEFAULT_CHARSET, 0x181, 0x186];
    const first = await hydrate({ seed: 8, charset });
    await vi.waitFor(() => expect(first.service.status()).toBe('active'));
    TestBed.resetTestingModule();
    const second = await hydrate({ seed: 9, charset });
    await vi.waitFor(() => expect(second.service.status()).toBe('active'));

    const warnings = warn.mock.calls.filter(([m]) => String(m).includes('VNR014'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toContain('ƁƆ');
  });

  it('keeps the initial map when the font covers everything', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = await hydrate({ charset: DEFAULT_CHARSET });
    await vi.waitFor(() => expect(service.status()).toBe('active'));
    expect(service.map()).toBe(service.initialMap()!);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('strictCoverage: true', () => {
  it('fails open on any missing glyph, listing them', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fixture, service, el } = await hydrate({ strictCoverage: true });

    await vi.waitFor(() => expect(service.status()).toBe('failed'));
    fixture.detectChanges();

    expect(service.failed()?.code).toBe('VNR012');
    expect(service.failed()?.missing).toEqual(['ƀ', 'ƃ']);
    expect(service.map()).toBe(service.initialMap()!);
    expect(el.textContent).toBe(TEXT);
    expect(registered).toHaveLength(0);
  });
});
