import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { DEFAULT_CHARSET, VeneerConfig } from '@pacyfist/veneer';
import { SectionHeading } from '../ui/section-heading';
import { IsolatedInstance } from '../ui/isolated-instance';

type Mode = 'healthy' | 'no-font' | 'missing-glyph' | 'strict' | 'flash';

const SAMPLE = 'The page stays usable no matter which of these you pick.';

/**
 * ƀ and ƃ (Latin Extended-B). Roboto-Regular has no glyph for either. Two,
 * because a character with no swap partner is left unscrambled anyway.
 */
const UNCOVERED = [0x180, 0x183];

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
          <p class="text-base-content/70 text-sm">{{ current().detail }}</p>
        </div>
      </div>
      <app-isolated-instance [text]="sample()" [config]="config()" />
    </div>
  `,
})
export class Breakage {
  protected readonly mode = signal<Mode>('healthy');
  protected readonly sample = computed(() =>
    this.mode() === 'missing-glyph' || this.mode() === 'strict'
      ? `${SAMPLE} Even with ƀ and ƃ in it.`
      : SAMPLE,
  );

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
      label: 'Characters the font lacks',
      plain:
        "The font can't draw ƀ or ƃ, which the charset asks it to cover. Those two letters are left unscrambled and drawn in the fallback font; everything else stays protected.",
      detail:
        'strictCoverage: false, the default. Once the font loads, the library drops the characters it has no glyph for, redraws the cipher without them, re-scrambles the text and warns in dev mode (VNR014).',
    },
    {
      id: 'strict' as const,
      label: 'Strict coverage',
      plain:
        'The same font and charset with strictCoverage: true. The library refuses to guess and falls back to plain text.',
      detail:
        'forgeScrambledFont throws VeneerFontError listing the missing characters rather than silently showing a reader the wrong letter. The service catches it, sets failed() to code VNR012 with the missing characters, and the page fails open.',
    },
    {
      id: 'flash' as const,
      label: 'Slow network, no hiding',
      plain:
        "With hiding turned off, you'll see a two-second flash of gibberish while the font loads. That's why hiding is on by default.",
      detail:
        'hideUntilReady: false plus a font loader delayed by two seconds. Leave it on: visitors without JavaScript still get the text either way, scrambled.',
    },
  ];

  protected readonly current = computed(() => this.modes.find((m) => m.id === this.mode())!);

  protected readonly config = computed<Partial<VeneerConfig>>(() => {
    switch (this.mode()) {
      case 'no-font':
        return { font: () => Promise.reject(new Error('deliberately broken by the demo')) };
      case 'missing-glyph':
        return { charset: [...DEFAULT_CHARSET, ...UNCOVERED] };
      case 'strict':
        return { charset: [...DEFAULT_CHARSET, ...UNCOVERED], strictCoverage: true };
      case 'flash':
        return {
          hideUntilReady: false,
          font: async () => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const response = await fetch('fonts/Roboto-Regular.ttf');
            return response.arrayBuffer();
          },
        };
      default:
        return {};
    }
  });
}
