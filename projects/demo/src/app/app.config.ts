import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideVeneer, withA11y, withStatusAttribute } from '@pacyfist/veneer';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless is the default from Angular 21 on; Angular 20 needs it spelled out.
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideVeneer(
      {
        // The same file styles.css registers as `Roboto`, so protected text is
        // indistinguishable from the rest of the page. Relative on purpose: fetch
        // resolves it against <base href>, so it works under the /veneer/ base
        // href on GitHub Pages too. A leading slash would not.
        font: 'fonts/Roboto-Regular.ttf',
        fallbackFontFamily: "'Roboto', sans-serif",
      },
      // <html data-veneer-status="..."> for the shell instance; e2e reads it.
      withStatusAttribute(),
      // aria-hidden on protected elements while they are scrambled. The navbar's
      // "Readable text" switch is what gives screen reader users the text.
      withA11y('hide'),
    ),
  ],
};
