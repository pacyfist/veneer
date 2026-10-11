import {
  Sanitizer,
  SecurityContext,
  ɵ_sanitizeHtml as sanitizeHtmlString,
  ɵallowSanitizationBypassAndThrow as allowBypass,
  ɵunwrapSafeValue as unwrapSafeValue,
} from '@angular/core';

/**
 * HTML for `[veneerHtml]`: a string, or a value from
 * `DomSanitizer.bypassSecurityTrustHtml()` (Angular's `SafeHtml`).
 */
export type VeneerHtml = string | object;

/**
 * Sanitizes HTML the way Angular sanitizes an `[innerHTML]` binding.
 *
 * A `Sanitizer` the application provides wins. Otherwise this is what
 * `DomSanitizer.sanitize(SecurityContext.HTML, value)` does (and what Angular
 * falls back to for `[innerHTML]`), spelled out with the same core functions
 * so the library does not need `@angular/platform-browser`: a `SafeHtml` from
 * `bypassSecurityTrustHtml()` passes through, anything else is stripped of
 * scripts, event handlers and unsafe URLs. Under Trusted Types the result is
 * a `TrustedHTML`, which is why it is not turned into a string here.
 *
 * Internal: not part of the public API.
 */
export function sanitizeHtml(
  value: VeneerHtml | null,
  document: Document,
  sanitizer: Sanitizer | null,
): ReturnType<typeof sanitizeHtmlString> {
  if (value == null) return '';
  if (sanitizer) return sanitizer.sanitize(SecurityContext.HTML, value) ?? '';
  // 'HTML' is the value of core's internal BypassType.Html const enum.
  if (allowBypass(value, 'HTML' as never)) return unwrapSafeValue(value);
  return sanitizeHtmlString(document, String(value));
}
