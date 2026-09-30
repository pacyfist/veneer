import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { buildScrambleMap, invertScrambleMap, scrambleText } from '@pacyfist/no-ai';
import { CodeBlock } from '../ui/code-block';

const SEED = 12345;

/** The framework-free core, running the same code the snippet shows. */
@Component({
  selector: 'app-beyond-angular',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodeBlock],
  template: `
    <p class="text-base-content/70 mb-4 max-w-3xl">
      The cipher has no framework in it. The same functions run in the browser, in an SSR process
      and in a plain Node script that pre-scrambles static content at build time.
    </p>

    <div class="grid gap-3 md:grid-cols-2">
      <div class="card bg-base-200/60">
        <div class="card-body p-4">
          <h3 class="card-title mb-2 text-xs">node</h3>
          <app-code-block [lines]="snippet" />
        </div>
      </div>
      <div class="card bg-base-200/60">
        <div class="card-body p-4">
          <h3 class="card-title justify-between text-xs">
            output
            <span class="badge badge-primary badge-sm">round trip</span>
          </h3>
          <label class="mt-2 flex flex-col gap-1 text-xs">
            <span class="text-base-content/50 tracking-widest uppercase">input</span>
            <input class="input input-sm" [value]="input()" (input)="onType($event)" />
          </label>
          <div class="mt-3">
            <div class="text-base-content/50 text-xs tracking-widest uppercase">scrambleText</div>
            <p class="text-primary mt-1 font-mono text-xs break-all">{{ scrambled() }}</p>
          </div>
          <div class="mt-3">
            <div class="text-base-content/50 text-xs tracking-widest uppercase">
              invertScrambleMap
            </div>
            <p class="mt-1 font-mono text-xs break-all">{{ restored() }}</p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class BeyondAngular {
  protected readonly snippet = [
    "import { buildScrambleMap, scrambleText } from '@pacyfist/no-ai';",
    '',
    `const map = buildScrambleMap(${SEED});`,
    "scrambleText('Hello, world', map);",
  ];

  private readonly map = buildScrambleMap(SEED);

  protected readonly input = signal('Hello, world');
  protected readonly scrambled = computed(() => scrambleText(this.input(), this.map));
  protected readonly restored = computed(() =>
    scrambleText(this.scrambled(), invertScrambleMap(this.map)),
  );

  protected onType(event: Event): void {
    this.input.set((event.target as HTMLInputElement).value);
  }
}
