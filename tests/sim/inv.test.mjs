import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGame, readState, STATE as stateJson } from '../helpers.mjs';

const { ex, mem } = await loadGame();
const BAL = JSON.parse(readFileSync('tools/balance.json', 'utf8'));
const W = { Wheat: 0, Tomato: 2 }, BLD = Object.fromEntries(BAL.enums.buildings.map((b, i) => [b, i]));
const setDay = (d) => new DataView(mem().buffer).setUint16(0x100C, d, true);
const fresh = () => ex.init(42);

test('storage cap is 30 at start and grows by 40 per Warehouse, 20 per Cold Store', () => {
  fresh(); assert.equal(ex.storage_cap(), 30);
  ex.t_put_bld(10, BLD.Warehouse); assert.equal(ex.storage_cap(), 70);
  ex.t_put_bld(11, BLD.Warehouse); assert.equal(ex.storage_cap(), 110);
  ex.t_put_bld(12, BLD.ColdStore); assert.equal(ex.storage_cap(), 130);
  ex.t_put_bld(13, BLD.Mill); assert.equal(ex.storage_cap(), 130);
});

test('t_put_bld writes a building tile (kind 2, id bld)', () => {
  fresh(); ex.t_put_bld(9, BLD.Well);
  const t = readState(mem()).tiles[9];
  assert.deepEqual([t.kind, t.id, t.progress, t.recipe], [2, BLD.Well, 0, 0]);
});

test('storage_used sums every age bucket; t_give adds at the given age', () => {
  fresh(); ex.t_give(W.Tomato, 3, 1); ex.t_give(W.Tomato, 2, 0); ex.t_give(W.Wheat, 4, 5);
  assert.equal(ex.storage_used(), 9);
  const s = readState(mem());
  assert.deepEqual([s.inv[2 * 8 + 1], s.inv[2 * 8], s.inv[5]], [3, 2, 4]);
});

test('inv_take removes oldest first', () => {
  fresh(); ex.t_give(W.Tomato, 3, 1); ex.t_give(W.Tomato, 2, 0);
  assert.equal(ex.t_take(W.Tomato, 4), 4);
  const s = readState(mem());
  assert.deepEqual([s.inv[2 * 8 + 1], s.inv[2 * 8]], [0, 1]);
  assert.equal(ex.t_count(W.Tomato), 1);
});

test('inv_take returns the amount actually taken when short', () => {
  fresh(); ex.t_give(W.Wheat, 3, 0);
  assert.equal(ex.t_take(W.Wheat, 10), 3); assert.equal(ex.t_count(W.Wheat), 0);
  assert.equal(ex.t_take(W.Wheat, 1), 0);
});

test('t_set_cash sets cash', () => {
  fresh(); ex.t_set_cash(-25); assert.equal(readState(mem()).cash, -25);
});

test('season boundaries', () => {
  fresh();
  for (const [d, s] of [[1, 0], [20, 0], [21, 1], [40, 1], [41, 2], [60, 2], [61, 3], [80, 3], [81, 0], [161, 0], [241, 0]]) {
    setDay(d); assert.equal(ex.season(), s, `day ${d}`);
  }
});

test('state length grows to 0x5B0', () => {
  assert.equal(stateJson.length, 0x5B0); assert.equal(ex.save_len(), 0x5B0);
});

test('init sets status Playing, today Sunny, nextEventDay 5', () => {
  fresh(); const s = readState(mem());
  assert.deepEqual([s.status, s.weatherToday, s.nextEventDay, s.droughtStreak, s.ringsBought, s.milestones],
                   [0, 0, 5, 0, 0, 0]);
  assert.ok(s.driftNext.every(v => v === 0) && s.events.every(e => e.kind === 0));
  assert.ok(s.board[0].qty > 0 && s.board[1].qty > 0 && s.board[2].qty === 0); // Task 7: init rolls the visible board
  assert.ok(s.tiles.every(t => t.recipe === 0));
});
