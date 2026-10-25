import { readFile } from 'node:fs/promises';

export async function loadGame(path = 'build/game.wasm') {
  const { instance } = await WebAssembly.instantiate(await readFile(path), {});
  const ex = instance.exports;
  return { ex, mem: () => new Uint8Array(ex.memory.buffer) };
}
