import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, readState, stateBytes } from '../helpers.mjs';

const { ex, mem } = await loadGame();
const LEN = 0x5B0;
const dv = () => new DataView(mem().buffer);
const st = () => readState(mem());
const snap = () => stateBytes(mem(), LEN);
const E = { BAD_ARG: 1, STATUS: 2, TILE_OUT: 3, TILE_BUSY: 4, SEASON: 5, CASH: 6, LOCKED: 7, NOT_RIPE: 8,
  STORAGE_FULL: 9, NO_STOCK: 10, MAX: 14, NOT_BUILDING: 19 };
const A = { PLANT: 1, HARVEST: 2, HARVEST_ALL: 3, BUILD: 4, DEMOLISH: 5, UPGRADE: 6, RECIPE: 7, LAND: 8, SELL: 9, CONTINUE: 19 };
const WHEAT = 0, CORN = 1, TOMATO = 2, APPLE = 3, GRAPE = 4;
const MILL = 0, BAKERY = 3, CELLAR = 4, WAREHOUSE = 5, GREENHOUSE = 7, GARAGE = 9;
const tileAt = (i) => 0x1200 + i * 8;
const setDay = (d) => dv().setUint16(0x100C, d, true);
const setStatus = (s) => { mem()[0x1400] = s; };
const setTile = (i, kind, id, progress = 0, flags = 0, gh = 0) => {
  const o = tileAt(i); mem().fill(0, o, o + 8);
  mem()[o] = kind; mem()[o + 1] = id; dv().setUint16(o + 2, progress, true); mem()[o + 5] = flags; mem()[o + 6] = gh;
};
// init starts with four Wheat tiles; tests want an empty farm.
const fresh = () => { ex.init(42); mem().fill(0, 0x1200, 0x1400); };
// Assert an action fails with `code` and leaves every state byte untouched.
const fails = (code, ...args) => {
  const before = snap();
  assert.equal(ex.act(...args), code);
  assert.deepEqual(snap(), before);
};

test('rank thresholds', () => {
  fresh();
  for (const [rep, rank] of [[0, 1], [2, 1], [3, 2], [7, 2], [8, 3], [15, 4], [24, 4], [25, 5], [200, 5]]) {
    mem()[0x100F] = rep; assert.equal(ex.rank(), rank, `rep ${rep}`);
  }
});

test('dispatcher: unknown and unwired ids, status guard, continue', () => {
  fresh();
  fails(E.BAD_ARG, 0, 0, 0, 0);
  fails(E.BAD_ARG, 20, 0, 0, 0);
  for (let id = 15; id <= 18; id++) fails(E.BAD_ARG, id, 0, 0, 0);
  fails(E.STATUS, A.CONTINUE, 0, 0, 0); // Playing
  for (const s of [1, 3]) { setStatus(s); fails(E.STATUS, A.PLANT, 0, WHEAT, 0); fails(E.STATUS, A.HARVEST_ALL, 0, 0, 0); }
  setStatus(1);
  assert.equal(ex.act(A.CONTINUE, 0, 0, 0), 0);
  assert.equal(st().status, 2);
  fails(E.STATUS, A.CONTINUE, 0, 0, 0); // Endless
  assert.equal(ex.act(A.PLANT, 0, WHEAT, 0), 0); // Endless allows actions
  setStatus(3);
  fails(E.STATUS, A.CONTINUE, 0, 0, 0);
});

test('PLANT', () => {
  fresh();
  assert.equal(ex.act(A.PLANT, 0, WHEAT, 0), 0);
  let s = st();
  assert.equal(s.cash, 490);
  assert.deepEqual([s.tiles[0].kind, s.tiles[0].id, s.tiles[0].progress], [1, WHEAT, 0]);
  fails(E.SEASON, A.PLANT, 1, CORN, 0); // Corn not in Spring
  fails(E.TILE_OUT, A.PLANT, 4, WHEAT, 0); // (4,0) at grid 4
  fails(E.TILE_OUT, A.PLANT, 64, WHEAT, 0);
  fails(E.TILE_OUT, A.PLANT, 4000, WHEAT, 0);
  fails(E.TILE_BUSY, A.PLANT, 0, WHEAT, 0);
  fails(E.BAD_ARG, A.PLANT, 1, 5, 0);
  ex.t_set_cash(9);
  fails(E.CASH, A.PLANT, 1, WHEAT, 0);
  ex.t_set_cash(-100);
  fails(E.CASH, A.PLANT, 1, WHEAT, 0);
  ex.t_set_cash(10);
  assert.equal(ex.act(A.PLANT, 1, WHEAT, 0), 0);
  assert.equal(st().cash, 0);
});

