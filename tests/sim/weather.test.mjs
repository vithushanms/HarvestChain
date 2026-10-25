import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGame, readState, stateBytes } from '../helpers.mjs';

const { ex, mem } = await loadGame();
const BAL = JSON.parse(readFileSync('tools/balance.json', 'utf8'));
const dv = () => new DataView(mem().buffer);
const setDay = (d) => dv().setUint16(0x100C, d, true);
const getDay = () => dv().getUint16(0x100C, true);
const rngWord = () => dv().getUint32(0x1008, true);
const nextEvent = () => dv().getUint16(0x140A, true);
const setNextEvent = (d) => dv().setUint16(0x140A, d, true);
const events = () => readState(mem()).events;
const WTH = BAL.tables.WEATHER.cols;
const KIND = { None: 0, Surge: 1, Glut: 2, Road: 3, Festival: 4, Fuel: 5, Bumper: 6 };
const WEIGHTS = [[55, 30, 0, 15, 0, 0], [50, 15, 20, 0, 0, 15], [45, 25, 0, 15, 15, 0], [50, 20, 0, 0, 30, 0]];

test('weather frequencies follow season weights', () => {
  ex.init(42);
  for (let s = 0; s < 4; s++) {
    const n = new Array(6).fill(0);
    for (let i = 0; i < 10000; i++) n[ex.t_weather_roll(s)]++;
    WEIGHTS[s].forEach((w, k) => {
      const pct = n[k] / 100;
      if (w === 0) assert.equal(n[k], 0, `season ${s} ${WTH[k]} must never appear`);
      else assert.ok(Math.abs(pct - w) <= 2, `season ${s} ${WTH[k]}: ${pct}% vs ${w}%`);
    });
  }
});

test('init rolls tomorrow and forecast from the day-1 (Spring) table', () => {
  for (let seed = 1; seed < 60; seed++) {
    ex.init(seed); const s = readState(mem());
    assert.equal(s.weatherToday, 0);
    assert.ok([0, 1, 3].includes(s.weatherTomorrow), `tomorrow ${s.weatherTomorrow}`);
    assert.ok([0, 1, 3].includes(s.forecast));
  }
  ex.init(42); const a = stateBytes(mem(), ex.save_len()); ex.init(42);
  assert.deepEqual(stateBytes(mem(), ex.save_len()), a);
});

test('weather_advance: today takes tomorrow, tomorrow is rolled from the new day season', () => {
  ex.init(42); ex.t_set_weather(0);
  const t0 = readState(mem()).weatherTomorrow;
  ex.t_weather_advance();
  assert.equal(readState(mem()).weatherToday, t0);
  // day 60 -> new day 61 is Winter: only Sunny/Rain/Frost are possible.
  setDay(60);
  for (let i = 0; i < 300; i++) {
    ex.t_weather_advance(); const s = readState(mem());
    assert.ok([0, 1, 4].includes(s.weatherTomorrow), `winter tomorrow ${s.weatherTomorrow}`);
    assert.ok([0, 1, 4].includes(s.forecast));
  }
});

test('forecast matches tomorrow at about 80%', () => {
  // Decision 2: 80% copy, else a fresh roll that may coincide, so the expected rate is
  // 0.8 + 0.2 * sum(p^2) (about 0.88 in Spring). The brief's 0.75-0.85 band cannot hold
  // under that rule; assert the analytical band instead.
  ex.init(42); let hit = 0;
  for (let i = 0; i < 2000; i++) { ex.t_weather_advance(); const s = readState(mem()); if (s.forecast === s.weatherTomorrow) hit++; }
  const r = hit / 2000;
  assert.ok(r >= 0.8 && r <= 0.92, `forecast match rate ${r}`);
});

test('t_set_weather sets today only', () => {
  ex.init(42); const before = readState(mem());
  ex.t_set_weather(5); const s = readState(mem());
  assert.equal(s.weatherToday, 5); assert.equal(s.weatherTomorrow, before.weatherTomorrow);
});

test('events: at most 3 active, durations 3-7 (Festival 2), next roll 4-6 days later', () => {
  ex.init(7); setDay(1);
  let rolls = 0; const kinds = new Set();
  for (let t = 0; t < 500; t++) {
    const prevNext = nextEvent(), day = getDay();
    const before = events().map((e) => ({ ...e }));
    ex.t_events_tick();
    const after = events();
    assert.ok(after.filter((e) => e.kind).length <= 3);
    // Surviving events lose exactly one day.
    before.forEach((b, i) => { if (b.kind && b.daysLeft > 1) assert.deepEqual(after[i], { ...b, daysLeft: b.daysLeft - 1 }); });
    if (nextEvent() !== prevNext) {
      rolls++;
      const gap = nextEvent() - (day + 1);
      assert.ok(gap >= 4 && gap <= 6, `gap ${gap}`);
      assert.ok(day + 1 >= prevNext);
      const fresh = after.filter((e, i) => e.kind && !(before[i].kind && before[i].daysLeft > 1));
      assert.equal(fresh.length, 1);
      const e = fresh[0]; kinds.add(e.kind);
      assert.ok(e.kind >= 1 && e.kind <= 6 && e.market < 3 && e.good < 13);
      if (e.kind === KIND.Festival) assert.equal(e.daysLeft, 2);
      else assert.ok(e.daysLeft >= 3 && e.daysLeft <= 7, `duration ${e.daysLeft}`);
    } else assert.ok(day + 1 < prevNext || after.every((e) => e.kind), 'free slot and due day must roll');
    setDay(day + 1);
  }
  assert.ok(rolls > 60); assert.equal(kinds.size, 6);
});

