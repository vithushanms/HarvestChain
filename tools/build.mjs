// Concatenate src/*.wat into one module, assemble, optimise, enforce budgets.
// Usage: node tools/build.mjs [--src dir] [--out dir]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => join(root, 'node_modules', '.bin', name);
const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const fail = (msg) => { console.error(`build: ${msg}`); process.exit(1); };

const BUDGETS = { wasmRaw: 48 * 1024, wasmGz: 20 * 1024, htmlGz: 3 * 1024, swGz: 1 * 1024 };

const src = arg('--src', join(root, 'src'));
const out = arg('--out', join(root, 'build'));
mkdirSync(out, { recursive: true });

const files = readdirSync(src).filter((f) => f.endsWith('.wat')).sort();
if (files.length === 0) fail(`no .wat files in ${src}`);

const parts = [];
for (const f of files) {
  const text = readFileSync(join(src, f), 'utf8');
  const code = text.replace(/;;.*$/gm, '');
  if (/\bf(32|64)\b/.test(code)) fail(`integer-only: found f32/f64 in ${f}`);
  // Presentation layers (numeric prefix >= 20) must never draw from the sim RNG.
  if (parseInt(f, 10) >= 20 && /call\s+\$rng_/.test(code)) {
    fail(`presentation code must not use the sim RNG: found "call $rng_" in ${f} (use a render-only hash noise function)`);
  }
  parts.push(`;; ---- ${f} ----\n${text}`);
}
const wat = join(out, 'game.wat');
writeFileSync(wat, `(module\n${parts.join('\n')}\n)\n`);

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) fail(`${cmd.split('/').pop()} failed\n${r.stderr || r.stdout}`);
};
const rawWasm = join(out, 'game.raw.wasm');
const wasm = join(out, 'game.wasm');
run(bin('wat2wasm'), [wat, '-o', rawWasm, '--disable-simd', '--disable-multi-value',
  '--disable-reference-types', '--disable-saturating-float-to-int']);
run(bin('wasm-opt'), [rawWasm, '-o', wasm, '-Oz', '--mvp-features',
  '--enable-bulk-memory', '--enable-sign-ext', '--enable-mutable-globals']);

const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const buf = readFileSync(wasm);
const raw = buf.length, gzipped = gz(buf);
console.log(`game.wasm  ${raw} B raw  ${gzipped} B gz`);
if (raw > BUDGETS.wasmRaw) fail(`game.wasm raw ${raw} B > ${BUDGETS.wasmRaw} B`);
if (gzipped > BUDGETS.wasmGz) fail(`game.wasm gz ${gzipped} B > ${BUDGETS.wasmGz} B`);

for (const [file, budget] of [['index.html', BUDGETS.htmlGz], ['sw.js', BUDGETS.swGz]]) {
  const p = join(root, file);
  if (!existsSync(p)) continue;
  const n = gz(readFileSync(p));
  console.log(`${file}  ${n} B gz`);
  if (n > budget) fail(`${file} gz ${n} B > ${budget} B`);
}