test('PLANT in Greenhouse: any season, only when empty', () => {
  fresh(); setDay(61); // Winter
  assert.equal(ex.season(), 3);
  fails(E.SEASON, A.PLANT, 0, TOMATO, 0);
  setTile(0, 2, GREENHOUSE);
  assert.equal(ex.act(A.PLANT, 0, TOMATO, 0), 0);
  const t = st().tiles[0];
  assert.deepEqual([t.kind, t.id, t.ghCrop, t.progress, t.ripeAge], [2, GREENHOUSE, TOMATO + 1, 0, 0]);
  assert.equal(st().cash, 485);
  fails(E.TILE_BUSY, A.PLANT, 0, WHEAT, 0);
  setTile(1, 2, MILL);
  fails(E.TILE_BUSY, A.PLANT, 1, WHEAT, 0);
  setTile(2, 2, GREENHOUSE);
  ex.t_set_cash(1);
  fails(E.CASH, A.PLANT, 2, TOMATO, 0);
});

test('HARVEST', () => {
  fresh();
  setTile(0, 1, WHEAT, 299);
  fails(E.NOT_RIPE, A.HARVEST, 0, 0, 0);
  setTile(0, 1, WHEAT, 300);
  assert.equal(ex.act(A.HARVEST, 0, 0, 0), 0);
  assert.equal(ex.t_count(WHEAT), 4);
  assert.deepEqual(Array.from(mem().slice(tileAt(0), tileAt(0) + 8)), [0, 0, 0, 0, 0, 0, 0, 0]);
  fails(E.BAD_ARG, A.HARVEST, 0, 0, 0); // empty
  setTile(1, 2, MILL);
  fails(E.BAD_ARG, A.HARVEST, 1, 0, 0);
  setTile(2, 2, GREENHOUSE);
  fails(E.BAD_ARG, A.HARVEST, 2, 0, 0); // greenhouse with no crop
  fails(E.TILE_OUT, A.HARVEST, 4, 0, 0);
});

test('HARVEST storage full', () => {
  fresh();
  ex.t_give(CORN, 27, 0); // cap 30, used 27, wheat yields 4
  setTile(0, 1, WHEAT, 300);
  fails(E.STORAGE_FULL, A.HARVEST, 0, 0, 0);
  ex.t_take(CORN, 1); // 26 used: exactly fits
  assert.equal(ex.act(A.HARVEST, 0, 0, 0), 0);
  assert.equal(ex.storage_used(), 30);
});

test('HARVEST Apple keeps tree and sets mature; regrow target is 300', () => {
  fresh();
  setTile(0, 1, APPLE, 799);
  fails(E.NOT_RIPE, A.HARVEST, 0, 0, 0);
  setTile(0, 1, APPLE, 800); mem()[tileAt(0) + 4] = 3;
  assert.equal(ex.act(A.HARVEST, 0, 0, 0), 0);
  assert.equal(ex.t_count(APPLE), 8);
  let t = st().tiles[0];
  assert.deepEqual([t.kind, t.id, t.progress, t.ripeAge, t.flags & 1], [1, APPLE, 0, 0, 1]);
  setTile(0, 1, APPLE, 299, 1);
  fails(E.NOT_RIPE, A.HARVEST, 0, 0, 0);
  setTile(0, 1, APPLE, 300, 1);
  assert.equal(ex.act(A.HARVEST, 0, 0, 0), 0);
  assert.equal(ex.t_count(APPLE), 16);
  assert.equal(st().tiles[0].kind, 1);
});

