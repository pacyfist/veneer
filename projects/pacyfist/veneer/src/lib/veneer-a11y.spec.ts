import { Component, PLATFORM_ID, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildScrambleMap, scrambleText } from '@pacyfist/veneer/core';
import {
  VeneerTestingFontService,
  VeneerTestingOptions,
  provideVeneerTesting,
} from '@pacyfist/veneer/testing';
import { VeneerDirective } from './veneer.directive';
import { VeneerFontDirective } from './veneer-font.directive';
import { VeneerPipe } from './veneer.pipe';
import { VeneerReadableToggle } from './veneer-readable-toggle';
import { VeneerFontService } from './veneer-font.service';
import { provideVeneer, withA11y, withReadableCopy } from './veneer.config';
import { READABLE_STORAGE_KEY, readableMode } from './veneer-readable';
import { copyReadable } from './veneer-copy';

const SEED = 77;
const MAP = buildScrambleMap(SEED);
const scramble = (text: string) => scrambleText(text, MAP);

@Component({
  template: `
    <p id="before">Plain intro.</p>
    <p veneer>Secret words <span veneer-skip>Plain name</span></p>
    <h2 veneerFont>{{ 'Piped title' | veneer }}</h2>
    <p id="after">Tail.</p>
  `,
  imports: [VeneerDirective, VeneerFontDirective, VeneerPipe],
})
class Page {}

@Component({
  template: `<p veneer>Read <a href="/x">this</a></p>
    <p veneer aria-hidden="true">Static</p>`,
  imports: [VeneerDirective],
})
class LinkPage {}

@Component({
  template: `
    <button veneerReadableToggle></button>
    <button veneerReadableToggle class="custom">Plain words, please</button>
  `,
  imports: [VeneerReadableToggle],
})
class TogglePage {}

function render<T>(host: Type<T>, options: VeneerTestingOptions = {}, platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      provideVeneerTesting({ seed: SEED, ...options }),
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  const service = TestBed.inject(VeneerTestingFontService);
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return { fixture, service, root };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.getSelection()?.removeAllRanges();
});

