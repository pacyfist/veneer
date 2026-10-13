import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  Type,
  afterNextRender,
  computed,
  createEnvironmentInjector,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { VeneerConfig, VeneerFeature, provideVeneer, withA11y } from '@pacyfist/veneer';
import { SpecimenCard } from './specimen-card';

/**
 * Renders one specimen under its own `provideVeneer`.
 *
 * The child injector is built only in the browser, after the first render -
 * never during prerender. The server forges only the shell's font, so an
 * instance rendered there would have no font to hydrate with; this one draws
 * its own cipher from the CSPRNG, with no seed, like any client-only app.
 *
 * `config` is watched with an `effect` rather than derived with `computed`,
 * because building the injector is a side effect: the previous injector, its
 * `VeneerFontService`, and the `FontFace` it registered must be torn down
 * before a replacement is built, or every config change leaks one of each.
 */
@Component({
  selector: 'app-isolated-instance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet],
  template: `
    @if (injector(); as env) {
      <ng-container
        [ngComponentOutlet]="card()"
        [ngComponentOutletEnvironmentInjector]="env"
        [ngComponentOutletInputs]="inputs()"
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
  /** The text a `SpecimenCard` protects. Other cards bring their own. */
  readonly text = input<string>();
  readonly config = input<Partial<VeneerConfig>>({});
  /** Features beyond `withA11y('hide')`, which every instance gets. */
  readonly features = input<readonly VeneerFeature[]>([]);
  /** The component rendered inside the instance's injector. */
  readonly card = input<Type<unknown>>(SpecimenCard);
  /** More inputs for `card`. */
  readonly cardInputs = input<Record<string, unknown>>({});

  protected readonly injector = signal<EnvironmentInjector | null>(null);
  protected readonly inputs = computed(() => {
    const text = this.text();
    return text === undefined ? this.cardInputs() : { text, ...this.cardInputs() };
  });

  private readonly parent = inject(EnvironmentInjector);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const browserReady = signal(false);

    afterNextRender(() => browserReady.set(true));

    effect(() => {
      if (!browserReady()) return;
      const config = this.config();
      const features = this.features();
      untracked(() => this.rebuild(config, features));
    });

    destroyRef.onDestroy(() => untracked(this.injector)?.destroy());
  }

  private rebuild(config: Partial<VeneerConfig>, features: readonly VeneerFeature[]): void {
    untracked(this.injector)?.destroy();

    const child = createEnvironmentInjector(
      [
        provideVeneer(
          {
            // The library fetches and parses each URL once per page, so every
            // instance shares the shell's download.
            font: 'fonts/Roboto-Regular.ttf',
            fallbackFontFamily: "'Roboto', sans-serif",
            ...config,
          },
          withA11y('hide'),
          ...features,
        ),
      ],
      this.parent,
    );

    this.injector.set(child);
  }
}
