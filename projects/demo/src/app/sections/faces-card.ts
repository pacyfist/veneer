import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  computed,
  inject,
  input,
} from '@angular/core';
import { VeneerDirective, VeneerFontService } from '@pacyfist/veneer';
import { DomProbe } from '../ui/dom-probe';

/**
 * One protected paragraph with bold and italic words, the forged family's
 * registered faces, and what a bot reads. Rendered inside an
 * IsolatedInstance, so it uses that instance's service and font.
 */
@Component({
  selector: 'app-faces-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VeneerDirective, DomProbe],
  template: `
    <div class="card bg-base-100 border-base-300 h-full border">
      <div class="card-body gap-3 p-4">
        <span class="text-base-content/70 text-xs font-bold tracking-widest uppercase">
          {{ label() }}
        </span>
        <p class="sr-only">A protected sample with bold and italic words follows.</p>
        <p class="text-2xl leading-snug" veneer appDomProbe #probe="domProbe">
          Drawn from the forged family: <strong>bold words</strong>, <em>italic words</em>, and
          regular text that stays protected.
        </p>
        <div class="rounded-field border-secondary/30 bot-scan border p-3">
          <p class="text-secondary text-xs font-bold tracking-widest uppercase">A bot reads</p>
          <p class="text-secondary mt-1 font-mono text-sm break-all">{{ probe.text() }}</p>
        </div>
        <div data-testid="faces">
          <p class="text-xs font-bold tracking-widest uppercase">Faces registered</p>
          @if (veneer.ready()) {
            <ul class="mt-1 font-mono text-xs">
              @for (face of faces(); track $index) {
                <li>{{ face }}</li>
              }
            </ul>
          } @else {
            <span class="loading loading-dots loading-xs"></span>
          }
        </div>
      </div>
    </div>
  `,
})
export class FacesCard {
  private readonly document = inject(DOCUMENT);
  protected readonly veneer = inject(VeneerFontService);
  readonly label = input.required<string>();

  /** The FontFace descriptors in `document.fonts` for this instance's forged family. */
  protected readonly faces = computed(() => {
    if (!this.veneer.ready()) return [];
    const family = this.veneer.familyName;
    return [...this.document.fonts]
      .filter((face) => face.family.replace(/["']/g, '') === family)
      .map((face) => `weight ${face.weight}, style ${face.style}`);
  });
}
