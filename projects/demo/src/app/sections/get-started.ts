import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SectionHeading } from '../ui/section-heading';
import { CodeBlock } from '../ui/code-block';
import { VeneerDirective } from '@pacyfist/veneer';
import { ApplyTabs } from './apply-tabs';

/**
 * Snippets live here rather than inline in the template: an Angular template
 * would parse any `{{ }}` inside them as interpolation.
 */
const INSTALL = ['npm install @pacyfist/veneer'];

const CONFIG = [
  "import { provideVeneer } from '@pacyfist/veneer';",
  '',
  'export const appConfig: ApplicationConfig = {',
  '  providers: [',
  '    provideVeneer({',
  "      font: 'fonts/Roboto-Regular.ttf',",
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
  imports: [SectionHeading, CodeBlock, ApplyTabs, VeneerDirective],
  template: `
    <app-section-heading eyebrow="Get started" title="Add it to your Angular app in three steps">
      Works with standalone components, signals, server-side rendering and hydration. No stylesheet
      to copy and no build plugin.
    </app-section-heading>

    <ol class="flex flex-col gap-10">
      <li class="grid gap-4 md:grid-cols-[16rem_1fr]">
        <div>
          <span class="badge badge-primary badge-lg mb-2">Step 1</span>
          <h3 class="text-xl font-bold">Install it</h3>
          <p class="text-base-content/70 mt-1">
            Also put a <strong>.ttf</strong>, <strong>.otf</strong> or <strong>.woff</strong> copy
            of your body font in <code>public/fonts/</code>. WOFF2 needs converting first.
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
            shows while the font loads and covers characters your font lacks. Keep the path relative
            (no leading slash) so it resolves against <code>&lt;base href&gt;</code> and still works
            when the app is deployed under a subpath.
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

      <div class="rounded-box border-base-300 bg-base-100 mt-6 border p-5">
        <h4 class="text-lg font-bold">Markup inside is fine</h4>
        <p class="mt-2 text-lg leading-relaxed" veneer>
          Links, <strong>bold</strong> and <em>italic</em> words keep working inside a protected
          paragraph, like <a class="link link-primary" href="#how">this one</a>. Only the text is
          scrambled.
        </p>
        <p class="text-base-content/60 mt-2 text-sm">
          The attribute rewrites each text node in place and leaves the elements alone.
          <code>code</code> elements and anything marked <code>veneer-skip</code> stay readable. For
          HTML from a CMS, bind it with <code>[veneerHtml]</code>, which sanitizes it first.
        </p>
      </div>
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
