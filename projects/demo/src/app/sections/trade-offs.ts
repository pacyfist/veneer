import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { VeneerFontService } from '@pacyfist/veneer';
import { SectionHeading } from '../ui/section-heading';

const SPOKEN = 'Protect article bodies, not navigation.';

/**
 * What it stops, what it does not, and what it costs.
 *
 * Wording here tracks the README's "What this defends against" and
 * "Trade-offs" sections. If one changes, change the other.
 */
@Component({
  selector: 'app-trade-offs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading],
  template: `
    <app-section-heading eyebrow="The honest part" title="A speed bump, not a vault">
      veneer makes lazy, bulk scraping pointless. It won't stop someone who is specifically after
      your content, and it doesn't pretend to.
    </app-section-heading>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="card border-primary/30 bg-primary/5 border">
        <div class="card-body">
          <h3 class="card-title text-primary">Stops</h3>
          <ul class="flex flex-col gap-2 text-lg">
            @for (item of stops; track item) {
              <li class="flex gap-3"><span class="text-primary">✓</span>{{ item }}</li>
            }
          </ul>
        </div>
      </div>
      <div class="card border-secondary/30 bg-secondary/5 border">
        <div class="card-body">
          <h3 class="card-title text-secondary">Doesn't stop</h3>
          <ul class="flex flex-col gap-2 text-lg">
            @for (item of doesNotStop; track item) {
              <li class="flex gap-3"><span class="text-secondary">✕</span>{{ item }}</li>
            }
          </ul>
        </div>
      </div>
    </div>

    <h3 class="mt-14 mb-2 text-2xl font-bold">What it costs you</h3>
    <p class="text-base-content/70 mb-6 max-w-2xl text-lg">
      These come from the same trick that does the protecting, so they can't be fixed without losing
      it. Weigh them before you protect anything.
    </p>

    <div class="grid gap-4 md:grid-cols-3">
      <div class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <span class="text-3xl" aria-hidden="true">🔍</span>
          <h4 class="card-title">Find in page</h4>
          <p class="text-base-content/70">
            Ctrl+F can't find protected words, because the page doesn't contain them.
            <a class="link link-primary" href="#try">You tried it above.</a>
          </p>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <span class="text-3xl" aria-hidden="true">📋</span>
          <h4 class="card-title">Copy and paste</h4>
          <p class="text-base-content/70">
            Your human readers get gibberish when they copy a quote, too. Don't protect text people
            are meant to share.
          </p>
        </div>
      </div>
      <div class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <span class="text-3xl" aria-hidden="true">🔊</span>
          <h4 class="card-title">Screen readers</h4>
          <p class="text-base-content/70">
            Assistive tech reads the page's text, so it would say this out loud:
          </p>
          <p class="text-secondary font-mono break-all">{{ spoken() }}</p>
          <p class="text-base-content/70">
            Hide protected text from it with <code>aria-hidden</code> and offer a readable summary.
          </p>
        </div>
      </div>
    </div>

    <div class="rounded-box border-base-300 bg-base-200 mt-6 border p-5 text-lg">
      <p>
        <strong>Good use:</strong> article bodies, recipes, lyrics, product descriptions.
        <strong>Leave alone:</strong> menus, headings, form labels, and anything you want Google to
        rank. <strong>Never:</strong> secrets. This is not encryption.
      </p>
    </div>
  `,
})
export class TradeOffs {
  private readonly veneer = inject(VeneerFontService);

  protected readonly stops = [
    'Scripts that download your HTML and parse it',
    "Crawlers that don't run JavaScript",
    'Copy-pasting your page into a chatbot',
    'Cheap bulk scraping for AI training sets',
  ];

  protected readonly doesNotStop = [
    'Screenshots run through OCR: the pixels are correct',
    'Someone who downloads the font and reverses the cipher',
    'A determined person targeting your site in particular',
  ];

  // computed, not a constant: if the font fails the library stops scrambling,
  // and this readout must stop claiming otherwise.
  protected readonly spoken = computed(() => this.veneer.scramble(SPOKEN));
}
