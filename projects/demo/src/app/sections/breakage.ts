import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  DEFAULT_CHARSET,
  VeneerConfig,
  VeneerFeature,
  VeneerStatusEvent,
  withStatusListener,
} from '@pacyfist/veneer';
import { SectionHeading } from '../ui/section-heading';
import { IsolatedInstance } from '../ui/isolated-instance';

type Mode = 'healthy' | 'no-font' | 'missing-glyph' | 'strict' | 'flash';

/** One status event, as monitoring would receive it. */
interface Logged {
  readonly ms: number;
  readonly status: string;
  readonly code: string;
  readonly message: string;
}

const SAMPLE = 'The page stays usable no matter which of these you pick.';

/**
 * ƀ and ƃ (Latin Extended-B). Roboto-Regular has no glyph for either. Two,
 * because a character with no swap partner is left unscrambled anyway.
 */
const UNCOVERED = [0x180, 0x183];

/** Controls that genuinely break the library, rather than describing breakage. */
@Component({
  selector: 'app-breakage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading, IsolatedInstance],
  template: `
    <app-section-heading eyebrow="When it fails" title="Usually: your text is just text">
      If the decoder font can't be built, protected text quietly turns back into ordinary readable
      text. One exception: on a server-rendered page, if the browser cannot get the fonts or the
      forge code, the server's text stays scrambled and veneer reports VNR016. These buttons really
      break it.
    </app-section-heading>

    <div class="mb-4 flex flex-wrap gap-2">
      @for (m of modes; track m.id) {
        <button class="btn" [class.btn-primary]="mode() === m.id" (click)="pick(m.id)">
          {{ m.label }}
        </button>
      }
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="card bg-base-100 border-base-300 border">
        <div class="card-body">
          <h3 class="card-title">{{ current().label }}</h3>
          <p class="text-base-content/80 text-lg">{{ current().plain }}</p>
          <p class="text-base-content/70 text-sm">{{ current().detail }}</p>
        </div>
      </div>
      <app-isolated-instance [text]="sample()" [config]="config()" [features]="listen" />

      <div class="card bg-base-100 border-base-300 border md:col-span-2">
        <div class="card-body gap-2">
          <h3 class="text-xs font-bold tracking-widest uppercase">
            What monitoring receives (<code>withStatusListener</code>)
          </h3>
          <ol class="font-mono text-sm" data-testid="status-log">
            @for (e of log(); track $index) {
              <li class="flex flex-wrap gap-x-3">
                <span class="text-base-content/70 w-16 text-right">+{{ e.ms }} ms</span>
                <span class="w-16" [class.text-warning]="e.status === 'failed'">{{
                  e.status
                }}</span>
                @if (e.code) {
                  <strong class="text-warning">{{ e.code }}</strong>
                  <span class="text-base-content/70 min-w-0 flex-1 break-words">{{
                    e.message
                  }}</span>
                }
              </li>
            } @empty {
              <li class="text-base-content/70">Waiting for the sample…</li>
            }
          </ol>
          @if (mode() === 'missing-glyph') {
            <p class="text-base-content/70 text-sm">
              No failure here: the instance stays active. The dropped characters are reported by a
              dev-mode console warning, VNR014, which production builds like this one leave out.
            </p>
          }
          <p class="text-base-content/70 text-sm">
            VNR016 only happens while a server-rendered page hydrates and its cipher cannot be read,
            so these browser-drawn samples cannot produce it. This page's own status, from
            <code>withStatusAttribute()</code>:
            <code data-testid="html-status"
              >&lt;html data-veneer-status="{{ htmlStatus() }}"&gt;</code
            >
          </p>
        </div>
      </div>
    </div>
  `,
})
export class Breakage {
  protected readonly mode = signal<Mode>('healthy');

  /** Status events of the current sample, newest last. */
  protected readonly log = signal<readonly Logged[]>([]);
  /** The shell's `<html data-veneer-status>`, read from the DOM. */
  protected readonly htmlStatus = signal('…');
  private started = 0;

