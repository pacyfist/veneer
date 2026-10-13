import { ChangeDetectionStrategy, Component, afterNextRender, inject, signal } from '@angular/core';
import { VENEER_CSP_HASHES } from '@pacyfist/veneer';
import { CodeBlock } from '../ui/code-block';
import { ServedPageLoader } from '../ui/served-page';

interface HashCheck {
  readonly name: string;
  readonly element: string;
  readonly exported: string;
  readonly computed: string;
}

const HEADER = [
  "import { VENEER_CSP_HASHES } from '@pacyfist/veneer';",
  '',
  'const csp =',
  "  `script-src 'self' ${VENEER_CSP_HASHES.script}; ` +",
  "  `style-src 'self' ${VENEER_CSP_HASHES.style}`;",
];

const HIDDEN = [
  'provideVeneer({',
  "  font: 'fonts/Roboto-Regular.ttf',",
  "  hideWith: 'hidden',",
  '});',
];

/**
 * Strict CSP on a prerendered page: the live `VENEER_CSP_HASHES`, checked
 * against hashes this browser computes from the two inline elements in the
 * page's own served HTML.
 */
@Component({
  selector: 'app-csp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodeBlock],
  template: `
    <p class="text-base-content/70 mb-3">
      On server-rendered pages veneer adds one tiny inline <code>&lt;style&gt;</code> and
      <code>&lt;script&gt;</code> that hide protected text until the font is ready. With dynamic
      SSR, provide Angular's <code>CSP_NONCE</code> and veneer uses it. A prerendered page like this
      one has no nonce, so allow them by hash:
    </p>
    <div class="overflow-x-auto">
      <table class="table-sm table font-mono text-xs" data-testid="csp-hashes">
        <thead>
          <tr>
            <th>VENEER_CSP_HASHES</th>
            <th>exported value</th>
            <th>computed from this page's HTML</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (check of checks(); track check.name) {
            <tr>
              <td>{{ check.name }}</td>
              <td class="break-all">{{ check.exported }}</td>
              <td class="break-all">{{ check.computed || status() }}</td>
              <td>
                @if (check.computed) {
                  <span
                    class="badge badge-sm"
                    [class.badge-primary]="check.computed === check.exported"
                    [class.badge-warning]="check.computed !== check.exported"
                    >{{ check.computed === check.exported ? 'matches' : 'differs' }}</span
                  >
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <div class="mt-3 flex flex-col gap-3">
      <app-code-block [lines]="header" />
      <div>
        <app-code-block [lines]="hidden" />
        <p class="text-base-content/70 mt-2 text-sm">
          Or nothing inline at all: <code>hideWith: 'hidden'</code> uses the HTML
          <code>hidden</code> attribute. Readers without JavaScript then see nothing, and the layout
          shifts when the text appears. Either way, veneer downloads fonts with
          <code>fetch()</code>, so they fall under <code>connect-src</code>, not
          <code>font-src</code>.
        </p>
      </div>
    </div>
  `,
})
export class Csp {
  private readonly served = inject(ServedPageLoader);

  protected readonly header = HEADER;
  protected readonly hidden = HIDDEN;
  protected readonly status = signal('computing…');
  protected readonly checks = signal<readonly HashCheck[]>([
    {
      name: 'script',
      element: 'script#veneer-js',
      exported: VENEER_CSP_HASHES.script,
      computed: '',
    },
    {
      name: 'style',
      element: 'style#veneer-hide',
      exported: VENEER_CSP_HASHES.style,
      computed: '',
    },
  ]);

  constructor() {
    afterNextRender(() => void this.verify());
  }

  private async verify(): Promise<void> {
    try {
      const page = await this.served.load();
      const checks = await Promise.all(
        this.checks().map(async (check) => {
          const text = page.doc.querySelector(check.element)?.textContent;
          if (text == null) throw new Error(`no ${check.element} in the served HTML`);
          return { ...check, computed: await sha256(text) };
        }),
      );
      this.checks.set(checks);
    } catch (cause) {
      this.status.set(`not computed: ${(cause as Error).message}`);
    }
  }
}

/** A CSP hash source expression for `text`. */
async function sha256(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('hashing needs a secure (https) page');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}
