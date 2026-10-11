import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARSET } from '@pacyfist/veneer/core';
import { VeneerFontService } from './veneer-font.service';
import {
  VENEER_CONFIG,
  VeneerConfig,
  VeneerFeature,
  provideVeneer,
  withFaces,
  withStatusAttribute,
  withStatusListener,
} from './veneer.config';

function resolve(config: VeneerConfig, ...features: VeneerFeature[]) {
  TestBed.configureTestingModule({ providers: [provideVeneer(config, ...features)] });
  return TestBed.inject(VENEER_CONFIG);
}

describe('provideVeneer', () => {
  it('fills in every default', () => {
    expect(resolve({ font: 'fonts/A.ttf' })).toEqual({
      font: 'fonts/A.ttf',
      fallbackFontFamily: 'sans-serif',
      charset: DEFAULT_CHARSET,
      hideUntilReady: true,
      hideWith: 'stylesheet',
      disabled: false,
      strictCoverage: false,
      faces: [],
      statusListeners: [],
      statusAttribute: false,
    });
  });

  it('keeps what the config sets', () => {
    const charset = [0x61, 0x62];
    const config = resolve({
      font: 'fonts/A.ttf',
      fallbackFontFamily: 'serif',
      charset,
      seed: 9,
      hideUntilReady: false,
      disabled: true,
      strictCoverage: true,
      id: 'main',
    });
    expect(config).toMatchObject({
      fallbackFontFamily: 'serif',
      charset,
      seed: 9,
      hideUntilReady: false,
      disabled: true,
      strictCoverage: true,
      id: 'main',
    });
  });

  it('provides the font service', () => {
    TestBed.configureTestingModule({
      providers: [provideVeneer({ font: 'fonts/A.ttf', disabled: true })],
    });
    expect(TestBed.inject(VeneerFontService)).toBeInstanceOf(VeneerFontService);
  });

  it('folds features in, in order, and lets them repeat', () => {
    const first = () => undefined;
    const second = () => undefined;
    const config = resolve(
      { font: 'fonts/A.ttf' },
      withStatusListener(first),
      withFaces({ src: 'fonts/A-Bold.ttf', weight: 700 }),
      withStatusAttribute(),
      withStatusListener(second),
      withFaces({ src: 'fonts/A-Italic.ttf', style: 'italic' }),
    );
    expect(config.statusListeners).toEqual([first, second]);
    expect(config.statusAttribute).toBe(true);
    expect(config.faces).toEqual([
      { src: 'fonts/A-Bold.ttf', weight: 700 },
      { src: 'fonts/A-Italic.ttf', style: 'italic' },
    ]);
  });

  it('labels each feature with its kind', () => {
    expect(withStatusListener(() => undefined).ɵkind).toBe('statusListener');
    expect(withStatusAttribute().ɵkind).toBe('statusAttribute');
    expect(withFaces().ɵkind).toBe('faces');
  });

  it('gives every call its own resolved config', () => {
    const a = provideVeneer({ font: 'a.ttf' }, withStatusAttribute());
    TestBed.configureTestingModule({ providers: [provideVeneer({ font: 'b.ttf' }), a] });
    // The last provider wins the token; it must carry its own feature only.
    expect(TestBed.inject(VENEER_CONFIG)).toMatchObject({ font: 'a.ttf', statusAttribute: true });
  });
});
