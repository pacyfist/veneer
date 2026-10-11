import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectVeneerState } from './veneer-inject';

/**
 * A ready-made switch for readable mode: put it on a `<button>` of yours.
 *
 * ```html
 * <button veneerReadableToggle class="btn">Readable text</button>
 * <button veneerReadableToggle></button> <!-- label defaults to "Readable text" -->
 * ```
 *
 * Pressing it switches scrambling off (or back on) for every protected element
 * on the page and remembers the choice in `localStorage`. It is a toggle
 * button: `aria-pressed` says whether readable mode is on, and the label
 * stays the same. Style it like any button; it adds no CSS.
 *
 * Put it early in the page, outside protected content, so keyboard and screen
 * reader users reach it before the text it unlocks.
 */
@Component({
  selector: 'button[veneerReadableToggle]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    type: 'button',
    '[attr.aria-pressed]': 'service.readable()',
    '(click)': 'toggle()',
  },
  template: '<ng-content>Readable text</ng-content>',
})
export class VeneerReadableToggle {
  /** @internal */
  protected readonly service = injectVeneerState('The veneerReadableToggle button');

  /** Switches readable mode. Bound to the button's `click`. */
  toggle(): void {
    this.service.readable.update((on) => !on);
  }
}
