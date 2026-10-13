/**
 * Serves the built static site the way GitHub Pages does.
 *
 * Tests run against `dist/demo/browser` under the real `/veneer/` base path,
 * because that path is where the interesting failures live: an asset URL that
 * resolves at the domain root and 404s under a subpath takes the font with it,
 * and the library then fails open into a page that looks fine and protects
 * nothing.
 *
 * Deliberately dependency-free — the repo already carries enough tooling.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = 'dist/demo/browser';
const BASE = '/veneer/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/**
 * The static server, not yet listening. `onRequest` sees every request path,
 * for tests that count what the browser actually fetched over the network.
 *
 * Responses carry the caching headers GitHub Pages sends (`max-age=600` and
 * `Last-Modified`), so the browser's HTTP cache behaves as it does in
 * production: a file requested twice is fetched once.
 *
 * `root` serves another folder than the build output, such as a copy of a
 * previous build standing in for the deployed site.
 */
export function createStaticServer({ onRequest, root = ROOT } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    onRequest?.(url.pathname);

    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(404).end('outside the base path');
      return;
    }

    let rel = url.pathname.slice(BASE.length) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';

    // normalize collapses any ../ before it can escape the served directory.
    const file = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ''));

    try {
      const [body, info] = await Promise.all([readFile(file), stat(file)]);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'content-length': body.byteLength,
        'cache-control': 'max-age=600',
        'last-modified': info.mtime.toUTCString(),
      });
      res.end(body);
    } catch {
      // Pages serves 404.html for anything it does not recognise.
      try {
        const body = await readFile(join(root, '404.html'));
        res.writeHead(404, { 'content-type': TYPES['.html'] });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    }
  });
}

// Run as a script (the Playwright webServer), not imported by a spec. No
// import.meta: Playwright loads this file through its own transpiler.
if (/serve-static\.mjs$/.test(process.argv[1] ?? '')) {
  const PORT = Number(process.env.PORT ?? 4322);
  createStaticServer().listen(PORT, () =>
    console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}${BASE}`),
  );
}
