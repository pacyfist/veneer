import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { VeneerDirective, VeneerFontService } from '@pacyfist/veneer';

/**
 * Kept in sync with the element content below by hand. The specimen has to be
 * element content rather than a binding: only that form is scrambled during
 * prerender and carries the data-veneer-ssr marker the "what a crawler
 * downloads" panel goes looking for.
 */
const HERO_TEXT =
  'This paragraph looks perfectly normal to you. Copy it, search it, or feed it to a scraper, and all you get is gibberish.';

/** Radius of the bot-vision lens, in pixels. */
const LENS = 90;

/**
 * The five-second pitch: a protected paragraph with a lens that shows what a
 * machine reads in the same spot.
 *
 * The lens layer is the paragraph's scrambled text drawn in the ordinary font,
 * which is exactly what a scraper extracts. Forged glyphs keep the widths of
 * the letters they draw, so the two layers do not line up letter for letter.
 * That is fine: the lens shows the same passage, not a pixel overlay.
 */
@Component({
  selector: 'app-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VeneerDirective],
  template: `
    <div class="grid items-center gap-12 pt-16 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
      <div>
        <p
          class="border-base-300 bg-base-100 mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
            <path fill="currentColor" d="M12 2 3 5.2l1.4 11.9L12 22l7.6-4.9L21 5.2z" />
            <path
              fill="var(--color-base-100)"
              d="M12 5.3 7.2 16h1.8l1-2.4h4l1 2.4h1.8zm-1.3 6.8L12 9l1.3 3.1z"
            />
          </svg>
          An Angular library
          <span class="text-base-content/50 font-normal">· Angular 20–22 · SSR ready</span>
        </p>
        <h1 class="text-5xl leading-[1.05] font-bold tracking-tight md:text-6xl">
          Readable by <span class="text-primary">people</span>.<br />
          Gibberish to <span class="text-secondary font-mono tracking-normal">b0t$</span>.
        </h1>
        <p class="text-base-content/70 mt-6 max-w-xl text-lg leading-relaxed">
          Add one directive to your Angular templates. Visitors read your text as usual, but
          anything that scrapes your HTML (AI crawlers, scripts, copy-paste) gets scrambled
          nonsense.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a class="btn btn-primary btn-lg" href="#start">Add it to your Angular app</a>
          <a class="btn btn-ghost btn-lg" href="#try">Try it yourself ↓</a>
        </div>
        <div class="mt-8 flex flex-wrap items-center gap-2 font-mono text-sm">
          <code class="rounded-field bg-[#16161d] px-3 py-1.5 text-[#e8e6e3]"
            >npm i &#64;pacyfist/veneer</code
          >
          <code class="rounded-field bg-[#16161d] px-3 py-1.5 text-[#e8e6e3]"
            >&lt;p <span class="text-[#2dd4bf]">veneer</span>&gt;…&lt;/p&gt;</code
          >
        </div>
      </div>

      <div class="rounded-box bg-base-100 border-base-300 border p-6 shadow-xl md:p-8">
        <div class="mb-4 flex items-center justify-between gap-3">
          <span class="text-base-content/50 text-xs font-bold tracking-widest uppercase">
            {{ botView() ? 'what a bot reads' : 'what you see' }}
          </span>
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <span [class.text-primary]="!botView()">Human</span>
            <input
              type="checkbox"
              class="toggle toggle-sm border-primary text-primary checked:border-secondary checked:text-secondary"
              [checked]="botView()"
              (change)="botView.set(!botView())"
              aria-label="Show what a bot reads"
            />
            <span [class.text-secondary]="botView()">Bot</span>
          </label>
        </div>

        <div
          class="relative cursor-crosshair overflow-hidden touch-pan-y"
          (pointermove)="move($event)"
          (pointerleave)="pointer.set(null)"
        >
          <p class="sr-only">
            A protected sample paragraph follows. It is stored scrambled and repaired on screen by a
            generated font.
          </p>
          <p class="text-2xl leading-snug md:text-[1.7rem]" aria-hidden="true" veneer>
            This paragraph looks perfectly normal to you. Copy it, search it, or feed it to a
            scraper, and all you get is gibberish.
          </p>

          <p
            class="bot-scan bg-base-100 text-secondary pointer-events-none absolute inset-0 font-mono text-lg leading-snug break-all md:text-xl"
            [style.clip-path]="clip()"
            aria-hidden="true"
          >
            {{ botText() }}
          </p>

          @if (pointer(); as p) {
            @if (!botView()) {
              <div
                class="border-secondary pointer-events-none absolute rounded-full border-2 shadow-lg"
                [style.left.px]="p.x - lens"
                [style.top.px]="p.y - lens"
                [style.width.px]="lens * 2"
                [style.height.px]="lens * 2"
              ></div>
            }
          }
        </div>

        <p class="text-base-content/50 mt-5 text-sm">
          <span class="hidden md:inline">Hover the paragraph for bot vision.</span>
          <span class="md:hidden">Drag across the paragraph for bot vision.</span>
        </p>
      </div>
    </div>
  `,
})
export class Hero {
  private readonly veneer = inject(VeneerFontService);

  protected readonly lens = LENS;
  protected readonly botView = signal(false);
  protected readonly pointer = signal<{ x: number; y: number } | null>(null);

  protected readonly botText = computed(() => this.veneer.scramble(HERO_TEXT));

  protected readonly clip = computed(() => {
    if (this.botView()) return 'inset(0 0 0 0)';
    const p = this.pointer();
    return p ? `circle(${LENS}px at ${p.x}px ${p.y}px)` : 'circle(0px at 50% 50%)';
  });

  protected move(event: PointerEvent): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.pointer.set({ x: event.clientX - box.left, y: event.clientY - box.top });
  }
}
