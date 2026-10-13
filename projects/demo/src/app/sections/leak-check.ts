import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { VeneerFontService } from '@pacyfist/veneer';
import { ServedPage, ServedPageLoader } from '../ui/served-page';

interface Row {
  readonly text: string;
  /** '' when clean, else where the served HTML holds it. */
  readonly html: string;
  /** The script files that hold it, by file name. */
  readonly js: readonly string[];
}

interface Report {
  readonly rows: readonly Row[];
  readonly htmlKb: number;
  readonly scripts: number;
  readonly scriptKb: number;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const kb = (text: string) => Math.round(new TextEncoder().encode(text).byteLength / 1024);
const fileName = (url: string) => new URL(url).pathname.split('/').pop() ?? url;

/**
 * `findVeneerLeaks` from `@pacyfist/veneer/testing`, run in the browser over
 * this page's served HTML and every script it loaded, for the texts the
 * server protected in that HTML (decoded with this page's cipher).
 *
 * The testing entry point is imported on the click, so it is a lazy chunk and
 * never part of the initial bundle.
 */
@Component({
  selector: 'app-leak-check',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (report(); as r) {
      <p class="text-base-content/70 mb-3 text-sm">
        {{ r.rows.length }} texts the server protected in this page, checked against its served HTML
        ({{ r.htmlKb }} KB) and the {{ r.scripts }} script files it loaded ({{ r.scriptKb }} KB).
      </p>
      <ul class="divide-base-300 flex flex-col divide-y" data-testid="leak-report">
        @for (row of r.rows; track $index) {
          <li class="py-2">
            <p class="truncate" [title]="row.text" data-field="text">{{ row.text }}</p>
            <p class="text-xs">
              Served HTML:
              <span data-field="html" [class.text-warning]="row.html">{{
                row.html || 'clean'
              }}</span>
              · JavaScript:
              <span class="font-mono" data-field="js" [class.text-warning]="row.js.length">{{
                row.js.length ? 'found in ' + row.js.join(', ') : 'clean'
              }}</span>
            </p>
          </li>
        }
      </ul>
      <p class="mt-3 text-sm">
        The served HTML holds only ciphertext{{
          quoted() ? ', apart from the demo quoting itself' : ''
        }}. The JavaScript holds every one of these texts, because they are written in this demo's
        source and Angular compiles template text into the bundle. Only text that arrives at
        runtime, from an API or a CMS, stays out of it.
      </p>
    } @else {
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        [disabled]="running() || !veneer.initialMap()"
        (click)="run()"
      >
        @if (running()) {
          <span class="loading loading-spinner loading-xs"></span>
        }
        Check this page for leaks
      </button>
      @if (error()) {
        <p class="text-warning mt-2 font-mono text-sm">{{ error() }}</p>
      }
    }
  `,
})
export class LeakCheck {
  protected readonly veneer = inject(VeneerFontService);
  private readonly served = inject(ServedPageLoader);

  protected readonly report = signal<Report | null>(null);
  protected readonly running = signal(false);
  protected readonly error = signal('');
  protected readonly quoted = computed(() => this.report()?.rows.some((r) => r.html) ?? false);

  protected async run(): Promise<void> {
    const map = this.veneer.initialMap();
    if (!map) return;
    this.running.set(true);
    try {
      const [{ decodeVeneer, findVeneerLeaks }, page] = await Promise.all([
        import('@pacyfist/veneer/testing'),
        this.served.load(),
      ]);

      // The texts the server protected, decoded the way the browser does.
      const originals = [
        ...new Set(
          [...page.doc.querySelectorAll('[data-veneer-ssr]')].map((el) =>
            squash(decodeVeneer(el, map)),
          ),
        ),
      ].filter(Boolean);

      const scripts = await loadScripts(page);
      const quotes = [...page.doc.querySelectorAll('code, pre')].map((el) => el.textContent ?? '');
      const values = [...page.doc.querySelectorAll('[value], [placeholder]')].map(
        (el) => `${el.getAttribute('value') ?? ''} ${el.getAttribute('placeholder') ?? ''}`,
      );
      const found = (text: string, original: string) =>
        findVeneerLeaks(text, [original]).length > 0;

      const rows = originals.map((text) => ({
        text,
        html: !found(page.html, text)
          ? ''
          : quotes.some((q) => found(q, text))
            ? 'quoted in a code sample'
            : values.some((v) => found(v, text))
              ? 'in a form value'
              : 'found',
        js: Object.entries(scripts)
          .filter(([, js]) => found(js, text))
          .map(([url]) => fileName(url)),
      }));

      const js = Object.values(scripts);
      this.report.set({
        rows,
        htmlKb: kb(page.html),
        scripts: js.length,
        scriptKb: js.reduce((sum, source) => sum + kb(source), 0),
      });
    } catch (cause) {
      this.error.set(`The check failed: ${(cause as Error).message}`);
    } finally {
      this.running.set(false);
    }
  }
}

/** Every script the served HTML names or the page has loaded, by absolute URL. */
async function loadScripts(page: ServedPage): Promise<Record<string, string>> {
  const urls = new Set<string>();
  for (const el of page.doc.querySelectorAll('script[src], link[rel="modulepreload"]')) {
    const src = el.getAttribute('src') ?? el.getAttribute('href');
    if (src) urls.add(new URL(src, page.url).href);
  }
  for (const entry of performance.getEntriesByType('resource')) {
    const url = new URL(entry.name);
    if (url.origin === location.origin && url.pathname.endsWith('.js')) urls.add(url.href);
  }
  const scripts: Record<string, string> = {};
  await Promise.all(
    [...urls].map(async (url) => {
      const response = await fetch(url);
      if (response.ok) scripts[url] = await response.text();
    }),
  );
  return scripts;
}
