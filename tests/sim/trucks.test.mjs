import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, readState, stateBytes } from '../helpers.mjs';

const { ex, mem } = await loadGame();
const LEN = 0x5B0;
const dv = () => new DataView(mem().buffer);
const st = () => readState(mem());
const snap = () => stateBytes(mem(), LEN);
const WHEAT = 0, CORN = 1, TOMATO = 2, APPLE = 3, GRAPE = 4, AJ = 8;
const GARAGE = 9;
const LOAD = 10, UNLOAD = 11, SEND = 12, BUY = 13, UPG = 14;
const E = { BAD_ARG: 1, CASH: 6, STORAGE_FULL: 9, NO_STOCK: 10, AWAY: 11, FULL: 12, NO_SLOT: 13, MAX: 14, GARAGE: 15, CONTRACT: 16 };
const cash = () => dv().getInt32(0x1010, true);
const inv = (g, a) => dv().getUint16(0x1020 + (g * 8 + a) * 2, true);
const truck = (t = 0) => st().trucks[t];
const slots = (t = 0) => truck(t).cargo.filter((c) => c.qty > 0);
const fresh = () => { ex.init(42); mem().fill(0, 0x1200, 0x1400); };
const day = (w = 0) => { ex.t_set_weather(w); return ex.end_day(); };
// an action that must fail with `code` and leave every state byte alone
const fails = (code, ...args) => {
  const before = snap();
  assert.equal(ex.act(...args), code);
  assert.deepEqual(snap(), before);
};
const withGarage = () => { ex.t_put_bld(0, GARAGE); ex.t_set_cash(5000); };

test('truck_cap export: 20 base, +20 per level, 0 for no truck', () => {
  fresh();
  assert.equal(ex.truck_cap(0), 20);
  assert.equal(ex.truck_cap(1), 0);
  withGarage();
  assert.equal(ex.act(UPG, 0, 0, 0), 0);
  assert.equal(ex.truck_cap(0), 40);
});

test('load/unload moves oldest-first and keeps ages', () => {
  fresh();
  ex.t_give(AJ, 3, 4); ex.t_give(AJ, 5, 1);
  assert.equal(ex.act(LOAD, 0, AJ, 6), 0);
  assert.equal(inv(AJ, 4), 0); assert.equal(inv(AJ, 1), 2);
  assert.deepEqual(slots().map((c) => [c.good, c.age, c.qty]), [[AJ, 4, 3], [AJ, 1, 3]]);
  // loading more of the same age merges into the existing slot
  ex.t_give(AJ, 2, 1);
  assert.equal(ex.act(LOAD, 0, AJ, 4), 0);
  assert.deepEqual(slots().map((c) => [c.good, c.age, c.qty]), [[AJ, 4, 3], [AJ, 1, 7]]);
  assert.equal(ex.act(UNLOAD, 0, AJ, 5), 0); // 3 @4 first, then 2 @1
  assert.equal(inv(AJ, 4), 3); assert.equal(inv(AJ, 1), 2);
  assert.deepEqual(slots().map((c) => [c.good, c.age, c.qty]), [[AJ, 1, 5]]);
  assert.equal(ex.act(UNLOAD, 0, AJ, 5), 0);
  assert.equal(slots().length, 0);
  assert.equal(ex.t_count(AJ), 10);
});

test('load/unload error paths leave state unchanged', () => {
  fresh();
  ex.t_give(WHEAT, 30, 0);
  fails(E.BAD_ARG, LOAD, 0, 13, 1);   // bad good
  fails(E.BAD_ARG, LOAD, 0, WHEAT, 0); // zero qty
  fails(E.BAD_ARG, LOAD, 1, WHEAT, 1); // no such truck
  fails(E.BAD_ARG, LOAD, 3, WHEAT, 1);
  fails(E.NO_STOCK, LOAD, 0, CORN, 1);
  fails(E.NO_STOCK, LOAD, 0, WHEAT, 31);
  fails(E.FULL, LOAD, 0, WHEAT, 21);
  assert.equal(ex.act(LOAD, 0, WHEAT, 20), 0);
  fails(E.FULL, LOAD, 0, WHEAT, 1);
  fails(E.BAD_ARG, UNLOAD, 0, 13, 1);
  fails(E.BAD_ARG, UNLOAD, 0, WHEAT, 0);
  fails(E.BAD_ARG, UNLOAD, 2, WHEAT, 1);
  fails(E.NO_STOCK, UNLOAD, 0, WHEAT, 21);
  fails(E.NO_STOCK, UNLOAD, 0, CORN, 1);
  // storage full: 10 free after loading 20 of 30 held; cap 30 -> fill it up
  ex.t_give(CORN, 20, 0);
  fails(E.STORAGE_FULL, UNLOAD, 0, WHEAT, 15);
});

