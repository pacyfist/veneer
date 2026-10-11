import { ScrambleMap, invertScrambleMap, scrambleText } from '@pacyfist/veneer/core';
import type { VeneerFontState } from './veneer-font-state';
import { protectingHost } from './veneer-hosts';

/**
 * The `withReadableCopy()` handler: on copy, the clipboard gets the readable
 * form of the protected text in the selection.
 *
 * It listens on `document`, not on protected elements: in Chromium a
 * selection that starts outside an element never fires that element's
 * `copy` listener.
 *
 * To copy exactly what the browser would (its own line breaks, whitespace
 * collapsing, hidden content left out), the protected text nodes in the
 * selection are swapped for their readable form, the selection is
 * serialized as text and as HTML, and everything is put back, all inside the
 * event handler, so nothing is painted in between. The cipher maps each
 * character to one of the same length, so the selection's offsets stay valid
 * across the swap.
 *
 * Internal: installed by the directives of an instance with the feature.
 */

const installed = new WeakSet<Document>();

export function installReadableCopy(document: Document): void {
  if (installed.has(document)) return;
  installed.add(document);
  document.addEventListener('copy', (event) => copyReadable(document, event as ClipboardEvent));
}

/** Text nodes the range touches, in document order. */
function textNodesIn(document: Document, range: Range): Text[] {
  const root = range.commonAncestorContainer;
  if (root.nodeType === 3) return [root as Text];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (range.intersectsNode(node)) nodes.push(node as Text);
  }
  return nodes;
}

export function copyReadable(document: Document, event: ClipboardEvent): void {
  const clipboard = event.clipboardData;
  const selection = document.getSelection();
  if (event.defaultPrevented || !clipboard || !selection || selection.isCollapsed) return;

  const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i));
  const inverses = new Map<VeneerFontState, ScrambleMap>();
  const swaps = new Map<Text, { plain: string; cipher: string }>();
  const families = new Set<string>();

  for (const range of ranges) {
    for (const text of textNodesIn(document, range)) {
      if (swaps.has(text)) continue;
      const found = protectingHost(text);
      if (!found?.host.copy || !found.host.state.active()) continue;
      const { state } = found.host;
      let inverse = inverses.get(state);
      if (!inverse) inverses.set(state, (inverse = invertScrambleMap(state.map())));
      const cipher = text.data;
      const plain = scrambleText(cipher, inverse);
      // A length change would move the selection's offsets: keep the
      // browser's own copy rather than copy the wrong characters.
      if (plain.length !== cipher.length) return;
      if (plain !== cipher) {
        swaps.set(text, { plain, cipher });
        families.add(state.familyName);
      }
    }
  }
  if (swaps.size === 0) return;

  const bounds = ranges.map((r) => [r.startContainer, r.startOffset, r.endContainer, r.endOffset]);
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  const reselect = () => {
    // Writing a text node's data moves selection boundaries inside it to 0.
    if (ranges.length === 1 && anchorNode && focusNode) {
      selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
      return;
    }
    selection.removeAllRanges();
    for (const [sc, so, ec, eo] of bounds) {
      const range = document.createRange();
      range.setStart(sc as Node, so as number);
      range.setEnd(ec as Node, eo as number);
      selection.addRange(range);
    }
  };

  let text: string;
  let html: string;
  try {
    for (const [node, { plain }] of swaps) node.data = plain;
    reselect();
    text = selection.toString();
    html = serialize(document, selection, families);
  } finally {
    for (const [node, { cipher }] of swaps) node.data = cipher;
    reselect();
  }

  clipboard.setData('text/plain', text);
  clipboard.setData('text/html', html);
  event.preventDefault();
}

/**
 * The selection as HTML, without the forged font: pasted into a page that
 * has it (this one), readable text in that font would turn back into
 * gibberish.
 */
function serialize(document: Document, selection: Selection, families: Set<string>): string {
  const container = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i++) {
    container.appendChild(selection.getRangeAt(i).cloneContents());
  }
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('[style]'))) {
    const family = el.style.fontFamily;
    if ([...families].some((name) => family.includes(name))) el.style.removeProperty('font-family');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }
  return container.innerHTML;
}
