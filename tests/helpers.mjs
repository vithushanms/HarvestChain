import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

export const STATE = JSON.parse(readFileSync('tools/state.json', 'utf8'));

export async function loadGame(path = 'build/game.wasm') {
  const { instance } = await WebAssembly.instantiate(await readFile(path), {});
  const ex = instance.exports;
  return { ex, mem: () => new Uint8Array(ex.memory.buffer) };
}

const READ = { u8: 'getUint8', u16: 'getUint16', u32: 'getUint32', i32: 'getInt32' };
const SIZE = { u8: 1, u16: 2, u32: 4, i32: 4 };

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
