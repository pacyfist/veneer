import { veneerMessage } from './veneer-errors';
import { hostOf } from './veneer-hosts';

/**
 * Development-mode checks for misuse that otherwise fails silently. Every
 * caller guards with `typeof ngDevMode === 'undefined' || ngDevMode`, so
 * production builds drop the calls and this module with them.
 *
 * Internal: not part of the public API.
 */

/** `<p class="lead">`: enough to find the element in the DOM inspector. */
export function describeElement(el: Element): string {
  const id = el.id ? ` id="${el.id}"` : '';
  const cls = el.getAttribute('class');
  return `<${el.localName}${id}${cls ? ` class="${cls}"` : ''}>`;
}

export function devWarn(code: string, message: string): void {
  console.warn(veneerMessage(code, message));
}

/** `font-variant-caps` values a browser may synthesize by changing case. */
const CASE_VARIANTS = /\b(?:all-)?(?:small|petite)-caps\b|\bunicase\b/;

/**
 * CSS on `el` that changes letter case: `text-transform` other than `none`,
 * or small caps. Both act on the characters in the DOM, which are the
 * scrambled ones, so the forged font is asked for the glyph of a different
 * letter. Returns `property: value` strings, empty when there is none.
 */
export function caseStyles(el: Element): string[] {
  const view = el.ownerDocument.defaultView;
  if (!view) return [];
  const style = view.getComputedStyle(el);
  const found: string[] = [];
  const transform = style.textTransform;
  if (transform && transform !== 'none') found.push(`text-transform: ${transform}`);
  const caps = style.fontVariantCaps || style.fontVariant || '';
  const match = caps.match(CASE_VARIANTS);
  if (match) found.push(`font-variant-caps: ${match[0]}`);
  return found;
}

/**
 * VNR020: warn once when a protected element, or an element inside it that
 * holds protected text, changes letter case with CSS.
 */
export function warnCaseStyles(elements: Iterable<Element>): void {
  for (const el of elements) {
    const found = caseStyles(el);
    if (found.length === 0) continue;
    devWarn(
      'VNR020',
      `protected text is styled with ${found.join(' and ')} (${describeElement(el)}). ` +
        'Case changes apply to the scrambled characters, so the forged font draws the wrong ' +
        'letters. Change the case in the text itself, or keep this style off protected text. ' +
        'Small caps are only safe when the font has real small-cap glyphs (the smcp feature) ' +
        'and the browser does not synthesize them.',
    );
    return;
  }
}

/** Where a pipe's output was found in the rendered page. */
export type PipeOutputPlacement = 'protected' | 'unprotected' | 'absent';

/**
 * Looks for text nodes containing `output` and reports whether they render
 * in the forged font: inside a `veneerFont` or `veneer` element, or under an
 * element whose computed `font-family` names `familyName`.
 */
export function placePipeOutput(
  document: Document,
  output: string,
  familyName: string,
): PipeOutputPlacement {
  const body = document.body;
  if (!body) return 'absent';
  const view = document.defaultView;
  let found = false;
  const walker = document.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node as Text).data.includes(output)) continue;
    found = true;
    let protectedHere = false;
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (hostOf(el)) {
        protectedHere = true;
        break;
      }
    }
    const parent = node.parentElement;
    if (
      !protectedHere &&
      parent &&
      view?.getComputedStyle(parent).fontFamily.includes(familyName)
    ) {
      protectedHere = true;
    }
    if (!protectedHere) return 'unprotected';
  }
  return found ? 'protected' : 'absent';
}
