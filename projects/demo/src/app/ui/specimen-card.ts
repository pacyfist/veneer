import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NoAiDirective, NoAiFontService } from '@pacyfist/no-ai';

/**
 * One protected sample plus its own status and scraper readout.
 *
 * Instantiated once per child EnvironmentInjector, so `NoAiDirective` inside it
 * resolves that injector's `NoAiFontService` rather than the shell's.
 *
 * `aria-hidden` is applied only while this instance actually ciphers. A
 * disabled or failed instance renders ordinary readable text, and hiding that
 * from assistive technology would impose the cost without the protection.
 */
@Component({
  selector: 'app-specimen-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NoAiDirective],
  template: `
    <div class="card bg-base-100 border-base-300 border">
      <div class="card-body gap-3">
        <div class="flex items-center justify-between">
          <span class="text-base-content/50 text-xs font-bold tracking-widest uppercase">
            Live sample
          </span>
          <span
            class="badge"
            [class.badge-primary]="noAi.active()"
            [class.badge-warning]="noAi.failed()"
          >
            {{ status() }}
          </span>
        </div>
        <p class="sr-only">
          A protected sample follows. It is stored scrambled and repaired on screen by a generated
          font.
        </p>
        <p
          class="text-lg leading-relaxed"
          [attr.aria-hidden]="noAi.active() ? 'true' : null"
          [noAi]="text()"
        ></p>
        <div class="rounded-field border-secondary/30 bot-scan border p-3">
          <p class="text-secondary text-xs font-bold tracking-widest uppercase">A bot reads</p>
          <p class="text-secondary mt-1 font-mono text-sm break-all">{{ botReads() }}</p>
        </div>
        @if (noAi.failed(); as message) {
          <p class="text-warning font-mono text-xs break-all">{{ message }}</p>
        }
      </div>
    </div>
  `,
})
export class SpecimenCard {
  protected readonly noAi = inject(NoAiFontService);
  readonly text = input.required<string>();

  protected readonly status = computed(() =>
    this.noAi.failed() ? 'unprotected, still readable' : this.noAi.active() ? 'protected' : 'off',
  );

  /** What `innerText` returns: the scrambled form, or the original once protection is off. */
  protected readonly botReads = computed(() => this.noAi.scramble(this.text()));
}
