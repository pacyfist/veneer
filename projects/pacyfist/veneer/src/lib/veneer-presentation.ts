import { CSP_NONCE, DOCUMENT, PLATFORM_ID, Renderer2, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { VeneerFontState } from './veneer-font-state';
import { VENEER_CONFIG } from './veneer.config';
import { HIDDEN_BY_ATTRIBUTE, HIDE_ATTRIBUTE, ensureHideRules } from './veneer-hide';

/**
 * What both directives do to their host element besides its text: the font,
 * hiding until the font is ready, and keeping translators off scrambled text.
 *
 * Internal: not part of the public API.
 */
export class HostPresentation {
  private readonly renderer = inject(Renderer2);
  private readonly document = inject(DOCUMENT);
  private readonly config = inject(VENEER_CONFIG);
  private readonly nonce = inject(CSP_NONCE, { optional: true });
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor(
    private readonly element: HTMLElement,
    private readonly service: VeneerFontState,
  ) {}

  /** Apply the current state. `hide` adds a reason to hide beyond the service's own. */
  apply(hide = false): void {
    const { renderer, element: el, service } = this;
    renderer.setStyle(el, 'font-family', service.fontStack());

    // Scrambled text must not be machine-translated: the translation of
    // gibberish, drawn with the forged font, is gibberish twice over.
    if (service.active()) {
      renderer.setAttribute(el, 'translate', 'no');
      renderer.addClass(el, 'notranslate');
    } else {
      renderer.removeAttribute(el, 'translate');
      renderer.removeClass(el, 'notranslate');
    }

    this.applyHidden(hide || service.hidden());
  }

  private applyHidden(hidden: boolean): void {
    const { renderer, element: el } = this;

    if (!this.isBrowser) {
      // No inline style in the served HTML: a strict CSP ignores style
      // attributes, and readers without JavaScript would get blank space.
      if (!hidden) return;
      if (this.config.hideWith === 'hidden') {
        if (!el.hasAttribute('hidden')) {
          renderer.setAttribute(el, 'hidden', '');
          renderer.setAttribute(el, HIDE_ATTRIBUTE, HIDDEN_BY_ATTRIBUTE);
        }
      } else {
        renderer.setAttribute(el, HIDE_ATTRIBUTE, '');
        ensureHideRules(this.document, this.nonce);
      }
      return;
    }

    // In the browser: a CSSOM write, which a strict CSP allows, set before the
    // server's marker is dropped so the text never shows in between.
    if (hidden) {
      renderer.setStyle(el, 'visibility', 'hidden');
    } else {
      renderer.removeStyle(el, 'visibility');
    }
    const marker = el.getAttribute(HIDE_ATTRIBUTE);
    if (marker !== null) {
      if (marker === HIDDEN_BY_ATTRIBUTE) renderer.removeAttribute(el, 'hidden');
      renderer.removeAttribute(el, HIDE_ATTRIBUTE);
    }
  }
}
