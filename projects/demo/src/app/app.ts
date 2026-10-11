import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VeneerFontService, VeneerReadableToggle } from '@pacyfist/veneer';
import { Breakage } from './sections/breakage';
import { DeepDive } from './sections/deep-dive';
import { Faq } from './sections/faq';
import { GetStarted } from './sections/get-started';
import { Hero } from './sections/hero';
import { HowItWorks } from './sections/how-it-works';
import { TakeIt } from './sections/take-it';
import { TradeOffs } from './sections/trade-offs';
import { TryIt } from './sections/try-it';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Hero,
    TryIt,
    HowItWorks,
    GetStarted,
    Breakage,
    TradeOffs,
    Faq,
    DeepDive,
    TakeIt,
    VeneerReadableToggle,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  /** Drives the navbar's page-wide "bot vision" and readable-text switches. */
  protected readonly veneer = inject(VeneerFontService);
}
