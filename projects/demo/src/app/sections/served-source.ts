import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

type Status = 'loading' | 'ok' | 'error';

/**
 * Fetches the page's own served HTML and shows the protected paragraph from it.
 *
 * The evidence is the response body rather than anything this component
 * composed, which is the only reason the section is worth having.
 */
@Component({
  selector: 'app-served-source',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mockup-browser border-base-300 bg-base-200 border">
      <div class="mockup-browser-toolbar">
        <div class="input text-xs">{{ url() || 'loading…' }}</div>
        @if (status() === 'ok') {
          <span class="badge badge-primary badge-sm ml-2">200 OK</span>
        }
      </div>
      <div class="bg-base-100 bot-scan px-4 py-4">
        @switch (status()) {
          @case ('loading') {
            <span class="loading loading-dots loading-sm"></span>
          }
          @case ('error') {
            <p class="text-warning font-mono text-sm">{{ error() }}</p>
          }
          @case ('ok') {
            <pre
              class="text-secondary overflow-x-auto font-mono text-sm whitespace-pre-wrap"
            ><code>{{ markup() }}</code></pre>
          }
        }
      </div>
    </div>
  `,
})
export class ServedSource {
  private readonly document = inject(DOCUMENT);

  protected readonly url = signal('');
  protected readonly status = signal<Status>('loading');
  protected readonly markup = signal('');
  protected readonly error = signal('');

  constructor() {
    afterNextRender(() => void this.load());
  }

  private async load(): Promise<void> {
    const href = this.document.baseURI;
    this.url.set(href);

    try {
      const response = await fetch(href, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const protectedEl = parsed.querySelector('[data-veneer-ssr]');

      if (!protectedEl) {
        this.error.set(
          'No server-scrambled paragraph was found in the response. On a dev server without prerendering this is expected.',
        );
        this.status.set('error');
        return;
      }

      this.markup.set(protectedEl.outerHTML);
      this.status.set('ok');
    } catch (cause) {
      this.error.set(`Could not fetch this page's own HTML: ${(cause as Error).message}`);
      this.status.set('error');
    }
  }
}
