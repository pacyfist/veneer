import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A section's eyebrow, headline and lead.
 *
 * The lead is projected content so it can carry inline markup such as `<kbd>`.
 */
@Component({
  selector: 'app-section-heading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-10 max-w-2xl">
      <p class="text-primary mb-2 text-sm font-bold tracking-[0.14em] uppercase">
        {{ eyebrow() }}
      </p>
      <h2 class="text-3xl leading-tight font-bold tracking-tight md:text-4xl">{{ title() }}</h2>
      <div class="text-base-content/70 mt-3 text-lg leading-relaxed">
        <ng-content />
      </div>
    </div>
  `,
})
export class SectionHeading {
  readonly eyebrow = input.required<string>();
  readonly title = input.required<string>();
}