test('HARVEST Greenhouse crops', () => {
  fresh(); setDay(61);
  setTile(0, 2, GREENHOUSE, 300, 0, TOMATO + 1); mem()[tileAt(0) + 4] = 1;
  assert.equal(ex.act(A.HARVEST, 0, 0, 0), 0);
  assert.equal(ex.t_count(TOMATO), 6);
  let t = st().tiles[0];
  assert.deepEqual([t.kind, t.id, t.ghCrop, t.progress, t.ripeAge], [2, GREENHOUSE, 0, 0, 0]);
  setTile(1, 2, GREENHOUSE, 800, 0, APPLE + 1);
  assert.equal(ex.act(A.HARVEST, 1, 0, 0), 0);
  t = st().tiles[1];
  assert.deepEqual([t.kind, t.ghCrop, t.progress, t.flags & 1], [2, APPLE + 1, 0, 1]);
  setTile(2, 2, GREENHOUSE, 299, 0, TOMATO + 1);
  fails(E.NOT_RIPE, A.HARVEST, 2, 0, 0);
});

test('HARVEST Bumper x1.5 floor', () => {
  fresh();
  ex.t_put_event(0, 6, 0, 0, 5);
  setTile(0, 1, WHEAT, 300); // 4 -> 6
  setTile(1, 1, TOMATO, 300); // 6 -> 9
  setTile(2, 1, CORN, 400); // 5 -> 7 (floor 7.5)
  assert.equal(ex.act(A.HARVEST, 0, 0, 0), 0);
  assert.equal(ex.act(A.HARVEST, 1, 0, 0), 0);
  assert.equal(ex.act(A.HARVEST, 2, 0, 0), 0);
  assert.deepEqual([ex.t_count(WHEAT), ex.t_count(TOMATO), ex.t_count(CORN)], [6, 9, 7]);
});

test('HARVEST_ALL: skips tiles that do not fit, never exceeds cap, returns 0', () => {
  fresh();
  assert.equal(ex.act(A.HARVEST_ALL, 0, 0, 0), 0); // nothing ripe
  ex.t_give(CORN, 20, 0); // used 20, cap 30, room 10
  setTile(0, 1, CORN, 400);   // +5 -> 25
  setTile(1, 1, TOMATO, 300); // +6 would be 31: skipped
  setTile(2, 1, WHEAT, 300);  // +4 -> 29
  setTile(3, 1, WHEAT, 300);  // +4 -> 33: skipped
  setTile(8, 1, WHEAT, 100);  // not ripe
  assert.equal(ex.act(A.HARVEST_ALL, 0, 0, 0), 0);
  assert.equal(ex.storage_used(), 29);
  assert.equal(st().tiles[1].kind, 1);
  assert.equal(st().tiles[3].kind, 1);
  assert.equal(st().tiles[0].kind, 0);
  assert.equal(st().tiles[2].kind, 0);
  // repeated with the same full storage: the skipped tiles remain, cap holds
  for (let i = 0; i < 3; i++) {
    assert.equal(ex.act(A.HARVEST_ALL, 0, 0, 0), 0);
    assert.ok(ex.storage_used() <= ex.storage_cap());
  }
  assert.equal(ex.storage_used(), 29);
  ex.t_take(CORN, 25);
  assert.equal(ex.act(A.HARVEST_ALL, 0, 0, 0), 0);
  assert.equal(ex.storage_used(), 14);
  assert.equal(st().tiles[1].kind, 0);
  assert.equal(st().tiles[3].kind, 0);
});

