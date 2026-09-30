import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  signal,
} from '@angular/core';
import { buildScrambleMap, randomSeed } from '@pacyfist/veneer';

interface Pair {
  readonly from: string;
  readonly to: string;
}

/**
 * The substitution table, built from a seed drawn in the browser.
 *
 * Deliberately does not use the shell's map. The deployed site is prerendered,
 * so the shell's seed is identical for every visitor, and a table built from it
 * could not show what a per-load cipher looks like.
 *
 * The seed is drawn only after the first render and held in a nullable signal,
 * never in a field initialiser, so prerender never bakes one seed into the
 * static HTML while the browser draws a different one on top of it. A skeleton
 * fills the card until the seed is set.
 */
@Component({
  selector: 'app-cipher-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="text-base-content/70 mb-4 max-w-3xl">
      A freshly drawn cipher. No character ever maps to itself, and spaces are never swapped,
      because they are the only place a browser can wrap a line.
    </p>

    <div class="card bg-base-200/60">
      <div class="card-body p-4">
        <!-- Explicit null check, not truthiness: a drawn seed of 0 is falsy and
             would strand this section in its skeleton with no way back. -->
        @if (seed() !== null) {
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <button class="btn btn-sm btn-primary" (click)="redraw()">Shuffle</button>
            <span class="font-mono text-xs">seed {{ seed() }}</span>
            <span class="badge badge-ghost badge-sm">{{ pairs().length }} pairs</span>
          </div>
          <div class="overflow-x-auto">
            <table class="table table-zebra table-xs font-mono">
              <tbody>
                @for (row of rows(); track $index) {
                  <tr>
                    @for (pair of row; track pair.from) {
                      <td class="whitespace-nowrap">
                        {{ pair.from }} <span class="text-base-content/40">-&gt;</span>
                        <span class="text-primary">{{ pair.to }}</span>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
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
  private static readonly SHOWN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  private static readonly PER_ROW = 8;

  protected readonly seed = signal<number | null>(null);

  protected readonly pairs = computed<readonly Pair[]>(() => {
    const seed = this.seed();
    if (seed === null) return [];
    const map = buildScrambleMap(seed);
    return [...CipherTable.SHOWN].map((from) => ({
      from,
      to: String.fromCodePoint(map.forward.get(from.codePointAt(0)!)!),
    }));
  });

  protected readonly rows = computed<readonly (readonly Pair[])[]>(() => {
    const all = this.pairs();
    const out: Pair[][] = [];
    for (let i = 0; i < all.length; i += CipherTable.PER_ROW) {
      out.push(all.slice(i, i + CipherTable.PER_ROW));
    }
    return out;
  });

  constructor() {
    afterNextRender(() => this.seed.set(randomSeed()));
  }

  protected redraw(): void {
    this.seed.set(randomSeed());
  }
}
