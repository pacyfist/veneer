import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NoAiFontService, scrambleText } from '@pacyfist/no-ai';
import { SectionHeading } from '../ui/section-heading';

interface Pair {
  readonly real: string;
  readonly stored: string;
}

/**
 * The mechanism in three beats, driven by the page's own cipher.
 *
 * Uses the shell service's map directly instead of `scramble()`, so the
 * illustration keeps working even if the font fails to load. The map's seed
 * travels from server to client, so the prerendered example and the hydrated
 * one agree.
 */
@Component({
  selector: 'app-how-it-works',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading],
  template: `
    <app-section-heading eyebrow="How it works" title="A secret code, and a font that cracks it">
      Think of a kid's decoder ring. The page holds the code, the font is the ring, and only your
      screen ever puts the two together.
    </app-section-heading>

    <label class="mb-8 flex max-w-md flex-col gap-2">
      <span class="text-base-content/60 text-sm">Try a word:</span>
      <input
        class="input input-lg font-bold"
        maxlength="12"
        [value]="word()"
        (input)="onType($event)"
        aria-label="Word to follow through the three steps"
      />
    </label>

    <ol class="grid gap-4 md:grid-cols-3">
      <li class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <span class="text-primary text-4xl font-bold">1</span>
          <h3 class="card-title">Swap every letter</h3>
          <p class="text-base-content/70">
            Each character is replaced with a different one. That scrambled version is what goes
            into your HTML.
          </p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            @for (p of pairs(); track $index) {
              <div class="rounded-field bg-base-200 flex flex-col items-center px-2 py-1">
                <span class="text-primary text-lg font-bold">{{ p.real }}</span>
                <span class="text-base-content/40 text-xs">↓</span>
                <span class="text-secondary font-mono text-lg">{{ p.stored }}</span>
              </div>
            }
          </div>
        </div>
      </li>

      <li class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <span class="text-primary text-4xl font-bold">2</span>
          <h3 class="card-title">Build a matching font</h3>
          <p class="text-base-content/70">
            A font is just a lookup table from character to shape. Your browser builds one where the
            table is shuffled to match, so the slot for one letter draws another.
          </p>
          <ul class="mt-3 flex flex-col gap-1.5 font-mono text-sm">
            @for (p of uniquePairs(); track p.stored) {
              <li class="flex items-center gap-2">
                <span class="text-base-content/50">slot</span>
                <span class="text-secondary w-5 text-center text-base">{{ p.stored }}</span>
                <span class="text-base-content/50">draws</span>
                <span class="text-primary font-sans text-base font-bold">{{ p.real }}</span>
              </li>
            }
          </ul>
        </div>
      </li>

      <li class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <span class="text-primary text-4xl font-bold">3</span>
          <h3 class="card-title">Eyes decode, code doesn't</h3>
          <p class="text-base-content/70">
            Your screen draws shapes, so you read the word. A scraper reads characters, so it gets
            the code.
          </p>
          <div class="mt-3 flex flex-col gap-3">
            <div class="rounded-field border-primary/30 bg-primary/5 border p-3">
              <p class="text-primary text-xs font-bold tracking-widest uppercase">You see</p>
              <p class="text-2xl font-bold break-all">{{ word() }}</p>
            </div>
            <div class="rounded-field border-secondary/30 bot-scan border p-3">
              <p class="text-secondary text-xs font-bold tracking-widest uppercase">A bot reads</p>
              <p class="text-secondary font-mono text-2xl break-all">{{ stored() }}</p>
            </div>
          </div>
        </div>
      </li>
    </ol>

    <p class="text-base-content/60 mt-6 max-w-3xl">
      All of this happens in the browser when the page loads, from a normal <code>.ttf</code> font
      you already use. There is no server component and no third-party service.
    </p>
  `,
})
export class HowItWorks {
  private readonly noAi = inject(NoAiFontService);

  protected readonly word = signal('Hello');

  protected readonly stored = computed(() => scrambleText(this.word(), this.noAi.map));

  protected readonly pairs = computed<readonly Pair[]>(() => {
    const real = [...this.word()];
    const stored = [...this.stored()];
    return real.map((r, i) => ({ real: r, stored: stored[i] }));
  });

  /** One row per scrambled character, spaces left out: they are never swapped. */
  protected readonly uniquePairs = computed<readonly Pair[]>(() => {
    const seen = new Set<string>();
    return this.pairs().filter((p) => {
      if (p.real === ' ' || seen.has(p.stored)) return false;
      seen.add(p.stored);
      return true;
    });
  });

  protected onType(event: Event): void {
    this.word.set((event.target as HTMLInputElement).value);
  }
}
