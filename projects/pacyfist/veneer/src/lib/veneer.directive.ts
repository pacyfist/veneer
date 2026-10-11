import {
  AfterViewChecked,
  Directive,
  DOCUMENT,
  ElementRef,
  HostAttributeToken,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  Renderer2,
  Sanitizer,
  afterNextRender,
  effect,
  inject,
  input,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { injectVeneerState } from './veneer-inject';
import { VeneerFontState } from './veneer-font-state';
import { walkTextNodes } from './veneer-hosts';
import { VeneerHtml, sanitizeHtml } from './veneer-sanitize';
import { VENEER_CONFIG } from './veneer.config';
import { HostPresentation } from './veneer-presentation';
import { hasForeignText, warnCaseStyles, warnForeignText } from './veneer-dev';
import { invertScrambleMap, scrambleText } from '@pacyfist/veneer/core';

/**
 * Marks an element whose text was scrambled during server rendering. It
 * covers the element's whole subtree: every text node the walker protects.
 *
 * It travels to the client in the HTML, which is what lets a hydrating element
 * be told apart from one the browser rendered itself — a deferred block, say,
 * whose text is still the readable template content.
 */
const SSR_MARKER = 'data-veneer-ssr';

/** Where the protected text comes from. */
type Mode = 'content' | 'bound' | 'html';

declare const ngDevMode: boolean | undefined;

/**
 * Protects an element's text.
 *
 * ```html
 * <p veneer>Text a scraper should <a href="/why">not</a> be able to <em>read</em>.</p>
 * <p [veneer]="article().title"></p>
 * <div [veneerHtml]="article().bodyHtml"></div>
 * ```
 *
 * Three forms:
 *
 * - `<p veneer>…</p>`: protects every text node inside the element, markup
 *   included. Links, emphasis and other elements stay as they are; only their
 *   text is scrambled. Subtrees in `script`, `style`, `code`, `textarea`,
 *   `noscript` and anything marked `veneer-skip` are left readable, and a
 *   nested `veneer` or `veneerFont` element protects its own text.
 * - `[veneer]="text"`: renders the bound string as the element's only
 *   content. A binding that changes to `''` clears the text.
 * - `[veneerHtml]="html"`: renders sanitized HTML (sanitized as Angular
 *   sanitizes `[innerHTML]`) and protects its text nodes.
 *
 * Each text node is rewritten in place, so the nodes Angular created for the
 * template, or claimed during hydration, keep working. The scrambled form is
 * shown in the forged font so a reader still sees the original words.
 *
 * For text Angular interpolates, use the `veneer` pipe with `veneerFont`
 * instead: an interpolation inside this element would write readable text
 * over the scrambled text (dev mode warns, VNR001).
 */
@Directive({ selector: '[veneer], [veneerHtml]' })
export class VeneerDirective implements OnInit, AfterViewChecked, OnDestroy {
  /**
   * Text to protect. Bind a string to render it as the element's content;
   * leave the attribute bare (`<p veneer>`) to protect what the element
   * already contains.
   */
  readonly veneer = input<string | undefined>(undefined);

  /**
   * HTML to render and protect: a string, sanitized like `[innerHTML]`, or a
   * `SafeHtml` from `DomSanitizer.bypassSecurityTrustHtml()`. Takes
   * precedence over a bound `veneer` string.
   */
  readonly veneerHtml = input<VeneerHtml | null | undefined>(undefined);

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly document = inject(DOCUMENT);
  private readonly sanitizer = inject(Sanitizer, { optional: true });
  private readonly service: VeneerFontState = injectVeneerState('The veneer directive');
  private readonly config = inject(VENEER_CONFIG);
  private readonly presentation = new HostPresentation(
    this.element.nativeElement,
    this.service,
    'text',
  );
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * The bare attribute's value: `''` for `<p veneer>`, null when `veneer` is
   * only a property binding. Tells element content apart from a binding that
   * happens to be `''`.
   */
  private readonly attribute = inject(new HostAttributeToken('veneer'), { optional: true });

  /** The readable text of each protected text node. */
  private readonly originals = new WeakMap<Text, string>();

  /** What the directive last wrote into each text node, to notice writes by others. */
  private readonly written = new WeakMap<Text, string>();

  /** The protected text nodes, as of the last pass. */
  private texts: Text[] = [];

  /** `[veneer-skip]` elements found by the last pass. */
  private optedOut: Element[] = [];

  /** Set once a string has been bound, so a later `undefined` clears the text rather than adopting it. */
  private bound = false;

  /** The text node a bound string is rendered into. */
  private ownText: Text | null = null;

  /** The HTML last rendered for `veneerHtml`, to re-render only when it changes. */
  private renderedHtml: string | null = null;

  /** Whether the first pass, the one that sees the server's text, has run. */
  private walked = false;

  /** The mode of the last pass. */
  private current: Mode = 'content';

  /**
   * Text nodes holding the server's ciphertext that could not be inverted yet
   * because `initialMap()` is still null. They are left exactly as the server
   * wrote them until it is set.
   */
  private serverTexts: Text[] = [];

  constructor() {
    effect(() => {
      this.veneer();
      this.veneerHtml();

      // Read the reactive state so this re-runs when the font lands, when the
      // reveal toggle flips, when loading fails, when the map is narrowed, and
      // when the server's map becomes known.
      this.service.fontStack();
      this.service.hidden();
      this.service.map();
      this.service.initialMap();

      this.apply();
    });

    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      afterNextRender(() => {
        if (!this.service.active()) return;
        const parents = new Set<Element>([this.element.nativeElement]);
        for (const text of this.texts) if (text.parentElement) parents.add(text.parentElement);
        warnCaseStyles(parents);
      });
    }
  }

  ngOnInit(): void {
    // Runs on the server too, where effects may not have run yet, so the
    // server-rendered HTML is scrambled for crawlers that never execute
    // JavaScript. On the client it runs before Angular writes any
    // interpolation inside the element, so it sees the server's text.
    this.apply();
  }

  ngAfterViewChecked(): void {
    // VNR001: text the directive did not write, found after the view that
    // contains this element was checked (an interpolation, an @if inside it).
    if (
      (typeof ngDevMode === 'undefined' || ngDevMode) &&
      this.current === 'content' &&
      this.service.active() &&
      hasForeignText(this.element.nativeElement, this.written, this.serverTexts)
    ) {
      warnForeignText(this.element.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.presentation.destroy();
  }

  private mode(): Mode {
    if (this.veneerHtml() !== undefined) return 'html';
    const bound = this.veneer();
    if (this.bound || (bound !== undefined && !(this.attribute === '' && bound === ''))) {
      this.bound = true;
      return 'bound';
    }
    return 'content';
  }

  private apply(): void {
    const el = this.element.nativeElement;
    this.current = this.mode();
    switch (this.current) {
      case 'html':
        this.renderHtml();
        break;
      case 'bound':
        this.renderBound(this.veneer() ?? '');
        break;
      case 'content':
        this.collect();
        break;
    }
    this.walked = true;
    this.recoverServerTexts();

    const pending = new Set(this.serverTexts);
    for (const text of this.texts) {
      if (pending.has(text)) continue;
      const value = this.service.scramble(this.originals.get(text) ?? '');
      if (text.data !== value) this.renderer.setValue(text, value);
      this.written.set(text, value);
    }

    // Readable mode cannot show the server's text until it can be inverted:
    // in the fallback font it would be gibberish. Keep it hidden until then,
    // unless the font failed first: then the map never comes, and the text
    // must not stay hidden (it stays as the server wrote it).
    this.presentation.apply(
      this.serverTexts.length > 0 && this.service.readable() && this.service.failed() === null,
    );

    const fontStack = this.service.fontStack();
    // Opted-out text is readable, so it must not inherit the forged font,
    // which would draw it as gibberish.
    for (const skipped of this.optedOut) {
      if (fontStack === this.config.fallbackFontFamily) {
        this.renderer.removeStyle(skipped, 'font-family');
      } else {
        this.renderer.setStyle(skipped, 'font-family', this.config.fallbackFontFamily);
      }
    }

    // Record in the server-rendered HTML that this element's text is scrambled,
    // but only when it actually is — a disabled or failed pass leaves the text
    // readable, and inverting that on the client would corrupt it.
    if (!this.isBrowser && this.service.active()) {
      this.renderer.setAttribute(el, SSR_MARKER, '');
    }
  }

  /**
   * Finds the text nodes of element content: those Angular created for the
   * template, nodes added since (an `@if` inside the element), and on the
   * first pass of a hydrating element, the server's scrambled nodes.
   */
  private collect(): void {
    const el = this.element.nativeElement;
    const hydrating = !this.walked && this.isBrowser && el.hasAttribute(SSR_MARKER);
    const { texts, optedOut } = walkTextNodes(el);
    this.optedOut = optedOut;

    for (const text of texts) {
      const written = this.written.get(text);
      if (!this.originals.has(text)) {
        if (hydrating) {
          // The server scrambled this node. Its readable form comes from
          // inverting the server's map, once that is known.
          this.serverTexts.push(text);
        } else {
          // Text the browser rendered itself is still readable.
          this.originals.set(text, text.data);
        }
      } else if (written !== undefined && text.data !== written) {
        // Someone else wrote readable text into the node after it was
        // scrambled, most likely an interpolation. Take theirs as the latest
        // original rather than putting the stale one back.
        this.originals.set(text, text.data);
        if (typeof ngDevMode === 'undefined' || ngDevMode)
          warnForeignText(this.element.nativeElement);
      }
    }
    this.texts = texts;
  }

  /** Inverts the server's ciphertext once the map it was scrambled with is known. */
  private recoverServerTexts(): void {
    if (this.serverTexts.length === 0) return;
    const map = this.service.initialMap();
    if (!map) return;

    const inverse = invertScrambleMap(map);
    for (const text of this.serverTexts) {
      this.originals.set(text, scrambleText(text.data, inverse));
    }
    this.serverTexts = [];
  }

  /** Renders a bound string as the element's single text node. */
  private renderBound(value: string): void {
    const el = this.element.nativeElement;
    if (!this.ownText || this.ownText.parentNode !== el || el.childNodes.length !== 1) {
      // Reuse the text node the server rendered, if that is all there is, so
      // hydration does not churn the DOM.
      const only = el.childNodes.length === 1 ? el.firstChild : null;
      if (only?.nodeType === 3) {
        this.ownText = only as Text;
      } else {
        for (const child of Array.from(el.childNodes)) this.renderer.removeChild(el, child);
        this.ownText = this.renderer.createText('') as Text;
        this.renderer.appendChild(el, this.ownText);
      }
    }
    this.originals.set(this.ownText, value);
    this.texts = [this.ownText];
    this.optedOut = [];
  }

  /**
   * Renders the sanitized HTML, when it changed, and protects its text nodes.
   * The binding holds the readable HTML, so nothing is ever inverted here.
   */
  private renderHtml(): void {
    const el = this.element.nativeElement;
    const html = sanitizeHtml(this.veneerHtml() ?? null, this.document, this.sanitizer);
    if (String(html) !== this.renderedHtml) {
      this.renderer.setProperty(el, 'innerHTML', html);
      this.renderedHtml = String(html);
      const { texts, optedOut } = walkTextNodes(el);
      for (const text of texts) this.originals.set(text, text.data);
      this.texts = texts;
      this.optedOut = optedOut;
    }
  }
}
