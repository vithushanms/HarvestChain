import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, readState, stateBytes } from '../helpers.mjs';

const { ex, mem } = await loadGame();
const LEN = 0x5B0;
const dv = () => new DataView(mem().buffer);
const st = () => readState(mem());
const snap = () => stateBytes(mem(), LEN);
const W = { SUNNY: 0, RAIN: 1, DROUGHT: 2, STORM: 3, FROST: 4, HEAT: 5 };
const WHEAT = 0, CORN = 1, TOMATO = 2, APPLE = 3, GRAPE = 4;
const FLOUR = 5, GJ = 9, BREAD = 10, WINE = 12;
const MILL = 0, BAKERY = 3, CELLAR = 4, COLD = 6, GREENHOUSE = 7, WELL = 8;
const tileAt = (i) => 0x1200 + i * 8;
const setDay = (d) => dv().setUint16(0x100C, d, true);
const setTile = (i, kind, id, progress = 0, flags = 0, gh = 0) => {
  const o = tileAt(i); mem().fill(0, o, o + 8);
  mem()[o] = kind; mem()[o + 1] = id; dv().setUint16(o + 2, progress, true); mem()[o + 5] = flags; mem()[o + 6] = gh;
};
const fresh = () => { ex.init(42); mem().fill(0, 0x1200, 0x1400); };
const day = (w) => { ex.t_set_weather(w); return ex.end_day(); };
const invAt = (g, a) => dv().getUint16(0x1020 + (g * 8 + a) * 2, true);
const wheatField = (n = 64) => { mem()[0x100E] = 8; for (let i = 0; i < n; i++) setTile(i, 1, WHEAT, 0); };
const alive = () => st().tiles.filter((t) => t.kind === 1).length;

test('end_day: status guard leaves state unchanged', () => {
  fresh();
  for (const s of [1, 3]) {
    mem()[0x1400] = s;
    const before = snap();
    assert.equal(ex.end_day(), 2);
    assert.deepEqual(snap(), before);
  }
  mem()[0x1400] = 2;
  assert.equal(ex.end_day(), 0);
  assert.equal(st().day, 2);
});

test('end_day increments day exactly once and promotes tomorrow to today', () => {
  fresh();
  const tomorrow = st().weatherTomorrow;
  assert.equal(ex.end_day(), 0);
  assert.equal(st().day, 2);
  assert.equal(st().weatherToday, tomorrow);
});

test('starting wheat ripens after one end_day', () => {
  fresh(); // clears tiles; plant the starting layout by hand
  ex.init(42);
  assert.equal(st().tiles[0].progress, 200);
  assert.equal(day(W.SUNNY), 0);
  const s = st();
  for (let i = 0; i < 4; i++) assert.equal(s.tiles[i].progress, 300);
  assert.equal(ex.act(2, 0, 0, 0), 0); // harvest works now
  assert.equal(ex.t_count(WHEAT), 4);
});

test('growth: rain +10%, out of season halves, winter stops, greenhouse ignores weather', () => {
  fresh();
  setTile(0, 1, WHEAT, 0);
  day(W.RAIN); assert.equal(st().tiles[0].progress, 110);
  day(W.SUNNY); assert.equal(st().tiles[0].progress, 210);
  // Corn is out of season in Spring (day 1-20): half, half+rain.
  setTile(1, 1, CORN, 0);
  day(W.SUNNY); assert.equal(st().tiles[1].progress, 50);
  day(W.RAIN); assert.equal(st().tiles[1].progress, 105);
  // growth stops at ripe target (wheat 300)
  setTile(0, 1, WHEAT, 290);
  day(W.RAIN); assert.equal(st().tiles[0].progress, 300);
  // Winter (day 61+) is 0 for everything outside a greenhouse
  fresh(); setDay(61);
  setTile(0, 1, WHEAT, 10);
  setTile(1, 2, GREENHOUSE, 0, 0, WHEAT + 1);
  day(W.SUNNY);
  assert.equal(st().tiles[0].progress, 10);
  assert.equal(st().tiles[1].progress, 100);
  // greenhouse ignores rain and drought, and out-of-season
  fresh();
  setTile(0, 2, GREENHOUSE, 0, 0, CORN + 1);
  day(W.RAIN); assert.equal(st().tiles[0].progress, 100);
  day(W.DROUGHT); assert.equal(st().tiles[0].progress, 200);
});

