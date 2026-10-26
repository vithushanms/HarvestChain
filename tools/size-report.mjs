// Size report for the shipping binary: per-function code bytes, data segments and section totals.
// Usage: npm run build && node tools/size-report.mjs [N]   (N = rows to print, default 30)
// Assembles build/game.prod.wat (the shipping text, t_* hooks stripped) a second time with names kept
// (wat2wasm --debug-names, wasm-opt -Oz -g) and parses the binary itself: the code bodies are the same
// as build/game.wasm's (names live in a custom section, which the shipped file does not carry; the
// script checks the code section sizes agree). "gz" per row = the row's bytes gzipped alone (not
// additive; a rough guide to what removing it saves).
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv[2] || 30);
const prodWat = join(root, 'build', 'game.prod.wat'), shipped = join(root, 'build', 'game.wasm');
if (!existsSync(prodWat) || !existsSync(shipped)) { console.error('run npm run build first'); process.exit(1); }
const bin = (n) => join(root, 'node_modules', '.bin', n);
const tmp = mkdtempSync(join(tmpdir(), 'hc-size-'));
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); if (r.status) { console.error(r.stderr); process.exit(1); } };
run(bin('wat2wasm'), [prodWat, '-o', join(tmp, 'n.raw.wasm'), '--debug-names', '--disable-simd', '--disable-multi-value',
  '--disable-reference-types', '--disable-saturating-float-to-int']);
const opt = (o, extra) => { run(bin('wasm-opt'), [join(tmp, 'n.raw.wasm'), '-o', join(tmp, o), ...extra, '-Oz', '--converge', '-g', '--mvp-features',
  '--enable-bulk-memory', '--enable-sign-ext', '--enable-mutable-globals']); return readFileSync(join(tmp, o)); };
const named = opt('n.wasm', []);
// attribution view: the same optimisation with inlining off, so a helper inlined into its single caller
// (wasm-opt -Oz does that) keeps its own row and its source file
const flat = opt('f.wasm', ['--no-inline=*']);
rmSync(tmp, { recursive: true });

// ---- minimal binary reader
function sections(buf) {
  let p = 8; const out = [];
  const leb = () => { let r = 0, s = 0, b; do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  while (p < buf.length) {
    const id = buf[p++], size = leb(), start = p;
    let name = '';
    if (id === 0) { const n = leb(); name = buf.toString('utf8', p, p + n); }
    out.push({ id, name, start, end: start + size, size: size + (start - (start - 1)) });
    p = start + size;
  }
  return out;
}
const reader = (buf, p) => ({
  p,
  leb() { let r = 0, s = 0, b; do { b = buf[this.p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; },
  str() { const n = this.leb(); const s = buf.toString('utf8', this.p, this.p + n); this.p += n; return s; },
});
const SEC = ['custom', 'type', 'import', 'function', 'table', 'memory', 'global', 'export', 'start', 'element', 'code', 'data', 'datacount'];

function analyse(buf) {
  const secs = sections(buf);
  const code = secs.find((s) => s.id === 10), data = secs.find((s) => s.id === 11);
  const fns = [];
  let r = reader(buf, code.start);
  for (let i = 0, n = r.leb(); i < n; i++) { const sz = r.leb(); fns.push({ i, start: r.p, size: sz }); r.p += sz; }
  const segs = [];
  if (data) {
    r = reader(buf, data.start);
    for (let i = 0, n = r.leb(); i < n; i++) {
      const flag = r.leb(); let off = 0;
      if (flag === 0) { // active, memory 0: i32.const off end
        r.p++; off = r.leb(); if (off & 0x40000000) off |= 0; r.p++;
      } else if (flag === 2) { r.leb(); r.p++; off = r.leb(); r.p++; }
      const len = r.leb(); segs.push({ i, off, start: r.p, size: len }); r.p += len;
    }
  }
  const names = new Map(), imports = 0;
  const ns = secs.find((s) => s.id === 0 && s.name === 'name');
  if (ns) {
    r = reader(buf, ns.start); r.str();
    while (r.p < ns.end) {
      const kind = buf[r.p++], len = r.leb(), end = r.p + len;
      if (kind === 1) for (let i = 0, n = r.leb(); i < n; i++) { const idx = r.leb(); names.set(idx, r.str()); }
      r.p = end;
    }
  }
  return { secs, fns, segs, names, imports };
}
const S = analyse(readFileSync(shipped)), A = analyse(named), F = analyse(flat);
const sum = (a) => a.reduce((t, x) => t + x.size, 0);
const gz = (b) => gzipSync(b, { level: 9 }).length;
const kb = (n) => n.toLocaleString('en-US');

const ship = readFileSync(shipped);
console.log(`build/game.wasm  ${kb(ship.length)} B raw  ${kb(gz(ship))} B gz`);
console.log('\nsections (shipping binary):');
for (const s of S.secs) console.log(`  ${(SEC[s.id] + (s.name ? ':' + s.name : '')).padEnd(18)} ${kb(s.end - s.start).padStart(8)} B`);
const same = S.fns.length === A.fns.length && S.fns.every((f, i) => f.size === A.fns[i].size);
console.log(`\ncode: ${S.fns.length} functions, ${kb(sum(S.fns))} B bodies${same ? '' : '  (WARNING: named build differs from the shipped one; sizes below are from the named build)'}`);
console.log(`data: ${S.segs.length} segments, ${kb(sum(S.segs))} B`);

const rowsOf = (X, buf) => [
  ...X.fns.map((f) => ({ kind: 'func', name: X.names.get(f.i) ?? `#${f.i}`, size: f.size, bytes: buf.subarray(f.start, f.start + f.size) })),
  ...X.segs.map((s) => ({ kind: 'data', name: `0x${s.off.toString(16).padStart(4, '0')}`, size: s.size, bytes: buf.subarray(s.start, s.start + s.size) })),
].sort((a, b) => b.size - a.size);
const table = (title, rows) => {
  console.log(`\n${title}`);
  console.log('  kind  bytes     gz  name');
  for (const x of rows.slice(0, N)) console.log(`  ${x.kind}  ${String(x.size).padStart(5)}  ${String(gz(x.bytes)).padStart(5)}  ${x.name}`);
};
table(`top ${N} functions / data segments as shipped (single-caller helpers inlined into their caller):`, rowsOf(A, named));
const flatRows = rowsOf(F, flat);
table(`top ${N} with inlining off (attribution view; ${kb(sum(F.fns))} B code):`, flatRows);
// code bytes per source file (inlining off), from the function each src fragment defines
const owner = new Map();
for (const f of readFileSync(prodWat, 'utf8').split(/^;; ---- /m).slice(1)) {
  const file = f.slice(0, f.indexOf(' '));
  for (const m of f.matchAll(/^\s*\(func \$([\w.$]+)/gm)) owner.set(m[1], file);
}
const per = new Map();
for (const x of flatRows) if (x.kind === 'func') { const o = owner.get(x.name.replace(/^\$/, '')) ?? '?'; per.set(o, (per.get(o) ?? 0) + x.size); }
console.log('\ncode bytes by source file (inlining off):');
for (const [f, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  ${f.padEnd(20)} ${kb(n).padStart(7)} B`);
