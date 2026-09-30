import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SectionHeading } from '../ui/section-heading';
import { CodeBlock } from '../ui/code-block';
import { ApplyTabs } from './apply-tabs';

/**
 * Snippets live here rather than inline in the template: an Angular template
 * would parse any `{{ }}` inside them as interpolation.
 */
const INSTALL = ['npm install @pacyfist/veneer opentype.js'];

const CONFIG = [
  "import { provideVeneer } from '@pacyfist/veneer';",
  '',
  'export const appConfig: ApplicationConfig = {',
  '  providers: [',
  '    provideVeneer({',
  "      font: '/fonts/Roboto-Regular.ttf',",
  '      fallbackFontFamily: "\'Roboto\', sans-serif",',
  '    }),',
  '  ],',
  '};',
];

const USE = [
  "import { VeneerDirective } from '@pacyfist/veneer';",
  '',
  '@Component({',
  '  imports: [VeneerDirective],',
  '  template: `<p veneer>Scrapers get gibberish here.</p>`,',
  '})',
];

@Component({
  selector: 'app-get-started',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading, CodeBlock, ApplyTabs],
  template: `
    <app-section-heading eyebrow="Get started" title="Three steps, about two minutes">
      No stylesheet to copy and no build plugin. If your app already uses Angular, you're most of
      the way there.
    </app-section-heading>

    <ol class="flex flex-col gap-10">
      <li class="grid gap-4 md:grid-cols-[16rem_1fr]">
        <div>
          <span class="badge badge-primary badge-lg mb-2">Step 1</span>
          <h3 class="text-xl font-bold">Install it</h3>
          <p class="text-base-content/70 mt-1">
            Also put a <strong>.ttf</strong> or <strong>.otf</strong> copy of your body font in
            <code>public/fonts/</code>. WOFF and WOFF2 won't work.
          </p>
        </div>
        <app-code-block prefix="shell" [lines]="install" />
      </li>

      <li class="grid gap-4 md:grid-cols-[16rem_1fr]">
        <div>
          <span class="badge badge-primary badge-lg mb-2">Step 2</span>
          <h3 class="text-xl font-bold">Point it at your font</h3>
          <p class="text-base-content/70 mt-1">
            Use the same typeface your page already uses, so protected text blends in. The fallback
            covers characters that aren't scrambled, like spaces.
          </p>
        </div>
        <app-code-block file="app.config.ts" [lines]="config" />
      </li>

      <li class="grid gap-4 md:grid-cols-[16rem_1fr]">
        <div>
          <span class="badge badge-primary badge-lg mb-2">Step 3</span>
          <h3 class="text-xl font-bold">Mark your text</h3>
          <p class="text-base-content/70 mt-1">
            Add <code>veneer</code> to any element. That's it. People read it, and
            <code>innerText</code> gets noise.
          </p>
        </div>
        <app-code-block file="article.component.ts" [lines]="use" />
      </li>
    </ol>

    <div class="mt-16">
      <h3 class="text-2xl font-bold">Which form do I use?</h3>
      <p class="text-base-content/70 mt-2 mb-6 max-w-2xl text-lg">
        Rule of thumb:
        <strong
          >if you see <code>{{ braces }}</code
          >, use the pipe.</strong
        >
        Otherwise, use the attribute. Each tab below runs live, with what a bot would read
        underneath.
      </p>
      <app-apply-tabs />
    </div>
  `,
})
export class GetStarted {
  protected readonly install = INSTALL;
  protected readonly config = CONFIG;
  protected readonly use = USE;

  /** Held as a field so the braces are not parsed as an interpolation. */
  protected readonly braces = '{{ }}';
}
