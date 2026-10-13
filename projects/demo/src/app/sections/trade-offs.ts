import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { VeneerFontService, withReadableCopy } from '@pacyfist/veneer';
import { SectionHeading } from '../ui/section-heading';
import { IsolatedInstance } from '../ui/isolated-instance';
import { LeakCheck } from './leak-check';

const SPOKEN = 'Protect article bodies, not navigation.';

const COPY_SAMPLE = 'Copy me and paste me: you get these very words back.';

/**
 * What it stops, what it does not, and what it costs.
 *
 * Wording here tracks the root README's "A speed bump, not a vault" table and
 * the library README's "What this defends against". If one changes, change
 * the other.
 */
@Component({
  selector: 'app-trade-offs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading, IsolatedInstance, LeakCheck],
  template: `
    <app-section-heading eyebrow="The honest part" title="A speed bump, not a vault">
      veneer makes lazy, bulk scraping pointless. It won't stop someone who is specifically after
      your content, and it doesn't pretend to.
    </app-section-heading>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="card border-primary/30 bg-primary/5 border">
        <div class="card-body">
          <h3 class="card-title text-primary text-2xl">Stops</h3>
          <ul class="flex flex-col gap-2 text-lg">
            @for (item of stops; track item) {
              <li class="flex gap-3"><span class="text-primary">✓</span>{{ item }}</li>
            }
          </ul>
        </div>
      </div>
      <div class="card border-secondary/30 bg-secondary/5 border">
        <div class="card-body">
          <h3 class="card-title text-secondary text-2xl">Doesn't stop</h3>
          <ul class="flex flex-col gap-2 text-lg">
            @for (item of doesNotStop; track item) {
              <li class="flex gap-3"><span class="text-secondary">✕</span>{{ item }}</li>
            }
          </ul>
        </div>
      </div>
    </div>

    <h3 class="mt-14 mb-2 text-2xl font-bold">The attack matrix</h3>
    <p class="text-base-content/70 mb-4 max-w-2xl text-lg">
      Measured by the adversary suite, which runs these attacks against this demo on every CI run.
      You can run (b) and (d) yourself in
      <a class="link link-primary" href="#try">"Look at what a crawler downloads"</a>.
    </p>
    <div class="rounded-box border-base-300 bg-base-100 overflow-x-auto border">
      <table class="table" data-testid="attack-matrix">
        <thead>
          <tr>
            <th>Attacker</th>
            <th>Cost</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          @for (row of attacks; track row.who) {
            <tr>
              <td>{{ row.who }}</td>
              <td class="whitespace-nowrap">{{ row.cost }}</td>
              <td>
                <span
                  class="badge badge-sm mr-2"
                  [class.badge-primary]="row.stopped"
                  [class.badge-secondary]="!row.stopped"
                  >{{ row.result }}</span
                >{{ row.note }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <p class="text-base-content/70 mt-2 text-sm">
      The details, and who veneer does not try to stop:
      <a
        class="link link-primary"
        href="https://github.com/pacyfist/veneer/blob/main/THREAT_MODEL.md"
        >THREAT_MODEL.md</a
      >.
    </p>

    <div class="card bg-base-100 border-base-300 mt-6 border">
      <div class="card-body">
        <h3 class="card-title">Check this page for leaks</h3>
        <p class="text-base-content/70">
          Runs <code>findVeneerLeaks</code> from <code>&#64;pacyfist/veneer/testing</code> in your
          browser, over this page's served HTML and every script it loaded.
        </p>
        <app-leak-check />
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
            are meant to share, or opt in to readable copies (below).
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
            <code>withA11y('hide')</code> hides protected text from it while it is scrambled. That
            hides the text, it doesn't make it accessible: the <strong>Readable text</strong> switch
            at the top of this page turns scrambling off, and that is what gives these readers the
            words.
          </p>
        </div>
      </div>
    </div>

    <div class="mt-6 grid items-start gap-4 md:grid-cols-2">
      <div class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <h4 class="card-title">Opt in: copy readable text</h4>
          <p id="copy-explainer" class="text-base-content/70">
            With <code>withReadableCopy()</code>, copying a selection that includes protected text
            puts the words people see on the clipboard. Scripts reading the page still get
            gibberish. Select the sample, from the text above it if you like, and paste it
            somewhere.
          </p>
        </div>
      </div>
      <app-isolated-instance [text]="copySample" [features]="copyFeatures" />
    </div>

    <div class="rounded-box border-base-300 bg-base-200 mt-6 border p-5 text-lg">
      <p>
        <strong>Good use:</strong> article bodies, recipes, lyrics, product descriptions.
        <strong>Leave alone:</strong> menus, headings, form labels, and anything you want search
        engines to rank. <strong>Never:</strong> secrets. This is not encryption.
        <strong>Styling:</strong> <code>text-transform</code> and <code>small-caps</code> paint the
        wrong letters on protected text.
      </p>
    </div>
  `,
})
export class TradeOffs {
  private readonly veneer = inject(VeneerFontService);

