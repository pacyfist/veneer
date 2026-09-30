import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { VeneerFontDirective, VeneerFontService } from '@pacyfist/veneer';
import { SectionHeading } from '../ui/section-heading';
import { Bench } from './bench';
import { BeyondAngular } from './beyond-angular';
import { CipherTable } from './cipher-table';

/**
 * Everything a curious engineer wants and a first-time visitor does not:
 * collapsed by default so the main story stays short.
 */
@Component({
  selector: 'app-deep-dive',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading, CipherTable, Bench, BeyondAngular, VeneerFontDirective],
  template: `
    <app-section-heading eyebrow="Under the hood" title="For the curious">
      The nuts and bolts, live. Open whichever you like.
    </app-section-heading>

    <div class="flex flex-col gap-3">
      <details class="collapse-arrow bg-base-100 border-base-300 collapse border">
        <summary class="collapse-title text-lg font-bold">The full cipher table</summary>
        <div class="collapse-content">
          <app-cipher-table />
        </div>
      </details>

      <details class="collapse-arrow bg-base-100 border-base-300 collapse border">
        <summary class="collapse-title text-lg font-bold">Every setting, on a test bench</summary>
        <div class="collapse-content">
          <app-bench />
        </div>
      </details>

      <details class="collapse-arrow bg-base-100 border-base-300 collapse border">
        <summary class="collapse-title text-lg font-bold">Using the cipher outside Angular</summary>
        <div class="collapse-content">
          <app-beyond-angular />
        </div>
      </details>

      <details class="collapse-arrow bg-base-100 border-base-300 collapse border">
        <summary class="collapse-title text-lg font-bold">
          Why big headlines look slightly off
        </summary>
        <div class="collapse-content">
          <p class="text-base-content/70 mb-4 max-w-3xl">
            The generated font carries no kerning (<code>kern</code>/<code>GPOS</code> tables), so
            letter pairs that normally tuck together don't. You won't notice it in body text; at
            display sizes you can.
          </p>
          <div class="grid max-w-md grid-cols-2 gap-4 text-center">
            <div>
              <div class="text-base-content/50 text-xs tracking-widest uppercase">original</div>
              <div class="text-5xl">AV To</div>
            </div>
            <div>
              <div class="text-base-content/50 text-xs tracking-widest uppercase">generated</div>
              <div class="text-5xl" aria-hidden="true" veneerFont>{{ kernSample() }}</div>
            </div>
          </div>
        </div>
      </details>

      <details class="collapse-arrow bg-base-100 border-base-300 collapse border">
        <summary class="collapse-title text-lg font-bold">Fine print about this demo</summary>
        <div class="collapse-content text-base-content/70 flex max-w-3xl flex-col gap-3">
          <p>
            This site is prerendered to static files, so the page's own cipher is fixed at build
            time and every visitor sees the same one. A server-rendered app draws a fresh cipher per
            request. The cipher table above runs its own instance to show that.
          </p>
          <p>
            The demo sentences also ship readable inside this page's JavaScript bundle, because
            Angular compiles template text into it. Demo copy was never the thing being protected.
            The evidence that matters is the served HTML in "Try it yourself".
          </p>
          <p>
            Server-scrambled elements carry a <code>data-veneer-ssr</code> attribute. It tells the
            browser the text is already scrambled, so it is not scrambled a second time when the
            page hydrates.
          </p>
        </div>
      </details>
    </div>
  `,
})
export class DeepDive {
  private readonly veneer = inject(VeneerFontService);

  protected readonly kernSample = computed(() => this.veneer.scramble('AV To'));
}
