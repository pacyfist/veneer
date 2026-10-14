import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CHARSET,
  buildScrambleMap,
  invertScrambleMap,
  scrambleText,
} from '@pacyfist/veneer/core';
import {
  VeneerTestingFontService,
  VeneerTestingOptions,
  decodeVeneer,
  provideVeneerTesting,
} from '@pacyfist/veneer/testing';
import { VeneerDirective } from './veneer.directive';
import { VeneerFontDirective } from './veneer-font.directive';
import { VeneerPipe } from './veneer.pipe';
import { VeneerFontService } from './veneer-font.service';
import { provideVeneer } from './veneer.config';

const SEED = 2024;
const MAP = buildScrambleMap(SEED);
const scramble = (text: string) => scrambleText(text, MAP);

/** The data of every text node under `el`, in order. */
const texts = (el: Node): string[] => {
  const out: string[] = [];
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) out.push((child as Text).data);
      else visit(child);
    }
  };
  visit(el);
  return out;
};

@Component({
  // prettier-ignore
  template: `<p veneer>Read <a href="/more">the rest</a> with <strong>care</strong> and <em>joy</em>.</p>`,
  imports: [VeneerDirective],
})
class RichHost {}

@Component({
  template: `<div veneer>
    Run <code>npm test</code>, keep <span veneer-skip>Plain Name</span>, protect
    <pre>a poem</pre>
    <textarea>draft</textarea>
  </div>`,
  imports: [VeneerDirective],
})
class SkipHost {}

@Component({
  template: `<p veneer>Written by <span class="byline veneer-skip">Plain Name</span>.</p>`,
  imports: [VeneerDirective],
})
class ClassSkipHost {}

@Component({
  template: `<article veneer>
    Body text. <span veneerFont>{{ title() | veneer }}</span>
    <span veneer>Inner text</span>
  </article>`,
  imports: [VeneerDirective, VeneerFontDirective, VeneerPipe],
})
class NestedHost {
  readonly title = signal('Piped title');
}

@Component({ template: '<p veneer></p>', imports: [VeneerDirective] })
class EmptyHost {}

@Component({ template: '<p [veneer]="body()"></p>', imports: [VeneerDirective] })
class BoundHost {
  readonly body = signal<string | undefined>('Hello, world');
}

@Component({ template: '<div [veneerHtml]="html()"></div>', imports: [VeneerDirective] })
class HtmlHost {
  readonly html = signal<string | object | null>(
    'Click <a href="/x" onclick="alert(1)">here</a><script>alert(2)</script> <b>now</b>',
  );
}

function configure(options: VeneerTestingOptions = {}) {
  TestBed.configureTestingModule({ providers: [provideVeneerTesting({ seed: SEED, ...options })] });
  return TestBed.inject(VeneerTestingFontService);
}

function setup<T>(host: Type<T>, options: VeneerTestingOptions = {}) {
  const service = configure(options);
  const fixture: ComponentFixture<T> = TestBed.createComponent(host);
  fixture.detectChanges();
  const el = fixture.nativeElement.firstElementChild as HTMLElement;
  return { fixture, service, el };
}

/** Render EmptyHost with server-rendered markup planted in it, as hydration finds it. */
function hydrate(markup: string, prepare?: (service: VeneerTestingFontService) => void) {
  const service = configure();
  prepare?.(service);
  const fixture = TestBed.createComponent(EmptyHost);
  const el = fixture.nativeElement.querySelector('p') as HTMLElement;
  el.innerHTML = markup;
  el.setAttribute('data-veneer-ssr', '');
  fixture.detectChanges();
  return { fixture, service, el };
}

afterEach(() => vi.restoreAllMocks());