test('drought stops growth unless a Well exists; apple growth and regrow target', () => {
  fresh();
  setTile(0, 1, WHEAT, 0);
  day(W.DROUGHT); assert.equal(st().tiles[0].progress, 0);
  setTile(5, 2, WELL);
  day(W.DROUGHT); assert.equal(st().tiles[0].progress, 100); // Well: normal 100 even in drought
  // Apple: first cycle 8 days, then regrow target 3 days after maturing
  fresh();
  setTile(0, 1, APPLE, 750);
  day(W.SUNNY); assert.equal(st().tiles[0].progress, 800);
  day(W.SUNNY); assert.equal(st().tiles[0].progress, 800); // stops at ripe
  setTile(1, 1, APPLE, 250, 1); // mature: target 300
  day(W.SUNNY); assert.equal(st().tiles[1].progress, 300);
  day(W.SUNNY); assert.equal(st().tiles[1].progress, 300);
});

test('drought streak of 3 kills ~25% of crops; Well prevents it', () => {
  fresh(); wheatField();
  day(W.DROUGHT); assert.equal(st().droughtStreak, 1); assert.equal(alive(), 64);
  day(W.DROUGHT); assert.equal(st().droughtStreak, 2); assert.equal(alive(), 64);
  day(W.DROUGHT);
  assert.equal(st().droughtStreak, 0);
  const left = alive();
  assert.ok(left >= 36 && left <= 60, `survivors ${left}`);
  assert.equal(left, 48, 'seed 42 pinned survivor count'); // 16 killed (step 10 now draws 2 hint goods per day)
  // a non-drought day in between resets the streak
  fresh(); wheatField();
  day(W.DROUGHT); day(W.DROUGHT); day(W.SUNNY); day(W.DROUGHT);
  assert.equal(st().droughtStreak, 1);
  assert.equal(alive(), 64);
  // with a Well the streak never builds
  fresh(); wheatField(63); setTile(63, 2, WELL);
  for (let i = 0; i < 4; i++) day(W.DROUGHT);
  assert.equal(st().droughtStreak, 0);
  assert.equal(alive(), 63);
});

test('drought streak: greenhouse tiles immune, apple tree resets progress', () => {
  fresh(); mem()[0x100E] = 8;
  for (let i = 0; i < 32; i++) setTile(i, 2, GREENHOUSE, 0, 0, WHEAT + 1);
  for (let i = 32; i < 64; i++) setTile(i, 1, APPLE, 100, 1);
  day(W.DROUGHT); day(W.DROUGHT); day(W.DROUGHT);
  const s = st();
  for (let i = 0; i < 32; i++) assert.equal(s.tiles[i].ghCrop, WHEAT + 1);
  // apples never vanish; some were reset to 0 (those hit), others kept 100
  const t = s.tiles.slice(32);
  assert.ok(t.every((x) => x.kind === 1));
  assert.ok(t.some((x) => x.progress === 0) && t.some((x) => x.progress === 100));
});

test('storm: eligible tiles only, 1-in-5 chance, apple survives with progress reset', () => {
  fresh(); wheatField();
  setTile(63, 2, GREENHOUSE, 0, 0, WHEAT + 1);
  day(W.STORM);
  const left = alive();
  assert.ok(left >= 40 && left <= 58, `survivors ${left}`);
  assert.equal(st().tiles[63].ghCrop, WHEAT + 1);
  fresh(); mem()[0x100E] = 8;
  for (let i = 0; i < 64; i++) setTile(i, 1, APPLE, 100, 1);
  day(W.STORM);
  const t = st().tiles;
  assert.ok(t.every((x) => x.kind === 1 && x.flags === 1));
  assert.ok(t.some((x) => x.progress === 100) && t.some((x) => x.progress === 200)); // hit: reset then +100 growth; rest 100+100
  assert.ok(t.every((x) => x.progress === 100 || x.progress === 200));
});

test('frost kills tomato/grape, not wheat; greenhouse immune', () => {
  fresh();
  setTile(0, 1, TOMATO, 50); setTile(1, 1, GRAPE, 50); setTile(2, 1, WHEAT, 50); setTile(3, 1, APPLE, 50);
  setTile(4, 2, GREENHOUSE, 0, 0, TOMATO + 1);
  day(W.FROST);
  const t = st().tiles;
  assert.equal(t[0].kind, 0); assert.equal(t[1].kind, 0);
  assert.equal(t[2].kind, 1); assert.equal(t[3].kind, 1);
  assert.equal(t[4].ghCrop, TOMATO + 1);
});

