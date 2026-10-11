/** Thrown when the base font cannot be read, or cannot back the configured charset. */
export class VeneerFontError extends Error {
  constructor(
    message: string,
    /** The charset characters the base font has no glyph for, if that is the problem. */
    readonly missing: readonly string[] = [],
  ) {
    super(message);
    this.name = 'VeneerFontError';
  }
}
