import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, readState, stateBytes } from '../helpers.mjs';

const { ex, mem } = await loadGame();
const LEN = 0x5B0;
const dv = () => new DataView(mem().buffer);
const st = () => readState(mem());
const snap = () => stateBytes(mem(), LEN);
const WHEAT = 0, CORN = 1, TOMATO = 2;
const GARAGE = 9;
const LOAD = 10, SEND = 12, BUY = 13, ACCEPT = 15, DECLINE = 16;
const E = { BAD_ARG: 1, STATUS: 2, CASH: 6, NO_STOCK: 10, MAX: 14, CONTRACT: 16, DEADLINE: 17 };
const BOARD = 0x1440, ACC = 0x1458;
const cash = () => dv().getInt32(0x1010, true);
const setCash = (v) => ex.t_set_cash(v);
const rep = () => mem()[0x100F];
const setRep = (v) => { mem()[0x100F] = v; };
const setDay = (d) => dv().setUint16(0x100C, d, true);
const done = () => dv().getUint16(0x140C, true);
const rngWord = () => dv().getUint32(0x1008, true);
const setRng = (w) => dv().setUint32(0x1008, w, true);
const setNextEvent = (d) => dv().setUint16(0x140A, d, true);
const fresh = () => { ex.init(42); mem().fill(0, 0x1200, 0x1400); };
const day = (w = 0) => { ex.t_set_weather(w); return ex.end_day(); };
const fails = (code, ...args) => {
  const before = snap();
  assert.equal(ex.act(...args), code);
  assert.deepEqual(snap(), before);
};
const rec = (base, i) => { const r = st()[base === BOARD ? 'board' : 'accepted'][i]; return { ...r }; };
const board = () => st().board.map((r) => ({ ...r }));
const acc = () => st().accepted.map((r) => ({ ...r }));
const ZERO = { good: 0, market: 0, qty: 0, active: 0, deadline: 0, payout: 0 };
const setRec = (base, i, r) => {
  const o = base + i * 8;
  mem().fill(0, o, o + 8);
  mem()[o] = r.good; mem()[o + 1] = r.market; mem()[o + 2] = r.qty; mem()[o + 3] = r.active ?? 1;
  dv().setUint16(o + 4, r.deadline, true); dv().setUint16(o + 6, r.payout, true);
};
const giveLoad = (t, g, n, age = 0) => { ex.t_give(g, n, age); assert.equal(ex.act(LOAD, t, g, n), 0); };

// Reference xorshift32 and contract roll, independent of the wasm (Decision 17 + rulings).
const xs = (x) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
const draws = (w, n) => { for (let i = 0; i < n; i++) w = xs(w); return w; };
const findWord = (pred) => { for (let w = 1; ; w++) if (pred(w)) return w; };
const TIER = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2];
const BASE = [8, 7, 10, 12, 15, 22, 18, 40, 30, 38, 35, 28, 120];
const refRoll = (w, d, rank) => {
  const maxTier = rank >= 3 ? 2 : 1;
  const el = []; TIER.forEach((t, i) => { if (t <= maxTier) el.push(i); });
  w = xs(w); const good = el[w % el.length];
  let market = 1;
  if (TIER[good] > 0) { w = xs(w); market = 1 + (w % 2); }
  w = xs(w); const qty = 6 + (w % (5 + 3 * rank));
  w = xs(w); const deadline = d + 6 + (w % 9);
  const payout = Math.floor((qty * BASE[good] * 15000) / 10000);
  return { rec: { good, market, qty, active: 0, deadline, payout }, w };
};
// n visible slots rolled in slot order from word w
const refBoard = (w, d, rank, n) => {
  const out = [];
  for (let i = 0; i < n; i++) { const r = refRoll(w, d, rank); out.push(r.rec); w = r.w; }
  return { slots: out, w };
};

test('rank thresholds: star 1 at 0, 2 at 3, 3 at 8, 4 at 15, 5 at 25', () => {
  fresh();
  const cases = [[0, 1], [2, 1], [3, 2], [7, 2], [8, 3], [14, 3], [15, 4], [24, 4], [25, 5], [255, 5]];
  for (const [r, want] of cases) { setRep(r); assert.equal(ex.rank(), want, `rep ${r}`); }
});