test('ripe tomato on tile: ages, spoils at 2; heatwave +2 except greenhouse', () => {
  fresh();
  setTile(0, 1, TOMATO, 300);
  day(W.SUNNY); assert.equal(st().tiles[0].ripeAge, 1);
  day(W.SUNNY); assert.equal(st().tiles[0].kind, 0);
  fresh();
  setTile(0, 1, GRAPE, 600); setTile(1, 2, GREENHOUSE, 600, 0, GRAPE + 1);
  day(W.HEAT);
  assert.equal(st().tiles[0].ripeAge, 2);
  assert.equal(st().tiles[1].ripeAge, 1);
  day(W.SUNNY);
  assert.equal(st().tiles[0].kind, 0); // 2 + 1 = 3 >= spoilDays 3
  assert.equal(st().tiles[1].ripeAge, 2);
  day(W.SUNNY); // greenhouse grape reaches 3 and rots; building stays
  assert.equal(st().tiles[1].kind, 2);
  assert.equal(st().tiles[1].ghCrop, 0);
  // wheat never spoils on the tile
  fresh(); setTile(0, 1, WHEAT, 300);
  for (let i = 0; i < 5; i++) day(W.SUNNY);
  assert.equal(st().tiles[0].kind, 1);
});

test('processing: Mill with 10 wheat -> 4 flour, 2 wheat left (cap 8); upgraded cap 16', () => {
  fresh();
  ex.t_put_bld(0, MILL); assert.equal(ex.act(7, 0, 0, 0), 0);
  ex.t_give(WHEAT, 10, 0);
  assert.equal(day(W.SUNNY), 0);
  assert.equal(ex.t_count(WHEAT), 2);
  assert.equal(ex.t_count(FLOUR), 4);
  assert.equal(invAt(FLOUR, 0), 4);
  // upgraded
  fresh(); ex.t_put_bld(0, MILL); ex.act(7, 0, 0, 0); mem()[tileAt(0) + 5] = 2;
  ex.t_give(WHEAT, 20, 0);
  day(W.SUNNY);
  assert.equal(ex.t_count(WHEAT), 4); assert.equal(ex.t_count(FLOUR), 8);
  // no recipe set: nothing happens; odd leftovers stay
  fresh(); ex.t_put_bld(0, MILL); ex.t_give(WHEAT, 5, 0);
  day(W.SUNNY); assert.equal(ex.t_count(WHEAT), 5);
  ex.act(7, 0, 0, 0); day(W.SUNNY);
  assert.equal(ex.t_count(WHEAT), 1); assert.equal(ex.t_count(FLOUR), 2);
});

test('processing: oldest-first, chain in tile order, outputs gated by storage', () => {
  fresh();
  ex.t_put_bld(0, MILL); ex.act(7, 0, 0, 0);
  ex.t_put_bld(1, BAKERY); ex.act(7, 1, 5, 0); // Bakery flour -> bread
  ex.t_give(WHEAT, 2, 3); ex.t_give(WHEAT, 2, 0);
  day(W.SUNNY);
  assert.equal(ex.t_count(WHEAT), 0);
  // Mill (tile 0) ran first, the Bakery (tile 1) then saw the flour in the same step
  assert.equal(ex.t_count(FLOUR), 0); assert.equal(ex.t_count(BREAD), 2);
  // storage full: output must not overflow cap (cap 30)
  fresh();
  ex.t_put_bld(0, BAKERY); ex.act(7, 0, 5, 0);
  ex.t_give(FLOUR, 6, 0); ex.t_give(CORN, 24, 0); // used 30 = cap
  const before = ex.storage_used();
  day(W.SUNNY);
  assert.ok(ex.storage_used() <= ex.storage_cap());
  assert.equal(ex.storage_used(), before); // 1 flour -> 1 bread each, net zero, still fits
  // many-to-one with full storage: inputs leave room first
  fresh();
  ex.t_put_bld(0, MILL); ex.act(7, 0, 0, 0);
  ex.t_give(WHEAT, 8, 0); ex.t_give(CORN, 22, 0);
  day(W.SUNNY);
  assert.equal(ex.t_count(FLOUR), 4); assert.ok(ex.storage_used() <= 30);
  // production stops when output would not fit (overfull after demolish)
  fresh();
  ex.t_put_bld(0, BAKERY); ex.act(7, 0, 5, 0);
  ex.t_give(FLOUR, 4, 0); ex.t_give(CORN, 40, 0); // used 44 > cap 30
  day(W.SUNNY);
  assert.equal(ex.t_count(FLOUR), 4); assert.equal(ex.t_count(BREAD), 0);
});

