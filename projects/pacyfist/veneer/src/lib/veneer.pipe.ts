import { Injector, Pipe, PipeTransform, inject } from '@angular/core';
import { injectVeneerState } from './veneer-inject';
import { VeneerFontState } from './veneer-font-state';
import { PipePlacementCheck } from './veneer-dev';

declare const ngDevMode: boolean | undefined;

/**
 * Scrambles a bound string.
 *
 * ```html
 * <h1 veneerFont>{{ title() | veneer }}</h1>
 * ```
 *
 * Put `veneerFont` on the element that renders the result, or the reader sees
 * the gibberish too. Development builds warn when the output lands outside
 * any `veneerFont` or `veneer` element (VNR002).
 *
 * Impure by design. Protection has to switch off the instant the font fails to
 * load, and a pure pipe would keep serving its cached scramble because the
 * input string never changed. The work per call is one Map lookup per
 * character.
 */
@Pipe({ name: 'veneer', pure: false })
export class VeneerPipe implements PipeTransform {
  private readonly service: VeneerFontState = injectVeneerState('The veneer pipe');
  private readonly injector = inject(Injector);

  /** VNR002, created on first use in development builds only. */
  private placement: PipePlacementCheck | undefined;

  transform(value: string | null | undefined): string {
    const output = value == null ? '' : this.service.scramble(value);
    if ((typeof ngDevMode === 'undefined' || ngDevMode) && output !== value && output.trim()) {
      (this.placement ??= new PipePlacementCheck(this.injector, this.service)).check(output);
    }
    return output;
  }
}
