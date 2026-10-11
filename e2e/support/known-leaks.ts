/**
 * Places where the demo itself prints a protected specimen in the clear. These
 * are choices of the demo's copy, not library leaks, and each names the
 * channel (as htmlChannels() labels it) that carries it.
 */
export const DEMO_HTML_LEAKS: Readonly<Record<string, { channel: string; why: string }>> = {
  'Protected by element content.': {
    channel: 'document text',
    why: 'the "Fixed text" tab quotes its own code sample, <p veneer>Protected by element content.</p>, in a code block',
  },
  'My secret sauce recipe': {
    channel: 'form values and placeholders',
    why: 'the "Type your own" box is pre-filled with it, and an <input value> cannot use the forged font',
  },
};
