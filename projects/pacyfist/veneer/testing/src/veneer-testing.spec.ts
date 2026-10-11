import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  VeneerFontDirective,
  VeneerFontService,
  VeneerPipe,
  ɵVENEER_CONFIG as VENEER_CONFIG,
} from '@pacyfist/veneer';
import { buildScrambleMap, scrambleText } from '@pacyfist/veneer/core';
import {
  VeneerTestingFontService,
  VeneerTestingOptions,
  decodeVeneer,
  provideVeneerTesting,
} from '@pacyfist/veneer/testing';

@Component({
  template: '<h1 veneerFont>{{ title() | veneer }}</h1>',
  imports: [VeneerFontDirective, VeneerPipe],
})
class PipeHost {
  readonly title = signal('Hello, world');
}

function setup(options?: VeneerTestingOptions) {
  TestBed.configureTestingModule({ providers: [provideVeneerTesting(options)] });
  const fixture = TestBed.createComponent(PipeHost);
  fixture.detectChanges();
  return {
    fixture,
    el: fixture.nativeElement.querySelector('h1') as HTMLElement,
    service: TestBed.inject(VeneerTestingFontService),
  };
}

describe('provideVeneerTesting', () => {
  it('registers the stand-in under the VeneerFontService token', () => {
    TestBed.configureTestingModule({ providers: [provideVeneerTesting()] });
    expect(TestBed.inject(VeneerFontService)).toBe(TestBed.inject(VeneerTestingFontService));
  });

  it('builds the cipher from the seed', () => {
    const { service } = setup({ seed: 7 });
    expect(service.status()).toBe('active');
    expect([...service.map().forward]).toEqual([...buildScrambleMap(7).forward]);
    expect(service.familyName).toBe(`Veneer-${(7).toString(36)}`);
  });

  it('is deterministic without a seed', () => {
    const a = setup().service.map();
    TestBed.resetTestingModule();
    const b = setup().service.map();
    expect([...a.forward]).toEqual([...b.forward]);
  });

  it('scrambles through the pipe and points the element at the font when ready', () => {
    const { el, service } = setup({ seed: 7 });
    expect(service.ready()).toBe(true);
    expect(el.textContent).toBe(scrambleText('Hello, world', service.map()));
    expect(el.style.fontFamily).toContain(service.familyName);
    expect(el.style.visibility).toBe('');
  });

  it('hides the text while loading', () => {
    const { fixture, el, service } = setup({ state: 'loading' });
    expect(service.hidden()).toBe(true);
    expect(el.style.visibility).toBe('hidden');

    service.setState('ready');
    fixture.detectChanges();
    expect(el.style.visibility).toBe('');
  });

  it('fails open in the failed state', () => {
    const { el, service } = setup({ state: 'failed', fallbackFontFamily: 'serif' });
    expect(service.failed()?.message).toMatch(/forced/);
    expect(service.failed()?.code).toBe('VNR010');
    expect(service.status()).toBe('failed');
    expect(service.active()).toBe(false);
    expect(el.textContent).toBe('Hello, world');
    expect(el.style.fontFamily).toBe('serif');
  });

  it('leaves text alone when disabled, and says so in the internal config', () => {
    const { el, service } = setup({ state: 'disabled' });
    expect(service.ready()).toBe(true);
    expect(service.failed()).toBeNull();
    expect(el.textContent).toBe('Hello, world');
    expect(TestBed.inject(VENEER_CONFIG).disabled).toBe(true);
  });

  it('simulates an initial map that is not known yet', () => {
    const { service } = setup({ seed: 7 });
    expect(service.initialMap()).toBe(service.map());

    service.setInitialMap(null);
    expect(service.initialMap()).toBeNull();

    const other = buildScrambleMap(8);
    service.setInitialMap(other);
    expect(service.initialMap()).toBe(other);
    expect(service.map()).not.toBe(other);
  });

  it('withholds the font while revealed', () => {
    const { fixture, el, service } = setup();
    service.revealed.set(true);
    fixture.detectChanges();
    expect(el.style.fontFamily).toBe('sans-serif');
  });
});

describe('decodeVeneer', () => {
  it('decodes an element with the current stand-in cipher', () => {
    const { el } = setup({ seed: 99 });
    expect(decodeVeneer(el)).toBe('Hello, world');
  });

  it('decodes a string', () => {
    const { service } = setup({ seed: 99 });
    expect(decodeVeneer(scrambleText('abc XYZ', service.map()))).toBe('abc XYZ');
  });

  it('returns readable text untouched while the stand-in is failed', () => {
    const { fixture, el, service } = setup();
    service.setState('failed');
    fixture.detectChanges();
    expect(decodeVeneer(el)).toBe('Hello, world');
  });

  it('uses an explicit map when given one', () => {
    setup({ seed: 1 });
    const other = buildScrambleMap(2);
    expect(decodeVeneer(scrambleText('Hello', other), other)).toBe('Hello');
  });
});
