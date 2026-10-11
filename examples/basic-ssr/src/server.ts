import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { type VerifiedCrawler, veneerFontMiddleware, verifyCrawler } from '@pacyfist/veneer/server';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// The fonts veneer forges while rendering, which the pages reference.
app.use(veneerFontMiddleware());

app.use(express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false }));

/**
 * TEST ONLY: with VENEER_EXAMPLE_TEST_CRAWLER=1 (set by playwright.config.ts),
 * a request carrying `x-veneer-test-crawler: 1` counts as a verified crawler,
 * so the e2e test can see a crawler's page without a real crawler IP. Never
 * do this in an app: anyone can send a header.
 */
const testCrawlerHeader = process.env['VENEER_EXAMPLE_TEST_CRAWLER'] === '1';
const testCrawler: VerifiedCrawler = { name: 'test', hostname: 'test.invalid' };

app.use(async (req, res, next) => {
  // Reverse and forward DNS, never the user-agent alone. The result reaches
  // shouldProtect in app.config.server.ts as the request context.
  const crawler =
    testCrawlerHeader && req.get('x-veneer-test-crawler') === '1'
      ? testCrawler
      : await verifyCrawler(req.ip ?? '', req.get('user-agent'));
  angularApp
    .handle(req, { crawler })
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) throw error;
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