  /**
   * Stable, so the sample is not rebuilt for it. The listener can run while
   * the instance is being created inside change detection, so the log is
   * updated a microtask later.
   */
  protected readonly listen: readonly VeneerFeature[] = [
    withStatusListener((event: VeneerStatusEvent) =>
      queueMicrotask(() =>
        this.log.update((log) => [
          ...log,
          {
            ms: Math.round(performance.now() - this.started),
            status: event.status,
            code: event.failure?.code ?? '',
            message: event.failure ? shorten(event.failure.message) : '',
          },
        ]),
      ),
    ),
  ];

  constructor() {
    const document = inject(DOCUMENT);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.started = performance.now();
      const root = document.documentElement;
      const read = () => this.htmlStatus.set(root.getAttribute('data-veneer-status') ?? 'none');
      read();
      const observer = new MutationObserver(read);
      observer.observe(root, { attributes: true, attributeFilter: ['data-veneer-status'] });
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected pick(mode: Mode): void {
    if (mode === this.mode()) return;
    this.log.set([]);
    this.started = performance.now();
    this.mode.set(mode);
  }
  protected readonly sample = computed(() =>
    this.mode() === 'missing-glyph' || this.mode() === 'strict'
      ? `${SAMPLE} Even with ƀ and ƃ in it.`
      : SAMPLE,
  );

  protected readonly modes = [
    {
      id: 'healthy' as const,
      label: 'Working normally',
      plain: 'The decoder font loads and the text is protected.',
      detail: 'The baseline, for comparison.',
    },
    {
      id: 'no-font' as const,
      label: "Font won't load",
      plain: 'Protection switches off and the real text is put back. Readers notice nothing.',
      detail:
        'The font request fails. The library logs an error, sets failed(), and every veneer element restores its original text.',
    },
    {
      id: 'missing-glyph' as const,
      label: 'Characters the font lacks',
      plain:
        "The font can't draw ƀ or ƃ, which the charset asks it to cover. Those two letters are left unscrambled and drawn in the fallback font; everything else stays protected.",
      detail:
        'strictCoverage: false, the default. Once the font loads, the library drops the characters it has no glyph for, redraws the cipher without them, re-scrambles the text and warns in dev mode (VNR014).',
    },
    {
      id: 'strict' as const,
      label: 'Strict coverage',
      plain:
        'The same font and charset with strictCoverage: true. The library refuses to guess and falls back to plain text.',
      detail:
        'forgeScrambledFont throws VeneerFontError listing the missing characters rather than silently showing a reader the wrong letter. The service catches it, sets failed() to code VNR012 with the missing characters, and the page fails open.',
    },
    {
      id: 'flash' as const,
      label: 'Slow network, no hiding',
      plain:
        "With hiding turned off, you'll see a two-second flash of gibberish while the font loads. That's why hiding is on by default.",
      detail:
        'hideUntilReady: false plus a font loader delayed by two seconds. Leave it on: visitors without JavaScript still get the text either way, scrambled.',
    },
  ];

  protected readonly current = computed(() => this.modes.find((m) => m.id === this.mode())!);

  protected readonly config = computed<Partial<VeneerConfig>>(() => {
    switch (this.mode()) {
      case 'no-font':
        return { font: () => Promise.reject(new Error('deliberately broken by the demo')) };
      case 'missing-glyph':
        return { charset: [...DEFAULT_CHARSET, ...UNCOVERED] };
      case 'strict':
        return { charset: [...DEFAULT_CHARSET, ...UNCOVERED], strictCoverage: true };
      case 'flash':
        return {
          hideUntilReady: false,
          font: async () => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const response = await fetch('fonts/Roboto-Regular.ttf');
            return response.arrayBuffer();
          },
        };
      default:
        return {};
    }
  });
}

/** A failure message without the `[veneer] VNRxxx:` prefix and the docs link. */
function shorten(message: string): string {
  return message.replace(/^\[veneer\] (?:VNR\d+: )?/, '').replace(/ See https:\/\/\S+$/, '');
}
