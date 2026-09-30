import { Directive, ElementRef, OnInit, Renderer2, effect, inject } from '@angular/core';
import { NoAiFontService } from './no-ai-font.service';

/**
 * Points an element at the forged font without touching its text.
 *
 * Pair it with the `noAi` pipe when the text comes from a binding:
 *
 * ```html
 * <h1 noAiFont>{{ title() | noAi }}</h1>
 * ```
 *
 * The style is set on the element directly, so no stylesheet has to be copied
 * into the consuming application for the library to work.
 */
@Directive({ selector: '[noAiFont]' })
export class NoAiFontDirective implements OnInit {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly service = inject(NoAiFontService);

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
