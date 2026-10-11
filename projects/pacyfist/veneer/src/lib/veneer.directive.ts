import {
  Directive,
  ElementRef,
  OnInit,
  PLATFORM_ID,
  Renderer2,
  effect,
  inject,
  input,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { injectVeneerState } from './veneer-inject';
import { VeneerFontState } from './veneer-font-state';
import { ScrambleMap, invertScrambleMap, scrambleText } from '@pacyfist/veneer/core';

/**
 * Marks an element whose text was scrambled during server rendering.
 *
 * It travels to the client in the HTML, which is what lets a hydrating element
 * be told apart from one the browser rendered itself — a deferred block, say,
 * whose text is still the readable template content.
 */
const SSR_MARKER = 'data-veneer-ssr';

/**
 * Protects an element's text.
 *
 * ```html
 * <p veneer>Text a scraper should not be able to read.</p>
 * <p [veneer]="article().body"></p>
 * ```
 *
 * Takes the element's own text content, or the bound string when one is given,
 * replaces it with the scrambled form, and points the element at the forged
 * font so a reader still sees the original words.
 *
 * For text Angular interpolates, use the `veneer` pipe with `veneerFont` instead —
 * this directive owns the element's text content and would fight the binding.
 */
@Directive({ selector: '[veneer]' })
export class VeneerDirective implements OnInit {
  /** Text to protect. Omit to protect whatever the element already contains. */
  readonly veneer = input<string>('');

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly service: VeneerFontState = injectVeneerState('The veneer directive');
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** The readable text. Held so the directive can restore it if the font fails. */
  private original: string | null = null;

  /**
   * Set while the element holds server ciphertext that cannot be inverted
   * yet, because the client does not know the server's map.
   */
  private awaitingMap = false;

  constructor() {
    effect(() => {
      const bound = this.veneer();
      if (bound) this.original = bound;

      // Hydrating: the server's map arrives with its forged font. Until then
      // the server's text stays in the DOM untouched.
      const serverMap = this.service.initialMap();
      if (this.awaitingMap && serverMap) {
        this.awaitingMap = false;
        this.original ??= this.invert(serverMap);
      }

      // Read the reactive state so this re-runs when the font lands, when the
      // reveal toggle flips, when loading fails, or when the map is narrowed.
      this.service.fontStack();
      this.service.hidden();
      this.service.map();
      this.service.active();

      this.apply();
    });
  }

  ngOnInit(): void {
    // Runs on the server too, where effects do not, so the server-rendered HTML
    // is scrambled for crawlers that never execute JavaScript.
    this.original ??= this.readOriginalFromDom();
    this.apply();
  }

  /**
   * The readable text this element started with.
   *
   * When hydrating, the element already holds the text the server scrambled.
   * Taking that as the original would scramble it a second time, and the font
   * only ever undoes one layer — so the reader would be left looking at the
   * server's ciphertext. Invert the cipher instead to recover the real words.
   */
  private readOriginalFromDom(): string | null {
    const el = this.element.nativeElement;
    if (!el.hasAttribute(SSR_MARKER)) return el.textContent ?? '';

    // The server scrambled with the initial map, whatever the map is now. The
    // client learns it from the forged font; until then, wait.
    const serverMap = this.service.initialMap();
    if (serverMap) return this.invert(serverMap);
    this.awaitingMap = true;
    return null;
  }

  private invert(serverMap: ScrambleMap): string {
    const text = this.element.nativeElement.textContent ?? '';
    return scrambleText(text, invertScrambleMap(serverMap));
  }

  private apply(): void {
    if (this.original === null) {
      // The server's map never arrived and the font failed: the text cannot
      // be recovered, but it must not stay hidden either.
      if (this.awaitingMap && !this.service.active()) {
        const el = this.element.nativeElement;
        this.renderer.setStyle(el, 'font-family', this.service.fontStack());
        this.renderer.removeStyle(el, 'visibility');
      }
      return;
    }

    const el = this.element.nativeElement;
    this.renderer.setProperty(el, 'textContent', this.service.scramble(this.original));
    this.renderer.setStyle(el, 'font-family', this.service.fontStack());

    // Record in the server-rendered HTML that this element's text is scrambled,
    // but only when it actually is — a disabled or failed pass leaves the text
    // readable, and inverting that on the client would corrupt it.
    if (!this.isBrowser && this.service.active()) {
      this.renderer.setAttribute(el, SSR_MARKER, '');
    }

    if (this.service.hidden()) {
      this.renderer.setStyle(el, 'visibility', 'hidden');
    } else {
      this.renderer.removeStyle(el, 'visibility');
    }
  }
}