describe('VeneerDirective text-node walker', () => {
  it('keeps nested markup and scrambles each text node', () => {
    const { el } = setup(RichHost);

    expect(el.querySelector('a')?.getAttribute('href')).toBe('/more');
    expect(el.querySelector('strong')).not.toBeNull();
    expect(el.querySelector('em')).not.toBeNull();
    expect(texts(el)).toEqual(
      ['Read ', 'the rest', ' with ', 'care', ' and ', 'joy', '.'].map(scramble),
    );
    expect(decodeVeneer(el)).toBe('Read the rest with care and joy.');
  });

  it('rewrites the text nodes Angular created rather than replacing them', () => {
    configure();
    const fixture = TestBed.createComponent(RichHost);
    const el = fixture.nativeElement.querySelector('p') as HTMLElement;
    const before = Array.from(el.querySelectorAll('*'))
      .concat(el)
      .flatMap((e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3));

    fixture.detectChanges();

    const after = Array.from(el.querySelectorAll('*'))
      .concat(el)
      .flatMap((e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3));
    expect(after).toHaveLength(before.length);
    after.forEach((node, i) => expect(node).toBe(before[i]));
  });

  it('skips code, textarea and veneer-skip subtrees, and protects pre', () => {
    const { el } = setup(SkipHost);

    expect(el.querySelector('code')?.textContent).toBe('npm test');
    expect(el.querySelector('[veneer-skip]')?.textContent).toBe('Plain Name');
    expect(el.querySelector('textarea')?.value).toBe('draft');
    expect(el.querySelector('pre')?.textContent).toBe(scramble('a poem'));
    expect(el.textContent).toContain(scramble('Run'));
  });

  it('also skips an element marked with the veneer-skip class', () => {
    const { el } = setup(ClassSkipHost);
    expect(el.querySelector('.veneer-skip')?.textContent).toBe('Plain Name');
    expect(el.textContent).toContain(scramble('Written'));
  });

  it('draws veneer-skip subtrees in the fallback font, not the forged one', () => {
    const { el, service, fixture } = setup(SkipHost, { fallbackFontFamily: 'Georgia, serif' });
    const skip = el.querySelector('[veneer-skip]') as HTMLElement;
    expect(el.style.fontFamily).toContain(service.familyName);
    expect(skip.style.fontFamily).toBe('Georgia, serif');

    service.setState('failed');
    fixture.detectChanges();
    expect(skip.style.fontFamily).toBe('');
  });

  it('leaves nested veneer and veneerFont elements to protect their own text', () => {
    const { el } = setup(NestedHost);
    const [piped, inner] = Array.from(el.querySelectorAll('span'));

    expect(piped.textContent).toBe(scramble('Piped title'));
    expect(inner.textContent).toBe(scramble('Inner text'));
    expect(el.firstChild?.textContent?.trim()).toBe(scramble('Body text.'));
  });

  it('restores every text node when the font fails, and re-scrambles when it recovers', () => {
    const { el, service, fixture } = setup(RichHost);

    service.setState('failed');
    fixture.detectChanges();
    expect(el.textContent).toBe('Read the rest with care and joy.');
    expect(el.querySelector('a')?.textContent).toBe('the rest');

    service.setState('ready');
    fixture.detectChanges();
    expect(el.textContent).toBe(scramble('Read the rest with care and joy.'));
  });

  describe('hydration', () => {
    const SERVER = `${scramble('Read ')}<a href="/more">${scramble('the rest')}</a>${scramble(' now.')}`;

    it('inverts the server ciphertext per text node with the initial map, once', () => {
      const { el } = hydrate(SERVER);
      expect(texts(el)).toEqual(['Read ', 'the rest', ' now.'].map(scramble));
      expect(decodeVeneer(el)).toBe('Read the rest now.');
    });

    it('keeps the recovered originals, so fail-open shows readable text', () => {
      const { el, service, fixture } = hydrate(SERVER);
      service.setState('failed');
      fixture.detectChanges();
      expect(el.textContent).toBe('Read the rest now.');
    });

    it('leaves the server text in place while initialMap() is null, then recovers it', () => {
      const { el, service, fixture } = hydrate(SERVER, (s) => s.setInitialMap(null));
      const before = texts(el);
      expect(before).toEqual(['Read ', 'the rest', ' now.'].map(scramble));

      // Failing while the map is unknown cannot invert anything: the server's
      // text stays as it is rather than being "restored" to ciphertext.
      service.setState('failed');
      fixture.detectChanges();
      expect(texts(el)).toEqual(before);

      service.setInitialMap(MAP);
      fixture.detectChanges();
      expect(el.textContent).toBe('Read the rest now.');

      service.setState('ready');
      fixture.detectChanges();
      expect(texts(el)).toEqual(before);
    });

    it('inverts with the initial map, which then becomes the map in force', () => {
      const serverMap = buildScrambleMap(99);
      const server = `${scrambleText('Hello ', serverMap)}<b>${scrambleText('x', serverMap)}</b>`;
      const { el, service } = hydrate(server, (s) => s.setInitialMap(serverMap));
      expect(service.map()).toBe(serverMap);
      expect(el.textContent).toBe(scrambleText('Hello x', serverMap));
      expect(scrambleText(el.textContent!, invertScrambleMap(serverMap))).toBe('Hello x');
    });

    it('treats nodes added after the first pass as readable', () => {
      const { el, service, fixture } = hydrate(SERVER);
      const added = document.createElement('span');
      added.textContent = 'Later';
      el.appendChild(added);

      // Any re-application picks the new node up as readable text.
      service.revealed.set(true);
      fixture.detectChanges();
      expect(added.textContent).toBe(scramble('Later'));
      service.setState('failed');
      fixture.detectChanges();
      expect(el.textContent).toBe('Read the rest now.Later');
    });
  });

  describe('bound string', () => {
    it('clears the text when the binding changes to an empty string', () => {
      const { el, fixture } = setup(BoundHost);
      expect(el.textContent).toBe(scramble('Hello, world'));

      fixture.componentInstance.body.set('');
      fixture.detectChanges();
      expect(el.textContent).toBe('');

      fixture.componentInstance.body.set('Back');
      fixture.detectChanges();
      expect(el.textContent).toBe(scramble('Back'));
    });

    it('clears the text when the binding changes to undefined', () => {
      const { el, fixture } = setup(BoundHost);
      fixture.componentInstance.body.set(undefined);
      fixture.detectChanges();
      expect(el.textContent).toBe('');
    });

    it('renders an empty initial binding as nothing rather than adopting the content', () => {
      configure();
      const fixture = TestBed.createComponent(BoundHost);
      fixture.componentInstance.body.set('');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('p').textContent).toBe('');
    });

    it('reuses the text node the server rendered', () => {
      configure();
      const fixture = TestBed.createComponent(BoundHost);
      const el = fixture.nativeElement.querySelector('p') as HTMLElement;
      el.textContent = scramble('Hello, world');
      el.setAttribute('data-veneer-ssr', '');
      const node = el.firstChild;

      fixture.detectChanges();
      expect(el.firstChild).toBe(node);
      expect(el.textContent).toBe(scramble('Hello, world'));
    });
  });

  describe('veneerHtml', () => {
    it('renders sanitized HTML and protects its text nodes', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { el } = setup(HtmlHost);

      const link = el.querySelector('a')!;
      expect(link.getAttribute('href')).toBe('/x');
      expect(link.hasAttribute('onclick')).toBe(false);
      expect(el.querySelector('script')).toBeNull();
      expect(link.textContent).toBe(scramble('here'));
      expect(el.querySelector('b')?.textContent).toBe(scramble('now'));
      expect(decodeVeneer(el)).toBe('Click here now');
    });

    it('keeps a class="veneer-skip" span readable, since the sanitizer keeps class', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { el, fixture } = setup(HtmlHost);
      fixture.componentInstance.html.set(
        'Posted by <span class="veneer-skip">Ada Lovelace</span> <span veneer-skip>Dropped</span>',
      );
      fixture.detectChanges();

      // The attribute form does not survive sanitizing; the class form does.
      expect(el.querySelector('[veneer-skip]')).toBeNull();
      expect(el.querySelector('.veneer-skip')?.textContent).toBe('Ada Lovelace');
      expect(el.textContent).toContain(scramble('Dropped'));
      expect(decodeVeneer(el)).toBe('Posted by Ada Lovelace Dropped');
    });

    it('accepts SafeHtml from bypassSecurityTrustHtml', () => {
      const service = configure();
      const fixture = TestBed.createComponent(HtmlHost);
      const trusted = TestBed.inject(DomSanitizer).bypassSecurityTrustHtml(
        '<span style="color: red">Red</span>',
      );
      fixture.componentInstance.html.set(trusted);
      fixture.detectChanges();

      const span = fixture.nativeElement.querySelector('span') as HTMLElement;
      expect(span.style.color).toBe('red');
      expect(span.textContent).toBe(scrambleText('Red', service.map()));
    });

    it('re-renders when the HTML changes and restores it on fail-open', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { el, fixture, service } = setup(HtmlHost);
      fixture.componentInstance.html.set('<i>New</i> text');
      fixture.detectChanges();
      expect(el.innerHTML).toBe(`<i>${scramble('New')}</i>${scramble(' text')}`);

      service.setState('failed');
      fixture.detectChanges();
      expect(el.innerHTML).toBe('<i>New</i> text');
    });
  });
});

