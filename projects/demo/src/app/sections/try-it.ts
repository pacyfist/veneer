import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NoAiDirective, NoAiFontService } from '@pacyfist/no-ai';
import { SectionHeading } from '../ui/section-heading';
import { MirrorPanel } from '../ui/mirror-panel';
import { ServedSource } from './served-source';

const COPY_ME = 'Copy this sentence and paste it anywhere you like.';

/**
 * The word the search challenge hides. It must not appear readable anywhere
 * else on the page, screen-reader-only text included, or find-in-page would
 * succeed and the challenge would prove nothing.
 */
const NEEDLE = 'haystack';

/**
 * Challenges where the visitor's own clipboard, their own find-in-page and a
 * real HTTP request produce the evidence, so none of it rests on our word.
 */
@Component({
  selector: 'app-try-it',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading, NoAiDirective, MirrorPanel, ServedSource],
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <app-section-heading eyebrow="Try it yourself" title="Don't take our word for it">
      Everything below happens in your browser, using your clipboard and your search box. Nothing is
      faked.
    </app-section-heading>

    <div class="grid items-start gap-4 md:grid-cols-2">
      <!-- Copy -->
      <div class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <h3 class="card-title">1. Copy it</h3>
          <p class="sr-only">A protected sentence you are invited to copy follows.</p>
          <!-- Element content, not an interpolation: {{ }} inside a noAi element
               is the documented trap. The constant is spliced in at compile time
               so this and the clipboard readout cannot drift apart. -->
          <p
            #copyTarget
            class="rounded-field bg-base-200 p-3 text-lg"
            aria-hidden="true"
            noAi
            (copy)="onCopy()"
          >
            ${COPY_ME}
          </p>
          <div class="flex items-center gap-3">
            <button type="button" class="btn btn-sm btn-primary" (click)="copyForMe()">
              Copy it for me
            </button>
            <span class="text-base-content/50 text-sm">or select it and press Ctrl+C</span>
          </div>
          <div class="rounded-field border-secondary/30 bot-scan mt-2 border p-3">
            <p class="text-secondary text-xs font-bold tracking-widest uppercase">Your clipboard</p>
            @if (copied(); as taken) {
              <p class="text-secondary mt-1 font-mono break-all">{{ taken }}</p>
            } @else {
              <p class="text-base-content/40 mt-1 text-sm">Waiting for you to copy…</p>
            }
          </div>
          <p class="text-base-content/60 text-sm">
            That's what ends up in a chatbot when someone pastes your article into it.
          </p>
        </div>
      </div>

      <!-- Search -->
      <div class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <h3 class="card-title">2. Search for it</h3>
          <p class="sr-only">A protected sentence naming a word to search for follows.</p>
          <p class="rounded-field bg-base-200 p-3 text-lg" aria-hidden="true" noAi>
            Find the word haystack on this page.
          </p>
          <p class="text-base-content/70">
            Press <kbd class="kbd kbd-sm">Ctrl</kbd> + <kbd class="kbd kbd-sm">F</kbd> (or
            <kbd class="kbd kbd-sm">⌘</kbd> + <kbd class="kbd kbd-sm">F</kbd>) and type the word
            from the line above.
          </p>
          @if (searched()) {
            <div class="rounded-field border-secondary/30 bot-scan border p-3">
              <p class="text-secondary text-xs font-bold tracking-widest uppercase">
                0 results, right?
              </p>
              <p class="mt-1 text-sm">
                Your browser searches the page's text, and the page doesn't contain that word. It
                contains <code class="text-secondary font-mono">{{ needleScrambled() }}</code>
                instead.
              </p>
            </div>
          } @else {
            <button
              type="button"
              class="btn btn-sm btn-ghost self-start"
              (click)="searched.set(true)"
            >
              I tried it
            </button>
          }
        </div>
      </div>

      <!-- Type -->
      <div class="card bg-base-100 border-base-300 border md:col-span-2">
        <div class="card-body">
          <h3 class="card-title">3. Type your own</h3>
          <input
            class="input input-lg w-full"
            [value]="text()"
            (input)="onType($event)"
            aria-label="Text to protect"
            placeholder="Type something…"
          />
          <app-mirror-panel [readable]="text()" [scrambled]="scrambled()" />
        </div>
      </div>

      <!-- Served HTML -->
      <div class="card bg-base-100 border-base-300 border md:col-span-2">
        <div class="card-body">
          <h3 class="card-title">4. Look at what a crawler downloads</h3>
          <p class="text-base-content/70">
            This box downloads this very page again, the way a scraper would, and shows the hero
            paragraph exactly as the server sent it, before any JavaScript runs.
          </p>
          <app-served-source />
        </div>
      </div>
    </div>
  `,
})
export class TryIt {
  private readonly document = inject(DOCUMENT);
  private readonly noAi = inject(NoAiFontService);

  private readonly copyTarget = viewChild.required<ElementRef<HTMLElement>>('copyTarget');

  protected readonly copied = signal('');
  protected readonly searched = signal(false);
  protected readonly text = signal('My secret sauce recipe');

  protected readonly scrambled = computed(() => this.noAi.scramble(this.text()));
  protected readonly needleScrambled = computed(() => this.noAi.scramble(NEEDLE));

  protected onCopy(): void {
    // Read the selection rather than the clipboard: no permission prompt, and
    // a partial selection is reported honestly instead of being called a miss.
    this.copied.set(this.document.getSelection()?.toString() ?? '');
  }

  /** Selects the sentence and copies it, exactly as a person would. */
  protected copyForMe(): void {
    const selection = this.document.getSelection();
    if (!selection) return;
    const range = this.document.createRange();
    range.selectNodeContents(this.copyTarget().nativeElement);
    selection.removeAllRanges();
    selection.addRange(range);

    const taken = selection.toString();
    this.copied.set(taken);
    navigator.clipboard?.writeText(taken).catch(() => {
      // Clipboard access denied. The readout above already shows what would
      // have been copied, which is the point.
    });
  }

  /** Reveals the search explanation shortly after find-in-page opens. */
  protected onKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      setTimeout(() => this.searched.set(true), 2500);
    }
  }

  protected onType(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
  }
}
