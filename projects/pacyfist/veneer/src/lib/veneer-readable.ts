import { WritableSignal, signal } from '@angular/core';

/**
 * Readable mode: the visitor's choice to switch scrambling off.
 *
 * One signal per document, shared by every instance on the page, so a single
 * toggle turns the whole page readable. The choice is remembered in
 * `localStorage`; storage that is missing, full or blocked (private
 * windows, sandboxed frames, disabled cookies) only means it is not
 * remembered.
 *
 * Internal: exposed as `VeneerFontService.readable`.
 */

/** The `localStorage` key, holding `'1'` while readable mode is on. */
export const READABLE_STORAGE_KEY = 'veneer-readable';

const modes = new WeakMap<Document, WritableSignal<boolean>>();

function storageOf(document: Document): Storage | null {
  try {
    return document.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The document's readable-mode signal. On the server it is a fresh `false`
 * for every caller: there is no visitor to remember, and a server document
 * must not share state across requests.
 */
export function readableMode(document: Document, isBrowser: boolean): WritableSignal<boolean> {
  if (!isBrowser) return signal(false);

  let mode = modes.get(document);
  if (mode) return mode;

  let stored = false;
  try {
    stored = storageOf(document)?.getItem(READABLE_STORAGE_KEY) === '1';
  } catch {
    // Unreadable storage: start with readable mode off, as if nothing was stored.
  }
  const created = signal(stored);
  const set = created.set;
  const remember = (on: boolean) => {
    try {
      const storage = storageOf(document);
      if (on) storage?.setItem(READABLE_STORAGE_KEY, '1');
      else storage?.removeItem(READABLE_STORAGE_KEY);
    } catch {
      // Not remembered across visits; the choice still holds for this page.
    }
  };
  created.set = (on: boolean) => {
    set(on);
    remember(on);
  };
  created.update = (fn: (on: boolean) => boolean) => created.set(fn(created()));

  modes.set(document, created);
  return created;
}