test('events: no RNG and no nextEventDay change when all slots are busy', () => {
  ex.init(3); setDay(10); setNextEvent(1);
  for (let i = 0; i < 3; i++) ex.t_put_event(i, KIND.Bumper, 0, 0, 5);
  const r = rngWord(), before = stateBytes(mem(), ex.save_len());
  ex.t_events_tick();
  assert.equal(rngWord(), r); assert.equal(nextEvent(), 1);
  assert.deepEqual(events().map((e) => e.daysLeft), [4, 4, 4]);
  assert.notDeepEqual(stateBytes(mem(), ex.save_len()), before);
});

test('events: a slot freed this tick is reusable this tick', () => {
  ex.init(3); setDay(10); setNextEvent(1);
  ex.t_put_event(0, KIND.Surge, 1, 1, 1);
  ex.t_put_event(1, KIND.Surge, 1, 1, 9); ex.t_put_event(2, KIND.Surge, 1, 1, 9);
  const r = rngWord(); ex.t_events_tick();
  assert.notEqual(rngWord(), r); assert.ok(nextEvent() >= 15 && nextEvent() <= 17);
  assert.ok(events()[0].kind > 0);
});

test('event_mod multiplies surge x glut for the same market/good', () => {
  ex.init(1);
  assert.equal(ex.t_event_mod(1, 2), 10000);
  ex.t_put_event(0, KIND.Surge, 1, 2, 3);
  assert.equal(ex.t_event_mod(1, 2), 15000);
  assert.equal(ex.t_event_mod(0, 2), 10000); assert.equal(ex.t_event_mod(1, 3), 10000);
  ex.t_put_event(1, KIND.Glut, 1, 2, 3);
  assert.equal(ex.t_event_mod(1, 2), 9000);
  ex.t_put_event(2, KIND.Festival, 1, 2, 2);
  assert.equal(ex.t_event_mod(1, 2), 9000);
});

test('event_active reports each kind', () => {
  ex.init(1);
  for (let k = 1; k <= 6; k++) assert.equal(ex.t_event_active(k), 0);
  ex.t_put_event(1, KIND.Road, 0, 0, 4);
  assert.equal(ex.t_event_active(KIND.Road), 1); assert.equal(ex.t_event_active(KIND.Bumper), 0);
});

// RNG draw-order pins. Reference xorshift32 matching 01_rng.wat.
const xs = (x) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
const draws = (w, n) => { for (let i = 0; i < n; i++) w = xs(w); return w; };
const findWord = (pred) => { for (let w = 1; ; w++) if (pred(w)) return w; };
const setRng = (w) => dv().setUint32(0x1008, w, true);

test('forecast roll draws once on a copy (<80) and twice on a re-roll', () => {
  const hit = findWord((w) => xs(w) % 100 < 80);
  const miss = findWord((w) => xs(w) % 100 >= 80);
  ex.init(42); mem()[0x1402] = 1; setRng(hit);
  ex.t_forecast_roll(0);
  assert.equal(rngWord(), draws(hit, 1)); assert.equal(mem()[0x1403], 1);
  setRng(miss); ex.t_forecast_roll(0);
  assert.equal(rngWord(), draws(miss, 2));
  // The re-roll uses the second draw: pick it from the Spring row.
  const r = xs(xs(miss)) % 100, exp = r < 55 ? 0 : r < 85 ? 1 : 3;
  assert.equal(mem()[0x1403], exp);
});

test('Festival takes festivalDays with no duration draw; other kinds draw one more', () => {
  const run = (w) => { ex.init(5); setDay(10); setNextEvent(1); setRng(w); ex.t_events_tick(); return events().find((e) => e.kind); };
  const fest = findWord((w) => xs(w) % 6 === 3);   // kind 4 = Festival
  const e = run(fest);
  assert.equal(e.kind, KIND.Festival); assert.equal(e.daysLeft, 2);
  assert.equal(rngWord(), draws(fest, 4));          // kind, market, good, gap
  const other = findWord((w) => xs(w) % 6 === 0);   // kind 1 = Surge
  const o = run(other);
  assert.equal(o.kind, KIND.Surge);
  assert.equal(o.daysLeft, 3 + xs(xs(xs(xs(other)))) % 5);
  assert.equal(rngWord(), draws(other, 5));         // kind, market, good, duration, gap
});
