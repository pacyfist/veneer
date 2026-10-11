import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VeneerFontService } from './veneer-font.service';
import {
  VeneerConfig,
  VeneerFeature,
  provideVeneer,
  withStatusAttribute,
  withStatusListener,
} from './veneer.config';
import { VeneerStatusEvent } from './veneer-status';
import { DEFAULT_CHARSET, scrambleText } from '@pacyfist/veneer/core';

/** A real font, so loading gets past parsing and forging (jsdom then lacks FontFace). */
function roboto(): ArrayBuffer {
  const bytes = readFileSync(join(__dirname, '../../testing/Roboto-Regular.ttf'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-veneer-status');
});

@Component({ template: '<p>host</p>' })
class Host {}

/** Creates the service inside a rendered component, so afterNextRender fires. */
async function createService(config: VeneerConfig, ...features: VeneerFeature[]) {
  TestBed.configureTestingModule({ providers: [provideVeneer(config, ...features)] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const service = TestBed.inject(VeneerFontService);
  await fixture.whenStable();
  return service;
}

describe('VeneerFontService', () => {
  it('builds the same cipher for the same seed', async () => {
    const a = await createService({ font: new ArrayBuffer(0), seed: 99, disabled: true });
    TestBed.resetTestingModule();
    const b = await createService({ font: new ArrayBuffer(0), seed: 99, disabled: true });

    expect([...a.map.forward]).toEqual([...b.map.forward]);
  });

  it('names the font after the seed, so two ciphers never share a family', async () => {
    const service = await createService({
      font: new ArrayBuffer(0),
      seed: 99,
      disabled: true,
    });
    expect(service.familyName).toBe(`Veneer-${(99).toString(36)}`);
  });

  it('leaves text alone when disabled', async () => {
    const service = await createService({ font: new ArrayBuffer(0), disabled: true });
    expect(service.scramble('Hello, world')).toBe('Hello, world');
    expect(service.active()).toBe(false);
  });

  it('scrambles text when active', async () => {
    const service = await createService({ font: new ArrayBuffer(0), seed: 5, disabled: true });
    // `disabled` short-circuits scramble(), so verify the map itself instead.
    expect(scrambleText('Hello', service.map)).not.toBe('Hello');
  });

  it('fails open when the font source throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const service = await createService({
      font: () => Promise.reject(new Error('network down')),
    });
    await vi.waitFor(() => expect(service.failed()).toBeTruthy());

    expect(service.failed()?.message).toContain('network down');
    expect(service.failed()?.code).toBe('VNR010');
    expect(service.status()).toBe('failed');
    expect(service.active()).toBe(false);
    expect(service.scramble('Hello, world')).toBe('Hello, world');
    // Nothing may stay hidden after a failure, or the page would go blank.
    expect(service.hidden()).toBe(false);

    consoleError.mockRestore();
  });

  it('fails open when the font bytes are not a real font', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const service = await createService({ font: new Uint8Array([1, 2, 3, 4]).buffer });
    await vi.waitFor(() => expect(service.failed()).toBeTruthy());

    expect(service.active()).toBe(false);
    expect(service.scramble('Hello, world')).toBe('Hello, world');

    consoleError.mockRestore();
  });

  it('drops the generated font from the stack when revealed', async () => {
    const service = await createService({
      font: new ArrayBuffer(0),
      seed: 1,
      fallbackFontFamily: "'Roboto', sans-serif",
      disabled: true,
    });

    service.revealed.set(true);
    expect(service.fontStack()).toBe("'Roboto', sans-serif");
    expect(service.fontStack()).not.toContain(service.familyName);
  });

  it('logs the failure with its code, keeping the "[veneer] disabled" prefix', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const service = await createService({ font: () => Promise.reject(new Error('offline')) });
    await vi.waitFor(() => expect(service.failed()).toBeTruthy());

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][0]).toMatch(/^\[veneer\] disabled \(VNR010\)/);
    expect(consoleError.mock.calls[0][0]).toContain('README.md#vnr010');
  });

  it('reports unreadable bytes as VNR011', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = await createService({ font: new Uint8Array([1, 2, 3, 4]).buffer });
    await vi.waitFor(() => expect(service.failed()).toBeTruthy());
    expect(service.failed()?.code).toBe('VNR011');
    expect(service.failed()?.message).toMatch(/could not parse/);
  });

  it('reports glyphs the font lacks as VNR012, listing them', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = await createService({
      font: roboto(),
      charset: [...DEFAULT_CHARSET, 0x1f600],
    });
    await vi.waitFor(() => expect(service.failed()).toBeTruthy());
    expect(service.failed()?.code).toBe('VNR012');
    expect(service.failed()?.missing).toEqual(['😀']);
  });

  it('reports a font the browser cannot register as VNR013', async () => {
    // jsdom has no FontFace, which is what a browser without the API looks like.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = await createService({ font: roboto() });
    await vi.waitFor(() => expect(service.failed()).toBeTruthy());
    expect(service.failed()?.code).toBe('VNR013');
  });

  it('tells status listeners about every change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const events: VeneerStatusEvent[] = [];

    const service = await createService(
      { font: () => Promise.reject(new Error('offline')) },
      withStatusListener((event) => events.push(event)),
    );
    await vi.waitFor(() => expect(events).toHaveLength(2));

    expect(events.map((e) => e.status)).toEqual(['loading', 'failed']);
    expect(events[0].failure).toBeNull();
    expect(events[1].failure?.code).toBe('VNR010');
    expect(events[1].familyName).toBe(service.familyName);
  });

  it('reports disabled once', async () => {
    const listener = vi.fn();
    const service = await createService(
      { font: new ArrayBuffer(0), disabled: true },
      withStatusListener(listener),
    );
    expect(service.status()).toBe('disabled');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].status).toBe('disabled');
  });

  it('survives a listener that throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();

    const service = await createService(
      { font: new ArrayBuffer(0), disabled: true },
      withStatusListener(() => {
        throw new Error('listener bug');
      }),
      withStatusListener(second),
    );

    expect(service.status()).toBe('disabled');
    expect(second).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[veneer] a status listener threw.',
      expect.any(Error),
    );
  });

  it('mirrors the status on <html> with withStatusAttribute()', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = document.documentElement;
    let reject!: (error: Error) => void;
    const pending = new Promise<ArrayBuffer>((_, r) => (reject = r));

    const service = await createService({ font: () => pending }, withStatusAttribute());
    expect(html.getAttribute('data-veneer-status')).toBe('loading');

    reject(new Error('offline'));
    await vi.waitFor(() => expect(service.status()).toBe('failed'));
    expect(html.getAttribute('data-veneer-status')).toBe('failed');

    TestBed.resetTestingModule();
    expect(html.hasAttribute('data-veneer-status')).toBe(false);
  });

  it('leaves <html> alone without withStatusAttribute()', async () => {
    await createService({ font: new ArrayBuffer(0), disabled: true });
    expect(document.documentElement.hasAttribute('data-veneer-status')).toBe(false);
  });
});
