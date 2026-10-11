import { CSP_NONCE, DOCUMENT, PLATFORM_ID, Renderer2, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { VeneerFontState } from './veneer-font-state';
import { VENEER_CONFIG } from './veneer.config';
import { HIDDEN_BY_ATTRIBUTE, HIDE_ATTRIBUTE, ensureHideRules } from './veneer-hide';
import { ProtectedHost, registerHost, unregisterHost } from './veneer-hosts';
import { installReadableCopy } from './veneer-copy';
import { describeElement, devWarn } from './veneer-dev';

declare const ngDevMode: boolean | undefined;

/** Focusable elements, which `aria-hidden` must not cover. */
const FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, iframe, summary, audio[controls], ' +
  'video[controls], [tabindex], [contenteditable]:not([contenteditable="false"])';

/**
 * What both directives do to their host element besides its text: the font,
 * hiding until the font is ready, keeping translators off scrambled text,
 * `withA11y('hide')`, and the bookkeeping the copy handler and the dev checks
 * read.
 *
 * Internal: not part of the public API.
 */
export class HostPresentation {
  private readonly renderer = inject(Renderer2);
  private readonly document = inject(DOCUMENT);
  private readonly config = inject(VENEER_CONFIG);
  private readonly nonce = inject(CSP_NONCE, { optional: true });
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Set once VNR021 has been reported for this element. */
  private warnedFocusable = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly service: VeneerFontState,
    kind: ProtectedHost['kind'],
  ) {
    const copy = this.config.readableCopy;
    registerHost(element, { state: service, kind, copy });
    if (copy && this.isBrowser) installReadableCopy(this.document);
  }

  destroy(): void {
    unregisterHost(this.element);
  }

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

    if (this.config.a11y === 'hide') this.applyA11y();

    this.applyHidden(hide || service.hidden());
  }

  /**
   * `withA11y('hide')`: keep screen readers from reading scrambled text
   * aloud, only while it is scrambled. Readable text (fail-open, disabled,
   * readable mode) is never hidden: that would cost the protection without
   * providing any.
   */
  private applyA11y(): void {
    const { renderer, element: el } = this;
    let hide = this.service.active();
    if (hide && (el.matches(FOCUSABLE) || el.querySelector(FOCUSABLE))) {
      // aria-hidden over something focusable leaves a keyboard stop that
      // assistive technology cannot describe (WCAG 4.1.2).
      hide = false;
      if ((typeof ngDevMode === 'undefined' || ngDevMode) && !this.warnedFocusable) {
        this.warnedFocusable = true;
        devWarn(
          'VNR021',
          `withA11y('hide') left ${describeElement(el)} visible to assistive technology because ` +
            'it is or contains a focusable element, and aria-hidden must not hide focusable ' +
            'content. Screen readers will read its scrambled text. Keep links and controls out ' +
            'of protected elements, or rely on readable mode for this content.',
        );
      }
    }
    if (hide) {
      renderer.setAttribute(el, 'aria-hidden', 'true');
    } else {
      renderer.removeAttribute(el, 'aria-hidden');
    }
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