test('init rolls the visible board slots after the weather prime (RNG pinned)', () => {
  ex.init(42);
  // reference weather_prime for day 1 (Spring row 55/30/0/15/0/0): tomorrow, then forecast
  let w = xs(42);
  const r1 = w % 100;
  const tomorrow = r1 < 55 ? 0 : r1 < 85 ? 1 : 3;
  w = xs(w);
  let fc;
  if (w % 100 < 80) fc = tomorrow; else { w = xs(w); const r = w % 100; fc = r < 55 ? 0 : r < 85 ? 1 : 3; }
  assert.equal(mem()[0x1402], tomorrow); assert.equal(mem()[0x1403], fc);
  const exp = refBoard(w, 1, 1, 2);
  assert.deepEqual(board().slice(0, 2), exp.slots);
  assert.deepEqual(board()[2], ZERO);
  assert.equal(rngWord(), exp.w);
  assert.deepEqual(acc(), [ZERO, ZERO, ZERO]);
});

test('board shows 2 slots at star 1 and 2, 3 at star 3', () => {
  for (const repPts of [0, 3]) {
    fresh(); setRep(repPts);
    assert.deepEqual(board()[2], ZERO);
    fails(E.BAD_ARG, ACCEPT, 2, 0, 0);
    fails(E.BAD_ARG, DECLINE, 2, 0, 0);
    assert.ok(board()[0].qty > 0 && board()[1].qty > 0);
  }
  // rep 8 = star 3: slot 2 fills on the next refresh and is then usable
  fresh(); setRep(8); setDay(4); setNextEvent(0xFFFF);
  fails(E.BAD_ARG, ACCEPT, 2, 0, 0);          // still empty before the refresh
  assert.equal(day(), 0);
  assert.ok(board().every((r) => r.qty > 0 && r.active === 0));
  assert.equal(ex.act(ACCEPT, 2, 0, 0), 0);
  assert.equal(acc()[0].active, 1);
});

test('payout = qty * basePrice * 1.5 (floor); exact record fields', () => {
  fresh();
  // Corn (id 1, tier 0 -> Town), qty 7: 7*7*1.5 = 73.5 -> 73
  const w = findWord((x) => xs(x) % 10 === 1 && xs(xs(x)) % 11 === 1);   // rank 1: good idx 1, qty 6 + 1 = 7
  setRng(w); setDay(3);
  ex.t_contract_roll(0);
  assert.deepEqual(board()[0], { good: CORN, market: 1, qty: 7, active: 0, deadline: 3 + 6 + (xs(xs(xs(w))) % 9), payout: 73 });
  assert.equal(rngWord(), draws(w, 3));       // tier 0: no market draw
  // Wine (id 12, tier 2, needs star 3): 120 base
  setRep(8);
  const w2 = findWord((x) => xs(x) % 13 === 12);
  setRng(w2); ex.t_contract_roll(1);
  const r = refRoll(w2, 3, 3).rec;
  assert.equal(r.good, 12);
  assert.equal(r.payout, r.qty * 180);
  assert.deepEqual(board()[1], r);
  assert.equal(rngWord(), draws(w2, 4));       // good, market, qty, deadline
});

test('roll matches the reference over many words and ranks (draw order and ranges)', () => {
  fresh();
  const seen = new Set();
  for (const repPts of [0, 3, 8, 15, 25]) {
    setRep(repPts);
    const rank = ex.rank();
    for (let w = 1; w < 4000; w += 7) {
      setDay(10 + (w % 50)); setRng(w); ex.t_contract_roll(0);
      const e = refRoll(w, 10 + (w % 50), rank);
      assert.deepEqual(board()[0], e.rec, `rank ${rank} word ${w}`);
      assert.equal(rngWord(), e.w);
      assert.ok(e.rec.good <= (rank >= 3 ? 12 : 9));
      seen.add(`${rank}:${e.rec.good}`);
    }
  }
  assert.ok(seen.has('1:9') && !seen.has('1:10') && seen.has('3:12'));
});

