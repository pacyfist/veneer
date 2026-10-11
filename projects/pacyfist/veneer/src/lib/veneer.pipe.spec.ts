import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { buildScrambleMap, scrambleText } from '@pacyfist/veneer/core';
import {
  VeneerTestingFontService,
  VeneerTestingOptions,
  provideVeneerTesting,
} from '@pacyfist/veneer/testing';
import { VeneerPipe } from './veneer.pipe';

const SEED = 31;
const MAP = buildScrambleMap(SEED);

@Component({ template: '<span>{{ value() | veneer }}</span>', imports: [VeneerPipe] })
class Host {
  readonly value = signal<string | null | undefined>('Hello, world');
}

function setup(options: VeneerTestingOptions = {}) {
  TestBed.configureTestingModule({ providers: [provideVeneerTesting({ seed: SEED, ...options })] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return {
    fixture,
    span: fixture.nativeElement.querySelector('span') as HTMLElement,
    service: TestBed.inject(VeneerTestingFontService),
  };
}

describe('VeneerPipe', () => {
  it('scrambles the bound string', () => {
    const { span } = setup();
    expect(span.textContent).toBe(scrambleText('Hello, world', MAP));
  });

  it('scrambles while the font is still loading, so text never flashes readable', () => {
    const { span } = setup({ state: 'loading' });
    expect(span.textContent).toBe(scrambleText('Hello, world', MAP));
  });

  it('renders null and undefined as an empty string', () => {
    const { fixture, span } = setup();
    fixture.componentInstance.value.set(null);
    fixture.detectChanges();
    expect(span.textContent).toBe('');
    fixture.componentInstance.value.set(undefined);
    fixture.detectChanges();
    expect(span.textContent).toBe('');
  });

  it('follows changes to the bound string', () => {
    const { fixture, span } = setup();
    fixture.componentInstance.value.set('something else');
    fixture.detectChanges();
    expect(span.textContent).toBe(scrambleText('something else', MAP));
  });

  it('returns readable text the moment the font fails, although the input did not change', () => {
    const { fixture, span, service } = setup();
    service.setState('failed');
    fixture.detectChanges();
    expect(span.textContent).toBe('Hello, world');
  });

  it('leaves text alone when disabled', () => {
    const { span } = setup({ state: 'disabled' });
    expect(span.textContent).toBe('Hello, world');
  });

  it('transforms directly, through the injected service', () => {
    setup();
    const pipe = TestBed.runInInjectionContext(() => new VeneerPipe());
    expect(pipe.transform('abc')).toBe(scrambleText('abc', MAP));
    expect(pipe.transform(null)).toBe('');
  });
});
