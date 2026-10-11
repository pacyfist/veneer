import { Component, signal } from '@angular/core';
import { VeneerDirective, VeneerFontDirective, VeneerPipe } from '@pacyfist/veneer';

/** The text the e2e test looks for. It must never reach the served HTML. */
export const SECRET = 'The quick brown fox jumps over the lazy dog.';

@Component({
  selector: 'app-root',
  imports: [VeneerDirective, VeneerFontDirective, VeneerPipe],
  template: `
    <h1>veneer basic example</h1>
    <p id="bound" [veneer]="secret()"></p>
    <p id="piped" veneerFont>{{ secret() | veneer }}</p>
  `,
})
export class App {
  protected readonly secret = signal(SECRET);
}
