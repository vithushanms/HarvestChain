import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from './helpers.mjs';

const { ex } = await loadGame();
const seq = (seed, n) => { ex.t_rng_seed(seed); return Array.from({ length: n }, () => ex.t_rng_next() >>> 0); };

test('xorshift32 reference sequence, seed 1', () => {
  assert.deepEqual(seq(1, 4), [270369, 67634689, 2647435461, 307599695]);
});

test('xorshift32 reference sequence, seed 42', () => {
  assert.deepEqual(seq(42, 4), [11355432, 2836018348, 476557059, 3648046016]);
});

test('seed 0 is remapped and never sticks at zero', () => {
  assert.deepEqual(seq(0, 4), [1085196063, 2447379481, 2618286376, 1701901981]);
});

test('rng_range is unsigned modulo', () => {
  ex.t_rng_seed(42);
  assert.equal(ex.t_rng_range(10), 2);      // 11355432 % 10
  assert.equal(ex.t_rng_range(1000), 348);  // 2836018348 % 1000 (unsigned)
});

test('same seed, same sequence', () => {
  assert.deepEqual(seq(12345, 50), seq(12345, 50));
});
