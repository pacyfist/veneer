import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideVeneerServer } from '@pacyfist/veneer/server';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // The server forges the font itself, so the page carries only its URL and
    // never a seed. Every route is prerendered, from the workspace root: the
    // base font is read from the source folder, and the forged fonts are
    // written outside dist/demo (the builder empties that after prerendering)
    // for scripts/demo-veneer-fonts.mjs to copy into the browser output.
    // VENEER_SECRET (optional, a CI secret) keeps the cipher and font URLs the
    // same from build to build while nothing else changes, so HTML a browser
    // or the CDN still caches from the last deploy finds its font. It is read
    // while prerendering, in this server-only file, and never reaches the
    // browser bundle.
    provideVeneerServer({
      fonts: 'projects/demo/public',
      emitDir: 'dist/demo-veneer',
      secret: process.env['VENEER_SECRET'],
    }),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
