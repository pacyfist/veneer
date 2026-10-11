import {
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  afterNextRender,
  effect,
  inject,
} from '@angular/core';
import { injectVeneerState } from './veneer-inject';
import { VeneerFontState } from './veneer-font-state';
import { registerHost, unregisterHost } from './veneer-hosts';
import { warnCaseStyles } from './veneer-dev';
import { HostPresentation } from './veneer-presentation';

declare const ngDevMode: boolean | undefined;

/**
 * Points an element at the forged font without touching its text.
 *
 * Pair it with the `veneer` pipe when the text comes from a binding:
 *
 * ```html
 * <h1 veneerFont>{{ title() | veneer }}</h1>
 * ```
 *
 * The style is set on the element directly, so no stylesheet has to be copied
 * into the consuming application for the library to work.
 */
@Directive({ selector: '[veneerFont]' })
export class VeneerFontDirective implements OnInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly service: VeneerFontState = injectVeneerState('The veneerFont directive');
  private readonly presentation = new HostPresentation(this.element.nativeElement, this.service);

  constructor() {
    registerHost(this.element.nativeElement, { state: this.service, kind: 'font', copy: false });

    effect(() => {
      this.service.fontStack();
      this.service.hidden();
      this.apply();
    });

    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      afterNextRender(() => {
        if (this.service.active()) warnCaseStyles([this.element.nativeElement]);
      });
    }
  }

  ngOnInit(): void {
    this.apply();
  }

  ngOnDestroy(): void {
    unregisterHost(this.element.nativeElement);
  }

  private apply(): void {
    this.presentation.apply();
  }
}
