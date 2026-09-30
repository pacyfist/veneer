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
import { NoAiFontService } from './no-ai-font.service';
import { invertScrambleMap, scrambleText } from './scramble-map';

/**
 * Marks an element whose text was scrambled during server rendering.
 *
 * It travels to the client in the HTML, which is what lets a hydrating element
 * be told apart from one the browser rendered itself — a deferred block, say,
 * whose text is still the readable template content.
 */
const SSR_MARKER = 'data-no-ai-ssr';

/**
 * Protects an element's text.
 *
 * ```html
 * <p noAi>Text a scraper should not be able to read.</p>
 * <p [noAi]="article().body"></p>
 * ```
 *
 * Takes the element's own text content, or the bound string when one is given,
 * replaces it with the scrambled form, and points the element at the forged
 * font so a reader still sees the original words.
 *
 * For text Angular interpolates, use the `noAi` pipe with `noAiFont` instead —
 * this directive owns the element's text content and would fight the binding.
 */
@Directive({ selector: '[noAi]' })
export class NoAiDirective implements OnInit {
  /** Text to protect. Omit to protect whatever the element already contains. */
  readonly noAi = input<string>('');

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly service = inject(NoAiFontService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** The readable text. Held so the directive can restore it if the font fails. */
  private original: string | null = null;

  constructor() {
    effect(() => {
      const bound = this.noAi();
      if (bound) this.original = bound;

      // Read the reactive state so this re-runs when the font lands, when the
      // reveal toggle flips, or when loading fails.
      this.service.fontStack();
      this.service.hidden();

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
  private readOriginalFromDom(): string {
    const el = this.element.nativeElement;
    const text = el.textContent ?? '';

    if (!el.hasAttribute(SSR_MARKER)) return text;

    return scrambleText(text, invertScrambleMap(this.service.map));
  }

  private apply(): void {
    if (this.original === null) return;

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
