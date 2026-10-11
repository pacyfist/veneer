import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BaseFont } from '@pacyfist/veneer/forge';
import {
  FontSourceError,
  clearBaseFontCache,
  loadBaseFont,
  resolveFontSource,
  resolveFontUrl,
} from './base-font';

const BASE = 'https://example.test/veneer/';
const FAKE_FONT = { numGlyphs: 1 } as BaseFont;

function bytesResponse(): Response {
  return new Response(new Uint8Array([0, 1, 0, 0]), { status: 200 });
}

/** A parse stub that records what it was handed. */
function parser() {
  return vi.fn(async (_bytes: ArrayBuffer) => FAKE_FONT);
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearBaseFontCache();
});

describe('resolveFontUrl', () => {
  it('resolves a relative path against the document base URL', () => {
    expect(resolveFontUrl('fonts/A.ttf', BASE)).toBe('https://example.test/veneer/fonts/A.ttf');
  });

  it('lets a leading slash escape the base path, which is why snippets avoid it', () => {
    expect(resolveFontUrl('/fonts/A.ttf', BASE)).toBe('https://example.test/fonts/A.ttf');
  });

  it('keeps absolute URLs', () => {
    expect(resolveFontUrl('https://cdn.test/A.ttf', BASE)).toBe('https://cdn.test/A.ttf');
  });
});

describe('resolveFontSource', () => {
  it('fetches a URL source, resolved against the base URL', async () => {
    const fetchMock = vi.fn(async () => bytesResponse());
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await resolveFontSource('fonts/A.ttf', BASE);
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/veneer/fonts/A.ttf');
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([0, 1, 0, 0]));
  });

  it('puts the resolved URL, the status and a subpath hint in a failed response', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404, statusText: 'Not Found' }));

    const error = await resolveFontSource('fonts/A.ttf', BASE).catch((e) => e);
    expect(error).toBeInstanceOf(FontSourceError);
    expect(error.url).toBe('https://example.test/veneer/fonts/A.ttf');
    expect(error.message).toContain('VNR010');
    expect(error.message).toContain('https://example.test/veneer/fonts/A.ttf');
    expect(error.message).toContain('404 Not Found');
    expect(error.message).toContain('<base href>');
  });

  it('leaves out an empty status text', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const error = await resolveFontSource('fonts/A.ttf', BASE).catch((e) => e);
    expect(error.message).toContain('failed: 404. ');
  });

  it('reports a network error with the URL', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = await resolveFontSource('fonts/A.ttf', BASE).catch((e) => e);
    expect(error).toBeInstanceOf(FontSourceError);
    expect(error.message).toContain('https://example.test/veneer/fonts/A.ttf');
    expect(error.message).toContain('Failed to fetch');
  });

  it('returns an ArrayBuffer source as is', async () => {
    const buffer = new ArrayBuffer(8);
    expect(await resolveFontSource(buffer, BASE)).toBe(buffer);
  });

  it('awaits a loader source', async () => {
    const buffer = new ArrayBuffer(8);
    expect(await resolveFontSource(async () => buffer, BASE)).toBe(buffer);
  });

  it('wraps a rejected loader, keeping its message', async () => {
    const error = await resolveFontSource(
      () => Promise.reject(new Error('network down')),
      BASE,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(FontSourceError);
    expect(error.message).toContain('VNR010');
    expect(error.message).toContain('network down');
  });
});

describe('resolveFontSource with a loader that throws FontSourceError', () => {
  it('passes it through unwrapped', async () => {
    const original = new FontSourceError('[veneer] VNR010: custom', 'https://cdn.test/A.ttf');
    const error = await resolveFontSource(() => Promise.reject(original), BASE).catch((e) => e);
    expect(error).toBe(original);
  });
});

describe('loadBaseFont', () => {
  it('fetches and parses a URL once, however many callers ask', async () => {
    const fetchMock = vi.fn(async () => bytesResponse());
    vi.stubGlobal('fetch', fetchMock);
    const parse = parser();

    const [a, b] = await Promise.all([
      loadBaseFont('fonts/A.ttf', BASE, parse),
      loadBaseFont('fonts/A.ttf', BASE, parse),
    ]);
    const c = await loadBaseFont('fonts/A.ttf', BASE, parse);

    expect(a).toBe(FAKE_FONT);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('keys URLs by their resolved form', async () => {
    const fetchMock = vi.fn(async () => bytesResponse());
    vi.stubGlobal('fetch', fetchMock);
    const parse = parser();

    await loadBaseFont('fonts/A.ttf', BASE, parse);
    await loadBaseFont('https://example.test/veneer/fonts/A.ttf', BASE, parse);
    await loadBaseFont('fonts/A.ttf', 'https://example.test/other/', parse);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops a failed fetch so the next caller retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(bytesResponse());
    vi.stubGlobal('fetch', fetchMock);
    const parse = parser();

    await expect(loadBaseFont('fonts/A.ttf', BASE, parse)).rejects.toThrow(/503/);
    await expect(loadBaseFont('fonts/A.ttf', BASE, parse)).resolves.toBe(FAKE_FONT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops a failed parse too', async () => {
    vi.stubGlobal('fetch', async () => bytesResponse());
    const parse = vi
      .fn()
      .mockRejectedValueOnce(new Error('bad font'))
      .mockResolvedValueOnce(FAKE_FONT);

    await expect(loadBaseFont('fonts/A.ttf', BASE, parse)).rejects.toThrow('bad font');
    await expect(loadBaseFont('fonts/A.ttf', BASE, parse)).resolves.toBe(FAKE_FONT);
  });

  it('parses the same ArrayBuffer once', async () => {
    const buffer = new ArrayBuffer(4);
    const parse = parser();

    await loadBaseFont(buffer, BASE, parse);
    await loadBaseFont(buffer, BASE, parse);
    await loadBaseFont(new ArrayBuffer(4), BASE, parse);

    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[0][0]).toBe(buffer);
  });

  it('calls the same loader function once', async () => {
    const loader = vi.fn(async () => new ArrayBuffer(4));
    const parse = parser();

    await loadBaseFont(loader, BASE, parse);
    await loadBaseFont(loader, BASE, parse);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('retries a loader that failed', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new ArrayBuffer(4));
    const parse = parser();

    await expect(loadBaseFont(loader, BASE, parse)).rejects.toThrow('offline');
    await expect(loadBaseFont(loader, BASE, parse)).resolves.toBe(FAKE_FONT);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
