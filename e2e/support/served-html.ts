import type { APIRequestContext } from '@playwright/test';
// jsdom is already a dev dependency (the unit-test environment). It ships no
// types and nothing type-checks e2e/, so the import stays untyped.
import { JSDOM, VirtualConsole } from 'jsdom';

/**
 * Parses HTML without running scripts or loading subresources. The silent
 * console drops jsdom's complaints about modern CSS it cannot parse.
 */
export function parseHtml(html: string): Document {
  return new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
}

/**
 * The served page as a crawler that never runs JavaScript gets it: one HTTP
 * GET, parsed by an HTML parser.
 */
export async function fetchServedPage(request: APIRequestContext): Promise<{
  html: string;
  document: Document;
}> {
  const response = await request.get('./');
  if (!response.ok()) throw new Error(`GET ./ returned ${response.status()}`);
  const html = await response.text();
  return { html, document: parseHtml(html) };
}

/** Text nodes under `root`, skipping script and style, one per line. */
export function visibleText(root: Node): string {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement?.localName;
    if (parent === 'script' || parent === 'style') continue;
    const text = node.textContent?.trim();
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

/**
 * The places in a served page where text can sit outside the protected
 * elements, each as one searchable string.
 */
export function htmlChannels(document: Document): Record<string, string> {
  const all = (selector: string) => [...document.querySelectorAll(selector)];
  const attribute = (name: string) =>
    all(`[${name}]`)
      .map((el) => el.getAttribute(name))
      .join('\n');
  return {
    title: document.title,
    'meta and OG tags': all('meta[content]')
      .map((el) => el.getAttribute('content'))
      .join('\n'),
    'JSON-LD': all('script[type="application/ld+json"]')
      .map((el) => el.textContent)
      .join('\n'),
    'alt / aria-label / title attributes': ['alt', 'aria-label', 'title'].map(attribute).join('\n'),
    'form values and placeholders': ['value', 'placeholder'].map(attribute).join('\n'),
    'ng-state transfer JSON': document.querySelector('script#ng-state')?.textContent ?? '',
    'document text': visibleText(document.body),
  };
}
