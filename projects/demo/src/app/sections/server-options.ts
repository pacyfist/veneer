import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CodeBlock } from '../ui/code-block';

/** Kept in step with the library README's "Load balancers and restarts". */
const SECRET = [
  '// app.config.server.ts',
  'provideVeneerServer({',
  "  fonts: join(import.meta.dirname, '../browser'),",
  "  secret: process.env['VENEER_SECRET'], // openssl rand -hex 32",
  "  emitDir: '/srv/veneer-fonts', // storage every instance shares",
  '});',
  '',
  '// server.ts',
  "app.use(veneerFontMiddleware({ dir: '/srv/veneer-fonts' }));",
];

/** Kept in step with the library README's "Search engines and shouldProtect". */
const CRAWLERS = [
  '// app.config.server.ts',
  'provideVeneerServer({',
  "  fonts: join(import.meta.dirname, '../browser'),",
  '  shouldProtect: (request, context) => !(context as { crawler?: unknown })?.crawler,',
  '});',
  '',
  '// server.ts: reverse and forward DNS, never the user agent alone',
  'app.use(async (req, res, next) => {',
  "  const crawler = await verifyCrawler(req.ip ?? '', req.get('user-agent'));",
  '  angularApp',
  '    .handle(req, { crawler })',
  '    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))',
  '    .catch(next);',
  '});',
];

/**
 * Server-only options. They need a running server, which GitHub Pages does
 * not have, so they are shown as code with a pointer to the runnable example.
 */
@Component({
  selector: 'app-server-options',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodeBlock],
  template: `
    <p class="text-base-content/70 mb-4">
      These need a running server, so this static demo cannot show them live.
      <a
        class="link link-primary"
        href="https://github.com/pacyfist/veneer/tree/main/examples/basic-ssr"
        >examples/basic-ssr</a
      >
      in the repository runs all of them.
    </p>
    <div class="flex flex-col gap-6">
      <div>
        <h4 class="font-bold">Several servers, restarts and redeploys</h4>
        <p class="text-base-content/70 mb-2">
          With a <code>secret</code>, every process and build forges the same fonts at the same
          URLs, and <code>veneerFontMiddleware</code> serves fonts any instance wrote to the shared
          folder, so a page still decodes when another server answers its font request.
        </p>
        <app-code-block [lines]="secret" />
      </div>
      <div>
        <h4 class="font-bold">Readable text for verified search crawlers</h4>
        <p class="text-base-content/70 mb-2">
          <code>shouldProtect</code> decides per request; <code>verifyCrawler</code> checks the
          visitor's IP by reverse and forward DNS. Dynamic SSR only: prerendered pages are always
          protected.
        </p>
        <app-code-block [lines]="crawlers" />
      </div>
    </div>
  `,
})
export class ServerOptions {
  protected readonly secret = SECRET;
  protected readonly crawlers = CRAWLERS;
}
