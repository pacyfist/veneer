import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { VeneerFontService } from '@pacyfist/veneer';

/**
 * Whether a protected element is hidden from screen readers right now, read
 * from its `aria-hidden` attribute (a DomProbe), and why. `withA11y('hide')`
 * hides scrambled text and shows it again in readable mode, on fail-open, and
 * never over a link or other focusable content.
 */
@Component({
  selector: 'app-a11y-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Always there, so the line does not appear (and shift the layout) on hydration. -->
    <p class="text-base-content/70 mt-2 min-h-4 text-xs" data-testid="a11y">
      @if (hidden() === null) {
      } @else if (hidden()) {
        Screen readers: skipped (<code>aria-hidden="true"</code>) while it is scrambled.
      } @else if (veneer.readable()) {
        Screen readers: read it, readable mode is on.
      } @else if (!veneer.active()) {
        Screen readers: read it, the text is readable.
      } @else if (focusable()) {
        Screen readers: read it scrambled. It contains a link, which
        <code>aria-hidden</code> must not hide.
      } @else {
        Screen readers: read it scrambled.
      }
    </p>
  `,
})
export class A11yNote {
  protected readonly veneer = inject(VeneerFontService);
  /** The element's `aria-hidden` state, null until the browser has read it. */
  readonly hidden = input.required<boolean | null>();
  /** The element is or contains something focusable, such as a link. */
  readonly focusable = input(false);
}
