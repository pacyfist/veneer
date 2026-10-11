import { ɵisSkippedElement as isSkippedElement } from '@pacyfist/veneer';
import { ScrambleMap, invertScrambleMap, scrambleText } from '@pacyfist/veneer/core';
import { currentTestingService, defaultTestingMap } from './veneer-testing';

/**
 * The readable form of protected text: what a visitor sees on screen.
 *
 * Pass the protected element or a string. For an element, every text node
 * is decoded except those the `veneer` directive leaves readable: inside
 * `script`, `style`, `template`, `code`, `textarea`, `noscript` or a
 * `[veneer-skip]` element below it. Those are returned as they are, in place.
 *
 * Without `map`, uses the cipher of the most recent `provideVeneerTesting()`
 * service, or of its default seed if none was created. In that mode text is
 * returned untouched while that service is not active (`failed`, `disabled`
 * or readable mode), since the DOM then already holds the readable text. Pass
 * `map` (for example `TestBed.inject(VeneerFontService).map()`) to always
 * invert with that cipher.
 */
export function decodeVeneer(input: Element | string, map?: ScrambleMap): string {
  let inverse: ScrambleMap | null;
  if (map) {
    inverse = invertScrambleMap(map);
  } else {
    const service = currentTestingService();
    inverse =
      service && !service.active()
        ? null
        : invertScrambleMap(service?.map() ?? defaultTestingMap());
  }
  const decode = (text: string) => (inverse ? scrambleText(text, inverse) : text);

  if (typeof input === 'string') return decode(input);

  let out = '';
  const visit = (node: Node, skipped: boolean) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        const data = (child as Text).data;
        out += skipped ? data : decode(data);
      } else if (child.nodeType === 1) {
        visit(child, skipped || isSkippedElement(child as Element));
      }
    }
  };
  visit(input, false);
  return out;
}