test('ACCEPT copies the record with active=1 into the first free slot, re-rolls the board slot, RNG pinned', () => {
  fresh();
  const before = board();
  const w = 123456789; setRng(w);
  assert.equal(ex.act(ACCEPT, 1, 0, 0), 0);
  assert.deepEqual(acc()[0], { ...before[1], active: 1 });
  assert.deepEqual(acc().slice(1), [ZERO, ZERO]);
  const e = refRoll(w, 1, 1);
  assert.deepEqual(board()[1], e.rec);
  assert.deepEqual(board()[0], before[0]);
  assert.deepEqual(board()[2], ZERO);
  assert.equal(rngWord(), e.w);
  // second accept goes to the next free slot, third too
  const b0 = board()[0];
  assert.equal(ex.act(ACCEPT, 0, 0, 0), 0);
  assert.deepEqual(acc()[1], { ...b0, active: 1 });
  assert.equal(ex.act(ACCEPT, 0, 0, 0), 0);
  assert.equal(acc()[2].active, 1);
});

test('at most 3 accepted: E_MAX with state unchanged; a freed slot is reused first', () => {
  fresh();
  for (let i = 0; i < 3; i++) assert.equal(ex.act(ACCEPT, 0, 0, 0), 0);
  fails(E.MAX, ACCEPT, 0, 0, 0);
  const keep = acc()[2];
  setRec(ACC, 1, ZERO);                       // free the middle slot
  const nb = board()[0];
  assert.equal(ex.act(ACCEPT, 0, 0, 0), 0);
  assert.deepEqual(acc()[1], { ...nb, active: 1 });
  assert.deepEqual(acc()[2], keep);
});

test('ACCEPT/DECLINE argument and status errors leave state unchanged', () => {
  fresh();
  fails(E.BAD_ARG, ACCEPT, 3, 0, 0);
  fails(E.BAD_ARG, ACCEPT, 255, 0, 0);
  fails(E.BAD_ARG, DECLINE, 3, 0, 0);
  setRec(BOARD, 0, ZERO);                     // empty visible slot
  fails(E.BAD_ARG, ACCEPT, 0, 0, 0);
  fails(E.BAD_ARG, DECLINE, 0, 0, 0);
  mem()[0x1400] = 3;                          // GameOver
  fails(E.STATUS, ACCEPT, 1, 0, 0);
  fails(E.STATUS, DECLINE, 1, 0, 0);
  mem()[0x1400] = 1;                          // Results
  fails(E.STATUS, ACCEPT, 1, 0, 0);
});

test('DECLINE re-rolls the slot, consumes RNG (pinned), leaves accepted alone', () => {
  fresh();
  const b = board(); const a = acc();
  const w = 987654321; setRng(w);
  assert.equal(ex.act(DECLINE, 0, 0, 0), 0);
  const e = refRoll(w, 1, 1);
  assert.deepEqual(board()[0], e.rec);
  assert.deepEqual(board()[1], b[1]);
  assert.deepEqual(acc(), a);
  assert.equal(rngWord(), e.w);
  assert.notDeepEqual(board()[0], b[0]);
  // two declines replay identically from the same word
  const x = snap(); fresh(); setRng(w); ex.act(DECLINE, 0, 0, 0); assert.deepEqual(snap().slice(0x440, 0x458), x.slice(0x440, 0x458));
});

test('board refreshes only when the new day is divisible by 5 (day 4->5 yes, 3->4 no)', () => {
  const run = (start, repPts) => {
    fresh(); setRep(repPts); setDay(start); setNextEvent(0xFFFF);
    const b0 = board();
    assert.equal(day(), 0);
    return { b0, b1: board(), w: rngWord() };
  };
  const quiet = run(3, 0);
  assert.deepEqual(quiet.b1, quiet.b0);
  const r = run(4, 0);
  // identical prefix draws, so the refresh starts from the no-refresh run's final word
  const exp = refBoard(quiet.w, 5, 1, 2);
  assert.deepEqual(r.b1.slice(0, 2), exp.slots);
  assert.deepEqual(r.b1[2], ZERO);
  assert.equal(r.w, exp.w);
  // star 3: all three slots, rank evaluated at refresh time
  const q3 = run(3, 8), r3 = run(4, 8);
  const exp3 = refBoard(q3.w, 5, 3, 3);
  assert.deepEqual(r3.b1, exp3.slots);
  assert.equal(r3.w, exp3.w);
  // later multiples of five too, and nothing in between
  fresh(); setNextEvent(0xFFFF);
  let prev = board();
  for (let d = 1; d < 21; d++) {
    day();
    const nd = d + 1, cur = board();
    if (nd % 5 === 0) assert.notDeepEqual(cur, prev, `new day ${nd} must refresh`);
    else assert.deepEqual(cur, prev, `new day ${nd} must not refresh`);
    prev = cur;
  }
});

