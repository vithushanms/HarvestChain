import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmdirSync, renameSync } from 'node:fs';

export const STATE = JSON.parse(readFileSync('tools/state.json', 'utf8'));

// The binary is read and compiled once per test process: every instance a test file makes runs the
// same code even if build/ is rewritten meanwhile (a concurrent `npm run build`), which once made a
// golden run record a hash from a different binary for its last state.
const MODULES = new Map();
export async function loadGame(path = 'build/game.test.wasm') {
  if (!MODULES.has(path)) MODULES.set(path, readFile(path).then((b) => WebAssembly.compile(b)));
  const instance = await WebAssembly.instantiate(await MODULES.get(path), {});
  const ex = instance.exports;
  return { ex, mem: () => new Uint8Array(ex.memory.buffer) };
}

const READ = { u8: 'getUint8', u16: 'getUint16', i16: 'getInt16', u32: 'getUint32', i32: 'getInt32' };
const SIZE = { u8: 1, u16: 2, i16: 2, u32: 4, i32: 4 };

function decode(dv, base, fields) {
  const out = {};
  for (const [name, f] of Object.entries(fields)) {
    const at = base + f.off;
    if (f.fields) {
      out[name] = Array.from({ length: f.count }, (_, i) => decode(dv, at + i * f.stride, f.fields));
    } else if (f.count) {
      out[name] = Array.from({ length: f.count }, (_, i) => dv[READ[f.type]](at + i * SIZE[f.type], true));
    } else {
      out[name] = dv[READ[f.type]](at, true);
    }
  }
  return out;
}

// Decode the state region into a plain object using tools/state.json offsets.
export function readState(memU8) {
  return decode(new DataView(memU8.buffer), STATE.base, STATE.fields);
}

export function stateBytes(memU8, len) {
  return memU8.slice(STATE.base, STATE.base + len);
}

// UPDATE_GOLDEN=1: merge hashes into a golden JSON shared by several test files. node --test runs
// files in parallel processes; an unlocked read-merge-write let one file's stale copy overwrite
// another's fresh hashes. A lock directory serialises the read-merge-write; the write is atomic.
export function mergeGolden(path, hashes) {
  const lock = `${path}.lock`, t0 = Date.now();
  for (;;) {
    try { mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - t0 > 30000) throw new Error(`${lock} held for 30 s (stale? remove it)`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    const old = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    writeFileSync(`${path}.tmp${process.pid}`, JSON.stringify({ ...old, ...hashes }, null, 2) + '\n');
    renameSync(`${path}.tmp${process.pid}`, path);
  } finally { rmdirSync(lock); }
}
