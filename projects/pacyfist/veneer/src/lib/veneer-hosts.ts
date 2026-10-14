import type { VeneerFontState } from './veneer-font-state';

/**
 * Bookkeeping shared by the directives, the pipe's dev check and the copy
 * handler: which elements are protected, by which instance, and which of
 * their descendants the walker leaves alone.
 *
 * Internal: not part of the public API.
 */

/** One protected element. */
export interface ProtectedHost {
  /** The instance whose cipher the element's text is scrambled with. */
  readonly state: VeneerFontState;
  /**
   * `text`: a `[veneer]` host. Its walker skips some subtrees (see
   * {@link isSkippedElement}), whose text stays readable.
   * `font`: a `veneerFont` host. Everything in it is drawn with the forged
   * font, so all of its text is pipe output.
   */
  readonly kind: 'text' | 'font';
  /** Whether `withReadableCopy()` decodes this element's text on copy. */
  readonly copy: boolean;
}

const hosts = new WeakMap<Element, ProtectedHost>();

export function registerHost(el: Element, host: ProtectedHost): void {
  hosts.set(el, host);
}

export function unregisterHost(el: Element): void {
  hosts.delete(el);
}

export function hostOf(el: Element): ProtectedHost | undefined {
  return hosts.get(el);
}

/**
 * Elements whose subtree the `[veneer]` walker leaves readable:
 *
 * - `script`, `style`, `template`: not rendered text.
 * - `code`: code samples are meant to be copied and run.
 * - `textarea`: its text is the control's value.
 * - `noscript`: parsed as text with scripting on and as markup with it off,
 *   so the server and the browser would not agree on its text nodes.
 *
 * `pre` is protected on purpose. Code inside it sits in `<pre><code>` (what
 * Markdown renderers emit), which `code` already covers, and a bare `pre` is
 * usually preformatted prose (a poem, lyrics) that is worth protecting.
 */
const SKIPPED_TAGS = new Set(['script', 'style', 'template', 'code', 'textarea', 'noscript']);

/**
 * The opt-out marker: `<span veneer-skip>` or `<span class="veneer-skip">`
 * keeps its subtree readable. The class form is for `[veneerHtml]` strings:
 * Angular's sanitizer keeps `class` but drops attributes it does not know.
 */
export const SKIP_ATTRIBUTE = 'veneer-skip';

/** Whether `el` carries the opt-out marker, as an attribute or a class. */
export function hasSkipMarker(el: Element): boolean {
  return (
    el.hasAttribute(SKIP_ATTRIBUTE) ||
    (el.getAttribute('class') ?? '').split(/\s+/).includes(SKIP_ATTRIBUTE)
  );
}

/**
 * Whether the walker leaves `el` and its subtree readable.
 *
 * @internal Exported as `ɵisSkippedElement` for the testing entry point only.
 */
export function isSkippedElement(el: Element): boolean {
  return SKIPPED_TAGS.has(el.localName) || hasSkipMarker(el);
}

/** What the walker found under a `[veneer]` host. */
export interface Walk {
  /** Text nodes to protect, in document order. */
  readonly texts: Text[];
  /** `[veneer-skip]` elements at the top of skipped subtrees. */
  readonly optedOut: Element[];
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * The text nodes under `root` that a `[veneer]` host protects: every
 * descendant text node except those in skipped subtrees and in other
 * protected hosts (a nested `[veneer]` or `veneerFont` protects its own).
 *
 * Plain recursion over `childNodes` rather than a TreeWalker, so it behaves
 * the same in the browser and in the server's DOM.
 */
export function walkTextNodes(root: Element): Walk {
  const texts: Text[] = [];
  const optedOut: Element[] = [];
  const visit = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        texts.push(child as Text);
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element;
        if (hosts.has(el)) continue;
        if (isSkippedElement(el)) {
          if (hasSkipMarker(el)) optedOut.push(el);
          continue;
        }
        visit(el);
      }
    }
  };
  visit(root);
  return { texts, optedOut };
}

/**
 * The protected host a text node's characters were scrambled for, or null
 * when the node is readable: outside every host, or in a subtree a `[veneer]`
 * host skips.
 */
export function protectingHost(node: Node): { el: Element; host: ProtectedHost } | null {
  let skipped = false;
  for (let el = node.parentElement; el; el = el.parentElement) {
    const host = hosts.get(el);
    if (host) return host.kind === 'text' && skipped ? null : { el, host };
    if (isSkippedElement(el)) skipped = true;
  }
  return null;
}
