import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { DEFAULT_CHARSET, VeneerConfig } from '@pacyfist/veneer';
import { IsolatedInstance } from '../ui/isolated-instance';

const SAMPLE = 'Rendered with the settings on the left. Accents like cafe and naive pass through.';

/** Every config option, wired to one live instance in its own injector. */
@Component({
  selector: 'app-bench',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IsolatedInstance],
  template: `
    <p class="text-base-content/70 mb-4 max-w-3xl">
      The sample on the right has its own <code>provideVeneer()</code> and its own generated font.
      Change a setting and only it changes.
    </p>

    <div class="grid gap-3 md:grid-cols-2">
      <div class="card bg-base-200/60">
        <div class="card-body gap-3 p-4">
          <h3 class="card-title text-xs">provideVeneer()</h3>

          <label class="flex items-center gap-3 text-xs">
            <span class="w-32">charset</span>
            <select class="select select-sm flex-1" (change)="onCharset($event)">
              <option value="ascii">printable ASCII, no space</option>
              <option value="letters">letters only</option>
              <option value="digits">digits only</option>
            </select>
          </label>

          <label class="flex items-center gap-3 text-xs">
            <span class="w-32">hideUntilReady</span>
            <input
              type="checkbox"
              class="toggle toggle-sm"
              [checked]="hideUntilReady()"
              (change)="hideUntilReady.set(!hideUntilReady())"
            />
          </label>

          <label class="flex items-center gap-3 text-xs">
            <span class="w-32">disabled</span>
            <input
              type="checkbox"
              class="toggle toggle-sm"
              [checked]="disabled()"
              (change)="disabled.set(!disabled())"
            />
          </label>

          <label class="flex items-center gap-3 text-xs">
            <span class="w-32">fallback family</span>
            <select class="select select-sm flex-1" (change)="onFallback($event)">
              <option value="'Roboto', sans-serif">Roboto (matches)</option>
              <option value="Georgia, serif">Georgia (deliberate mismatch)</option>
            </select>
          </label>

          <p class="text-base-content/50 text-xs leading-relaxed">
            Pick the mismatched fallback to see why the base font has to be the one your body text
            already uses. Characters outside the charset fall back, and they stop matching their
            neighbours.
          </p>
        </div>
      </div>

      <app-isolated-instance [text]="sample" [config]="config()" />
    </div>
  `,
})
export class Bench {
  protected readonly sample = SAMPLE;

  protected readonly charset = signal<'ascii' | 'letters' | 'digits'>('ascii');
  protected readonly hideUntilReady = signal(true);
  protected readonly disabled = signal(false);
  protected readonly fallback = signal("'Roboto', sans-serif");

  protected readonly config = computed<Partial<VeneerConfig>>(() => ({
    charset: this.charsetCodes(),
    hideUntilReady: this.hideUntilReady(),
    disabled: this.disabled(),
    fallbackFontFamily: this.fallback(),
  }));

  private charsetCodes(): readonly number[] {
    switch (this.charset()) {
      case 'letters':
        return [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'].map((c) =>
          c.codePointAt(0)!,
        );
      case 'digits':
        return [...'0123456789'].map((c) => c.codePointAt(0)!);
      default:
        return DEFAULT_CHARSET;
    }
  }

  protected onCharset(event: Event): void {
    this.charset.set((event.target as HTMLSelectElement).value as 'ascii' | 'letters' | 'digits');
  }

  protected onFallback(event: Event): void {
    this.fallback.set((event.target as HTMLSelectElement).value);
  }
}
