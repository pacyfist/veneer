import { DOCUMENT, Injector, Pipe, PipeTransform, afterNextRender, inject } from '@angular/core';
import { injectVeneerState } from './veneer-inject';
import { VeneerFontState } from './veneer-font-state';
import { devWarn, placePipeOutput } from './veneer-dev';

declare const ngDevMode: boolean | undefined;

/** How many renders the dev check looks for output it cannot find before giving up. */
const MAX_PLACEMENT_CHECKS = 3;

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

  /** Dev check state: settled once the output was found, or after a few misses. */
  private placement: 'idle' | 'scheduled' | 'settled' = 'idle';
  private placementChecks = 0;
  private lastOutput = '';

  transform(value: string | null | undefined): string {
    const output = value == null ? '' : this.service.scramble(value);
    if (
      (typeof ngDevMode === 'undefined' || ngDevMode) &&
      this.placement !== 'settled' &&
      output !== value &&
      output.trim()
    ) {
      this.checkPlacement(output);
    }
    return output;
  }

  /**
   * VNR002. A pipe is not told which element renders its result, so after the
   * next render this looks for the output in the page's text nodes and checks
   * that they sit inside a protected element. Output used in an attribute is
   * never found; the check gives up quietly after a few renders.
   */
  private checkPlacement(output: string): void {
    this.lastOutput = output;
    if (this.placement === 'scheduled') return;
    this.placement = 'scheduled';
    afterNextRender(
      () => {
        this.placement = 'idle';
        const document = this.injector.get(DOCUMENT);
        const where = placePipeOutput(document, this.lastOutput, this.service.familyName);
        if (where === 'unprotected') {
          devWarn(
            'VNR002',
            `the veneer pipe's output "${this.lastOutput.slice(0, 40)}" is rendered outside any ` +
              'veneerFont or veneer element, so readers see it scrambled. Add veneerFont to the ' +
              'element that renders it: <h1 veneerFont>{{ title() | veneer }}</h1>.',
          );
        }
        if (where !== 'absent' || ++this.placementChecks >= MAX_PLACEMENT_CHECKS) {
          this.placement = 'settled';
        }
      },
      { injector: this.injector },
    );
  }
}