// ---- TRUCK_SEND tagging -------------------------------------------------------------------
const CON = { good: CORN, market: 1, qty: 5, active: 1, deadline: 3, payout: 52 };
const ready = (over = {}, cargo = 8) => {
  fresh();
  setRec(ACC, 0, { ...CON, ...over });
  if (cargo) giveLoad(0, CORN, cargo);
};
const truck = (t = 0) => st().trucks[t];

test('send with a tag: success marks the truck and leaves the accepted slot intact', () => {
  ready();
  const a = acc(), c = cash();
  assert.equal(ex.act(SEND, 0, 1, 0), 0);
  assert.equal(truck().contract, 0); assert.equal(truck().phase, 1);
  assert.deepEqual(acc(), a); assert.equal(cash(), c);
  // no tag -> 255 as before
  fresh(); giveLoad(0, CORN, 3);
  assert.equal(ex.act(SEND, 0, 1, 255), 0); assert.equal(truck().contract, 255);
});

test('send: tag must name an active accepted slot', () => {
  ready();
  fails(E.CONTRACT, SEND, 0, 1, 3);
  fails(E.CONTRACT, SEND, 0, 1, 254);
  fails(E.CONTRACT, SEND, 0, 1, 1);           // slot 1 not active
  setRec(ACC, 0, { ...CON, active: 0 });
  fails(E.CONTRACT, SEND, 0, 1, 0);
});

test('send: destination market must equal the contract market', () => {
  ready();
  fails(E.CONTRACT, SEND, 0, 2, 0);
  ready({ market: 2, deadline: 9 });
  fails(E.CONTRACT, SEND, 0, 1, 0);
  assert.equal(ex.act(SEND, 0, 2, 0), 0);
});

test('send: the same slot cannot be tagged by two trucks', () => {
  ready();
  ex.t_put_bld(0, GARAGE); setCash(5000);
  assert.equal(ex.act(BUY, 0, 0, 0), 0);
  giveLoad(1, CORN, 8);
  assert.equal(ex.act(SEND, 0, 1, 0), 0);
  fails(E.CONTRACT, SEND, 1, 1, 0);
  assert.equal(truck(1).contract, 255);
  assert.equal(ex.act(SEND, 1, 1, 255), 0);   // untagged is still fine
});

test('send: arrival day must be <= deadline (boundary exact), RoadClosure adds a City day', () => {
  ready({ deadline: 1 });
  fails(E.DEADLINE, SEND, 0, 1, 0);           // day 1 + 1 travel = 2 > 1
  ready({ deadline: 2 });
  assert.equal(ex.act(SEND, 0, 1, 0), 0);     // 2 <= 2
  ready({ market: 2, deadline: 2 });
  fails(E.DEADLINE, SEND, 0, 2, 0);           // City 2 days -> 3 > 2
  ready({ market: 2, deadline: 3 });
  assert.equal(ex.act(SEND, 0, 2, 0), 0);
  ready({ market: 2, deadline: 3 }); ex.t_put_event(0, 3, 0, 0, 9);
  fails(E.DEADLINE, SEND, 0, 2, 0);           // closure: 4 > 3
  ready({ market: 2, deadline: 4 }); ex.t_put_event(0, 3, 0, 0, 9);
  assert.equal(ex.act(SEND, 0, 2, 0), 0);
  ready({ deadline: 2 }); ex.t_put_event(0, 3, 0, 0, 9);
  assert.equal(ex.act(SEND, 0, 1, 0), 0);     // closure does not touch Town
});

