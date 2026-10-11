import { Component, Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScrambleMap, scrambleText } from '@pacyfist/veneer/core';
import {
  VeneerTestingFontService,
  VeneerTestingOptions,
  provideVeneerTesting,
} from '@pacyfist/veneer/testing';
import { VeneerDirective } from './veneer.directive';
import { VeneerFontDirective } from './veneer-font.directive';
import { VeneerPipe } from './veneer.pipe';

const SEED = 31;

@Component({ template: '<p veneer>{{ text() }}</p>', imports: [VeneerDirective] })
class InterpolatedHost {
  readonly text = signal('Readable words');
}

@Component({
  template: '<p veneer>Always @if (show()) {<b>later</b>}</p>',
  imports: [VeneerDirective],
})
class LateContentHost {
  readonly show = signal(false);
}

@Component({
  template: '<p veneer>Fixed <b>text</b></p><p [veneer]="text()"></p>',
  imports: [VeneerDirective],
})
class CorrectHost {
  readonly text = signal('Bound words');
}

@Component({ template: '<p veneer></p>', imports: [VeneerDirective] })
class EmptyHost {}

@Component({ template: '<h1>{{ title() | veneer }}</h1>', imports: [VeneerPipe] })
class BarePipeHost {
  readonly title = signal('Pipe output here');
}

@Component({
  template: `
    <h1 veneerFont>{{ title() | veneer }}</h1>
    <p veneer>
      Before <span veneerFont>{{ title() | veneer }}</span>
    </p>
    <img alt="" [title]="title() | veneer" />
  `,
  imports: [VeneerPipe, VeneerFontDirective, VeneerDirective],
})
class ProtectedPipeHost {
  readonly title = signal('Pipe output here');
}

@Component({
  template: `
    <p veneer style="text-transform: uppercase">Shouting</p>
    <h2 veneerFont style="font-variant: small-caps">{{ 'Small' | veneer }}</h2>
  `,
  imports: [VeneerDirective, VeneerFontDirective, VeneerPipe],
})
class CaseHost {}

@Component({
  template: '<p veneer>Calm <span style="text-transform: capitalize">words</span></p>',
  imports: [VeneerDirective],
})
class NestedCaseHost {}

@Component({
  template: '<p veneer style="text-transform: none">Calm</p>',
  imports: [VeneerDirective],
})
class NoCaseHost {}

let warn: { mock: { calls: unknown[][] } };
const codes = () => warn.mock.calls.map((call: unknown[]) => String(call[0]).match(/VNR\d+/)?.[0]);

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

async function render<T>(host: Type<T>, options: VeneerTestingOptions = {}) {
  TestBed.configureTestingModule({ providers: [provideVeneerTesting({ seed: SEED, ...options })] });
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

describe('VNR001: text written into a veneer element by someone else', () => {
  it('warns once for an interpolation inside the element', async () => {
    const fixture = await render(InterpolatedHost);
    expect(codes()).toEqual(['VNR001']);
    expect(String(warn.mock.calls[0][0])).toContain('#vnr001');

    fixture.componentInstance.text.set('Other words');
    fixture.detectChanges();
    expect(codes()).toEqual(['VNR001']);
  });

  it('warns for text added inside the element after the first render', async () => {
    const fixture = await render(LateContentHost);
    expect(codes()).toEqual([]);

    fixture.componentInstance.show.set(true);
    fixture.detectChanges();
    expect(codes()).toEqual(['VNR001']);
  });

  it('adopts interpolated text, and scrambles a change the next time protection changes', async () => {
    const fixture = await render(InterpolatedHost, { state: 'loading' });
    const el = fixture.nativeElement.querySelector('p') as HTMLElement;
    const map = buildScrambleMap(SEED);
    expect(el.textContent).toBe(scrambleText('Readable words', map));

    fixture.componentInstance.text.set('Other words');
    fixture.detectChanges();
    expect(el.textContent).toBe('Other words');

    TestBed.inject(VeneerTestingFontService).setState('ready');
    fixture.detectChanges();
    expect(el.textContent).toBe(scrambleText('Other words', map));
  });

  it('stays quiet for element content and bound strings', async () => {
    const fixture = await render(CorrectHost);
    fixture.componentInstance.text.set('Changed');
    fixture.detectChanges();
    expect(codes()).toEqual([]);
  });

  it('stays quiet while hydrating text that waits for the initial map', async () => {
    TestBed.configureTestingModule({ providers: [provideVeneerTesting({ seed: SEED })] });
    const service = TestBed.inject(VeneerTestingFontService);
    service.setInitialMap(null);
    const fixture = TestBed.createComponent(EmptyHost);
    const el = fixture.nativeElement.querySelector('p') as HTMLElement;
    el.textContent = 'ciphertext from the server';
    el.setAttribute('data-veneer-ssr', '');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(codes()).toEqual([]);
  });
});

describe('VNR002: pipe output outside veneerFont', () => {
  it('warns when the output is rendered in an unprotected element', async () => {
    await render(BarePipeHost);
    expect(codes()).toEqual(['VNR002']);
    expect(String(warn.mock.calls[0][0])).toContain('#vnr002');
  });

  it('stays quiet inside veneerFont or veneer, and for attribute bindings', async () => {
    await render(ProtectedPipeHost);
    expect(codes()).toEqual([]);
  });

  it('stays quiet when protection is off', async () => {
    await render(BarePipeHost, { state: 'failed' });
    expect(codes()).toEqual([]);
  });
});

describe('VNR020: CSS that changes letter case on protected text', () => {
  it('warns for text-transform on a veneer element and small caps on a veneerFont element', async () => {
    await render(CaseHost);
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(codes()).toEqual(['VNR020', 'VNR020']);
    expect(messages[0]).toContain('text-transform: uppercase');
    expect(messages[1]).toContain('font-variant-caps: small-caps');
  });

  it('checks elements inside a veneer element that hold protected text', async () => {
    await render(NestedCaseHost);
    expect(codes()).toEqual(['VNR020']);
    expect(String(warn.mock.calls[0][0])).toContain('text-transform: capitalize');
  });

  it('stays quiet for text-transform: none and when protection is off', async () => {
    await render(NoCaseHost);
    TestBed.resetTestingModule();
    await render(CaseHost, { state: 'disabled' });
    expect(codes()).toEqual([]);
  });
});
