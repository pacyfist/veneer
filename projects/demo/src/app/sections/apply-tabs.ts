import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  VeneerDirective,
  VeneerFontDirective,
  VeneerFontService,
  VeneerPipe,
} from '@pacyfist/veneer';
import { CodeBlock } from '../ui/code-block';

/**
 * Settled empirically during Task 3: effects run during prerender.
 *
 * A prerender with `[veneer]="text()"` bound specimens produced scrambled text
 * carrying `data-veneer-ssr` in the served HTML. That can only happen if the
 * directive's effect ran, because its `ngOnInit` fallback reads an empty
 * element and would have rendered nothing. Effects therefore do run during
 * prerender in Angular 21, and the library's own comment claiming otherwise is
 * out of date.
 */
const BOUND_SSR_NOTE =
  'For words that come from code or an API. Bind the string to the attribute and leave the ' +
  'element empty. Also scrambled during server rendering.';

const TABS = [
  { id: 'static', label: 'Fixed text' },
  { id: 'bound', label: 'Text from a variable' },
  { id: 'pipe', label: 'Inside {{ }}' },
  { id: 'trap', label: "Don't do this" },
] as const;

type TabId = (typeof TABS)[number]['id'];

const STATIC_TEXT = 'Protected by element content.';

const SNIPPETS = {
  static: [`<p veneer>${STATIC_TEXT}</p>`],
  bound: ['<p [veneer]="body()"></p>'],
  pipe: ['<h3 veneerFont>{{ title() | veneer }}</h3>'],
  trap: ['<!-- do not do this -->', '<p veneer>{{ title() }}</p>'],
} as const;

/**
 * The three template forms, named by situation rather than syntax, each
 * running live with its own element's innerText underneath.
 */
@Component({
  selector: 'app-apply-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodeBlock, VeneerDirective, VeneerFontDirective, VeneerPipe],
  template: `
    <div role="tablist" class="tabs tabs-lift">
      @for (t of tabs; track t.id) {
        <button
          role="tab"
          class="tab"
          [class.tab-active]="active() === t.id"
          [class.text-error]="t.id === 'trap'"
          (click)="active.set(t.id)"
        >
          {{ t.label }}
        </button>
      }
    </div>

    <div class="card bg-base-100 border-base-300 rounded-t-none border">
      <div class="card-body gap-4">
        @switch (active()) {
          @case ('static') {
            <app-code-block [lines]="snippets.static" />
            <div class="rounded-box border-base-300 border p-3" [class.border-warning]="isEmpty()">
              <p class="text-lg" aria-hidden="true" veneer #specimen>${STATIC_TEXT}</p>
            </div>
            <p class="text-base-content/70">
              For words written straight into the template. The most common case, and it is
              scrambled during server rendering too, so crawlers never see the real text.
            </p>
          }
          @case ('bound') {
            <app-code-block [lines]="snippets.bound" />
            <div class="rounded-box border-base-300 border p-3" [class.border-warning]="isEmpty()">
              <p class="text-lg" aria-hidden="true" [veneer]="bound()" #specimen></p>
            </div>
            <p class="text-base-content/70">{{ boundNote }}</p>
          }
          @case ('pipe') {
            <app-code-block [lines]="snippets.pipe" />
            <div class="rounded-box border-base-300 border p-3" [class.border-warning]="isEmpty()">
              <h3 class="text-lg" aria-hidden="true" veneerFont #specimen>
                {{ piped() | veneer }}
              </h3>
            </div>
            <p class="text-base-content/70">
              When you're already interpolating. The <code>veneer</code> pipe scrambles the string
              and the <code>veneerFont</code> attribute applies the decoder font.
            </p>
          }
          @case ('trap') {
            <app-code-block [lines]="snippets.trap" />
            <div
              class="rounded-box border p-3"
              [class.border-warning]="isEmpty()"
              [class.border-base-300]="!isEmpty()"
            >
              <p class="text-lg" aria-hidden="true" veneer #specimen>{{ piped() }}</p>
            </div>
            @if (isEmpty()) {
              <p class="text-error text-sm italic">↑ this element is empty</p>
            }
            <div class="alert alert-error alert-soft">
              <span>
                The <code>veneer</code> attribute and <code>{{ braces }}</code> both try to own the
                element's text, and the text ends up empty. Use the "Inside {{ braces }}" form
                instead.
              </span>
            </div>
          }
        }

        <div class="rounded-field border-secondary/30 bot-scan border p-3">
          <div class="text-secondary text-xs font-bold tracking-widest uppercase">
            A bot reads (this element's innerText)
          </div>
          @if (hasReadout()) {
            <p class="text-secondary mt-1 min-h-6 font-mono break-all">{{ readout() }}</p>
          } @else {
            <div class="skeleton mt-1 h-4 w-48"></div>
          }
        </div>
      </div>
    </div>
  `,
})
export class ApplyTabs {
  /**
   * Not read for its value. Depending on the same signals the directives
   * depend on means this effect re-reads the DOM whenever they re-apply, so
   * the readout never lags behind the specimen it is meant to describe.
   */
  private readonly veneer = inject(VeneerFontService);

  protected readonly tabs = TABS;

  /** Held as a field so the braces are not parsed as an interpolation. */
  protected readonly braces = '{{ }}';

  /**
   * Snippets live here rather than inline in the template. An Angular template
   * parses `{{ }}` inside a binding's string literal as interpolation, so the
   * pipe example cannot be written inline without being evaluated.
   */
  protected readonly snippets = SNIPPETS;

  protected readonly active = signal<TabId>('static');
  protected readonly boundNote = BOUND_SSR_NOTE;

  protected readonly bound = signal('Protected from a bound signal.');
  protected readonly piped = signal('Protected through the pipe.');

  /** The currently rendered specimen. Only one `@switch` case is in the DOM at a time. */
  private readonly specimen = viewChild<ElementRef<HTMLElement>>('specimen');

  /**
   * The specimen's own `innerText`, read from the DOM rather than recomputed.
   *
   * Null until the first client-side read lands - `afterRenderEffect` never
   * runs on the server, so a prerendered page has no readout yet and shows a
   * skeleton in its place rather than a value the server cannot see.
   */
  protected readonly readout = signal<string | null>(null);

  protected readonly hasReadout = computed(() => this.readout() !== null);
  protected readonly isEmpty = computed(() => this.readout() === '');

  constructor() {
    afterRenderEffect({
      read: () => {
        this.veneer.fontStack();
        this.veneer.hidden();
        const el = this.specimen()?.nativeElement;
        this.readout.set(el ? el.innerText : null);
      },
    });
  }
}