test('BUILD', () => {
  fresh();
  assert.equal(ex.act(A.BUILD, 0, MILL, 0), 0);
  assert.equal(st().cash, 250);
  assert.deepEqual([st().tiles[0].kind, st().tiles[0].id], [2, MILL]);
  fails(E.TILE_BUSY, A.BUILD, 0, MILL, 0);
  fails(E.TILE_OUT, A.BUILD, 4, MILL, 0);
  fails(E.BAD_ARG, A.BUILD, 1, 10, 0);
  fails(E.LOCKED, A.BUILD, 1, CELLAR, 0); // rank 1
  fails(E.LOCKED, A.BUILD, 1, GREENHOUSE, 0); // day 1
  ex.t_set_cash(10000);
  fails(E.LOCKED, A.BUILD, 1, 6, 0); // ColdStore needs rank 2
  mem()[0x100F] = 7;
  fails(E.LOCKED, A.BUILD, 1, CELLAR, 0); // rank 2 only
  mem()[0x100F] = 8;
  assert.equal(ex.act(A.BUILD, 1, CELLAR, 0), 0);
  mem()[0x100F] = 0;
  setDay(41);
  assert.equal(ex.act(A.BUILD, 2, GREENHOUSE, 0), 0);
  ex.t_set_cash(10);
  fails(E.CASH, A.BUILD, 3, WAREHOUSE, 0);
  ex.t_set_cash(-5);
  fails(E.CASH, A.BUILD, 3, WAREHOUSE, 0);
});

test('BUILD Bakery needs a Mill; clears the tile cellar buckets', () => {
  fresh(); ex.t_set_cash(5000);
  fails(E.LOCKED, A.BUILD, 1, BAKERY, 0);
  assert.equal(ex.act(A.BUILD, 0, MILL, 0), 0);
  mem().fill(7, 0x1470 + 5, 0x1470 + 10);
  assert.equal(ex.act(A.BUILD, 1, BAKERY, 0), 0);
  assert.deepEqual(Array.from(mem().slice(0x1470 + 5, 0x1470 + 10)), [0, 0, 0, 0, 0]);
});

test('DEMOLISH', () => {
  fresh();
  fails(E.BAD_ARG, A.DEMOLISH, 0, 0, 0); // empty
  fails(E.TILE_OUT, A.DEMOLISH, 4, 0, 0);
  setTile(0, 1, WHEAT, 100);
  const cash = st().cash;
  assert.equal(ex.act(A.DEMOLISH, 0, 0, 0), 0);
  assert.equal(st().cash, cash); // no refund
  assert.equal(st().tiles[0].kind, 0);
  setTile(1, 2, CELLAR, 0, 3); mem().fill(9, 0x1470 + 5, 0x1470 + 10);
  assert.equal(ex.act(A.DEMOLISH, 1, 0, 0), 0);
  assert.deepEqual(Array.from(mem().slice(tileAt(1), tileAt(1) + 8)), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(mem().slice(0x1470 + 5, 0x1470 + 10)), [0, 0, 0, 0, 0]);
});

test('DEMOLISH Garage refuses if slots < trucks', () => {
  fresh();
  setTile(0, 2, GARAGE);
  mem()[0x101E] = 2; // two trucks, 1 + 1 garage slots
  fails(E.MAX, A.DEMOLISH, 0, 0, 0);
  mem()[0x101E] = 1;
  assert.equal(ex.act(A.DEMOLISH, 0, 0, 0), 0);
  setTile(0, 2, GARAGE); setTile(1, 2, GARAGE);
  mem()[0x101E] = 2;
  assert.equal(ex.act(A.DEMOLISH, 0, 0, 0), 0); // 1 + 2 - 1 = 2 >= 2
  fails(E.MAX, A.DEMOLISH, 1, 0, 0);
});

test('UPGRADE_BLD', () => {
  fresh();
  fails(E.NOT_BUILDING, A.UPGRADE, 0, 0, 0);
  setTile(0, 2, MILL);
  assert.equal(ex.act(A.UPGRADE, 0, 0, 0), 0);
  assert.equal(st().cash, 300);
  assert.equal(st().tiles[0].flags & 2, 2);
  fails(E.MAX, A.UPGRADE, 0, 0, 0);
  setTile(1, 2, WAREHOUSE);
  fails(E.BAD_ARG, A.UPGRADE, 1, 0, 0);
  setTile(2, 1, WHEAT);
  fails(E.NOT_BUILDING, A.UPGRADE, 2, 0, 0);
  fails(E.TILE_OUT, A.UPGRADE, 4, 0, 0);
  setTile(3, 2, 1); ex.t_set_cash(319);
  fails(E.CASH, A.UPGRADE, 3, 0, 0); // Cannery 400 * 0.8 = 320
  ex.t_set_cash(320);
  assert.equal(ex.act(A.UPGRADE, 3, 0, 0), 0);
  assert.equal(st().cash, 0);
});

