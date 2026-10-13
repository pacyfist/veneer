import type { VeneerStatus } from './veneer-status';

/**
 * `<html data-veneer-status>`, shared by every instance with
 * `withStatusAttribute()` in a document. It shows the most urgent status of
 * them all, so one healthy instance never hides a failing one, and it is
 * removed only when the last of them is destroyed.
 *
 * Internal: not part of the public API.
 */

/** The attribute `withStatusAttribute()` maintains on `<html>`. */
export const STATUS_ATTRIBUTE = 'data-veneer-status';

/** Most urgent first: the attribute shows the first status any instance has. */
const PRECEDENCE: readonly VeneerStatus[] = ['failed', 'loading', 'active', 'disabled'];

/** Per document (one per request on the server): each instance's current status. */
const registries = new WeakMap<Document, Map<object, VeneerStatus>>();

function render(document: Document, statuses: Map<object, VeneerStatus>): void {
  const root = document.documentElement;
  if (!root) return;
  const present = new Set(statuses.values());
  const shown = PRECEDENCE.find((status) => present.has(status));
  if (shown) root.setAttribute(STATUS_ATTRIBUTE, shown);
  else root.removeAttribute(STATUS_ATTRIBUTE);
}

/** Record `owner`'s status and update the attribute. */
export function setStatusAttribute(document: Document, owner: object, status: VeneerStatus): void {
  let statuses = registries.get(document);
  if (!statuses) registries.set(document, (statuses = new Map()));
  statuses.set(owner, status);
  render(document, statuses);
}

/** Forget `owner`; the attribute goes when no instance is left. */
export function releaseStatusAttribute(document: Document, owner: object): void {
  const statuses = registries.get(document);
  if (!statuses?.delete(owner)) return;
  render(document, statuses);
}
