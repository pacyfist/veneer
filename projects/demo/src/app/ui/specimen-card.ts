import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { VeneerDirective, VeneerFontService } from '@pacyfist/veneer';
import { A11yNote } from './a11y-note';
import { DomProbe } from './dom-probe';

/**
 * One protected sample plus its own status and scraper readout.
 *
 * Instantiated once per child EnvironmentInjector, so `VeneerDirective` inside it
 * resolves that injector's `VeneerFontService` rather than the shell's.
 *
 * `aria-hidden` comes from `withA11y('hide')` on the instance (see
 * IsolatedInstance): set only while the instance actually ciphers, so a
 * disabled or failed instance's readable text stays available to assistive
 * technology.
 */
@Component({
  selector: 'app-specimen-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VeneerDirective, DomProbe, A11yNote],
  template: `
    <div class="card bg-base-100 border-base-300 border">
      <div class="card-body gap-3">
        <div class="flex items-center justify-between">
          <span class="text-base-content/70 text-xs font-bold tracking-widest uppercase">
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
        <p class="text-lg leading-relaxed" [veneer]="text()" appDomProbe #probe="domProbe"></p>
        <div class="rounded-field border-secondary/30 bot-scan border p-3">
          <p class="text-secondary text-xs font-bold tracking-widest uppercase">A bot reads</p>
          <p class="text-secondary mt-1 font-mono text-sm break-all">{{ botReads() }}</p>
          <app-a11y-note [hidden]="probe.ariaHidden()" />
          @if (codepoints() && probe.text() !== null) {
            <p class="text-base-content/70 mt-2 text-xs" data-testid="codepoints">
              {{ count(text()) }} code points in the text, {{ count(probe.text()!) }} in the page.
            </p>
          }
        </div>
        @if (veneer.failed(); as failure) {
          <p class="text-warning font-mono text-xs break-all">
            {{ failure.code }}: {{ failure.message }}
          </p>
        }
      </div>
    </div>
  `,
})
export class SpecimenCard {
  protected readonly veneer = inject(VeneerFontService);
  readonly text = input.required<string>();
  /** Show how many code points the text has, and how many the DOM holds. */
  readonly codepoints = input(false);

  protected readonly status = computed(() =>
    this.veneer.failed()
      ? 'unprotected, still readable'
      : this.veneer.active()
        ? 'protected'
        : 'off',
  );

  /** What `innerText` returns: the scrambled form, or the original once protection is off. */
  protected readonly botReads = computed(() => this.veneer.scramble(this.text()));

  protected count(text: string): number {
    return [...text].length;
  }
}
