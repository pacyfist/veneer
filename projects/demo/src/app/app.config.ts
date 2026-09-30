import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideNoAi } from '@pacyfist/no-ai';
import { baseFontBuffer } from './font-source';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideNoAi({
      // The same file styles.css registers as `Roboto`, so protected text is
      // indistinguishable from the rest of the page. A loader rather than a URL:
      // the string form is fetched relative to the document, which breaks under
      // the /no-ai/ base href on GitHub Pages.
      font: baseFontBuffer,
      fallbackFontFamily: "'Roboto', sans-serif",
    }),
  ],
};
