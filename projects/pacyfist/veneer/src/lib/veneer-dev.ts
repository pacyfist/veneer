import { veneerMessage } from './veneer-errors';
import { DOCUMENT, Injector, afterNextRender } from '@angular/core';
import type { VeneerFontState } from './veneer-font-state';
import { hostOf, walkTextNodes } from './veneer-hosts';

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
 * Outputs with fewer non-space characters are not checked: a short string
 * turns up in unrelated text too often to say where the pipe put it.
 */
export const MIN_CHECKED_LENGTH = 4;

/** Whether `output` is long enough for `placePipeOutput` to look for it. */
export function isCheckable(output: string): boolean {
  return output.replace(/\s/g, '').length >= MIN_CHECKED_LENGTH;
}

/**
 * Matches `output` as whole words: not preceded or followed by a letter or
 * digit, so a short output inside a longer word does not count.
 */
function wholeWords(output: string): RegExp {
  const escaped = output.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
}

/**
 * Looks for text nodes holding `output` as whole words and reports whether it
 * renders in the forged font: inside a `veneerFont` or `veneer` element, or
 * under an element whose computed `font-family` names `familyName`.
 *
 * `protected` when any match is, since the same ciphertext may also appear on
 * purpose elsewhere (a "what a bot reads" readout); `unprotected` only when
 * every match is. Outputs shorter than `MIN_CHECKED_LENGTH` non-space
 * characters are never looked for (`absent`).
 */
export function placePipeOutput(
  document: Document,
  output: string,
  familyName: string,
): PipeOutputPlacement {
  const body = document.body;
  if (!body || !isCheckable(output)) return 'absent';
  const view = document.defaultView;
  const pattern = wholeWords(output);
  let found = false;
  const walker = document.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!pattern.test((node as Text).data)) continue;
    found = true;
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (hostOf(el)) return 'protected';
    }
    const parent = node.parentElement;
    if (parent && view?.getComputedStyle(parent).fontFamily.includes(familyName)) {
      return 'protected';
    }
  }
  return found ? 'unprotected' : 'absent';
}

/**
 * VNR001: whether a `veneer` element holds text the directive did not write:
 * a node whose text changed since it was scrambled, or a new node. That is an
 * interpolation, an `@if` or another binding writing readable text into
 * protected content, which stays readable (and is drawn as gibberish) until
 * protection next changes.
 */
export function hasForeignText(
  host: Element,
  written: WeakMap<Text, string>,
  pending: readonly Text[],
): boolean {
  return walkTextNodes(host).texts.some((text) => {
    if (pending.includes(text) || !text.data.trim()) return false;
    const last = written.get(text);
    return last === undefined || text.data !== last;
  });
}

const warnedForeign = new WeakSet<Element>();

/** VNR001, once per element. */
export function warnForeignText(host: Element): void {
  if (warnedForeign.has(host)) return;
  warnedForeign.add(host);
  devWarn(
    'VNR001',
    `text inside a veneer element changed after it was scrambled (${describeElement(host)}). ` +
      'This is usually {{ interpolation }} or an @if inside the element: the new text is ' +
      'readable to scrapers and drawn as gibberish for people. Use ' +
      '<p veneerFont>{{ text | veneer }}</p> or bind the string: <p [veneer]="text"></p>.',
  );
}

/** How many renders the VNR002 check looks for output it cannot find before giving up. */
const MAX_PLACEMENT_CHECKS = 3;

/**
 * VNR002 for one pipe instance. A pipe is not told which element renders its
 * result, so after the next render this looks for the output in the page's
 * text nodes and checks that they sit inside a protected element. Output used
 * in an attribute is never found; the check gives up quietly after a few
 * renders. Settles after the first verdict.
 */
export class PipePlacementCheck {
  private state: 'idle' | 'scheduled' | 'settled' = 'idle';
  private misses = 0;
  private output = '';

  constructor(
    private readonly injector: Injector,
    private readonly service: VeneerFontState,
  ) {}

  check(output: string): void {
    if (this.state === 'settled') return;
    if (!isCheckable(output)) return;
    this.output = output;
    if (this.state === 'scheduled') return;
    this.state = 'scheduled';
    afterNextRender(
      () => {
        this.state = 'idle';
        const document = this.injector.get(DOCUMENT);
        const where = placePipeOutput(document, this.output, this.service.familyName);
        if (where === 'unprotected') {
          devWarn(
            'VNR002',
            `the veneer pipe's output "${this.output.slice(0, 40)}" is rendered outside any ` +
              'veneerFont or veneer element, so readers see it scrambled. Add veneerFont to the ' +
              'element that renders it: <h1 veneerFont>{{ title() | veneer }}</h1>.',
          );
        }
        if (where !== 'absent' || ++this.misses >= MAX_PLACEMENT_CHECKS) this.state = 'settled';
      },
      { injector: this.injector },
    );
  }
}