test('send: cargo must hold the full contract quantity of the good (no partial)', () => {
  ready({}, 4);
  fails(E.NO_STOCK, SEND, 0, 1, 0);           // 4 < 5
  fresh(); setRec(ACC, 0, CON); giveLoad(0, WHEAT, 20);
  fails(E.NO_STOCK, SEND, 0, 1, 0);           // wrong good
  ready({}, 5);
  assert.equal(ex.act(SEND, 0, 1, 0), 0);     // exactly qty
  // stock split over two ages still counts
  fresh(); setRec(ACC, 0, CON); giveLoad(0, CORN, 2, 3); giveLoad(0, CORN, 3, 1);
  assert.equal(ex.act(SEND, 0, 1, 0), 0);
});

test('send: contract checks run in order market -> deadline -> stock, then fuel cash', () => {
  ready({ deadline: 1 }, 1);
  fails(E.CONTRACT, SEND, 0, 2, 0);           // market wins over deadline and stock
  fails(E.DEADLINE, SEND, 0, 1, 0);           // deadline wins over stock
  ready({}, 1);
  fails(E.NO_STOCK, SEND, 0, 1, 0);
  ready({ market: 2 }); ex.t_put_event(0, 5, 0, 0, 9); setCash(5);
  fails(E.CONTRACT, SEND, 0, 1, 0);           // contract error before fuel cash
  ready(); ex.t_put_event(0, 5, 0, 0, 9); setCash(5);
  fails(E.CASH, SEND, 0, 1, 0);
  setCash(25);
  assert.equal(ex.act(SEND, 0, 1, 0), 0); assert.equal(cash(), 5); assert.equal(truck().contract, 0);
});

// ---- fulfilment -----------------------------------------------------------------------------
test('cargo take is oldest-first and only touches the named good', () => {
  fresh();
  giveLoad(0, CORN, 2, 3); giveLoad(0, CORN, 6, 1); giveLoad(0, WHEAT, 4, 2);
  assert.equal(ex.t_cargo_take(0, CORN, 5), 5);
  const s = truck().cargo.filter((c) => c.qty > 0).map((c) => [c.good, c.age, c.qty]);
  assert.deepEqual(s, [[CORN, 1, 3], [WHEAT, 2, 4]]);
  assert.equal(ex.t_cargo_take(0, CORN, 99), 3);
  assert.deepEqual(truck().cargo.filter((c) => c.qty > 0).map((c) => [c.good, c.qty]), [[WHEAT, 4]]);
});

test('cargo take is by age, not slot order (young cargo sits in the first slot)', () => {
  fresh();
  const o = 0x1160 + 16;
  mem()[o] = CORN; mem()[o + 1] = 1; dv().setUint16(o + 2, 6, true);        // slot 0: 6 young
  mem()[o + 4] = CORN; mem()[o + 5] = 3; dv().setUint16(o + 6, 2, true);    // slot 1: 2 old
  assert.equal(ex.t_cargo_take(0, CORN, 5), 5);
  assert.deepEqual(truck().cargo.filter((c) => c.qty > 0).map((c) => [c.age, c.qty]), [[1, 3]]);
});

const deliverRun = (over = {}) => {
  fresh();
  setRec(ACC, 0, { ...CON, qty: 7, payout: 73, deadline: 10, ...over });
  giveLoad(0, CORN, 10);
  assert.equal(ex.act(SEND, 0, 1, 0), 0);
  setRep(4);
  assert.equal(day(), 0);
};

