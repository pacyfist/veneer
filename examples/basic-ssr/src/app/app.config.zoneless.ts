import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideVeneer } from '@pacyfist/veneer';

/** SSR with hydration and zoneless change detection (the `zoneless` build). */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideClientHydration(withEventReplay()),
    provideVeneer({
      font: 'fonts/Roboto-Regular.ttf',
      fallbackFontFamily: "'Roboto', sans-serif",
    }),
  ],
};