test('load needs cargo slots: E_TRUCK_FULL when distinct (good, age) would exceed 8', () => {
  fresh();
  for (let a = 0; a < 6; a++) ex.t_give(AJ, 1, a);
  ex.t_give(WHEAT, 1, 0); ex.t_give(CORN, 1, 0); ex.t_give(APPLE, 1, 0);
  assert.equal(ex.act(LOAD, 0, AJ, 6), 0);
  assert.equal(slots().length, 6);
  assert.equal(ex.act(LOAD, 0, WHEAT, 1), 0);
  assert.equal(ex.act(LOAD, 0, CORN, 1), 0);
  fails(E.FULL, LOAD, 0, APPLE, 1);
  assert.equal(slots().length, 8);
});

test('send to Town: cargo sold, cash back after exactly 2 end_days', () => {
  fresh();
  ex.t_set_cash(1000);
  ex.t_give(WHEAT, 10, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 10), 0);
  assert.equal(ex.act(SEND, 0, 1, 255), 0);
  let t = truck(); assert.equal(t.phase, 1); assert.equal(t.daysLeft, 1); assert.equal(t.dest, 1);
  assert.equal(day(), 0);
  t = truck(); assert.equal(t.phase, 2); assert.equal(t.daysLeft, 1);
  assert.equal(slots().length, 0);
  assert.ok(t.cashBack > 0);
  assert.equal(cash(), 1000);
  const back = t.cashBack;
  assert.equal(day(), 0);
  t = truck(); assert.equal(t.phase, 0); assert.equal(t.cashBack, 0); assert.equal(t.daysLeft, 0);
  assert.equal(cash(), 1000 + back);
});

test('send to City takes 4 end_days; Fast makes it 3', () => {
  fresh();
  ex.t_set_cash(1000); ex.t_give(WHEAT, 10, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 10), 0);
  assert.equal(ex.act(SEND, 0, 2, 255), 0);
  for (let i = 0; i < 3; i++) { day(); assert.equal(cash(), 1000, `day ${i + 1}`); assert.notEqual(truck().phase, 0); }
  day();
  assert.equal(truck().phase, 0); assert.ok(cash() > 1000);

  fresh(); withGarage();
  assert.equal(ex.act(UPG, 0, 2, 0), 0);
  assert.equal(truck().upg & 8, 8);
  ex.t_set_cash(1000); ex.t_give(WHEAT, 10, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 10), 0);
  assert.equal(ex.act(SEND, 0, 2, 255), 0);
  // the Garage costs $3 upkeep per End Day (step 9)
  for (let i = 0; i < 2; i++) { day(); assert.equal(cash(), 1000 - 3 * (i + 1)); }
  assert.equal(truck().daysLeft, 1);
  day();
  assert.equal(truck().phase, 0); assert.ok(cash() > 1000 - 9);
});

test('Fast does not shorten the Town leg', () => {
  fresh(); withGarage();
  assert.equal(ex.act(UPG, 0, 2, 0), 0);
  ex.t_give(WHEAT, 5, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 5), 0);
  assert.equal(ex.act(SEND, 0, 1, 255), 0);
  day(); assert.equal(truck().daysLeft, 1);
  day(); assert.equal(truck().phase, 0);
});

test('RoadClosure adds one day to City trips only', () => {
  fresh(); ex.t_put_event(0, 3, 0, 0, 9);
  ex.t_give(WHEAT, 10, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 10), 0);
  assert.equal(ex.act(SEND, 0, 2, 255), 0);
  assert.equal(truck().daysLeft, 3);
  for (let i = 0; i < 4; i++) { day(); assert.notEqual(truck().phase, 0); }
  day(); assert.equal(truck().phase, 0);
  ex.t_give(WHEAT, 5, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 5), 0);
  assert.equal(ex.act(SEND, 0, 1, 255), 0);
  assert.equal(truck().daysLeft, 1);
});

test('FuelSpike charges $20 to send; E_CASH when short', () => {
  fresh(); ex.t_put_event(0, 5, 0, 0, 9);
  ex.t_give(WHEAT, 10, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 10), 0);
  ex.t_set_cash(19);
  fails(E.CASH, SEND, 0, 1, 255);
  ex.t_set_cash(500);
  assert.equal(ex.act(SEND, 0, 1, 255), 0);
  assert.equal(cash(), 480);
});

