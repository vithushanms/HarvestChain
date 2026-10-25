import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, readState, stateBytes, STATE as stateJson } from './helpers.mjs';

const { ex, mem } = await loadGame();

test('init sets the §5 starting state', () => {
  ex.init(42); const s = readState(mem());
  assert.deepEqual([s.magic, s.version, s.seed, s.day, s.grid, s.rep, s.cash, s.truckCount],
                   [[0x48, 0x43], 1, 42, 1, 4, 0, 500, 1]);
  assert.equal(s.loanPrincipal + s.loanInterest + s.grace, 0);
  assert.ok(s.drift.every(v => v === 10000) && s.sat.every(v => v === 10000));
  assert.deepEqual(s.tiles.slice(0, 4).map(t => [t.kind, t.id, t.progress]), Array(4).fill([1, 0, 200]));
  assert.ok(s.tiles.slice(4).every(t => t.kind === 0));
  assert.deepEqual(s.trucks.map(t => [t.present, t.contract]), [[1, 255], [0, 255], [0, 255]]);
  assert.ok(s.inv.every(v => v === 0));
});

test('init seeds the RNG from the seed', () => {
  ex.init(42); assert.equal(ex.t_rng_next() >>> 0, 11355432);
});

test('save_len matches state.json and save_ptr is 0x1000', () => {
  assert.equal(ex.save_len(), stateJson.length); assert.equal(ex.save_ptr(), 0x1000);
});

test('re-init clears every byte of a dirty state region', () => {
  ex.init(7); const clean = mem().slice(0x1000, 0x5000);
  mem().fill(0xAB, 0x1000, 0x5000); ex.init(7);
  assert.deepEqual(mem().slice(0x1000, 0x5000), clean);
});

test('save → load round-trip is byte-identical', () => {
  ex.init(42); ex.t_rng_next(); const saved = stateBytes(mem(), ex.save_len());
  ex.init(9); mem().set(saved, ex.io_buf());
  assert.equal(ex.load(ex.io_buf(), saved.length), 0);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), saved);
});

for (const [name, mutate, len, code] of [
  ['too short', b => b, 3, 1], ['too long', b => b, 0x4001, 1],
  ['truncated', b => b, 0x200, 1], ['one byte over', b => b, 0x401, 1],
  ['zero rng word', b => { b.fill(0, 8, 12); }, null, 5],
  ['grid 3', b => { b[14] = 3; }, null, 5], ['grid 9', b => { b[14] = 9; }, null, 5],
  ['no trucks', b => { b[30] = 0; }, null, 5], ['4 trucks', b => { b[30] = 4; }, null, 5],
  ['bad magic', b => { b[0] = 0x58; }, null, 2], ['future version', b => { b[2] = 2; }, null, 3],
]) test(`load rejects ${name} and leaves state untouched`, () => {
  ex.init(42); const before = stateBytes(mem(), ex.save_len());
  const b = before.slice(); mutate(b); mem().set(b, ex.io_buf());
  assert.equal(ex.load(ex.io_buf(), len ?? b.length), code);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), before);
});

test('load from a source overlapping the state region succeeds unchanged', () => {
  ex.init(42); const before = stateBytes(mem(), ex.save_len());
  assert.equal(ex.load(ex.save_ptr(), ex.save_len()), 0);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), before);
});

test('load from out-of-bounds memory is rejected, not trapped, and leaves state untouched', () => {
  ex.init(42); const before = stateBytes(mem(), ex.save_len());
  const end = ex.memory.buffer.byteLength;
  mem().set(before.subarray(0, 4), end - 4);
  assert.equal(ex.load(end - 4, ex.save_len()), 4);
  assert.equal(ex.load(0xFFFFFF00, ex.save_len()), 4);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), before);
});
