import { dirname, join } from 'node:path';
import {
  ApplicationInitStatus,
  Component,
  PLATFORM_ID,
  REQUEST,
  REQUEST_CONTEXT,
  TransferState,
  makeStateKey,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VeneerDirective, VeneerFontService, provideVeneer } from '@pacyfist/veneer';
import { VeneerShouldProtect, provideVeneerServer } from './provide-veneer-server';

const FIXTURE = join(__dirname, '../../testing/Roboto-Regular.ttf');
const FONT_DIR = dirname(FIXTURE);
const TEXT = 'Hello, crawler';

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

@Component({ template: `<p veneer>${TEXT}</p>`, imports: [VeneerDirective] })
class Page {}

/**
 * One server render with a `shouldProtect` hook: the request and context
 * Angular's server engine would provide (none when prerendering), the app
 * initializers awaited as the engine awaits them, then the instance created.
 */
async function render(
  shouldProtect: VeneerShouldProtect,
  request: Request | null = new Request('https://example.com/article'),
  context: unknown = undefined,
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'server' },
      ...(request
        ? [
            { provide: REQUEST, useValue: request },
            { provide: REQUEST_CONTEXT, useValue: context },
          ]
        : []),
      provideVeneerServer({ fonts: FONT_DIR, shouldProtect }),
      provideVeneer({ font: 'Roboto-Regular.ttf' }),
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const service = TestBed.inject(VeneerFontService);
  const transfer = TestBed.inject(TransferState).get(makeStateKey<unknown>('veneer'), null);
  return { service, transfer };
}

function expectProtected({ service, transfer }: Awaited<ReturnType<typeof render>>) {
  expect(service.active()).toBe(true);
  expect(service.status()).toBe('loading');
  expect(service.scramble(TEXT)).not.toBe(TEXT);
  expect(transfer).toEqual({ family: service.familyName, fonts: [expect.any(String)] });
}

function expectUnprotected({ service, transfer }: Awaited<ReturnType<typeof render>>) {
  expect(service.active()).toBe(false);
  expect(service.status()).toBe('disabled');
  expect(service.failed()).toBeNull();
  expect(service.hidden()).toBe(false);
  expect(service.scramble(TEXT)).toBe(TEXT);
  // No font URL and no family: only the note that tells the client to stay off.
  expect(transfer).toEqual({ protect: false });
}

describe('provideVeneerServer({ shouldProtect })', () => {
  it('protects the render when the hook returns true', async () => {
    expectProtected(await render(() => true));
  });

  it('renders readable text, with no font, when the hook returns false', async () => {
    expectUnprotected(await render(() => false));
  });

  it('waits for an asynchronous hook', async () => {
    expectUnprotected(await render(() => new Promise((r) => setTimeout(() => r(false), 5))));
    TestBed.resetTestingModule();
    expectProtected(await render(async () => true));
  });

  it('turns protection off only for an explicit false', async () => {
    for (const value of [undefined, null, 0, '']) {
      TestBed.resetTestingModule();
      expectProtected(await render(() => value as unknown as boolean));
    }
  });

  it('protects the page when the hook throws or rejects, and logs VNR017 once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = () => {
      throw new Error('dns down (sync)');
    };
    expectProtected(await render(hook));
    TestBed.resetTestingModule();
    expectProtected(await render(hook));
    TestBed.resetTestingModule();
    expectProtected(await render(() => Promise.reject(new Error('dns down (async)'))));

    const logged = error.mock.calls.filter(([message]) => String(message).includes('VNR017'));
    expect(logged).toHaveLength(2);
    expect(logged[0][1]).toEqual(new Error('dns down (sync)'));
  });

  it('passes the request and the server.ts context to the hook', async () => {
    const hook = vi.fn<VeneerShouldProtect>(() => true);
    const request = new Request('https://example.com/a', { headers: { 'user-agent': 'x' } });
    await render(hook, request, { crawler: null });
    expect(hook).toHaveBeenCalledExactlyOnceWith(request, { crawler: null });
  });

  it('is not called, and the page is protected, without a request (prerendering)', async () => {
    const hook = vi.fn<VeneerShouldProtect>(() => false);
    expectProtected(await render(hook, null));
    expect(hook).not.toHaveBeenCalled();
  });

  it('decides per application, so one request does not leak into the next', async () => {
    expectUnprotected(await render(() => false));
    TestBed.resetTestingModule();
    expectProtected(await render(() => true));
  });

  it('server-renders the element readable, without the scrambled-text marker', async () => {
    await render(() => false);
    const fixture = TestBed.createComponent(Page);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('p') as HTMLElement;
    expect(el.textContent).toBe(TEXT);
    expect(el.hasAttribute('data-veneer-ssr')).toBe(false);
    expect(el.hasAttribute('data-veneer-hidden')).toBe(false);
    expect(el.style.fontFamily).not.toContain('Veneer-');
  });

  it('server-renders the element scrambled when the hook returns true', async () => {
    await render(() => true);
    const fixture = TestBed.createComponent(Page);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('p') as HTMLElement;
    expect(el.textContent).not.toBe(TEXT);
    expect(el.hasAttribute('data-veneer-ssr')).toBe(true);
  });
});
