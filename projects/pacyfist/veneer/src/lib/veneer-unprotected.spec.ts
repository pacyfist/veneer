import { Component, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VeneerDirective } from './veneer.directive';
import { VeneerFontService } from './veneer-font.service';
import { provideVeneer } from './veneer.config';

/**
 * Hydrating a page the server left unprotected, because the app's
 * `shouldProtect` hook (`@pacyfist/veneer/server`) returned false for its
 * request: the client keeps the readable text, fetches nothing and hides
 * nothing.
 */

const TEXT = 'Readable for a verified crawler';

@Component({ template: `<p veneer>${TEXT}</p>`, imports: [VeneerDirective] })
class Host {}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('unexpected', { status: 500 })),
  );
  vi.stubGlobal(
    'FontFace',
    vi.fn(() => {
      throw new Error('unexpected FontFace');
    }),
  );
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('hydrating a page the server left unprotected', () => {
  it('keeps the readable text, with no font, no hiding and no errors', async () => {
    const error = vi.spyOn(console, 'error');
    TestBed.configureTestingModule({
      providers: [provideVeneer({ font: 'fonts/Roboto-Regular.ttf' })],
    });
    const state = TestBed.inject(TransferState);
    const key = makeStateKey<unknown>('veneer');
    state.set(key, { protect: false });

    const service = TestBed.inject(VeneerFontService);
    const fixture = TestBed.createComponent(Host);
    const el = fixture.nativeElement.querySelector('p') as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.status()).toBe('disabled');
    expect(service.active()).toBe(false);
    expect(service.ready()).toBe(true);
    expect(service.hidden()).toBe(false);
    expect(service.scramble(TEXT)).toBe(TEXT);
    expect(el.textContent).toBe(TEXT);
    expect(el.style.visibility).toBe('');
    expect(el.style.fontFamily).not.toContain('Veneer-');
    expect(fetch).not.toHaveBeenCalled();
    expect(FontFace).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    // Taken once, like the font transfer.
    expect(state.hasKey(key)).toBe(false);
  });

  it('honours the note under its own id only', async () => {
    TestBed.configureTestingModule({
      providers: [provideVeneer({ font: 'fonts/Roboto-Regular.ttf', id: 'body' })],
    });
    TestBed.inject(TransferState).set(makeStateKey<unknown>('veneer:body'), { protect: false });
    expect(TestBed.inject(VeneerFontService).status()).toBe('disabled');
  });
});
