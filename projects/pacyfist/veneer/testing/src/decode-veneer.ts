import { ScrambleMap, invertScrambleMap, scrambleText } from '@pacyfist/veneer/core';
import { currentTestingService, defaultTestingMap } from './veneer-testing';

/**
 * The readable form of protected text: what a visitor sees on screen.
 *
 * Pass the protected element (its `textContent` is decoded) or a string.
 *
 * Without `map`, uses the cipher of the most recent `provideVeneerTesting()`
 * service, or of its default seed if none was created. In that mode text is
 * returned untouched while that service is `failed` or `disabled`, since the
 * DOM then already holds the readable text. Pass `map` (for example
 * `TestBed.inject(VeneerFontService).map`) to always invert with that cipher.
 */
export function decodeVeneer(input: Element | string, map?: ScrambleMap): string {
  const text = typeof input === 'string' ? input : (input.textContent ?? '');

  if (map) return scrambleText(text, invertScrambleMap(map));

  const service = currentTestingService();
  if (service && !service.active()) return text;
  return scrambleText(text, invertScrambleMap(service?.map ?? defaultTestingMap()));
}
