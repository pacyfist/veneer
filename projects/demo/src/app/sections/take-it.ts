import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CodeBlock } from '../ui/code-block';

/** The closing call to action, including a fast no. */
@Component({
  selector: 'app-take-it',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodeBlock],
  template: `
    <div class="mx-auto max-w-2xl text-center">
      <h2 class="text-4xl leading-tight font-bold tracking-tight md:text-5xl">
        Give the bots <span class="text-secondary font-mono tracking-normal">g!bb3r$h</span>.
      </h2>
      <p class="text-base-content/70 mt-4 text-lg">
        A free, open-source Angular library. Needs Angular 21.2+, opentype.js 2, and a .ttf or .otf
        font you're allowed to embed.
      </p>
      <div class="mt-8 text-left">
        <app-code-block prefix="shell" [lines]="install" />
      </div>
      <div class="mt-6 flex flex-wrap justify-center gap-3">
        <a class="btn btn-primary btn-lg" href="https://github.com/pacyfist/veneer">
          View on GitHub
        </a>
        <a
          class="btn btn-ghost btn-lg"
          href="https://github.com/pacyfist/veneer/tree/main/projects/pacyfist/veneer#readme"
        >
          Read the docs
        </a>
      </div>

      <div class="rounded-box border-warning/50 bg-base-100 mt-10 border p-5 text-left">
        <p>
          <strong class="text-warning">License: AGPL-3.0.</strong> If you use this on a public
          website, that site's source code has to be released under the same license. That's on
          purpose. Better a fast no here than a surprise later.
        </p>
      </div>
    </div>
  `,
})
export class TakeIt {
  protected readonly install = ['npm install @pacyfist/veneer opentype.js'];
}
