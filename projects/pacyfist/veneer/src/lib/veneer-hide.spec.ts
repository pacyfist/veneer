import { createHash } from 'node:crypto';
import { CSP_NONCE, Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { VENEER_CSP_HASHES } from '@pacyfist/veneer';
import {
  VeneerTestingFontService,
  VeneerTestingOptions,
  provideVeneerTesting,
} from '@pacyfist/veneer/testing';
import { VeneerDirective } from './veneer.directive';
import { VeneerFontDirective } from './veneer-font.directive';
import { HIDE_SCRIPT, HIDE_STYLE } from './veneer-hide';

@Component({
  template: '<p veneer>Hello</p><h2 veneerFont>Title</h2>',
  imports: [VeneerDirective, VeneerFontDirective],
})
class Host {}

function render(
  platform: 'server' | 'browser',
  options: VeneerTestingOptions = {},
  nonce?: string,
) {
  TestBed.configureTestingModule({
    providers: [
      provideVeneerTesting({ seed: 3, state: 'loading', ...options }),
      { provide: PLATFORM_ID, useValue: platform },
      ...(nonce ? [{ provide: CSP_NONCE, useValue: nonce }] : []),
    ],
  });
  const service = TestBed.inject(VeneerTestingFontService);
  const fixture = TestBed.createComponent(Host);
  const [p, h2] = Array.from(fixture.nativeElement.children) as HTMLElement[];
  return { fixture, service, p, h2 };
}

afterEach(() => {
  document.getElementById('veneer-hide')?.remove();
  document.getElementById('veneer-js')?.remove();
});

describe('hiding server-rendered text', () => {
  it('marks elements and adds the switchable rule instead of an inline style', () => {
    const { fixture, p, h2 } = render('server', {}, 'n0nce');
    fixture.detectChanges();

    for (const el of [p, h2]) {
      expect(el.style.visibility).toBe('');
      expect(el.getAttribute('data-veneer-hidden')).toBe('');
    }
    const style = document.getElementById('veneer-hide')!;
    const script = document.getElementById('veneer-js')!;
    expect(style.textContent).toBe(HIDE_STYLE);
    expect(script.textContent).toBe(HIDE_SCRIPT);
    expect(style.getAttribute('nonce')).toBe('n0nce');
    expect(script.getAttribute('nonce')).toBe('n0nce');
    expect(document.head.querySelectorAll('#veneer-hide')).toHaveLength(1);
  });

  it('adds no nonce when the page has none', () => {
    const { fixture } = render('server');
    fixture.detectChanges();
    expect(document.getElementById('veneer-hide')!.hasAttribute('nonce')).toBe(false);
  });

  it("uses the hidden attribute and no inline code with hideWith: 'hidden'", () => {
    const { fixture, p } = render('server', { hideWith: 'hidden' });
    fixture.detectChanges();
    expect(p.hasAttribute('hidden')).toBe(true);
    expect(p.getAttribute('data-veneer-hidden')).toBe('hidden');
    expect(p.style.visibility).toBe('');
    expect(document.getElementById('veneer-hide')).toBeNull();
  });

  it('marks nothing once protection is off', () => {
    const { fixture, p } = render('server', { state: 'failed' });
    fixture.detectChanges();
    expect(p.hasAttribute('data-veneer-hidden')).toBe(false);
    expect(document.getElementById('veneer-hide')).toBeNull();
  });

  it('takes over in the browser: a CSSOM style first, then the marker goes', () => {
    const { fixture, service, p } = render('browser');
    p.setAttribute('data-veneer-hidden', '');
    fixture.detectChanges();

    expect(p.style.visibility).toBe('hidden');
    expect(p.hasAttribute('data-veneer-hidden')).toBe(false);

    service.setState('ready');
    fixture.detectChanges();
    expect(p.style.visibility).toBe('');
  });

  it('removes a hidden attribute it added, and only that', () => {
    const { fixture, p, h2 } = render('browser', { hideWith: 'hidden' });
    p.setAttribute('hidden', '');
    p.setAttribute('data-veneer-hidden', 'hidden');
    h2.setAttribute('hidden', '');
    fixture.detectChanges();

    expect(p.hasAttribute('hidden')).toBe(false);
    expect(h2.hasAttribute('hidden')).toBe(true);
  });

  it('publishes the hashes of the inline style and script', () => {
    const hash = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
    expect(VENEER_CSP_HASHES).toEqual({ script: hash(HIDE_SCRIPT), style: hash(HIDE_STYLE) });
  });
});

describe('translation', () => {
  it('marks protected elements translate="no" and notranslate while protection is on', () => {
    const { fixture, service, p, h2 } = render('browser', { state: 'ready' });
    fixture.detectChanges();
    for (const el of [p, h2]) {
      expect(el.getAttribute('translate')).toBe('no');
      expect(el.classList).toContain('notranslate');
    }

    service.setState('failed');
    fixture.detectChanges();
    for (const el of [p, h2]) {
      expect(el.hasAttribute('translate')).toBe(false);
      expect(el.classList).not.toContain('notranslate');
    }
  });

  it('marks the server-rendered HTML too', () => {
    const { fixture, p } = render('server');
    fixture.detectChanges();
    expect(p.getAttribute('translate')).toBe('no');
    expect(p.hasAttribute('data-veneer-ssr')).toBe(true);
  });
});