describe('VeneerDirective walker with the real service', () => {
  const ROBOTO = (() => {
    const bytes = readFileSync(join(__dirname, '../../testing/Roboto-Regular.ttf'));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  })();

  class FakeFontFace {
    readonly status = 'loaded';
    constructor(readonly family: string) {}
    load() {
      return Promise.resolve(this);
    }
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    delete (document as { fonts?: unknown }).fonts;
  });

  it('re-scrambles every text node with the narrowed map once the font loads', async () => {
    vi.stubGlobal('FontFace', FakeFontFace);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: () => {}, delete: () => {} },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    TestBed.configureTestingModule({
      providers: [
        provideVeneer({ font: ROBOTO, seed: 7, charset: [...DEFAULT_CHARSET, 0x180, 0x183] }),
      ],
    });
    const service = TestBed.inject(VeneerFontService);
    const fixture = TestBed.createComponent(EmptyHost);
    const el = fixture.nativeElement.querySelector('p') as HTMLElement;
    const initial = service.initialMap()!;
    el.innerHTML = `${scrambleText('Hi ƀ', initial)}<b>${scrambleText('ƃ there', initial)}</b>`;
    el.setAttribute('data-veneer-ssr', '');
    fixture.detectChanges();

    await vi.waitFor(() => expect(service.status()).toBe('active'));
    fixture.detectChanges();

    const map = service.map();
    expect(map).not.toBe(initial);
    expect(texts(el)).toEqual([scrambleText('Hi ƀ', map), scrambleText('ƃ there', map)]);
    expect(el.textContent).toContain('ƀ');
  });
});
