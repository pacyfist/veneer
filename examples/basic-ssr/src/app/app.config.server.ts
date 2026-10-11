import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideVeneerServer } from '@pacyfist/veneer/server';
import { join } from 'node:path';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // The server forges the font and serves it (veneerFontMiddleware() in
    // server.ts); the page only carries its URL. It reads the base font from
    // the browser build output, next to the server bundle.
    provideVeneerServer({
      fonts: join(import.meta.dirname, '../browser'),
      // Verified search crawlers (server.ts passes the verifyCrawler() result
      // as the request context) get readable text. Dynamic SSR only.
      shouldProtect: (_request, context) => !(context as { crawler?: unknown } | null)?.crawler,
    }),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
