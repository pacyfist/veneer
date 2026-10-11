import { Component, Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { buildScrambleMap, scrambleText } from '@pacyfist/veneer/core';
import {
  VeneerTestingFontService,
  VeneerTestingOptions,
  decodeVeneer,
  provideVeneerTesting,
} from '@pacyfist/veneer/testing';
import { VeneerDirective } from './veneer.directive';

// The testing entry point stands in for the real service, so directive
// behaviour is asserted without a font fetch (jsdom has no FontFace). The real
// loading path is covered by the Playwright suite in e2e/.
const SEED = 2024;
const MAP = buildScrambleMap(SEED);

// Templates must be literals for the AOT compiler, so each shape gets a host.
@Component({ template: '<p veneer>Hello, world</p>', imports: [VeneerDirective] })
class StaticHost {}

@Component({ template: '<p [veneer]="body()"></p>', imports: [VeneerDirective] })
class BoundHost {
  readonly body = signal('Hello, world');
}

// Empty so the test can plant text into the element before the directive
// initialises, which is exactly what hydration looks like.
@Component({ template: '<p veneer></p>', imports: [VeneerDirective] })
class EmptyHost {}

function configure(options: VeneerTestingOptions = {}) {
  TestBed.configureTestingModule({ providers: [provideVeneerTesting({ seed: SEED, ...options })] });
  return TestBed.inject(VeneerTestingFontService);
}

function setup<T>(host: Type<T>, options: VeneerTestingOptions = {}) {
  const service = configure(options);
  const fixture: ComponentFixture<T> = TestBed.createComponent(host);
  fixture.detectChanges();
  return { fixture, service, el: fixture.nativeElement.querySelector('p') as HTMLElement };
}

describe('VeneerDirective', () => {
  it('scrambles the text the element already contains', () => {
    const { el } = setup(StaticHost);
    expect(el.textContent).not.toContain('Hello');
    expect(el.textContent).toBe(scrambleText('Hello, world', MAP));
  });

  it('scrambles a bound string', () => {
    const { el } = setup(BoundHost);
    expect(el.textContent).toBe(scrambleText('Hello, world', MAP));
  });

  it('points the element at the generated font', () => {
    const { el, service } = setup(StaticHost);
    expect(el.style.fontFamily).toContain(service.familyName);
  });

  it('shows the reader the original words', () => {
    const { el } = setup(StaticHost);
    expect(decodeVeneer(el)).toBe('Hello, world');
  });

  it('hides the text until the font is ready, then reveals it', () => {
    const { fixture, service, el } = setup(StaticHost, { state: 'loading' });

    expect(el.style.visibility).toBe('hidden');

    service.setState('ready');
    fixture.detectChanges();
    expect(el.style.visibility).toBe('');
  });

  it('fails open — leaves readable text when the font could not be built', () => {
    const { el } = setup(StaticHost, { state: 'failed' });
    expect(el.textContent).toBe('Hello, world');
    expect(el.style.fontFamily).toBe('sans-serif');
  });

  it('does not scramble twice when hydrating server-scrambled text', () => {
    // The server left ciphertext in the DOM and marked the element. Reading
    // that text as the original would scramble it again, and the font undoes
    // only one layer — the reader would be shown the server's ciphertext.
    configure();
    const fixture = TestBed.createComponent(EmptyHost);
    const el = fixture.nativeElement.querySelector('p') as HTMLElement;

    el.textContent = scrambleText('Hello, world', MAP);
    el.setAttribute('data-veneer-ssr', '');

    fixture.detectChanges();

    expect(el.textContent).toBe(scrambleText('Hello, world', MAP));
  });

  it('restores the readable text when hydration is followed by a font failure', () => {
    const service = configure();
    const fixture = TestBed.createComponent(EmptyHost);
    const el = fixture.nativeElement.querySelector('p') as HTMLElement;

    el.textContent = scrambleText('Hello, world', MAP);
    el.setAttribute('data-veneer-ssr', '');
    fixture.detectChanges();

    // Font dies after hydration: the directive must still know the real words.
    service.setState('failed');
    fixture.detectChanges();

    expect(el.textContent).toBe('Hello, world');
  });

  it('treats unmarked text as already readable, so client rendering is untouched', () => {
    // A deferred block rendered in the browser carries readable template text
    // and no marker. Inverting it would corrupt it.
    const { el } = setup(StaticHost);
    expect(el.textContent).toBe(scrambleText('Hello, world', MAP));
    expect(el.hasAttribute('data-veneer-ssr')).toBe(false);
  });

  it('re-scrambles when the bound text changes', () => {
    const { fixture, el } = setup(BoundHost);
    expect(el.textContent).toBe(scrambleText('Hello, world', MAP));

    fixture.componentInstance.body.set('something else');
    fixture.detectChanges();
    expect(el.textContent).toBe(scrambleText('something else', MAP));
  });
});