test('no fuel cost without a spike', () => {
  fresh(); ex.t_give(WHEAT, 10, 0); ex.t_set_cash(500);
  assert.equal(ex.act(LOAD, 0, WHEAT, 10), 0);
  assert.equal(ex.act(SEND, 0, 1, 255), 0);
  assert.equal(cash(), 500);
});

test('send errors leave state unchanged', () => {
  fresh(); ex.t_give(WHEAT, 10, 0);
  fails(E.BAD_ARG, SEND, 0, 0, 255);
  fails(E.BAD_ARG, SEND, 0, 3, 255);
  fails(E.BAD_ARG, SEND, 1, 1, 255);
  fails(E.NO_STOCK, SEND, 0, 1, 255); // empty truck
  assert.equal(ex.act(LOAD, 0, WHEAT, 10), 0);
  fails(E.CONTRACT, SEND, 0, 1, 0);   // tags arrive in Task 7
  assert.equal(ex.act(SEND, 0, 1, 255), 0);
  fails(E.AWAY, SEND, 0, 1, 255);
});

test('an away truck cannot be loaded, unloaded or upgraded', () => {
  fresh(); withGarage(); ex.t_give(WHEAT, 10, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 5), 0);
  assert.equal(ex.act(SEND, 0, 1, 255), 0);
  fails(E.AWAY, LOAD, 0, WHEAT, 1);
  fails(E.AWAY, UNLOAD, 0, WHEAT, 1);
  fails(E.AWAY, UPG, 0, 0, 0);
});

test('perishables spoil in an unrefrigerated truck, not in a refrigerated one', () => {
  fresh(); ex.t_give(TOMATO, 5, 0);
  assert.equal(ex.act(LOAD, 0, TOMATO, 5), 0);
  day();
  assert.deepEqual(slots().map((c) => [c.age, c.qty]), [[1, 5]]);
  day();
  assert.equal(slots().length, 0);

  fresh(); withGarage();
  assert.equal(ex.act(UPG, 0, 1, 0), 0);
  ex.t_give(TOMATO, 5, 0);
  assert.equal(ex.act(LOAD, 0, TOMATO, 5), 0);
  for (let i = 0; i < 4; i++) day();
  assert.deepEqual(slots().map((c) => [c.age, c.qty]), [[0, 5]]);
});

test('Heatwave ages truck cargo by 2; non-perishables never age', () => {
  fresh(); ex.t_give(GRAPE, 4, 0); ex.t_give(WHEAT, 4, 0);
  assert.equal(ex.act(LOAD, 0, GRAPE, 4), 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 4), 0);
  day(5);
  assert.deepEqual(slots().map((c) => [c.good, c.age, c.qty]), [[GRAPE, 2, 4], [WHEAT, 0, 4]]);
  day(5);
  assert.deepEqual(slots().map((c) => [c.good, c.age, c.qty]), [[WHEAT, 0, 4]]);
});

test('cargo on an away truck ages too (sold fresh-spoilt goods are gone)', () => {
  fresh(); ex.t_set_cash(1000); ex.t_give(TOMATO, 5, 0);
  assert.equal(ex.act(LOAD, 0, TOMATO, 5), 0);
  assert.equal(ex.act(SEND, 0, 2, 255), 0); // 2 days out
  day(); day();                              // spoils at step 5 of day 2, before arrival
  assert.equal(truck().cashBack, 0);
});

test('BUY_TRUCK needs a free slot (Garages), cash, and respects maxTrucks', () => {
  fresh(); ex.t_set_cash(5000);
  fails(E.NO_SLOT, BUY, 0, 0, 0);
  ex.t_put_bld(0, GARAGE);
  ex.t_set_cash(449);
  fails(E.CASH, BUY, 0, 0, 0);
  ex.t_set_cash(5000);
  assert.equal(ex.act(BUY, 0, 0, 0), 0);
  assert.equal(st().truckCount, 2); assert.equal(cash(), 4550);
  const t = truck(1);
  assert.equal(t.present, 1); assert.equal(t.phase, 0); assert.equal(t.contract, 255); assert.equal(t.upg, 0);
  fails(E.NO_SLOT, BUY, 0, 0, 0);
  ex.t_put_bld(1, GARAGE); ex.t_put_bld(2, GARAGE); ex.t_put_bld(3, GARAGE);
  assert.equal(ex.act(BUY, 0, 0, 0), 0);
  assert.equal(st().truckCount, 3);
  fails(E.NO_SLOT, BUY, 0, 0, 0);
  assert.equal(ex.truck_cap(2), 20);
});

