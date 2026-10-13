import { ChangeDetectionStrategy, Component, ElementRef, signal, viewChild } from '@angular/core';

/** What the frame shows of the hero paragraph. */
interface FrameHero {
  readonly visible: boolean;
  readonly text: string;
}

/**
 * This very page in a sandboxed frame without `allow-scripts`: what a reader
 * with JavaScript off, a reader mode or an archive that strips scripts gets.
 * `allow-same-origin` alone is safe without scripts, and lets the frame load
 * the page's fonts and lets this panel read the hero out of it.
 *
 * Loaded on a click, so the page does not render itself twice on every visit.
 */
@Component({
  selector: 'app-no-js',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="text-base-content/70 mb-3 text-sm">
      This page again, in a frame where scripts cannot run. veneer hides protected text until its
      font is ready only when JavaScript runs, so readers without it get the scrambled text instead
      of blank space.
    </p>
    @if (shown()) {
      <iframe
        #frame
        src="./"
        sandbox="allow-same-origin"
        title="This page with JavaScript turned off"
        class="rounded-box border-base-300 h-[26rem] w-full border"
        (load)="read()"
      ></iframe>
      @if (hero(); as h) {
        <p class="text-base-content/70 mt-2 text-sm" data-testid="no-js-hero">
          The hero paragraph in the frame is
          <strong>{{ h.visible ? 'visible' : 'hidden' }}</strong> and reads:
          <span class="text-secondary font-mono">{{ h.text }}</span>
        </p>
      }
    } @else {
      <button type="button" class="btn btn-sm btn-primary" (click)="shown.set(true)">
        Load this page with JavaScript off
      </button>
    }
  `,
})
export class NoJs {
  protected readonly shown = signal(false);
  protected readonly hero = signal<FrameHero | null>(null);
  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  protected read(): void {
    const doc = this.frame()?.nativeElement.contentDocument;
    const el = doc?.querySelector('app-hero p[veneer]');
    if (!doc || !el) return;
    const view = doc.defaultView!;
    // Scroll the frame, not this page, to the hero paragraph, clear of its sticky navbar.
    view.scrollTo(0, el.getBoundingClientRect().top + view.scrollY - 120);
    const style = view.getComputedStyle(el);
    this.hero.set({
      visible: style.visibility === 'visible' && style.display !== 'none',
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    });
  }
}
