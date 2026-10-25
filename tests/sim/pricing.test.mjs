import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, readState, stateBytes } from '../helpers.mjs';

const { ex, mem } = await loadGame();
const dv = () => new DataView(mem().buffer);
const sat = (m, g) => readState(mem()).sat[m * 13 + g];
const drift = (g) => readState(mem()).drift[g];
const WHEAT = 0, WINE = 12, FLOUR = 5;
const STAND = 0, TOWN = 1, CITY = 2;

test('base prices at x1.0', () => {
  ex.init(42);
  assert.equal(ex.price(TOWN, WHEAT), 8);
  assert.equal(ex.price(STAND, WHEAT), 6);
  assert.equal(ex.price(CITY, WHEAT), 4);
  assert.equal(ex.price(CITY, WINE), 168);
});

test('price applies drift, event modifier and saturation in order, floor, min 1', () => {
  ex.init(42);
  ex.t_set_drift(WHEAT, 13000);
  assert.equal(ex.price(TOWN, WHEAT), 10); // 800*1.3 = 1040 -> 10
  ex.t_put_event(0, 1, TOWN, WHEAT, 5); // surge x1.5
  assert.equal(ex.price(TOWN, WHEAT), 15); // 1040*1.5 = 1560
  ex.t_set_sat(TOWN, WHEAT, 5000);
  assert.equal(ex.price(TOWN, WHEAT), 7); // 780 -> 7
  ex.init(42);
  ex.t_set_sat(CITY, WHEAT, 0);
  assert.equal(ex.price(CITY, WHEAT), 1); // never below $1
});

test('saturation per unit', () => {
  ex.init(42);
  const total = ex.t_sell_units(STAND, WHEAT, 10);
  assert.equal(sat(STAND, WHEAT), 8000);
  // units priced 640,627.2.. in cents: each floors separately to dollars: 6,6,6,6,6,5,5,5,5,5? check sum via price walk
  ex.init(42);
  let expect = 0;
  for (let i = 0; i < 10; i++) { expect += ex.price(STAND, WHEAT); ex.t_set_sat(STAND, WHEAT, 10000 - 200 * (i + 1)); }
  assert.equal(total, expect);
  ex.init(42); ex.t_sell_units(STAND, WHEAT, 10);
  assert.equal(ex.price(STAND, WHEAT), 5); // 6.4 * 0.8 = 5.12
});

test('sell_units does not touch inventory', () => {
  ex.init(42); ex.t_give(WHEAT, 5, 0);
  ex.t_sell_units(TOWN, WHEAT, 3);
  assert.equal(ex.t_count(WHEAT), 5);
});

test('saturation floors at 50%', () => {
  ex.init(42);
  ex.t_sell_units(STAND, WHEAT, 100);
  assert.equal(sat(STAND, WHEAT), 5000);
  ex.t_sell_units(TOWN, WHEAT, 200);
  assert.equal(sat(TOWN, WHEAT), 5000);
  assert.equal(sat(STAND, WHEAT + 1), 10000);
});

test('sell_units with qty 0 is a no-op', () => {
  ex.init(42); const b = stateBytes(mem(), ex.save_len());
  assert.equal(ex.t_sell_units(TOWN, WHEAT, 0), 0);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), b);
});

test('recovery: Stand full, Town halves the gap, City 34%', () => {
  ex.init(42);
  ex.t_set_sat(STAND, WHEAT, 7000); ex.t_set_sat(TOWN, WHEAT, 7000); ex.t_set_sat(CITY, WHEAT, 7000);
  ex.t_sat_recover();
  assert.equal(sat(STAND, WHEAT), 10000);
  assert.equal(sat(TOWN, WHEAT), 8500);
  assert.equal(sat(CITY, WHEAT), 8020);
  assert.equal(sat(CITY, WINE), 10000);
});

test('drift clamps to 0.7-1.3 over 1,000 ticks and driftNext in {-500,0,500}', () => {
  ex.init(42);
  let sawMin = false, sawMax = false;
  for (let t = 0; t < 1000; t++) {
    ex.t_drift_tick();
    const s = readState(mem());
    for (let g = 0; g < 13; g++) {
      assert.ok(s.drift[g] >= 7000 && s.drift[g] <= 13000, `drift ${s.drift[g]}`);
      assert.ok([-500, 0, 500].includes(s.driftNext[g]), `next ${s.driftNext[g]}`);
      if (s.drift[g] === 7000) sawMin = true;
      if (s.drift[g] === 13000) sawMax = true;
    }
  }
  assert.ok(sawMin && sawMax, 'random walk should hit both clamps');
});

test('drift_tick applies pending driftNext then rerolls; clamps at bounds', () => {
  ex.init(42);
  dv().setInt16(0x1412 + 2 * 3, 500, true); // Apple +500
  dv().setInt16(0x1412 + 2 * 4, -500, true); // Grape -500
  ex.t_set_drift(3, 12800);
  ex.t_set_drift(4, 7200);
  ex.t_drift_tick();
  assert.equal(drift(3), 13000); // 13300 clamped
  assert.equal(drift(4), 7000);
  assert.equal(drift(WHEAT), 10000); // driftNext starts 0 => flat first day
});

test('drift_tick is deterministic and uses 13 rng draws', () => {
  ex.init(9); ex.t_drift_tick(); const a = stateBytes(mem(), ex.save_len());
  ex.init(9); ex.t_drift_tick();
  assert.deepEqual(stateBytes(mem(), ex.save_len()), a);
  ex.init(9); const r0 = ex.t_rng_next(); ex.init(9);
  for (let i = 0; i < 13; i++) ex.t_rng_next();
  const expected = ex.t_rng_next();
  ex.init(9); ex.t_drift_tick();
  assert.equal(ex.t_rng_next(), expected); assert.ok(r0 !== undefined);
});

test('festival disables Stand saturation only', () => {
  ex.init(42);
  ex.t_put_event(0, 4, 0, 0, 2);
  ex.t_sell_units(STAND, WHEAT, 20);
  assert.equal(sat(STAND, WHEAT), 10000);
  ex.t_sell_units(TOWN, WHEAT, 4);
  assert.equal(sat(TOWN, WHEAT), 10000 - 4 * 150);
});

test('counters: procSold for tier>=1, wineSold for Wine, saturating at 65535', () => {
  ex.init(42);
  ex.t_sell_units(TOWN, WHEAT, 5);
  assert.equal(readState(mem()).procSold, 0);
  ex.t_sell_units(TOWN, FLOUR, 3);
  assert.equal(readState(mem()).procSold, 3);
  assert.equal(readState(mem()).wineSold, 0);
  ex.t_sell_units(TOWN, WINE, 2);
  const s = readState(mem());
  assert.equal(s.procSold, 5); assert.equal(s.wineSold, 2);
  dv().setUint16(0x1410, 65530, true); dv().setUint16(0x140E, 65530, true);
  ex.t_sell_units(TOWN, WINE, 20);
  assert.equal(readState(mem()).procSold, 65535);
  assert.equal(readState(mem()).wineSold, 65535);
});
