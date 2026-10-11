/**
 * How server-rendered protected text is hidden until the forged font is
 * ready, without hiding it from readers that never run JavaScript.
 *
 * The server marks each hidden element with an attribute and adds two small
 * inline elements to `<head>`:
 *
 * - a `<style>` rule that hides marked elements, but only under
 *   `<html class="veneer-js">`;
 * - a `<script>` that adds that class while the page is parsed.
 *
 * A browser with JavaScript runs the script before the body is painted, so
 * the text is hidden from the first frame until the client takes over (it
 * then hides with a CSSOM style, which a strict CSP allows, and drops the
 * attribute). Everything that never runs the script never hides anything:
 * JavaScript turned off, reader modes and archives that strip scripts, and a
 * CSP that blocks the script. Those see the scrambled text in the fallback
 * font instead of blank space.
 *
 * Under a CSP the two inline elements need the page's nonce (Angular's
 * `CSP_NONCE`, which veneer adds when it is set) or their hashes
 * ({@link VENEER_CSP_HASHES}) in `script-src` and `style-src`.
 */

/** Marks a server-rendered element as hidden until the client takes over. */
export const HIDE_ATTRIBUTE = 'data-veneer-hidden';

/** `HIDE_ATTRIBUTE` value for elements hidden with the `hidden` attribute (`hideWith: 'hidden'`). */
export const HIDDEN_BY_ATTRIBUTE = 'hidden';

/** Ids of the inline elements, so each document gets one pair. */
const STYLE_ID = 'veneer-hide';
const SCRIPT_ID = 'veneer-js';

/** The inline rule. Changing it changes {@link VENEER_CSP_HASHES}. */
export const HIDE_STYLE = '.veneer-js [data-veneer-hidden]{visibility:hidden}';

/** The inline script. Changing it changes {@link VENEER_CSP_HASHES}. */
export const HIDE_SCRIPT = "document.documentElement.classList.add('veneer-js')";

/**
 * CSP source expressions for the inline `<style>` and `<script>` veneer adds
 * to server-rendered pages while `hideUntilReady` is on. Add them to
 * `style-src` and `script-src` when you cannot give the page a nonce, for
 * example on prerendered (static) pages:
 *
 * ```
 * Content-Security-Policy: script-src 'self' 'sha256-…'; style-src 'self' 'sha256-…'
 * ```
 *
 * With a per-request nonce, provide Angular's `CSP_NONCE` (or set
 * `ngCspNonce` on the root element) instead: veneer puts it on both elements.
 */
export const VENEER_CSP_HASHES = {
  script: "'sha256-zScTzaenp7O94uAEY9jA4ApwcUzDKRER9f1cpL7uzbU='",
  style: "'sha256-XoOItZbUxNa/iUajNPIswWzXGI7sNIjM3+RkxLnH6JI='",
} as const;

/**
 * Adds the hiding rule and the script that enables it to the document's
 * `<head>`, once. Server only: in the browser the client hides by itself.
 */
export function ensureHideRules(document: Document, nonce: string | null): void {
  const head = document.head;
  if (!head || document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  if (nonce) style.setAttribute('nonce', nonce);
  style.textContent = HIDE_STYLE;

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  if (nonce) script.setAttribute('nonce', nonce);
  script.textContent = HIDE_SCRIPT;

  head.appendChild(style);
  head.appendChild(script);
}