test('UPGRADE_TRUCK needs a Garage; cap +20 twice then E_MAX; fridge and fast once', () => {
  fresh(); ex.t_set_cash(5000);
  fails(E.GARAGE, UPG, 0, 0, 0);
  ex.t_put_bld(0, GARAGE);
  fails(E.BAD_ARG, UPG, 0, 3, 0);
  fails(E.BAD_ARG, UPG, 1, 0, 0);
  assert.equal(ex.act(UPG, 0, 0, 0), 0); assert.equal(ex.truck_cap(0), 40); assert.equal(cash(), 4700);
  assert.equal(ex.act(UPG, 0, 0, 0), 0); assert.equal(ex.truck_cap(0), 60);
  fails(E.MAX, UPG, 0, 0, 0);
  assert.equal(ex.act(UPG, 0, 1, 0), 0); assert.equal(cash(), 4000);
  fails(E.MAX, UPG, 0, 1, 0);
  assert.equal(ex.act(UPG, 0, 2, 0), 0); assert.equal(cash(), 3500);
  fails(E.MAX, UPG, 0, 2, 0);
  assert.equal(truck().upg, 2 | 4 | 8);
  ex.t_set_cash(299);
  fresh(); ex.t_put_bld(0, GARAGE); ex.t_set_cash(299);
  fails(E.CASH, UPG, 0, 0, 0);
});

test('actions are blocked outside Playing/Endless', () => {
  fresh(); mem()[0x1400] = 3;
  fails(2, LOAD, 0, WHEAT, 1);
  fails(2, BUY, 0, 0, 0);
});

test('fuel check applies only under FuelSpike (negative cash may still send)', () => {
  fresh(); ex.t_give(WHEAT, 10, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 10), 0);
  ex.t_set_cash(-5);
  assert.equal(ex.act(SEND, 0, 1, 255), 0);
  assert.equal(cash(), -5);

  fresh(); ex.t_put_event(0, 5, 0, 0, 9); ex.t_give(WHEAT, 10, 0);
  assert.equal(ex.act(LOAD, 0, WHEAT, 10), 0);
  ex.t_set_cash(19);
  fails(E.CASH, SEND, 0, 1, 255);
  ex.t_set_cash(20);
  assert.equal(ex.act(SEND, 0, 1, 255), 0);
  assert.equal(cash(), 0);
});

// Reference: sell the same cargo directly on an identical fresh state, then apply the
// step-8 recovery that runs later in the same end_day.
const reference = (market, lots) => {
  fresh();
  let total = 0;
  for (const [g, q] of lots) total += ex.t_sell_units(market, g, q);
  ex.t_sat_recover();
  return { total, sat: st().sat.slice() };
};
const arrival = (market, lots, give) => {
  fresh(); ex.t_set_cash(1000);
  for (const [g, q, a] of give) ex.t_give(g, q, a);
  for (const [g, q] of lots) assert.equal(ex.act(LOAD, 0, g, q), 0);
  assert.equal(ex.act(SEND, 0, market, 255), 0);
  const days = market === 1 ? 1 : 2;
  for (let i = 0; i < days; i++) day();
  return { back: truck().cashBack, sat: st().sat.slice() };
};

test('arrival sale pins dollars and saturation, Town and City', () => {
  for (const market of [1, 2]) {
    const lots = [[WHEAT, 10]];
    const ref = reference(market, lots);
    const got = arrival(market, lots, [[WHEAT, 10, 0]]);
    assert.ok(ref.total > 0);
    assert.equal(got.back, ref.total, `market ${market}`);
    assert.deepEqual(got.sat, ref.sat, `sat market ${market}`);
    assert.notEqual(ref.sat[market * 13 + WHEAT], 10000);
  }
  // different markets give different prices, so "always Town" cannot pass for City
  assert.notEqual(reference(1, [[WHEAT, 10]]).total, reference(2, [[WHEAT, 10]]).total);
});

test('two-slot cargo: every slot sold in order, saturation compounds on the second', () => {
  for (const market of [1, 2]) {
    // different goods
    let lots = [[WHEAT, 5], [CORN, 4]];
    let ref = reference(market, lots);
    let got = arrival(market, lots, [[WHEAT, 5, 0], [CORN, 4, 0]]);
    assert.equal(got.back, ref.total);
    assert.deepEqual(got.sat, ref.sat);
    // same good, two ages: the second slot sells into already-lowered saturation
    lots = [[AJ, 6]];
    ref = reference(market, [[AJ, 3], [AJ, 3]]);
    got = arrival(market, lots, [[AJ, 3, 2], [AJ, 3, 0]]);
    assert.equal(got.back, ref.total);
    assert.deepEqual(got.sat, ref.sat);
  }
});