test('cellar: 10 GJ -> 10 Wine after exactly 5 end_days; hold limit 10', () => {
  fresh();
  ex.t_put_bld(0, CELLAR); assert.equal(ex.act(7, 0, 7, 0), 0);
  ex.t_give(GJ, 10, 0);
  day(W.SUNNY);
  assert.deepEqual(st().cellar[0].b, [0, 0, 0, 10, 0]); // entered bucket 4, shifted in step 4
  assert.equal(ex.t_count(GJ), 0);
  for (let d = 2; d <= 4; d++) { day(W.SUNNY); assert.equal(ex.t_count(WINE), 0); }
  assert.deepEqual(st().cellar[0].b, [10, 0, 0, 0, 0]);
  day(W.SUNNY);
  assert.equal(ex.t_count(WINE), 10);
  assert.deepEqual(st().cellar[0].b, [0, 0, 0, 0, 0]);
  // hold limit: 15 GJ, only 10 enter; the rest wait (and may spoil)
  fresh();
  ex.t_put_bld(0, CELLAR); ex.act(7, 0, 7, 0);
  ex.t_give(GJ, 15, 0);
  day(W.SUNNY);
  assert.equal(ex.t_count(GJ), 5);
  assert.deepEqual(st().cellar[0].b, [0, 0, 0, 10, 0]);
  day(W.SUNNY); // still full of aging units; the 5 left over aged to 1
  assert.equal(ex.t_count(GJ), 5);
  assert.deepEqual(st().cellar[0].b, [0, 0, 10, 0, 0]);
});

test('cellar: wine stays in bucket 0 while storage is full', () => {
  fresh();
  ex.t_put_bld(0, CELLAR);
  mem()[0x1470 + 0] = 3; // bucket 0 holds 3 about to finish
  mem()[0x1470 + 1] = 2; // bucket 1 holds 2
  ex.t_give(CORN, 29, 0); // used 29, cap 30: room for one Wine
  day(W.SUNNY);
  assert.equal(ex.t_count(WINE), 1);
  assert.deepEqual(st().cellar[0].b, [2 + 2, 0, 0, 0, 0]);
  ex.t_give(CORN, 0, 0);
  assert.equal(ex.storage_used(), 30);
  day(W.SUNNY);
  assert.equal(ex.t_count(WINE), 1);
  assert.deepEqual(st().cellar[0].b, [4, 0, 0, 0, 0]);
  ex.t_take(CORN, 29);
  day(W.SUNNY);
  assert.equal(ex.t_count(WINE), 5);
  assert.deepEqual(st().cellar[0].b, [0, 0, 0, 0, 0]);
});

test('spoilage: tomato in storage gone after 2 end_days; wheat never; ages cap at 7', () => {
  fresh();
  ex.t_give(TOMATO, 5, 0); ex.t_give(WHEAT, 5, 0);
  day(W.SUNNY); assert.equal(invAt(TOMATO, 1), 5);
  day(W.SUNNY); assert.equal(ex.t_count(TOMATO), 0);
  for (let i = 0; i < 10; i++) day(W.SUNNY);
  assert.equal(invAt(WHEAT, 0), 5); // non-perishables never age
  // perishable ages stop at 7 (Apple Juice lasts 6 days, so use a Cold Store-free long-lived check)
  ex.t_give(8, 1, 6);
  ex.t_give(5, 1, 7);
  assert.equal(invAt(5, 7), 1);
});

