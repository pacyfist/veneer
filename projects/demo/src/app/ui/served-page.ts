import { DOCUMENT, Injectable, inject } from '@angular/core';

/** This page as the server sent it: the URL, the raw HTML and a parsed copy. */
export interface ServedPage {
  readonly url: string;
  readonly html: string;
  readonly doc: Document;
}

/**
 * Downloads this page's own HTML once, the way a crawler would, for every
 * panel that shows evidence from the response body rather than from the live
 * DOM. Browser only: call it from `afterNextRender` or an event handler.
 */
@Injectable({ providedIn: 'root' })
export class ServedPageLoader {
  private readonly document = inject(DOCUMENT);
  private page?: Promise<ServedPage>;

  load(): Promise<ServedPage> {
    this.page ??= this.fetchPage().catch((error) => {
      // Let the next caller try again rather than caching the failure.
      this.page = undefined;
      throw error;
    });
    return this.page;
  }

  private async fetchPage(): Promise<ServedPage> {
    const url = this.document.baseURI;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const html = await response.text();
    return { url, html, doc: new DOMParser().parseFromString(html, 'text/html') };
  }
}

/** The `veneer` entry of the served `<script id="ng-state">`, or null. */
export function veneerState(page: ServedPage): { family: string; fonts: unknown[] } | null {
  try {
    const state = JSON.parse(page.doc.querySelector('script#ng-state')?.textContent ?? '{}');
    return state.veneer ?? null;
  } catch {
    return null;
  }
}

/** A forged face's URL: transfer state holds a bare URL or `{ url, weight, ... }`. */
export function fontUrl(font: unknown): string {
  return typeof font === 'string' ? font : String((font as { url?: unknown })?.url ?? '');
}
