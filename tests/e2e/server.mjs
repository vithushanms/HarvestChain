// Tiny static server for the e2e specs: serves the three shipped files on a random port (correct MIME
// for .wasm). Default: the repo root (index.html, sw.js) + build/game.wasm at "/". opts.dir serves a
// packaged directory as is (dist/), opts.prefix mounts it under a sub-path ("/sub/path/", like a
// GitHub Pages project site); everything outside the prefix is a 404.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };

// opts.wasmMime: override the .wasm content type (tests the arrayBuffer fallback).
export function startServer({ wasmMime, dir, prefix = '/' } = {}) {
  const hits = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    hits.push(path);
    if (!path.startsWith(prefix)) { res.writeHead(404).end('not found'); return; }
    const rel = path === prefix ? 'index.html' : path.slice(prefix.length);
    if (rel.includes('..') || !['index.html', 'game.wasm', 'sw.js'].includes(rel)) { res.writeHead(404).end('not found'); return; }
    try {
      const body = await readFile(dir ? join(root, dir, rel) : join(root, rel === 'game.wasm' ? 'build/game.wasm' : rel));
      const type = rel === 'game.wasm' && wasmMime ? wasmMime : MIME[extname(rel)];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }).end(body);
    } catch { res.writeHead(404).end('missing'); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () =>
    resolve({ url: `http://127.0.0.1:${server.address().port}${prefix}`, hits, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) })));
}
