// Package the shipped game: dist/ = exactly the three files a static host serves (index.html, game.wasm,
// sw.js). Run `npm run dist` (builds first). dist/ is gitignored; publish its contents as they are.
import { copyFileSync, mkdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
let total = 0;
for (const [to, from] of [['index.html', 'index.html'], ['game.wasm', 'build/game.wasm'], ['sw.js', 'sw.js']]) {
  copyFileSync(join(root, from), join(out, to));
  const gz = gzipSync(readFileSync(join(out, to)), { level: 9 }).length;
  total += gz;
  console.log(`dist/${to.padEnd(10)} ${String(statSync(join(out, to)).size).padStart(6)} B raw  ${String(gz).padStart(6)} B gz`);
}
console.log(`dist total  ${total} B gz`);