test('spoilage: Cold Store protects 20 units oldest-first across goods; heatwave +2', () => {
  fresh();
  ex.t_put_bld(0, COLD);
  ex.t_give(TOMATO, 15, 0); ex.t_give(GRAPE, 15, 0); // 30 perishable units, 20 protected
  day(W.SUNNY);
  // tomatoes (id 2) are all protected (15), 5 of the grapes (oldest) too
  assert.equal(invAt(TOMATO, 0), 15);
  assert.equal(invAt(GRAPE, 0), 5);
  assert.equal(invAt(GRAPE, 1), 10);
  for (let i = 0; i < 5; i++) day(W.SUNNY);
  assert.equal(ex.t_count(TOMATO), 15);
  assert.equal(ex.t_count(GRAPE), 5);
  // oldest-first inside a good
  fresh();
  ex.t_put_bld(0, COLD);
  ex.t_give(TOMATO, 10, 1); ex.t_give(TOMATO, 15, 0); // 25 units: 20 protected = 10 old + 10 new
  day(W.SUNNY);
  // 10 old + 10 of the new are protected (stay); the other 5 new units age to 1
  assert.equal(invAt(TOMATO, 1), 15); assert.equal(invAt(TOMATO, 0), 10);
  assert.equal(ex.t_count(TOMATO), 25);
  // heatwave: +2 ages, so a fresh tomato is gone in one day
  fresh();
  ex.t_give(TOMATO, 4, 0); ex.t_give(GJ, 4, 0); ex.t_give(BREAD, 3, 0);
  day(W.HEAT);
  assert.equal(ex.t_count(TOMATO), 0);
  assert.equal(invAt(GJ, 2), 4); assert.equal(invAt(BREAD, 2), 3);
  day(W.HEAT); // GJ 4 gone (perish 4); bread 4 gone (perish 3)
  assert.equal(ex.t_count(GJ), 0); assert.equal(ex.t_count(BREAD), 0);
});

// Step-order pairs pinned elsewhere: trucks (6) before contracts (7) in contracts.test.mjs
// ("an outbound truck carrying the slot protects it"); upkeep before interest (9) and the
// day-241 precedence over step 11 in money.test.mjs; step 10's RNG order (events, weather,
// hint goods) in money.test.mjs ("hint goods") and, end to end, in the determinism goldens.
test('step order: growth before processing before spoilage', () => {
  // Grape Juice age 3 + Heatwave: step 2 ages it to 5, step 3 moves it into the cellar,
  // and only then would step 5 spoil it (perishDays 4).
  fresh();
  ex.t_put_bld(0, CELLAR); ex.act(7, 0, 7, 0);
  ex.t_give(GJ, 6, 3);
  day(W.HEAT);
  assert.equal(ex.t_count(GJ), 0);
  assert.deepEqual(st().cellar[0].b, [0, 0, 0, 6, 0]); // entered at 4, shifted in step 4
  // same inventory with no cellar spoils
  fresh();
  ex.t_give(GJ, 6, 3);
  day(W.HEAT);
  assert.equal(ex.t_count(GJ), 0);
  assert.deepEqual(st().cellar[0].b, [0, 0, 0, 0, 0]);
  // growth before processing: a fresh harvest-free check, flour appears the same day wheat is held
  fresh();
  ex.t_put_bld(0, MILL); ex.act(7, 0, 0, 0); ex.t_give(WHEAT, 2, 0);
  day(W.SUNNY);
  assert.equal(invAt(FLOUR, 0), 1); // outputs are age 0 and not aged in the same day
});

test('determinism: same seed and weather, byte-identical after several days', () => {
  const run = () => { ex.init(7); for (let i = 0; i < 30; i++) ex.end_day(); return snap(); };
  const a = run(); const b = run();
  assert.deepEqual(a, b);
  assert.equal(st().day, 31);
});

test('ripe timer starts the day after ripening (two harvest mornings for a tomato)', () => {
  fresh();
  setTile(0, 1, TOMATO, 200);
  setTile(1, 2, GREENHOUSE, 200, 0, TOMATO + 1);
  day(W.SUNNY);
  assert.equal(st().tiles[0].progress, 300); assert.equal(st().tiles[0].ripeAge, 0);
  assert.equal(st().tiles[1].ripeAge, 0);
  day(W.SUNNY);
  assert.equal(st().tiles[0].kind, 1); assert.equal(st().tiles[0].ripeAge, 1);
  assert.equal(st().tiles[1].ripeAge, 1);
  day(W.SUNNY);
  assert.equal(st().tiles[0].kind, 0);
  assert.equal(st().tiles[1].ghCrop, 0);
});
