import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, stateBytes } from '../helpers.mjs';

const { ex, mem } = await loadGame();
const LEN = 0x5B0;
const CORRUPT = 5;

// A realistic save: a few days in, with a loan, a building and trucks populated.
const goodSave = () => {
  ex.init(42);
  for (let i = 0; i < 6; i++) ex.end_day();
  ex.act(17, 500, 0, 0);
  ex.act(4, 20, 0, 0);
  return stateBytes(mem(), LEN);
};
const base = goodSave();

// Try to load `bytes`; the live game is a different, untouched run so "unchanged" is observable.
const tryLoad = (bytes) => {
  ex.init(9); ex.end_day();
  const before = stateBytes(mem(), LEN);
  mem().set(bytes, ex.io_buf());
  const err = ex.load(ex.io_buf(), bytes.length);
  return { err, before, after: stateBytes(mem(), LEN) };
};
const patch = (edits) => {
  const b = base.slice();
  const dv = new DataView(b.buffer);
  for (const [off, val, size = 1] of edits) {
    if (size === 1) b[off] = val;
    else if (size === 2) dv.setUint16(off, val & 0xFFFF, true);
    else dv.setInt32(off, val, true);
  }
  return b;
};
const rejects = (name, edits) => test(`load rejects ${name}`, () => {
  const { err, before, after } = tryLoad(patch(edits));
  assert.equal(err, CORRUPT);
  assert.deepEqual(after, before, 'state untouched');
});
const accepts = (name, edits) => test(`load accepts ${name}`, () => {
  const bytes = patch(edits);
  const { err, after } = tryLoad(bytes);
  assert.equal(err, 0);
  assert.deepEqual(after, bytes);
});

test('the unmodified save loads and round-trips byte-identically', () => {
  const { err, after } = tryLoad(base);
  assert.equal(err, 0); assert.deepEqual(after, base);
});

const TRUCK = (i) => 0x160 + 48 * i, TILE = (i) => 0x200 + 8 * i;
rejects('status 4', [[0x400, 4]]);
rejects('weatherToday 6', [[0x401, 6]]);
rejects('weatherTomorrow 6', [[0x402, 6]]);
rejects('forecast 6', [[0x403, 6]]);
rejects('day 0', [[0x00C, 0, 2]]);
rejects('ringsBought 5 (max 4)', [[0x405, 5]]);
rejects('milestones 0x80', [[0x406, 0x80]]);
rejects('hintGood[0] 13', [[0x407, 13]]);
rejects('hintGood[1] 13', [[0x408, 13]]);
rejects('drift 6999', [[0x0F0 + 2 * 5, 6999, 2]]);
rejects('drift 13001', [[0x0F0 + 2 * 12, 13001, 2]]);
rejects('sat 10001', [[0x110 + 2 * 38, 10001, 2]]);
rejects('driftNext +501', [[0x412 + 2 * 3, 501, 2]]);
rejects('driftNext -501', [[0x412 + 2 * 7, -501, 2]]);
rejects('event kind 7', [[0x42C + 4 * 2, 7]]);
rejects('event market 3', [[0x42C + 4 * 1 + 1, 3]]);
rejects('event good 13', [[0x42C + 2, 13]]);
rejects('board good 13', [[0x440 + 8 * 2, 13]]);
rejects('board market 3', [[0x440 + 8 + 1, 3]]);
rejects('board active 2', [[0x440 + 3, 2]]);
rejects('accepted good 13', [[0x458 + 8, 13]]);
rejects('accepted market 3', [[0x458 + 8 * 2 + 1, 3]]);
rejects('accepted active 2', [[0x458 + 3, 2]]);
rejects('truck dest 3', [[TRUCK(0) + 1, 3]]);
rejects('truck phase 3', [[TRUCK(0) + 2, 3]]);
rejects('truck contract 3', [[TRUCK(0) + 5, 3]]);
rejects('truck cargo good 13', [[TRUCK(0) + 16 + 4 * 7, 13]]);
rejects('truck cargo age 8', [[TRUCK(0) + 17 + 4 * 3, 8]]);
rejects('truck cargo age 8 on truck 2', [[TRUCK(2) + 17, 8]]);
rejects('truck present = 2', [[TRUCK(0), 2]]);
rejects('a truck beyond truckCount marked present', [[TRUCK(1), 1]]);
rejects('a truck below truckCount missing', [[TRUCK(0), 0]]);
rejects('tile kind 3', [[TILE(5), 3]]);
rejects('crop id 5', [[TILE(0), 1], [TILE(0) + 1, 5]]);
rejects('building id 10', [[TILE(20), 2], [TILE(20) + 1, 10]]);
rejects('ghCrop 6', [[TILE(63) + 6, 6]]);
rejects('recipe 9', [[TILE(63) + 7, 9]]);
rejects('cellar bucket 11 (cellarHold 10)', [[0x470 + 319, 11]]);
rejects('grace 4 (graceDays 3 + 1)', [[0x01C, 5]]);
rejects('negative principal', [[0x014, -1, 4]]);
rejects('negative interest', [[0x018, -1, 4]]);

accepts('boundary values of every range', [
  [0x400, 3], [0x401, 5], [0x402, 5], [0x403, 5], [0x00C, 1, 2], [0x405, 4], [0x406, 0x7F],
  [0x407, 12], [0x408, 12], [0x0F0, 7000, 2], [0x0F0 + 24, 13000, 2], [0x110, 10000, 2], [0x110, 0, 2],
  [0x412, 500, 2], [0x412 + 2, -500, 2], [0x42C, 6], [0x42D, 2], [0x42E, 12],
  [0x441, 2], [0x440, 12], [0x443, 1], [TRUCK(0) + 1, 2], [TRUCK(0) + 2, 2], [TRUCK(0) + 5, 255], [TRUCK(0) + 5, 2],
  [TRUCK(0) + 16, 12], [TRUCK(0) + 17, 7], [TILE(1), 1], [TILE(1) + 1, 4], [TILE(2), 2], [TILE(2) + 1, 9],
  [TILE(2) + 6, 5], [TILE(2) + 7, 8], [0x470, 10], [0x01C, 4], [0x014, 0, 4], [0x018, 0, 4],
]);
