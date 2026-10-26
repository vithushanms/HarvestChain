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

// Budgets apply to the SHIPPING build/game.wasm only (t_* hooks stripped); game.test.wasm is unbudgeted.
// Spec target is 20 KB gz / 48 KB raw. Ruling (presentation plan Decision 4, 2026-10-26): the renderer,
// UI, replay and QR code do not fit that, so the enforced ceiling is 40 KB gz / 100 KB raw (raised from 32/80 by a later ruling); the build
// prints a warning while above the spec target.
const SPEC_TARGET = { wasmRaw: 48 * 1024, wasmGz: 20 * 1024 };
const BUDGETS = { wasmRaw: 100 * 1024, wasmGz: 40 * 1024, htmlGz: 4 * 1024, swGz: 1 * 1024 };

const SPEC_TOTAL = 24 * 1024;
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
// Two binaries from the same sources:
//   game.test.wasm  every export (t_* test hooks included): used by tests and dev tools.
//   game.wasm       SHIPPING build: every export named t_* is removed from the concatenated text before
//                   assembling, so wasm-opt -Oz drops code that only the hooks kept alive. Budgets apply here.
const EXPORT_T = /\(\s*export\s+"t_/;
// Remove every balanced `(export "t_..." ...)` form (any whitespace / multi-line layout).
const stripTestExports = (text) => {
  let res = '', i = 0;
  const re = /\(\s*export\s+"t_/g;
  for (let m; (m = re.exec(text)); ) {
    let d = 0, j = m.index;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === ';' && text[j + 1] === ';') { while (j < text.length && text[j] !== '\n') j++; continue; }
      if (c === '"') { j++; while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1; continue; }
      if (c === '(') d++;
      else if (c === ')' && --d === 0) break;
    }
    if (d !== 0) fail('unbalanced t_ export form in exports source');
    res += text.slice(i, m.index);
    i = j + 1;
    re.lastIndex = i;
  }
  return res + text.slice(i);
};
const moduleText = (list) => `(module\n${list.join('\n')}\n)\n`;
const prodParts = parts.map((p, k) => (files[k] === '30_exports.wat' ? stripTestExports(p) : p));
for (const [k, p] of prodParts.entries()) {
  if (EXPORT_T.test(p.replace(/;;.*$/gm, ''))) fail(`a t_ export survived the shipping filter in ${files[k]}`);
}
const wat = join(out, 'game.wat');
const prodWat = join(out, 'game.prod.wat');
writeFileSync(wat, moduleText(parts));
writeFileSync(prodWat, moduleText(prodParts));

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) fail(`${cmd.split('/').pop()} failed\n${r.stderr || r.stdout}`);
};
const assemble = (watFile, name) => {
  const rawWasm = join(out, `${name}.raw.wasm`);
  const wasm = join(out, `${name}.wasm`);
  run(bin('wat2wasm'), [watFile, '-o', rawWasm, '--disable-simd', '--disable-multi-value',
    '--disable-reference-types', '--disable-saturating-float-to-int']);
  run(bin('wasm-opt'), [rawWasm, '-o', wasm, '-Oz', '--mvp-features',
    '--enable-bulk-memory', '--enable-sign-ext', '--enable-mutable-globals']);
  return wasm;
};
const testWasm = assemble(wat, 'game.test');
const wasm = assemble(prodWat, 'game');

const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const buf = readFileSync(wasm);
const raw = buf.length, gzipped = gz(buf);
const tbuf = readFileSync(testWasm);
console.log(`game.wasm  ${raw} B raw  ${gzipped} B gz`);
console.log(`game.test.wasm  ${tbuf.length} B raw  ${gz(tbuf)} B gz  (test build, no budget)`);
if (raw > SPEC_TARGET.wasmRaw || gzipped > SPEC_TARGET.wasmGz) {
  console.log(`warning: game.wasm is over the spec target (${SPEC_TARGET.wasmGz} B gz / ${SPEC_TARGET.wasmRaw} B raw); ceiling is ${BUDGETS.wasmGz} B gz / ${BUDGETS.wasmRaw} B raw`);
}
if (raw > BUDGETS.wasmRaw) fail(`game.wasm raw ${raw} B > ${BUDGETS.wasmRaw} B`);
if (gzipped > BUDGETS.wasmGz) fail(`game.wasm gz ${gzipped} B > ${BUDGETS.wasmGz} B`);

// ---- shell: loader -> index.html, service worker -> sw.js (repo root; default source tree only) ----
// Readable sources: tools/loader.src.html, tools/sw.src.js (source of truth); the minified outputs are committed.
let htmlGz = 0, swGz = 0;
if (src === join(root, 'src')) {
  const { buildShell } = await import('./shell.mjs');
  const { html, sw, version } = await buildShell({
    loader: readFileSync(join(root, 'tools', 'loader.src.html'), 'utf8'),
    swSrc: readFileSync(join(root, 'tools', 'sw.src.js'), 'utf8'),
    keys: JSON.parse(readFileSync(join(root, 'tools', 'keycodes.json'), 'utf8')),
    wasm: buf,
  });
  writeFileSync(join(root, 'index.html'), html);
  writeFileSync(join(root, 'sw.js'), sw);
  htmlGz = gz(Buffer.from(html)); swGz = gz(Buffer.from(sw));
  console.log(`index.html  ${Buffer.byteLength(html)} B raw  ${htmlGz} B gz  (budget ${BUDGETS.htmlGz}, headroom ${BUDGETS.htmlGz - htmlGz})`);
  console.log(`sw.js  ${Buffer.byteLength(sw)} B raw  ${swGz} B gz  (budget ${BUDGETS.swGz})  cache hc-${version}`);
  const total = gzipped + htmlGz + swGz;
  console.log(`total transfer  ${total} B gz  (spec target ${SPEC_TOTAL} B)`);
  if (total > SPEC_TOTAL) console.log(`warning: total transfer ${total} B gz is over the spec target ${SPEC_TOTAL} B (wasm ceiling ruling in place)`);
  if (htmlGz > BUDGETS.htmlGz) fail(`index.html gz ${htmlGz} B > ${BUDGETS.htmlGz} B`);
  if (swGz > BUDGETS.swGz) fail(`sw.js gz ${swGz} B > ${BUDGETS.swGz} B`);
}
