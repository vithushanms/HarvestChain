import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGame } from './helpers.mjs';

const { ex } = await loadGame();
const BAL = JSON.parse(readFileSync('tools/balance.json', 'utf8'));

// Read a whole table back from the module as { rowName: [cols...] } or [[cols...]].
const table = (name) => {
  const t = BAL.tables[name];
  const rows = Array.from({ length: t.rows }, (_, r) => t.cols.map((_, c) => ex.t_bal(t.id, r, c)));
  if (!t.rowEnum) return rows;
  return Object.fromEntries(rows.map((row, r) => [BAL.enums[t.rowEnum][r], row]));
};
const column = (name) => table(name).map(([v]) => v);

// Expected values transcribed from requirement-spec.md §5–§12.
const CROP = { // seed, growDays, yield, regrowDays, spoilDays, seasonMask, good
  Wheat: [10, 3, 4, 0, 0, 0b0111, 0], Corn: [12, 4, 5, 0, 0, 0b0110, 1],
  Tomato: [15, 3, 6, 0, 2, 0b0011, 2], Apple: [40, 8, 8, 3, 0, 0b0111, 3],
  Grape: [30, 6, 5, 0, 3, 0b0110, 4] };
const GOOD = { // basePrice, perishDays, tier
  Wheat: [8, 0, 0], Corn: [7, 0, 0], Tomato: [10, 2, 0], Apple: [12, 0, 0], Grape: [15, 3, 0],
  Flour: [22, 0, 1], Cornmeal: [18, 0, 1], Sauce: [40, 0, 1], AppleJuice: [30, 6, 1],
  GrapeJuice: [38, 4, 1], Bread: [35, 3, 2], Cornbread: [28, 3, 2], Wine: [120, 0, 2] };
const BLD = { // cost, upkeep, inputCap, storageBonus, unlockKind, unlockArg
  Mill: [250, 3, 8, 0, 0, 0], Cannery: [400, 4, 9, 0, 0, 0], Press: [350, 4, 8, 0, 0, 0],
  Bakery: [600, 5, 6, 0, 1, 0 /* owns Mill */], Cellar: [900, 6, 0, 0, 2, 3], Warehouse: [300, 2, 0, 40, 0, 0],
  ColdStore: [500, 5, 0, 20, 2, 2], Greenhouse: [450, 4, 0, 0, 3, 41 /* Year 1 Autumn, day 41 */],
  Well: [200, 1, 0, 0, 0, 0], Garage: [500, 3, 0, 0, 0, 0] };
const RECIPE = [ // building, inGood, inQty, outGood, ageDays
  [0, 0, 2, 5, 0], [0, 1, 2, 6, 0], [1, 2, 3, 7, 0], [2, 3, 2, 8, 0],
  [2, 4, 2, 9, 0], [3, 5, 1, 10, 0], [3, 6, 1, 11, 0], [4, 9, 1, 12, 5]];
const MKT = { // multRawBp, multProcBp, travelDays, satPerUnitBp, recoverBp
  Stand: [8000, 8000, 0, 200, 10000], Town: [10000, 10000, 1, 150, 5000], City: [6000, 14000, 2, 100, 3400] };
const LAND = [600, 1400, 3000, 6000];
const REP = [0, 3, 8, 15, 25];
const MILE = [100, 200, 200, 500, 300, 1000, 0];
const K = { startCash: 500, startStorage: 30, truckCap: 20, truckPrice: 450, maxTrucks: 3,
  truckCapUpgCost: 300, truckCapUpgAmt: 20, truckCapUpgMax: 2, fridgeCost: 400, fastCost: 500,
  loanMax: 1500, loanRateBp: 100, graceDays: 3, daysPerSeason: 20, runDays: 240,
  bldUpgPctBp: 8000, driftStepBp: 500, driftMinBp: 7000, driftMaxBp: 13000, satFloorBp: 5000,
  contractMultBp: 15000, latePenaltyBp: 1000, netWorthTarget: 50000, netWorthBldBp: 5000,
  netWorthLandBp: 5000, cellarHold: 10, startGrid: 4, maxGrid: 8,
  fuelCost: 20, bumperBp: 15000, surgeBp: 15000, glutBp: 6000, festivalDays: 2, contractRefreshDays: 5,
  coldPerStore: 20, warehouseStorage: 40,
  mileWorth1: 2000, mileContracts: 3, mileWorthY1: 3000, mileRank: 3, mileWine: 10, mileWorthRun: 50000,
  repScore: 100, contractScore: 50, boardVisibleLow: 2, boardVisibleHigh: 3, boardHighRank: 3,
  repGain: 1, repLoss: 1, bldUpgCapMult: 2, fastDays: 1, offSeasonPct: 50, rainBonus: 10, firstEventDay: 5,
  contractQtyBase: 6, contractQtyRankMult: 3, contractQtySpread: 5, contractDeadlineBase: 6,
  contractDeadlineSpread: 9, acceptedMax: 3, contractTierLow: 1, contractTierHigh: 2,
  stormOdds: 5, droughtOdds: 4, droughtKillStreak: 3, maxAge: 7,
  forecastPct: 80, eventDurBase: 3, eventDurSpread: 5, eventGapBase: 4, eventGapSpread: 3,
  startWheat: 4, startWheatProgress: 200, roadClosureDays: 1, heatAgeExtra: 1 };

test('crop table', () => assert.deepEqual(table('CROP'), CROP));
test('goods table', () => assert.deepEqual(table('GOOD'), GOOD));
test('building table', () => assert.deepEqual(table('BLD'), BLD));
test('recipe table', () => assert.deepEqual(table('RECIPE'), RECIPE));
test('market table', () => assert.deepEqual(table('MKT'), MKT));
test('land ring costs', () => assert.deepEqual(column('LAND'), LAND));
test('reputation thresholds', () => assert.deepEqual(column('REP'), REP));
test('milestone payouts', () => assert.deepEqual(column('MILE'), MILE));
test('scalar constants (u16 values above 32767 read unsigned)', () => {
  const [row] = table('K');
  assert.deepEqual(Object.fromEntries(BAL.tables.K.cols.map((c, i) => [c, row[i]])), K);
});

test('acceptedMax fits the 3-slot accepted list; maxAge is the top inventory age bucket', () => {
  const [row] = table('K');
  const col = (n) => row[BAL.tables.K.cols.indexOf(n)];
  assert.ok(col('acceptedMax') <= 3);
  assert.equal(col('maxAge'), 7);
});
