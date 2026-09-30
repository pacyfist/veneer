import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideVeneer } from '@pacyfist/veneer';
import { baseFontBuffer } from './font-source';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideVeneer({
      // The same file styles.css registers as `Roboto`, so protected text is
      // indistinguishable from the rest of the page. A loader rather than a URL:
      // the string form is fetched relative to the document, which breaks under
      // the /veneer/ base href on GitHub Pages.
      font: baseFontBuffer,
      fallbackFontFamily: "'Roboto', sans-serif",
    }),
  ],
};