  protected readonly copySample = COPY_SAMPLE;
  protected readonly copyFeatures = [withReadableCopy()];

  /** THREAT_MODEL.md's attack matrix, in short. Keep the two in step. */
  protected readonly attacks = [
    {
      who: '(a) Crawler: one GET and an HTML parser',
      cost: '5 lines, ~1 s',
      result: 'Blocked',
      stopped: true,
      note: 'Gets only what the page prints in the clear outside protected elements.',
    },
    {
      who: "(a') The same, also downloading the page's JavaScript",
      cost: 'A few more lines',
      result: 'Succeeds',
      stopped: false,
      note: 'For text written in the source, which ships in the bundle.',
    },
    {
      who: '(b) Veneer-aware crawler: regex a seed, rebuild the cipher',
      cost: '15 lines, <1 s',
      result: 'Blocked',
      stopped: true,
      note: 'There is no seed in the page.',
    },
    {
      who: '(c) Headless browser hooking FontFace',
      cost: '56 lines, 1-2 s',
      result: 'Succeeds',
      stopped: false,
      note: 'Once JavaScript runs, the forged font is in memory.',
    },
    {
      who: '(d) Font-aware crawler: download both fonts, no JavaScript',
      cost: '15 lines, 1-2 s',
      result: 'Succeeds',
      stopped: false,
      note: 'The bar veneer sets: a font parser and two downloads.',
    },
    {
      who: 'Brute-forcing a seed',
      cost: '~225 bits',
      result: 'Blocked',
      stopped: true,
      note: 'Infeasible by default; trivial if the app fixes a seed.',
    },
    {
      who: 'Substitution solver on the ciphertext alone',
      cost: 'Off the shelf',
      result: 'Succeeds',
      stopped: false,
      note: 'On long passages: spaces and word lengths are kept.',
    },
    {
      who: 'Screenshot plus OCR or a vision model',
      cost: 'Rendering + inference',
      result: 'Succeeds',
      stopped: false,
      note: 'The pixels are correct by design.',
    },
  ];

  protected readonly stops = [
    'Crawlers that read your HTML without running JavaScript',
    'Scripts that read innerText or textContent',
    'Copy-pasting your page into a chatbot',
    'Bulk scrapers that have never heard of veneer',
  ];

  protected readonly doesNotStop = [
    'Crawlers that also download your JS bundles: text written in your templates is in there',
    'Scrapers that know veneer and download the fonts: about 15 lines of code',
    'Headless browsers that read the font from memory',
    'Screenshots run through OCR or a vision model',
    'A determined person targeting your site in particular',
  ];

  // computed, not a constant: if the font fails the library stops scrambling,
  // and this readout must stop claiming otherwise.
  protected readonly spoken = computed(() => this.veneer.scramble(SPOKEN));
}
