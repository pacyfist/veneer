import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NoAiFontDirective, NoAiPipe } from '@pacyfist/no-ai';

/**
 * The same text as a person sees it and as a scraper reads it, side by side.
 *
 * The left card is genuinely protected. It has to be: a plain readable
 * paragraph there would make this a claim rather than a demonstration.
 *
 * It uses the pipe with `noAiFont` rather than the `noAi` directive because the
 * text is bound and changes as the visitor types. The directive owns
 * `textContent` and would fight the binding.
 */
@Component({
  selector: 'app-mirror-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NoAiFontDirective, NoAiPipe],
  template: `
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="rounded-box border-primary/30 bg-primary/5 border p-4">
        <p class="text-primary mb-2 text-xs font-bold tracking-widest uppercase">You see</p>
        <p class="min-h-6 text-lg leading-relaxed break-words" aria-hidden="true" noAiFont>
          {{ readable() | noAi }}
        </p>
        <p class="sr-only">
          A protected copy of your text. It is stored scrambled and repaired on screen by a
          generated font.
        </p>
      </div>
      <div class="rounded-box border-secondary/30 bot-scan border p-4">
        <p class="text-secondary mb-2 text-xs font-bold tracking-widest uppercase">A bot reads</p>
        <p class="text-secondary min-h-6 font-mono text-base leading-relaxed break-all">
          {{ scrambled() }}
        </p>
      </div>
    </div>
  `,
})
export class MirrorPanel {
  readonly readable = input.required<string>();
  readonly scrambled = input.required<string>();
}
