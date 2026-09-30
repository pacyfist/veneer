import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  afterNextRender,
  createEnvironmentInjector,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NoAiConfig, provideNoAi, randomSeed } from '@pacyfist/no-ai';
import { baseFontBuffer } from '../font-source';
import { SpecimenCard } from './specimen-card';

/**
 * Renders one specimen under its own `provideNoAi`.
 *
 * The child injector is built only in the browser, after the first render -
 * never during prerender. A seed drawn on the server and drawn again on the
 * client would invert the server's ciphertext with the wrong map at
 * hydration, so a server-rendered instance shows nothing until the browser
 * can build and keep its own cipher.
 *
 * `config` is watched with an `effect` rather than derived with `computed`,
 * because building the injector is a side effect: the previous injector, its
 * `NoAiFontService`, and the `FontFace` it registered must be torn down
 * before a replacement is built, or every config change leaks one of each.
 */
@Component({
  selector: 'app-isolated-instance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet],
  template: `
    @if (injector(); as env) {
      <ng-container
        [ngComponentOutlet]="card"
        [ngComponentOutletEnvironmentInjector]="env"
        [ngComponentOutletInputs]="{ text: text() }"
      />
    } @else {
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body gap-3 p-4">
          <div class="skeleton h-4 w-24"></div>
          <div class="skeleton h-10 w-full"></div>
          <div class="skeleton h-3 w-20"></div>
        </div>
      </div>
    }
  `,
})
export class IsolatedInstance {
  readonly text = input.required<string>();
  readonly config = input<Partial<NoAiConfig>>({});

  protected readonly card = SpecimenCard;
  protected readonly injector = signal<EnvironmentInjector | null>(null);

  private readonly parent = inject(EnvironmentInjector);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const browserReady = signal(false);

    afterNextRender(() => browserReady.set(true));

    effect(() => {
      if (!browserReady()) return;
      const config = this.config();
      untracked(() => this.rebuild(config));
    });

    destroyRef.onDestroy(() => untracked(this.injector)?.destroy());
  }

  private rebuild(config: Partial<NoAiConfig>): void {
    untracked(this.injector)?.destroy();

    const child = createEnvironmentInjector(
      [
        provideNoAi({
          font: baseFontBuffer,
          fallbackFontFamily: "'Roboto', sans-serif",
          seed: randomSeed(),
          ...config,
        }),
      ],
      this.parent,
    );

    this.injector.set(child);
  }
}
