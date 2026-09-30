import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { VeneerDirective, VeneerFontService } from '@pacyfist/veneer';

/**
 * One protected sample plus its own status and scraper readout.
 *
 * Instantiated once per child EnvironmentInjector, so `VeneerDirective` inside it
 * resolves that injector's `VeneerFontService` rather than the shell's.
 *
 * `aria-hidden` is applied only while this instance actually ciphers. A
 * disabled or failed instance renders ordinary readable text, and hiding that
 * from assistive technology would impose the cost without the protection.
 */
@Component({
  selector: 'app-specimen-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VeneerDirective],
  template: `
    <div class="card bg-base-100 border-base-300 border">
      <div class="card-body gap-3">
        <div class="flex items-center justify-between">
          <span class="text-base-content/50 text-xs font-bold tracking-widest uppercase">
            Live sample
          </span>
          <span
            class="badge"
            [class.badge-primary]="veneer.active()"
            [class.badge-warning]="veneer.failed()"
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
          [attr.aria-hidden]="veneer.active() ? 'true' : null"
          [veneer]="text()"
        ></p>
        <div class="rounded-field border-secondary/30 bot-scan border p-3">
          <p class="text-secondary text-xs font-bold tracking-widest uppercase">A bot reads</p>
          <p class="text-secondary mt-1 font-mono text-sm break-all">{{ botReads() }}</p>
        </div>
        @if (veneer.failed(); as message) {
          <p class="text-warning font-mono text-xs break-all">{{ message }}</p>
        }
      </div>
    </div>
  `,
})
export class SpecimenCard {
  protected readonly veneer = inject(VeneerFontService);
  readonly text = input.required<string>();

  protected readonly status = computed(() =>
    this.veneer.failed()
      ? 'unprotected, still readable'
      : this.veneer.active()
        ? 'protected'
        : 'off',
  );

  /** What `innerText` returns: the scrambled form, or the original once protection is off. */
  protected readonly botReads = computed(() => this.veneer.scramble(this.text()));
}
