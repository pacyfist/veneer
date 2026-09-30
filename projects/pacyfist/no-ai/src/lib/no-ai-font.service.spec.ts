import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { NoAiFontService } from './no-ai-font.service';
import { NoAiConfig, provideNoAi } from './no-ai.config';
import { scrambleText } from './scramble-map';

@Component({ template: '<p>host</p>' })
class Host {}

/** Creates the service inside a rendered component, so afterNextRender fires. */
async function createService(config: NoAiConfig) {
  TestBed.configureTestingModule({ providers: [provideNoAi(config)] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const service = TestBed.inject(NoAiFontService);
  await fixture.whenStable();
  return service;
}

describe('NoAiFontService', () => {
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
    expect(service.familyName).toBe(`NoAi-${(99).toString(36)}`);
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

    expect(service.failed()).toContain('network down');
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
});
