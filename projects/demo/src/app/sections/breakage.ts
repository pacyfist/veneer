import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { DEFAULT_CHARSET, VeneerConfig } from '@pacyfist/veneer';
import { SectionHeading } from '../ui/section-heading';
import { IsolatedInstance } from '../ui/isolated-instance';
import { baseFontBuffer } from '../font-source';

type Mode = 'healthy' | 'no-font' | 'missing-glyph' | 'flash';

const SAMPLE = 'The page stays usable no matter which of these you pick.';

/** Controls that genuinely break the library, rather than describing breakage. */
@Component({
  selector: 'app-breakage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading, IsolatedInstance],
  template: `
    <app-section-heading eyebrow="It fails safe" title="Worst case: your text is just text">
      If the decoder font can't be built, protected text quietly turns back into ordinary readable
      text. Unprotected is the worst case, never unreadable. These buttons really break it.
    </app-section-heading>

    <div class="mb-4 flex flex-wrap gap-2">
      @for (m of modes; track m.id) {
        <button class="btn" [class.btn-primary]="mode() === m.id" (click)="mode.set(m.id)">
          {{ m.label }}
        </button>
      }
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <h3 class="card-title">{{ current().label }}</h3>
          <p class="text-base-content/80 text-lg">{{ current().plain }}</p>
          <p class="text-base-content/50 text-sm">{{ current().detail }}</p>
        </div>
      </div>
      <app-isolated-instance [text]="sample" [config]="config()" />
    </div>
  `,
})
export class Breakage {
  protected readonly sample = SAMPLE;
  protected readonly mode = signal<Mode>('healthy');

  protected readonly modes = [
    {
      id: 'healthy' as const,
      label: 'Working normally',
      plain: 'The decoder font loads and the text is protected.',
      detail: 'The baseline, for comparison.',
    },
    {
      id: 'no-font' as const,
      label: "Font won't load",
      plain: 'Protection switches off and the real text is put back. Readers notice nothing.',
      detail:
        'The font request fails. The library logs an error, sets failed(), and every veneer element restores its original text.',
    },
    {
      id: 'missing-glyph' as const,
      label: 'Character the font lacks',
      plain:
        "The font can't draw an emoji it was asked to cover, so the library refuses to guess and falls back to plain text.",
      detail:
        'forgeScrambledFont throws VeneerFontError listing the missing characters rather than silently showing a reader the wrong letter. The throw is caught, so the page fails open.',
    },
    {
      id: 'flash' as const,
      label: 'Slow network, no hiding',
      plain:
        "With hiding turned off, you'll see a two-second flash of gibberish while the font loads. That's why hiding is on by default.",
      detail:
        'hideUntilReady: false plus a font loader delayed by two seconds. Leave it on unless visitors without JavaScript seeing nothing is worse for you than a brief flash.',
    },
  ];

  protected readonly current = computed(() => this.modes.find((m) => m.id === this.mode())!);

  protected readonly config = computed<Partial<VeneerConfig>>(() => {
    switch (this.mode()) {
      case 'no-font':
        return { font: () => Promise.reject(new Error('deliberately broken by the demo')) };
      case 'missing-glyph':
        // U+1F600 GRINNING FACE. Roboto-Regular has no glyph for it.
        return { charset: [...DEFAULT_CHARSET, 0x1f600] };
      case 'flash':
        return {
          hideUntilReady: false,
          font: async () => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return baseFontBuffer();
          },
        };
      default:
        return {};
    }
  });
}
