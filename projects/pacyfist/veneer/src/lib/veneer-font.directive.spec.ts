import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  VeneerTestingFontService,
  VeneerTestingOptions,
  provideVeneerTesting,
} from '@pacyfist/veneer/testing';
import { VeneerFontDirective } from './veneer-font.directive';

@Component({ template: '<h1 veneerFont>Already scrambled</h1>', imports: [VeneerFontDirective] })
class Host {}

function setup(options: VeneerTestingOptions = {}) {
  TestBed.configureTestingModule({
    providers: [provideVeneerTesting({ fallbackFontFamily: 'Roboto, serif', ...options })],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return {
    fixture,
    el: fixture.nativeElement.querySelector('h1') as HTMLElement,
    service: TestBed.inject(VeneerTestingFontService),
  };
}

describe('VeneerFontDirective', () => {
  it('points the element at the forged font, then the fallback', () => {
    const { el, service } = setup();
    expect(el.style.fontFamily).toBe(`"${service.familyName}", Roboto, serif`);
  });

  it('never touches the text', () => {
    const { fixture, el, service } = setup();
    service.setState('failed');
    fixture.detectChanges();
    expect(el.textContent).toBe('Already scrambled');
  });

  it('hides the element while the font loads, and shows it once ready', () => {
    const { fixture, el, service } = setup({ state: 'loading' });
    expect(el.style.visibility).toBe('hidden');

    service.setState('ready');
    fixture.detectChanges();
    expect(el.style.visibility).toBe('');
  });

  it('falls back to the plain font stack and stays visible when the font fails', () => {
    const { fixture, el, service } = setup({ state: 'loading' });
    service.setState('failed');
    fixture.detectChanges();
    expect(el.style.fontFamily).toBe('Roboto, serif');
    expect(el.style.visibility).toBe('');
  });

  it('uses the plain font stack when disabled', () => {
    const { el } = setup({ state: 'disabled' });
    expect(el.style.fontFamily).toBe('Roboto, serif');
    expect(el.style.visibility).toBe('');
  });

  it('withholds the forged font while revealed', () => {
    const { fixture, el, service } = setup();
    service.revealed.set(true);
    fixture.detectChanges();
    expect(el.style.fontFamily).toBe('Roboto, serif');

    service.revealed.set(false);
    fixture.detectChanges();
    expect(el.style.fontFamily).toContain(service.familyName);
  });
});
