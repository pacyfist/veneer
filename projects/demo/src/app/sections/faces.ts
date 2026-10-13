import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { VeneerFeature, withFaces } from '@pacyfist/veneer';
import { IsolatedInstance } from '../ui/isolated-instance';
import { FacesCard } from './faces-card';

/**
 * `withFaces()` with real Roboto Bold and Italic files, against the same text
 * with only the regular face, where the browser synthesizes bold and slant.
 *
 * The two faces are about 700 KB together, so nothing loads until the visitor
 * asks. Both instances are client-only (IsolatedInstance); the shell's
 * config, and so the prerendered page and the server forge, never see them.
 */
@Component({
  selector: 'app-faces',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IsolatedInstance],
  template: `
    <p class="text-base-content/70 mb-4 max-w-3xl">
      With only the regular face, the browser fakes bold and italic by smearing and slanting it.
      <code>withFaces()</code> forges real bold and italic files from the same cipher, under the
      same family name.
    </p>
    @if (loaded()) {
      <div class="grid gap-3 md:grid-cols-2">
        <app-isolated-instance [card]="card" [cardInputs]="{ label: 'Faked by the browser' }" />
        <app-isolated-instance
          [card]="card"
          [features]="withRealFaces"
          [cardInputs]="{ label: 'Real faces, withFaces()' }"
        />
      </div>
    } @else {
      <button type="button" class="btn btn-primary btn-sm" (click)="loaded.set(true)">
        Load bold and italic (about 700 KB)
      </button>
    }
  `,
})
export class Faces {
  protected readonly card = FacesCard;
  protected readonly loaded = signal(false);
  protected readonly withRealFaces: readonly VeneerFeature[] = [
    withFaces(
      { src: 'fonts/faces/Roboto-Bold.ttf', weight: 700 },
      { src: 'fonts/faces/Roboto-Italic.ttf', style: 'italic' },
    ),
  ];
}
