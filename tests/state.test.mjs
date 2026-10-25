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
  mem().fill(0xAB, 0x1000, 0x5000); ex.init(7);
  assert.ok(mem().subarray(0x1000 + ex.save_len(), 0x5000).every(b => b === 0));
});

test('save → load round-trip is byte-identical', () => {
  ex.init(42); ex.t_rng_next(); const saved = stateBytes(mem(), ex.save_len());
  ex.init(9); mem().set(saved, ex.io_buf());
  assert.equal(ex.load(ex.io_buf(), saved.length), 0);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), saved);
});

for (const [name, mutate, len, code] of [
  ['too short', b => b, 3, 1], ['too long', b => b, 0x4001, 1],
  ['bad magic', b => { b[0] = 0x58; }, null, 2], ['future version', b => { b[2] = 2; }, null, 3],
]) test(`load rejects ${name} and leaves state untouched`, () => {
  ex.init(42); const before = stateBytes(mem(), ex.save_len());
  const b = before.slice(); mutate(b); mem().set(b, ex.io_buf());
  assert.equal(ex.load(ex.io_buf(), len ?? b.length), code);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), before);
});
