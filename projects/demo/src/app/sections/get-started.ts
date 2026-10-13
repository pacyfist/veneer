import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SectionHeading } from '../ui/section-heading';
import { CodeBlock } from '../ui/code-block';
import { VeneerDirective } from '@pacyfist/veneer';
import { ApplyTabs } from './apply-tabs';
import { CmsHtml } from './cms-html';

/**
 * Snippets live here rather than inline in the template: an Angular template
 * would parse any `{{ }}` inside them as interpolation.
 *
 * They are the root README's "Get started" code blocks, line for line;
 * e2e/snippets.spec.ts fails when the two drift apart.
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
  'export class Article {}',
];

const SERVER_CONFIG = [
  '// app.config.server.ts',
  "import { provideVeneerServer } from '@pacyfist/veneer/server';",
  "import { join } from 'node:path';",
  '',
  'const serverConfig: ApplicationConfig = {',
  '  providers: [',
  '    provideServerRendering(withRoutes(serverRoutes)),',
  "    provideVeneerServer({ fonts: join(import.meta.dirname, '../browser') }),",
  '  ],',
  '};',
];

const SERVER_TS = [
  '// server.ts, before the Angular request handler',
  "import { veneerFontMiddleware } from '@pacyfist/veneer/server';",
  '',
  'app.use(veneerFontMiddleware());',
];

@Component({
  selector: 'app-get-started',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading, CodeBlock, ApplyTabs, CmsHtml, VeneerDirective],
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

      <li class="grid gap-4 md:grid-cols-[16rem_1fr]">
        <div>
          <span class="badge badge-outline badge-lg mb-2">Server-rendered apps</span>
          <h3 class="text-xl font-bold">Add the server half</h3>
          <p class="text-base-content/70 mt-1">
            Without it the server renders protected text readable. With it, the server forges the
            font and serves it, and the page carries only the font's URL, never the key. Prerendered
            sites copy the forged fonts into the build output once, after the build.
          </p>
        </div>
        <div class="flex flex-col gap-3">
          <app-code-block [lines]="serverConfig" />
          <app-code-block [lines]="serverTs" />
        </div>
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
        <p class="text-base-content/70 mt-2 text-sm">
          The attribute rewrites each text node in place and leaves the elements alone.
          <code>code</code> elements and anything marked <code>veneer-skip</code> stay readable.
        </p>

        <h4 class="mt-6 text-lg font-bold">HTML from a CMS: <code>[veneerHtml]</code></h4>
        <p class="text-base-content/70 mt-1 mb-3 text-sm">
          Bind the HTML and veneer sanitizes it first, then protects its text.
        </p>
        <app-cms-html />
      </div>
    </div>
  `,
})
export class GetStarted {
  protected readonly install = INSTALL;
  protected readonly config = CONFIG;
  protected readonly use = USE;
  protected readonly serverConfig = SERVER_CONFIG;
  protected readonly serverTs = SERVER_TS;

  /** Held as a field so the braces are not parsed as an interpolation. */
  protected readonly braces = '{{ }}';
}
