// Tiny static server for the e2e specs: serves the repo root on a random port (correct MIME for .wasm).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };

// opts.wasmMime: override the .wasm content type (tests the arrayBuffer fallback).
export function startServer({ wasmMime } = {}) {
  const hits = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    hits.push(path);
    const rel = path === '/' ? 'index.html' : path.slice(1);
    if (rel.includes('..') || !['index.html', 'game.wasm', 'sw.js'].includes(rel)) { res.writeHead(404).end('not found'); return; }
    try {
      const body = await readFile(join(root, rel === 'game.wasm' ? 'build/game.wasm' : rel));
      const type = rel === 'game.wasm' && wasmMime ? wasmMime : MIME[extname(rel)];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }).end(body);
    } catch { res.writeHead(404).end('missing'); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () =>
    resolve({ url: `http://127.0.0.1:${server.address().port}/`, hits, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) })));
}
