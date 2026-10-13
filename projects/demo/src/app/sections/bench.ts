import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  DEFAULT_CHARSET,
  LATIN_1,
  LATIN_EXT_A,
  VeneerConfig,
  charsetFromText,
} from '@pacyfist/veneer';
import { IsolatedInstance } from '../ui/isolated-instance';

const SAMPLE = 'Rendered with the settings on the left: Zażółć gęślą jaźń, Größe, façade, naïve.';

/**
 * `cafe` plus U+0301 COMBINING ACUTE ACCENT: five code points that look like
 * café. veneer NFC-normalizes text before scrambling, so the page holds one
 * letter for the é, which the cipher then treats like any other.
 */
const DECOMPOSED = ' And a decomposed cafe\u0301.';

type Charset = 'ascii' | 'latin' | 'latin1' | 'text' | 'letters' | 'digits';

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
              <option value="latin" selected>DEFAULT_CHARSET + LATIN_1 + LATIN_EXT_A</option>
              <option value="ascii">DEFAULT_CHARSET (ASCII)</option>
              <option value="latin1">DEFAULT_CHARSET + LATIN_1</option>
              <option value="text">charsetFromText(sample)</option>
              <option value="letters">ASCII letters only</option>
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

          <p class="text-base-content/70 text-xs leading-relaxed">
            With the Latin presets, accented letters scramble too, swapping only with other accented
            letters, and you still read them. With <code>DEFAULT_CHARSET</code> alone they stay as
            they are. <code>charsetFromText</code> lists just the characters a text uses.
          </p>
          <p class="text-base-content/70 text-xs leading-relaxed">
            Pick the mismatched fallback, then turn on <code>disabled</code>, to see why the
            fallback should name the same typeface as the base font: it draws the text whenever
            protection is off.
          </p>
        </div>
      </div>

      <app-isolated-instance
        [text]="sample"
        [config]="config()"
        [cardInputs]="{ codepoints: true }"
      />
    </div>
  `,
})
export class Bench {
  protected readonly sample = SAMPLE + DECOMPOSED;

  protected readonly charset = signal<Charset>('latin');
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
      case 'latin':
        return [...DEFAULT_CHARSET, ...LATIN_1, ...LATIN_EXT_A];
      case 'latin1':
        return [...DEFAULT_CHARSET, ...LATIN_1];
      case 'text':
        return charsetFromText(this.sample);
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
    this.charset.set((event.target as HTMLSelectElement).value as Charset);
  }

  protected onFallback(event: Event): void {
    this.fallback.set((event.target as HTMLSelectElement).value);
  }
}
