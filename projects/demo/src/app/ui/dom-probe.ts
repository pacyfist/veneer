import { DestroyRef, Directive, ElementRef, afterNextRender, inject, signal } from '@angular/core';

/**
 * Reads an element's live DOM state, so a readout next to a specimen shows
 * what the browser holds rather than what the demo expects it to hold.
 *
 * Browser only: both signals stay null through prerender and hydration, until
 * the first read after render.
 */
@Directive({ selector: '[appDomProbe]', exportAs: 'domProbe' })
export class DomProbe {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Whether the element is hidden from assistive technology (`aria-hidden="true"`). */
  readonly ariaHidden = signal<boolean | null>(null);
  /** The element's `textContent`. */
  readonly text = signal<string | null>(null);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const read = () => {
        this.ariaHidden.set(this.el.getAttribute('aria-hidden') === 'true');
        this.text.set(this.el.textContent ?? '');
      };
      read();
      const observer = new MutationObserver(read);
      observer.observe(this.el, {
        attributes: true,
        attributeFilter: ['aria-hidden'],
        childList: true,
        characterData: true,
        subtree: true,
      });
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