describe("withA11y('hide')", () => {
  it('sets aria-hidden only while protection is active', () => {
    const { fixture, service, root } = render(Page, { a11y: 'hide', state: 'loading' });
    const [p, h2] = [root.querySelector('p[veneer]')!, root.querySelector('h2')!];
    expect(p.getAttribute('aria-hidden')).toBe('true');
    expect(h2.getAttribute('aria-hidden')).toBe('true');

    service.setState('failed');
    fixture.detectChanges();
    expect(p.hasAttribute('aria-hidden')).toBe(false);
    expect(h2.hasAttribute('aria-hidden')).toBe(false);

    service.setState('ready');
    fixture.detectChanges();
    expect(p.getAttribute('aria-hidden')).toBe('true');

    service.readable.set(true);
    fixture.detectChanges();
    expect(p.hasAttribute('aria-hidden')).toBe(false);
  });

  it('is written into the server-rendered HTML', () => {
    const { root } = render(Page, { a11y: 'hide' }, 'server');
    expect(root.querySelector('p[veneer]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('never hides an element containing something focusable, and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fixture, service, root } = render(LinkPage, { a11y: 'hide' });
    const [withLink] = Array.from(root.querySelectorAll('p'));
    expect(withLink.hasAttribute('aria-hidden')).toBe(false);

    service.revealed.set(true);
    fixture.detectChanges();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/VNR021.*#vnr021/);
  });

  it('leaves aria-hidden alone without the feature', () => {
    const { root } = render(LinkPage);
    const [withLink, stat] = Array.from(root.querySelectorAll('p'));
    expect(withLink.hasAttribute('aria-hidden')).toBe(false);
    expect(stat.getAttribute('aria-hidden')).toBe('true');
  });

  it('resolves through provideVeneer', () => {
    TestBed.configureTestingModule({
      providers: [
        provideVeneer({ font: new ArrayBuffer(0) }, withA11y('hide'), withReadableCopy()),
      ],
    });
    expect(TestBed.inject(VeneerFontService)).toBeTruthy();
  });
});

describe('readable mode', () => {
  function fakeDocument(storage: Partial<Storage> | (() => never)) {
    const defaultView =
      typeof storage === 'function'
        ? Object.defineProperty({}, 'localStorage', { get: storage })
        : { localStorage: storage };
    return { defaultView } as unknown as Document;
  }

  function memoryStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      data,
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => void (data[k] = v),
      removeItem: (k: string) => void delete data[k],
    };
  }

  it('starts from the remembered choice and remembers changes', () => {
    const storage = memoryStorage({ [READABLE_STORAGE_KEY]: '1' });
    const doc = fakeDocument(storage);
    const mode = readableMode(doc, true);
    expect(mode()).toBe(true);

    mode.set(false);
    expect(storage.data[READABLE_STORAGE_KEY]).toBeUndefined();
    mode.update((on) => !on);
    expect(mode()).toBe(true);
    expect(storage.data[READABLE_STORAGE_KEY]).toBe('1');
  });

  it('is one signal per document, shared by every instance', () => {
    const doc = fakeDocument(memoryStorage());
    expect(readableMode(doc, true)).toBe(readableMode(doc, true));
  });

  it('works without storage, or with storage that throws', () => {
    const blocked = fakeDocument(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const throwing = fakeDocument({
      getItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    for (const doc of [blocked, throwing]) {
      const mode = readableMode(doc, true);
      expect(mode()).toBe(false);
      mode.set(true);
      expect(mode()).toBe(true);
    }
  });

  it('is always off, and never shared, on the server', () => {
    const doc = fakeDocument(memoryStorage({ [READABLE_STORAGE_KEY]: '1' }));
    const a = readableMode(doc, false);
    expect(a()).toBe(false);
    expect(readableMode(doc, false)).not.toBe(a);
  });

  it('switches the real service off and remembers it in localStorage', () => {
    // The test environment's own localStorage may be missing; use a stand-in.
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
    TestBed.configureTestingModule({ providers: [provideVeneer({ font: new ArrayBuffer(0) })] });
    const service = TestBed.inject(VeneerFontService);
    try {
      service.readable.set(true);
      expect(service.active()).toBe(false);
      expect(service.scramble('abc')).toBe('abc');
      expect(storage.data[READABLE_STORAGE_KEY]).toBe('1');
    } finally {
      service.readable.set(false);
      vi.unstubAllGlobals();
    }
    expect(storage.data[READABLE_STORAGE_KEY]).toBeUndefined();
  });

  it('restores readable text everywhere and scrambles again when switched back', () => {
    const { fixture, service, root } = render(Page);
    const p = root.querySelector('p[veneer]') as HTMLElement;
    const h2 = root.querySelector('h2') as HTMLElement;
    expect(p.firstChild!.textContent).toBe(scramble('Secret words '));

    service.readable.set(true);
    fixture.detectChanges();
    expect(p.textContent).toBe('Secret words Plain name');
    expect(h2.textContent).toBe('Piped title');
    expect(p.style.fontFamily).toBe('sans-serif');
    expect(p.hasAttribute('translate')).toBe(false);

    service.readable.set(false);
    fixture.detectChanges();
    expect(p.firstChild!.textContent).toBe(scramble('Secret words '));
    expect(h2.textContent).toBe(scramble('Piped title'));
  });

  it('keeps server text hidden while it waits for the initial map', () => {
    TestBed.configureTestingModule({ providers: [provideVeneerTesting({ seed: SEED })] });
    const service = TestBed.inject(VeneerTestingFontService);
    service.setInitialMap(null);
    service.readable.set(true);
    const fixture = TestBed.createComponent(EmptyPage);
    const p = fixture.nativeElement.querySelector('p') as HTMLElement;
    p.textContent = scramble('From the server');
    p.setAttribute('data-veneer-ssr', '');
    fixture.detectChanges();
    expect(p.style.visibility).toBe('hidden');

    service.setInitialMap(MAP);
    fixture.detectChanges();
    expect(p.textContent).toBe('From the server');
    expect(p.style.visibility).toBe('');
  });
});

@Component({ template: '<p veneer></p>', imports: [VeneerDirective] })
class EmptyPage {}

describe('VeneerReadableToggle', () => {
  it('is a toggle button for readable mode with a default label', () => {
    const { fixture, service, root } = render(TogglePage);
    const [plain, custom] = Array.from(root.querySelectorAll('button'));
    expect(plain.textContent?.trim()).toBe('Readable text');
    expect(plain.getAttribute('type')).toBe('button');
    expect(plain.getAttribute('aria-pressed')).toBe('false');
    expect(custom.textContent?.trim()).toBe('Plain words, please');
    expect(custom.classList).toContain('custom');

    plain.click();
    fixture.detectChanges();
    expect(service.readable()).toBe(true);
    expect(plain.getAttribute('aria-pressed')).toBe('true');
    expect(custom.getAttribute('aria-pressed')).toBe('true');

    custom.click();
    fixture.detectChanges();
    expect(service.readable()).toBe(false);
  });
});

describe('withReadableCopy()', () => {
  /** A copy event with a working clipboardData, as the browser fires it. */
  function copy() {
    const data: Record<string, string> = {};
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (type: string, value: string) => void (data[type] = value) },
    });
    copyReadable(document, event);
    return { data, prevented: event.defaultPrevented };
  }

  function select(start: Node, startOffset: number, end: Node, endOffset: number) {
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(start, startOffset, end, endOffset);
    return selection;
  }

  function parts(root: HTMLElement) {
    const before = root.querySelector('#before')!.firstChild as Text;
    const p = root.querySelector('p[veneer]') as HTMLElement;
    const secret = p.firstChild as Text;
    const skipped = p.querySelector('span')!.firstChild as Text;
    const piped = root.querySelector('h2')!.firstChild as Text;
    const after = root.querySelector('#after')!.firstChild as Text;
    return { before, secret, skipped, piped, after };
  }

  it('copies readable text for a selection that starts outside a protected element', () => {
    const { root } = render(Page, { readableCopy: true });
    const { before, secret } = parts(root);
    const selection = select(before, 6, secret, 6);

    const { data, prevented } = copy();
    expect(prevented).toBe(true);
    expect(data['text/plain']).toBe('intro.Secret');
    expect(data['text/html']).toContain('Secret');
    expect(data['text/html']).not.toContain(scramble('Secret'));

    // The DOM and the selection are put back exactly.
    expect(secret.data).toBe(scramble('Secret words '));
    expect(selection.anchorNode).toBe(before);
    expect(selection.anchorOffset).toBe(6);
    expect(selection.focusNode).toBe(secret);
    expect(selection.focusOffset).toBe(6);
  });

  it('decodes pipe output and leaves skipped and unprotected text as it is', () => {
    const { root } = render(Page, { readableCopy: true });
    const { before, after } = parts(root);
    select(before, 0, after, 5);

    // jsdom serializes a selection without layout, so blocks are not on lines of their own.
    expect(copy().data['text/plain']).toBe('Plain intro.Secret words Plain namePiped titleTail.');
  });

  it('drops the forged font from the copied HTML', () => {
    const { root, service } = render(Page, { readableCopy: true });
    const { before, after } = parts(root);
    select(before, 0, after, 5);
    const html = copy().data['text/html'];
    expect(html).not.toContain(service.familyName);
    expect(html).toContain('Plain name</span>');
    expect(html).toContain('>Secret words <span');
  });

  it('leaves the copy alone without the feature, outside protected text, and in readable mode', () => {
    const off = render(Page);
    let { before, secret, after } = parts(off.root);
    select(before, 0, secret, 3);
    expect(copy().prevented).toBe(false);
    TestBed.resetTestingModule();

    const on = render(Page, { readableCopy: true });
    ({ before, after } = parts(on.root));
    select(after, 0, after, 4);
    expect(copy().prevented).toBe(false);

    on.service.readable.set(true);
    on.fixture.detectChanges();
    ({ before, secret } = parts(on.root));
    select(before, 0, secret, 3);
    expect(copy().prevented).toBe(false);
  });

  it('listens on document once the feature is on', () => {
    const { root } = render(Page, { readableCopy: true });
    const { before, secret } = parts(root);
    select(before, 0, secret, 6);
    const data: Record<string, string> = {};
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (type: string, value: string) => void (data[type] = value) },
    });
    root.querySelector('#before')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(data['text/plain']).toBe('Plain intro.Secret');
  });
});
