import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ScrambleMap, VeneerFontService, buildScrambleMap } from '@pacyfist/veneer';

interface Pair {
  readonly from: string;
  readonly to: string;
}

interface Group {
  readonly label: string;
  readonly pairs: readonly Pair[];
}

/** Characters the line breaker may break at: swapping them would move line breaks. */
const BREAKS = new Set([...' -/?!|}']);

/**
 * The cipher this page actually uses: the shell's `VeneerFontService.map()`,
 * which the browser read back out of the server's forged font. Shown only
 * once the service is ready, because until then the map is a throwaway that
 * only keeps early text from rendering readable.
 *
 * Grouped by the classes the cipher swaps within. The classes are not copied
 * from the library: two characters share a class when some map built over the
 * same charset sends one to the other, so the grouping follows the library.
 */
@Component({
  selector: 'app-cipher-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="text-base-content/70 mb-4 max-w-3xl">
      The cipher this page uses, read back from its forged font by your browser. Every visitor of
      this build gets the same one. Letters swap only with letters, digits with digits, punctuation
      within groups the browser breaks lines at alike, and nothing maps to itself.
    </p>

    <div class="card bg-base-200/60">
      <div class="card-body gap-4 p-4" data-testid="cipher-table">
        @if (veneer.ready()) {
          <div class="flex flex-wrap gap-x-8 gap-y-4">
            @for (group of groups(); track $index) {
              <div [class.basis-full]="group.pairs.length > 12">
                <p class="mb-1 text-xs font-bold tracking-widest uppercase">
                  {{ group.label }}
                  <span class="badge badge-ghost badge-sm ml-1">{{ group.pairs.length }}</span>
                </p>
                <div class="flex flex-wrap gap-1.5 font-mono text-sm">
                  @for (pair of group.pairs; track pair.from) {
                    <span class="rounded-field bg-base-100 px-1.5 py-0.5 whitespace-nowrap">
                      {{ pair.from }} <span class="text-base-content/70">&rarr;</span>
                      <span class="text-secondary">{{ pair.to }}</span>
                    </span>
                  }
                </div>
              </div>
            }
          </div>
          <div>
            <p class="mb-1 text-xs font-bold tracking-widest uppercase">Left alone</p>
            <ul class="text-base-content/80 flex flex-col gap-1 text-sm">
              <li>
                <code class="font-mono">{{ breaking() }}</code
                >: a browser may break a line at them, so swapping one in would let a word split in
                two.
              </li>
              @if (unpaired()) {
                <li>
                  <code class="font-mono">{{ unpaired() }}</code
                  >: no partner that breaks lines the same way.
                </li>
              }
            </ul>
          </div>
        } @else {
          <div class="flex flex-col gap-3">
            <div class="skeleton h-8 w-64"></div>
            <div class="skeleton h-52 w-full"></div>
          </div>
        }
      </div>
    </div>
  `,
})
export class CipherTable {
  protected readonly veneer = inject(VeneerFontService);

  protected readonly groups = computed<readonly Group[]>(() => {
    const map = this.veneer.map();
    const classes = classesOf(map);
    const pair = (cp: number): Pair => ({
      from: String.fromCodePoint(cp),
      to: String.fromCodePoint(map.forward.get(cp)!),
    });
    const is = (re: RegExp) => (members: number[]) => re.test(String.fromCodePoint(members[0]));
    const letters = classes.filter(is(/\p{L}/u));
    const digits = classes.filter(is(/\p{Nd}/u));
    const punctuation = classes.filter((c) => !letters.includes(c) && !digits.includes(c));
    return [
      ...letters.map((members) => ({ label: 'Letters', pairs: members.map(pair) })),
      ...digits.map((members) => ({ label: 'Digits', pairs: members.map(pair) })),
      ...punctuation.map((members, i) => ({
        label: `Punctuation group ${i + 1}`,
        pairs: members.map(pair),
      })),
    ];
  });

  /** Printable ASCII the cipher leaves as it is. */
  private readonly untouched = computed(() => {
    const keys = this.veneer.map().forward;
    const out: string[] = [];
    for (let cp = 0x20; cp <= 0x7e; cp++) if (!keys.has(cp)) out.push(String.fromCodePoint(cp));
    return out;
  });

  protected readonly breaking = computed(() =>
    this.untouched()
      .filter((ch) => BREAKS.has(ch))
      .map((ch) => (ch === ' ' ? 'space' : ch))
      .join(' '),
  );

  protected readonly unpaired = computed(() =>
    this.untouched()
      .filter((ch) => !BREAKS.has(ch))
      .join(' '),
  );
}

/**
 * The classes `map` was drawn within, as sorted codepoint lists. Each swap
 * stays inside its class, so the cycles of `map` and of a few more maps over
 * the same charset join up into the classes.
 */
function classesOf(map: ScrambleMap): number[][] {
  const charset = [...map.forward.keys()];
  const parent = new Map(charset.map((cp) => [cp, cp]));
  const find = (cp: number): number => {
    let root = cp;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(cp, root);
    return root;
  };
  const maps = [map, ...Array.from({ length: 24 }, (_, i) => buildScrambleMap(i + 1, charset))];
  for (const m of maps) {
    for (const [from, to] of m.forward) parent.set(find(from), find(to));
  }
  const classes = new Map<number, number[]>();
  for (const cp of charset.sort((a, b) => a - b)) {
    const root = find(cp);
    classes.set(root, [...(classes.get(root) ?? []), cp]);
  }
  return [...classes.values()];
}
