import { Pipe, PipeTransform } from '@angular/core';
import { injectVeneerState } from './veneer-inject';
import { VeneerFontState } from './veneer-font-state';

/**
 * Scrambles a bound string.
 *
 * ```html
 * <h1 veneerFont>{{ title() | veneer }}</h1>
 * ```
 *
 * Put `veneerFont` on the element that renders the result, or the reader sees
 * the gibberish too.
 *
 * Impure by design. Protection has to switch off the instant the font fails to
 * load, and a pure pipe would keep serving its cached scramble because the
 * input string never changed. The work per call is one Map lookup per
 * character.
 */
@Pipe({ name: 'veneer', pure: false })
export class VeneerPipe implements PipeTransform {
  private readonly service: VeneerFontState = injectVeneerState('The veneer pipe');

  transform(value: string | null | undefined): string {
    return value == null ? '' : this.service.scramble(value);
  }
}
