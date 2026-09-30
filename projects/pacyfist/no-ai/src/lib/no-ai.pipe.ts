import { Pipe, PipeTransform, inject } from '@angular/core';
import { NoAiFontService } from './no-ai-font.service';

/**
 * Scrambles a bound string.
 *
 * ```html
 * <h1 noAiFont>{{ title() | noAi }}</h1>
 * ```
 *
 * Put `noAiFont` on the element that renders the result, or the reader sees
 * the gibberish too.
 *
 * Impure by design. Protection has to switch off the instant the font fails to
 * load, and a pure pipe would keep serving its cached scramble because the
 * input string never changed. The work per call is one Map lookup per
 * character.
 */
@Pipe({ name: 'noAi', pure: false })
export class NoAiPipe implements PipeTransform {
  private readonly service = inject(NoAiFontService);

  transform(value: string | null | undefined): string {
    return value == null ? '' : this.service.scramble(value);
  }
}