test('SET_RECIPE', () => {
  fresh();
  fails(E.NOT_BUILDING, A.RECIPE, 0, 0, 0);
  setTile(0, 2, MILL);
  assert.equal(ex.act(A.RECIPE, 0, 0, 0), 0);
  assert.equal(st().tiles[0].recipe, 1);
  assert.equal(ex.act(A.RECIPE, 0, 1, 0), 0);
  assert.equal(st().tiles[0].recipe, 2);
  fails(E.BAD_ARG, A.RECIPE, 0, 2, 0);
  fails(E.BAD_ARG, A.RECIPE, 0, 8, 0);
  fails(E.BAD_ARG, A.RECIPE, 0, 254, 0);
  assert.equal(ex.act(A.RECIPE, 0, 255, 0), 0);
  assert.equal(st().tiles[0].recipe, 0);
  fails(E.TILE_OUT, A.RECIPE, 4, 0, 0);
});

test('BUY_LAND', () => {
  fresh(); ex.t_set_cash(100000);
  const costs = [600, 1400, 3000, 6000];
  for (let i = 0; i < 4; i++) {
    const c = st().cash;
    assert.equal(ex.act(A.LAND, 0, 0, 0), 0);
    assert.equal(st().cash, c - costs[i]);
    assert.equal(st().grid, 5 + i);
    assert.equal(st().ringsBought, i + 1);
  }
  fails(E.MAX, A.LAND, 0, 0, 0);
  fresh();
  fails(E.CASH, A.LAND, 0, 0, 0); // 500 < 600
});

test('SELL_STAND', () => {
  fresh();
  ex.t_give(WHEAT, 10, 3);
  ex.t_give(WHEAT, 5, 0);
  // expected proceeds from an identical fresh instance
  const probe = await_probe();
  assert.equal(ex.act(A.SELL, WHEAT, 12, 0), 0);
  assert.equal(st().cash, 500 + probe);
  assert.equal(ex.t_count(WHEAT), 3);
  fails(E.NO_STOCK, A.SELL, WHEAT, 4, 0);
  fails(E.BAD_ARG, A.SELL, WHEAT, 0, 0);
  fails(E.BAD_ARG, A.SELL, 13, 1, 0);
  fails(E.NO_STOCK, A.SELL, CORN, 1, 0);
});
function await_probe() { ex.init(7); const v = ex.t_sell_units(0, 0, 12); ex.init(42); ex.t_give(WHEAT, 10, 3); ex.t_give(WHEAT, 5, 0); return v; }

test('storage_fits boundary', () => {
  fresh();
  ex.t_give(CORN, 25, 0); // cap 30
  assert.equal(ex.t_storage_fits(5), 1);
  assert.equal(ex.t_storage_fits(6), 0);
  assert.equal(ex.t_storage_fits(0), 1);
});

test('over-cap storage after demolishing a Warehouse: harvest refused, nothing wraps', () => {
  fresh(); ex.t_set_cash(1000);
  setTile(3, 2, WAREHOUSE);
  assert.equal(ex.storage_cap(), 70);
  ex.t_give(CORN, 60, 0);
  assert.equal(ex.act(A.DEMOLISH, 3, 0, 0), 0);
  assert.equal(ex.storage_cap(), 30);
  assert.ok(ex.storage_used() > ex.storage_cap());
  assert.equal(ex.t_storage_fits(0), 0);
  setTile(0, 1, WHEAT, 300);
  fails(E.STORAGE_FULL, A.HARVEST, 0, 0, 0);
  const before = snap();
  assert.equal(ex.act(A.HARVEST_ALL, 0, 0, 0), 0);
  assert.deepEqual(snap(), before);
  assert.equal(st().tiles[0].kind, 1);
  assert.equal(ex.storage_used(), 60);
});