test('on-time delivery: payout straight to cash, rep +1, contractsDone +1, slot cleared, extra cargo sells at market', () => {
  deliverRun();
  const t = truck(), satAfter = st().sat[13 + CORN];
  assert.equal(cash(), 500 + 73);                   // payout only; market proceeds wait in cashBack
  assert.equal(rep(), 5);
  assert.equal(done(), 1);
  assert.deepEqual(acc()[0], ZERO);
  assert.equal(t.contract, 255); assert.equal(t.phase, 2);
  // control: the same trip carrying only the 3 surplus units and no contract
  fresh(); giveLoad(0, CORN, 3); assert.equal(ex.act(SEND, 0, 1, 255), 0); assert.equal(day(), 0);
  assert.equal(truck().cashBack, t.cashBack);       // exactly 3 units went to market
  assert.equal(st().sat[13 + CORN], satAfter);      // and only 3 units lowered saturation
  assert.ok(t.cashBack >= 15 && t.cashBack <= 21);  // 3 Corn at about $7, never the 10 loaded
  assert.ok(satAfter < 10000);
  // return leg pays cashBack on top
  deliverRun(); day();
  assert.equal(cash(), 500 + 73 + t.cashBack);
});

test('delivery leaves saturation lowered by the surplus units only', () => {
  deliverRun({ qty: 10, payout: 105 });
  assert.equal(st().sat[13 + CORN], 10000);         // nothing left over: nothing sold
  assert.equal(truck().cashBack, 0);
  assert.equal(cash(), 500 + 105);
});

test('delivery: rep saturates at 255 and contractsDone at 65535', () => {
  fresh();
  setRec(ACC, 0, { ...CON, deadline: 10 }); giveLoad(0, CORN, 5);
  ex.act(SEND, 0, 1, 0); setRep(255); dv().setUint16(0x140C, 65535, true);
  day();
  assert.equal(rep(), 255); assert.equal(done(), 65535);
  assert.deepEqual(acc()[0], ZERO);
});

test('delivery of exactly the contract quantity leaves nothing to sell; other slots untouched', () => {
  fresh();
  setRec(ACC, 0, { ...CON, deadline: 10 }); setRec(ACC, 2, { ...CON, qty: 9, deadline: 20, payout: 94 });
  giveLoad(0, CORN, 5); ex.act(SEND, 0, 1, 0);
  const keep = acc()[2];
  day();
  assert.equal(truck().cashBack, 0);
  assert.deepEqual(acc()[2], keep);
  assert.equal(st().sat[13 + CORN], 10000);
});

test('contract goods that spoil en route: no partial delivery, slot stays active, truck untagged', () => {
  fresh();
  setRec(ACC, 0, { good: TOMATO, market: 2, qty: 5, active: 1, deadline: 10, payout: 75 });
  giveLoad(0, TOMATO, 5);
  assert.equal(ex.act(SEND, 0, 2, 0), 0);
  setRep(4);
  day(); assert.equal(truck().phase, 1);
  day(); // tomato hits perishDays 2 in the truck, then the truck arrives empty
  assert.equal(truck().phase, 2); assert.equal(truck().contract, 255);
  assert.equal(acc()[0].active, 1); assert.equal(rep(), 4); assert.equal(done(), 0);
  assert.equal(cash(), 500);
  // never delivered: expires on its deadline day
  setDay(10); day();
  assert.deepEqual(acc()[0], ZERO); assert.equal(rep(), 3);
});

// ---- expiry -----------------------------------------------------------------------------------
test('expiry: rep -1, cash -10% of payout (floor), slot cleared, slot order 0..2', () => {
  fresh(); setDay(5); setRep(4); setCash(1000);
  setRec(ACC, 0, { ...CON, deadline: 5, payout: 73 });        // penalty 7
  setRec(ACC, 1, { ...CON, deadline: 3, payout: 120 });       // penalty 12, long expired
  setRec(ACC, 2, { ...CON, deadline: 6, payout: 200 });       // not yet
  const keep = acc()[2];
  assert.equal(day(), 0);
  assert.equal(rep(), 2); assert.equal(cash(), 1000 - 7 - 12);
  assert.deepEqual(acc()[0], ZERO); assert.deepEqual(acc()[1], ZERO);
  assert.deepEqual(acc()[2], keep);
  // next day the last one expires
  assert.equal(day(), 0);
  assert.equal(rep(), 1); assert.equal(cash(), 981 - 20);
});

