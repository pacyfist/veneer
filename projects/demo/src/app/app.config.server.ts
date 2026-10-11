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
    provideVeneerServer({ fonts: 'projects/demo/public', emitDir: 'dist/demo-veneer' }),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
