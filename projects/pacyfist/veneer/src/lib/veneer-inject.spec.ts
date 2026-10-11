import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { VeneerDirective } from './veneer.directive';
import { VeneerFontDirective } from './veneer-font.directive';
import { VeneerPipe } from './veneer.pipe';

@Component({ template: '<p veneer>Hello</p>', imports: [VeneerDirective] })
class DirectiveHost {}

@Component({ template: '<p veneerFont>Hello</p>', imports: [VeneerFontDirective] })
class FontDirectiveHost {}

@Component({ template: '<p>{{ "Hello" | veneer }}</p>', imports: [VeneerPipe] })
class PipeHost {}

describe('without provideVeneer()', () => {
  for (const [name, host] of [
    ['veneer directive', DirectiveHost],
    ['veneerFont directive', FontDirectiveHost],
    ['veneer pipe', PipeHost],
  ] as const) {
    it(`the ${name} throws VNR003 with a pointer to the fix`, () => {
      const render = () => TestBed.createComponent(host).detectChanges();
      expect(render).toThrow(/\[veneer\] VNR003: .*provideVeneer\(\)/);
      expect(render).toThrow(/README\.md#vnr003/);
      expect(render).not.toThrow(/NullInjectorError/);
    });
  }
});