test('expiry: rep floors at 0 and cash may go negative', () => {
  fresh(); setDay(5); setRep(1); setCash(0);
  setRec(ACC, 0, { ...CON, deadline: 5, payout: 120 });
  setRec(ACC, 1, { ...CON, deadline: 5, payout: 99 });
  day();
  assert.equal(rep(), 0); assert.equal(cash(), -12 - 9);
  setDay(5); setRec(ACC, 0, { ...CON, deadline: 5, payout: 9 });
  day(); assert.equal(rep(), 0); assert.equal(cash(), -21); // floor(0.9) = 0 penalty
});

test('expiry: an outbound truck carrying the slot protects it; other tagged trucks are untagged', () => {
  fresh(); setDay(5); setRep(4); setCash(1000);
  setRec(ACC, 0, { ...CON, deadline: 5, payout: 100 });
  setRec(ACC, 1, { ...CON, deadline: 5, payout: 100 });
  const t0 = 0x1160;
  mem()[t0 + 2] = 1; mem()[t0 + 3] = 3; mem()[t0 + 5] = 0;     // truck 0 outbound with slot 0
  assert.equal(day(), 0);
  assert.equal(acc()[0].active, 1); assert.equal(truck().contract, 0);   // protected
  assert.deepEqual(acc()[1], ZERO);                                      // expired
  assert.equal(rep(), 3); assert.equal(cash(), 990);
  // a returning truck still tagged is untagged when its slot expires
  fresh(); setDay(5);
  setRec(ACC, 1, { ...CON, deadline: 5, payout: 100 });
  mem()[t0 + 2] = 2; mem()[t0 + 3] = 3; mem()[t0 + 5] = 1;
  day();
  assert.deepEqual(acc()[1], ZERO); assert.equal(truck().contract, 255); assert.equal(truck().phase, 2);
});

test('refresh empties board slots that are no longer visible after a rank drop', () => {
  fresh(); setRep(8); setDay(4); setNextEvent(0xFFFF); day();
  assert.ok(board()[2].qty > 0);
  setRep(7); setDay(9); day();                // new day 10 refresh at star 2
  assert.deepEqual(board()[2], ZERO);
  assert.ok(board()[0].qty > 0 && board()[1].qty > 0);
});

// --- final-fix ruling: contract deliveries count toward procSold / wineSold ---
const procSold = () => dv().getUint16(0x1410, true);
const wineSold = () => dv().getUint16(0x140E, true);
const WINE = 12, FLOUR = 5;

test('contract delivery of tier>=1 goods adds the delivered quantity to procSold (exactly, nothing sold at market)', () => {
  fresh();
  setRec(ACC, 0, { good: FLOUR, market: 1, qty: 6, active: 1, deadline: 10, payout: 198 });
  giveLoad(0, FLOUR, 6); assert.equal(ex.act(SEND, 0, 1, 0), 0);
  assert.equal(procSold(), 0);
  assert.equal(day(), 0);
  assert.equal(procSold(), 6); assert.equal(wineSold(), 0);
  assert.equal(done(), 1);
});

test('contract delivery of raw goods leaves procSold alone', () => {
  deliverRun({ qty: 10, payout: 105 });
  assert.equal(procSold(), 0); assert.equal(wineSold(), 0);
});

test('contract delivery of Wine counts toward both wineSold and procSold; saturates at 65535', () => {
  fresh();
  setRec(ACC, 0, { good: WINE, market: 2, qty: 7, active: 1, deadline: 20, payout: 1260 });
  giveLoad(0, WINE, 7); assert.equal(ex.act(SEND, 0, 2, 0), 0);
  dv().setUint16(0x140E, 65532, true); dv().setUint16(0x1410, 3, true);
  for (let i = 0; i < 2; i++) assert.equal(day(), 0);
  assert.equal(wineSold(), 65535); assert.equal(procSold(), 10);
});

test('a spoiled-away (undelivered) contract does not touch the sold counters', () => {
  fresh();
  setRec(ACC, 0, { good: FLOUR, market: 1, qty: 6, active: 1, deadline: 10, payout: 198 });
  giveLoad(0, FLOUR, 6); assert.equal(ex.act(SEND, 0, 1, 0), 0);
  mem().fill(0, 0x1160 + 16, 0x1160 + 48);   // cargo vanishes en route
  day();
  assert.equal(procSold(), 0); assert.equal(done(), 0);
});
