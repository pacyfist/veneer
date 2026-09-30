import { Directive, ElementRef, OnInit, Renderer2, effect, inject } from '@angular/core';
import { VeneerFontService } from './veneer-font.service';

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
export class VeneerFontDirective implements OnInit {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly service = inject(VeneerFontService);

  constructor() {
    effect(() => {
      this.service.fontStack();
      this.service.hidden();
      this.apply();
    });
  }

  ngOnInit(): void {
    this.apply();
  }

  private apply(): void {
    const el = this.element.nativeElement;
    this.renderer.setStyle(el, 'font-family', this.service.fontStack());

    if (this.service.hidden()) {
      this.renderer.setStyle(el, 'visibility', 'hidden');
    } else {
      this.renderer.removeStyle(el, 'visibility');
    }
  }
}
