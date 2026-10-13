import { ChangeDetectionStrategy, Component, afterNextRender, inject, signal } from '@angular/core';
import { buildScrambleMap, invertScrambleMap, scrambleText } from '@pacyfist/veneer';
import { ServedPage, ServedPageLoader, fontUrl, veneerState } from '../ui/served-page';
import { HERO_TEXT } from './hero';

/** What the seed hunt tried, and how much of it worked. */
interface SeedHunt {
  readonly bytes: string;
  readonly seedField: boolean;
  readonly tried: number;
  readonly decoded: number;
}

/** What decoding the served hero with the two fonts took. */
interface Decoded {
  readonly text: string;
  readonly matches: boolean;
  readonly forgedUrl: string;
  readonly baseUrl: string;
  readonly kilobytes: number;
  readonly ms: number;
  readonly more: number;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * "The key is not in the page", shown from the page's own response body: the
 * transfer state the server wrote, the old seed-regex attack run against it,
 * and then the honest limit, decoding the served hero the way a veneer-aware
 * crawler would (two font downloads and a font parser).
 *
 * The forge is imported on the click, never up front: it is the same lazy
 * chunk the library loads, and e2e/runtime.spec.ts checks the initial bundle
 * stays free of it.
 */
@Component({
  selector: 'app-keyless',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as message) {
      <p class="text-warning font-mono text-sm">{{ message }}</p>
    } @else if (!state()) {
      <span class="loading loading-dots loading-sm"></span>
    } @else {
      <div class="flex flex-col gap-4">
        <div>
          <p class="text-base-content/70 mb-2 text-sm">
            All the server put in the page for veneer, from
            <code>&lt;script id="ng-state"&gt;</code>: a random family name and the forged font's
            URL.
          </p>
          <pre
            class="rounded-field bg-base-200 text-secondary overflow-x-auto p-3 font-mono text-xs whitespace-pre-wrap"
            data-testid="ng-state"
          ><code>"veneer": {{ state() }}</code></pre>
        </div>

        @if (hunt(); as h) {
          <div
            class="rounded-field border-secondary/30 bot-scan border p-3"
            data-testid="seed-hunt"
          >
            <p class="text-secondary text-xs font-bold tracking-widest uppercase">
              The old attack: find the seed
            </p>
            <ul class="mt-2 flex flex-col gap-1 text-sm">
              <li>
                <code>veneerSeed</code> in the {{ h.bytes }}-byte response:
                <strong>{{ h.seedField ? 'found' : 'not found' }}</strong>
              </li>
              <li>
                Every number in the page, and the family name read as a number, tried as a seed with
                the public <code>buildScrambleMap</code>:
                <strong>{{ h.decoded }} of {{ h.tried }}</strong> decode the hero paragraph.
              </li>
            </ul>
          </div>
        }

        <div class="rounded-field border-base-300 border p-3">
          <p class="text-xs font-bold tracking-widest uppercase">
            The honest limit: the font is the key
          </p>
          <p class="text-base-content/70 mt-1 text-sm">
            A scraper that knows veneer downloads the forged font and your normal font, compares
            their character maps and undoes the cipher, without running any of the page's
            JavaScript. This button does exactly that, in your browser.
          </p>
          @if (decoded(); as d) {
            <div class="mt-3 flex flex-col gap-2" data-testid="decoded">
              <p class="text-primary text-lg leading-snug">{{ d.text }}</p>
              <p class="text-base-content/70 text-xs">
                {{ d.matches ? 'Matches the paragraph you can read.' : 'Does not match.' }}
                {{ d.kilobytes }} KB from <code>{{ d.forgedUrl }}</code> and
                <code>{{ d.baseUrl }}</code> (named in the page's own <code>&#64;font-face</code>),
                two font parses, {{ d.ms }} ms.
                @if (d.more > 0) {
                  The same map decodes the other {{ d.more }} protected elements in the page.
                }
              </p>
            </div>
          } @else {
            <button
              type="button"
              class="btn btn-sm btn-secondary mt-3"
              [disabled]="decoding()"
              (click)="decode()"
            >
              @if (decoding()) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              Decode it like an attacker
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class Keyless {
  private readonly served = inject(ServedPageLoader);
  private page?: ServedPage;

  protected readonly state = signal('');
  protected readonly hunt = signal<SeedHunt | null>(null);
  protected readonly decoded = signal<Decoded | null>(null);
  protected readonly decoding = signal(false);
  protected readonly error = signal('');

  constructor() {
    afterNextRender(() => void this.load());
  }

  private async load(): Promise<void> {
    try {
      const page = (this.page = await this.served.load());
      const veneer = veneerState(page);
      if (!veneer) throw new Error('the served page has no veneer transfer state');
      this.state.set(JSON.stringify(veneer, null, 2));
      this.hunt.set(huntForSeeds(page, veneer.family));
    } catch (cause) {
      this.error.set(`Could not read this page's own HTML: ${(cause as Error).message}`);
    }
  }

  protected async decode(): Promise<void> {
    const page = this.page;
    const veneer = page && veneerState(page);
    if (!page || !veneer) return;
    this.decoding.set(true);
    try {
      const started = performance.now();
      const forgedUrl = fontUrl(veneer.fonts[0]);
      // The base font's URL is in the page's own @font-face rule.
      const baseUrl = page.html.match(/url\(\s*['"]?([^'")]+\.(?:ttf|otf|woff))['"]?\s*\)/)?.[1];
      if (!baseUrl) throw new Error('no base font URL in the page');

      const download = async (url: string) => {
        const response = await fetch(new URL(url, page.url));
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        return response.arrayBuffer();
      };
      const [forge, forgedBytes, baseBytes] = await Promise.all([
        import('@pacyfist/veneer/forge'),
        download(forgedUrl),
        download(baseUrl),
      ]);
      const [base, forged] = await Promise.all([
        forge.parseBaseFont(baseBytes),
        forge.parseBaseFont(forgedBytes),
      ]);
      const inverse = invertScrambleMap({ forward: forge.readScrambleMap(base, forged).forward });

      const elements = [...page.doc.querySelectorAll('[data-veneer-ssr]')];
      const text = squash(scrambleText(elements[0]?.textContent ?? '', inverse));
      this.decoded.set({
        text,
        matches: text === HERO_TEXT,
        forgedUrl,
        baseUrl,
        kilobytes: Math.round((forgedBytes.byteLength + baseBytes.byteLength) / 1024),
        ms: Math.round(performance.now() - started),
        more: Math.max(0, elements.length - 1),
      });
    } catch (cause) {
      this.error.set(`Decoding failed: ${(cause as Error).message}`);
    } finally {
      this.decoding.set(false);
    }
  }
}

/**
 * The seed-regex attack (e2e/adversaries/seed-regex.spec.ts), in the browser:
 * look for a seed field, then try every integer in the page and the family
 * name read in bases 10, 16 and 36 as a seed for the public cipher.
 */
function huntForSeeds(page: ServedPage, family: string): SeedHunt {
  const hero = page.doc.querySelector('[data-veneer-ssr]')?.textContent ?? '';
  const candidates = new Set<number>(
    [...page.html.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n <= 0xffffffff),
  );
  const name = family.replace(/^Veneer-/, '');
  for (const radix of [10, 16, 36]) {
    const n = parseInt(name, radix);
    if (Number.isFinite(n)) candidates.add(n >>> 0);
  }
  for (const half of [name.slice(0, 8), name.slice(8)]) {
    const n = parseInt(half, 16);
    if (Number.isFinite(n)) candidates.add(n);
  }

  let decoded = 0;
  for (const seed of candidates) {
    const attempt = scrambleText(hero, invertScrambleMap(buildScrambleMap(seed)));
    if (squash(attempt) === HERO_TEXT) decoded++;
  }
  return {
    bytes: new TextEncoder().encode(page.html).byteLength.toLocaleString('en-US'),
    seedField: /veneerSeed/i.test(page.html),
    tried: candidates.size,
    decoded,
  };
}
