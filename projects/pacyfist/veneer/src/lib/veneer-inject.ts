import { inject } from '@angular/core';
import { VeneerFontService } from './veneer-font.service';
import { VeneerFontState } from './veneer-font-state';
import { veneerMessage } from './veneer-errors';

/**
 * The font service for a directive or pipe, or a clear error when
 * `provideVeneer()` is missing (instead of Angular's bare NullInjectorError).
 *
 * Internal: not part of the public API.
 */
export function injectVeneerState(consumer: string): VeneerFontState {
  const service = inject(VeneerFontService, { optional: true });
  if (!service) {
    throw new Error(
      veneerMessage(
        'VNR003',
        `${consumer} needs provideVeneer(). Add provideVeneer({ font: 'fonts/Your-Font.ttf' }) to the ` +
          'providers of your ApplicationConfig (or of the route or component that uses veneer), ' +
          'or provideVeneerTesting() from @pacyfist/veneer/testing in unit tests.',
      ),
    );
  }
  return service;
}
