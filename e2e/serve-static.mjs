/**
 * Serves the built static site the way GitHub Pages does.
 *
 * Tests run against `dist/demo/browser` under the real `/no-ai/` base path,
 * because that path is where the interesting failures live: an asset URL that
 * resolves at the domain root and 404s under a subpath takes the font with it,
 * and the library then fails open into a page that looks fine and protects
 * nothing.
 *
 * Deliberately dependency-free — the repo already carries enough tooling.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = 'dist/demo/browser';
const BASE = '/no-ai/';
const PORT = Number(process.env.PORT ?? 4322);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end('outside the base path');
    return;
  }

  let rel = url.pathname.slice(BASE.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';

  // normalize collapses any ../ before it can escape the served directory.
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': body.byteLength,
    });
    res.end(body);
  } catch {
    // Pages serves 404.html for anything it does not recognise.
    try {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      res.end(await readFile(join(ROOT, '404.html')));
    } catch {
      res.writeHead(404).end('not found');
    }
  }
});

server.listen(PORT, () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}${BASE}`));
