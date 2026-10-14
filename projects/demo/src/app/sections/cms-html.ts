import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { VeneerDirective } from '@pacyfist/veneer';
import { DomProbe } from '../ui/dom-probe';
import { A11yNote } from '../ui/a11y-note';

/** What a CMS might send: markup worth keeping, a readable name (class form, which survives sanitizing), and two unsafe bits. */
const CMS_HTML =
  '<p>Posted by <span class="veneer-skip">Ada Lovelace</span>. Run <code>npm test</code>, then follow the <a href="#start" onclick="alert(1)">setup guide</a>. The <strong>font</strong> does the decoding.</p><script>alert(2)</script>';

/** The same post after your own pipeline sanitized it with an allowlist that keeps veneer-skip. */
const CLEAN_HTML =
  '<p>Posted by <span veneer-skip>Ada Lovelace</span>. Run <code>npm test</code>, then follow the <a href="#start">setup guide</a>. The <strong>font</strong> does the decoding.</p>';

type Source = 'string' | 'trusted';

/**
 * `[veneerHtml]` live: CMS-style HTML, bound as a plain string (sanitized
 * like `[innerHTML]`) or as `SafeHtml`, with the element's resulting
 * innerHTML read back from the DOM.
 *
 * The input is quoted only in the browser: in the served HTML it would be the
 * post in plain text next to its own protected copy.
 */
@Component({
  selector: 'app-cms-html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VeneerDirective, DomProbe, A11yNote],
  template: `
    <div role="tablist" class="tabs tabs-border">
      @for (s of sources; track s.id) {
        <button
          type="button"
          role="tab"
          class="tab"
          [class.tab-active]="source() === s.id"
          [class.text-base-content/80]="source() !== s.id"
          [attr.aria-selected]="source() === s.id"
          (click)="source.set(s.id)"
        >
          {{ s.label }}
        </button>
      }
    </div>

    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-3">
        <p class="text-xs font-bold tracking-widest uppercase">The CMS sends</p>
        @if (browser()) {
          <pre
            class="rounded-field bg-neutral text-neutral-content p-3 font-mono text-xs break-all whitespace-pre-wrap"
          ><code>{{ sourceHtml() }}</code></pre>
        } @else {
          <div class="skeleton h-24 w-full"></div>
        }
        <p class="text-xs font-bold tracking-widest uppercase">You see</p>
        <div
          class="rounded-field border-base-300 border p-3 text-lg"
          [veneerHtml]="html()"
          data-testid="cms-element"
          appDomProbe
          #probe="domProbe"
        ></div>
      </div>
      <div class="rounded-field border-secondary/30 bot-scan min-w-0 border p-3">
        <p class="text-secondary text-xs font-bold tracking-widest uppercase">
          A bot reads (the element's innerHTML)
        </p>
        @if (probe.html(); as html) {
          <pre
            class="text-secondary mt-1 font-mono text-xs break-all whitespace-pre-wrap"
            data-testid="cms-dom"
          ><code>{{ html }}</code></pre>
          <app-a11y-note [hidden]="probe.ariaHidden()" [focusable]="true" />
        } @else {
          <div class="skeleton mt-1 h-24 w-full"></div>
        }
      </div>
    </div>
    <p class="text-base-content/70 mt-3 text-sm">
      @if (source() === 'string') {
        A string is sanitized like <code>[innerHTML]</code>: the <code>onclick</code> and the
        <code>&lt;script&gt;</code> are gone, links, <code>&lt;strong&gt;</code> and
        <code>&lt;code&gt;</code> stay. The sanitizer drops attributes it does not know but keeps
        <code>class</code>, so the name marked <code>class="veneer-skip"</code> stays readable.
      } @else {
        <code>SafeHtml</code> from <code>bypassSecurityTrustHtml()</code> goes in as it is, so only
        pass HTML your own pipeline has already sanitized. Here the attribute form,
        <code>veneer-skip</code>, survives too.
      }
    </p>
  `,
})
export class CmsHtml {
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly sources = [
    { id: 'string', label: 'A plain string' },
    { id: 'trusted', label: 'SafeHtml' },
  ] as const;
  protected readonly source = signal<Source>('string');
  protected readonly browser = signal(false);

  private readonly trusted = this.sanitizer.bypassSecurityTrustHtml(CLEAN_HTML);
  protected readonly html = computed(() => (this.source() === 'string' ? CMS_HTML : this.trusted));
  protected readonly sourceHtml = computed(() =>
    this.source() === 'string' ? CMS_HTML : CLEAN_HTML,
  );

  constructor() {
    afterNextRender(() => this.browser.set(true));
  }
}
