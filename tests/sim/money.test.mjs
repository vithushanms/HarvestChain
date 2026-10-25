import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, readState, stateBytes } from '../helpers.mjs';

const { ex, mem } = await loadGame();
const LEN = 0x5B0;
const dv = () => new DataView(mem().buffer);
const st = () => readState(mem());
const snap = () => stateBytes(mem(), LEN);
const E = { OK: 0, BAD_ARG: 1, STATUS: 2, CASH: 6, LOAN: 18 };
const tileAt = (i) => 0x1200 + i * 8;
const setDay = (d) => dv().setUint16(0x100C, d, true);
const setCash = (v) => dv().setInt32(0x1010, v, true);
const setLoan = (p, i) => { dv().setInt32(0x1014, p, true); dv().setInt32(0x1018, i, true); };
const setGrace = (g) => { mem()[0x101C] = g; };
const setStatus = (s) => { mem()[0x1400] = s; };
const setRep = (r) => { mem()[0x100F] = r; };
const setRings = (n) => { mem()[0x1405] = n; mem()[0x100E] = 4 + n; };
const setU16 = (off, v) => dv().setUint16(off, v, true);
const fresh = () => { ex.init(42); mem().fill(0, 0x1200, 0x1400); setCash(1000); };
const put = (tile, bld, upgraded = false) => { ex.t_put_bld(tile, bld); if (upgraded) mem()[tileAt(tile) + 5] |= 2; };
const MILL = 0, CANNERY = 1, BAKERY = 3, WELL = 8, GARAGE = 9;
const noEvent = () => setU16(0x140A, 1000);

test('step 9 upkeep: sum of T_BLD upkeep over all standing buildings (upgrade costs the same)', () => {
  fresh(); setCash(500); put(0, MILL, true); put(1, CANNERY); put(2, BAKERY); put(3, WELL); put(8, GARAGE);
  assert.equal(ex.end_day(), 0);
  assert.equal(st().cash, 500 - (3 + 4 + 5 + 1 + 3));
});

test('step 9 upkeep: no buildings, no change; crops cost nothing', () => {
  fresh(); mem()[tileAt(0)] = 1;
  ex.end_day();
  assert.equal(st().cash, 1000);
});

test('step 9 interest: (principal + interest) * 1% floor, compounding over days', () => {
  fresh(); setCash(30000); setLoan(1590, 0);
  const got = [];
  for (let d = 0; d < 4; d++) { ex.end_day(); got.push(st().loanInterest); }
  // 15.90 -> 15 ; 1605 -> 16.05 -> 16 ; 1621 -> 16.21 -> 16 ; 1637 -> 16.37 -> 16
  assert.deepEqual(got, [15, 31, 47, 63]);
  assert.equal(st().loanPrincipal, 1590);
});

test('step 9: upkeep is paid before interest and independent of it; no loan means no interest', () => {
  fresh(); put(0, MILL); setLoan(1000, 0);
  ex.end_day();
  const s = st();
  assert.equal(s.cash, 997); assert.equal(s.loanInterest, 10); assert.equal(s.loanPrincipal, 1000);
  fresh(); ex.end_day();
  assert.equal(st().loanInterest, 0);
});

test('step 9 interest saturates at 2^30 owed instead of wrapping i32', () => {
  fresh(); setCash(30000); setLoan(0, 0x3FFFFF00);
  ex.end_day(); assert.equal(st().loanInterest, 0x40000000);
  ex.end_day(); assert.equal(st().loanInterest, 0x40000000);
  fresh(); setCash(30000); setLoan(1000, 0x70000000);   // already beyond the cap: never grows
  for (let d = 0; d < 3; d++) ex.end_day();
  assert.equal(st().loanInterest, 0x70000000);
});

test('LOAN_TAKE: argument range, one loan at a time, state untouched on error', () => {
  fresh();
  for (const amt of [0, -5, 1501, 100000]) {
    const b = snap(); assert.equal(ex.act(17, amt, 0, 0), E.BAD_ARG, `amt ${amt}`); assert.deepEqual(snap(), b);
  }
  assert.equal(ex.act(17, 1500, 0, 0), 0);
  let s = st(); assert.equal(s.cash, 2500); assert.equal(s.loanPrincipal, 1500); assert.equal(s.loanInterest, 0);
  const b = snap();
  assert.equal(ex.act(17, 10, 0, 0), E.LOAN); assert.deepEqual(snap(), b);
  fresh(); setLoan(0, 5); const b2 = snap();
  assert.equal(ex.act(17, 10, 0, 0), E.LOAN); assert.deepEqual(snap(), b2);
  fresh(); assert.equal(ex.act(17, 1, 0, 0), 0); assert.equal(st().loanPrincipal, 1);
});

test('LOAN_TAKE / LOAN_REPAY are blocked outside Playing/Endless', () => {
  for (const s of [1, 3]) {
    fresh(); setStatus(s); const b = snap();
    assert.equal(ex.act(17, 100, 0, 0), E.STATUS); assert.equal(ex.act(18, 100, 0, 0), E.STATUS);
    assert.deepEqual(snap(), b);
  }
  fresh(); setStatus(2); assert.equal(ex.act(17, 100, 0, 0), 0);
});

test('LOAN_REPAY: errors leave state unchanged', () => {
  fresh(); setLoan(1000, 30);
  for (const amt of [0, -1]) { const b = snap(); assert.equal(ex.act(18, amt, 0, 0), E.BAD_ARG); assert.deepEqual(snap(), b); }
  fresh(); let b = snap(); assert.equal(ex.act(18, 10, 0, 0), E.LOAN); assert.deepEqual(snap(), b);
  fresh(); setLoan(1000, 30); setCash(100); b = snap();
  assert.equal(ex.act(18, 200, 0, 0), E.CASH); assert.deepEqual(snap(), b);
  setCash(-50); b = snap();
  assert.equal(ex.act(18, 10, 0, 0), E.CASH); assert.deepEqual(snap(), b);
  // asking for more than owed pays only what is owed, so cash 1000 < 1030 owed is still short
  fresh(); setLoan(1000, 30); b = snap();
  assert.equal(ex.act(18, 5000, 0, 0), E.CASH); assert.deepEqual(snap(), b);
});

test('LOAN_REPAY: interest first, then principal, capped at what is owed', () => {
  fresh(); setCash(2000); setLoan(1000, 30);
  assert.equal(ex.act(18, 20, 0, 0), 0);
  let s = st(); assert.deepEqual([s.cash, s.loanInterest, s.loanPrincipal], [1980, 10, 1000]);
  assert.equal(ex.act(18, 50, 0, 0), 0);
  s = st(); assert.deepEqual([s.cash, s.loanInterest, s.loanPrincipal], [1930, 0, 960]);
  assert.equal(ex.act(18, 5000, 0, 0), 0);
  s = st(); assert.deepEqual([s.cash, s.loanInterest, s.loanPrincipal], [970, 0, 0]);
  assert.equal(ex.act(18, 1, 0, 0), E.LOAN);
  assert.equal(ex.act(17, 700, 0, 0), 0);
});

test('step 11: loan + negative cash -> grace 1,2,3, Game Over on the 4th negative End Day', () => {
  fresh(); setCash(-1000); setLoan(100, 0);
  for (let n = 1; n <= 3; n++) { assert.equal(ex.end_day(), 0); assert.equal(st().grace, n); assert.equal(st().status, 0); }
  assert.equal(ex.end_day(), 0);
  assert.equal(st().grace, 4); assert.equal(st().status, 3);
  const b = snap();
  assert.equal(ex.end_day(), E.STATUS); assert.deepEqual(snap(), b);
});

test('after Game Over every action, CONTINUE included, returns E_STATUS and changes nothing', () => {
  fresh(); setCash(5000); setStatus(3); setLoan(100, 0);
  const b = snap();
  for (let id = 1; id <= 19; id++) { assert.equal(ex.act(id, 0, 0, 0), E.STATUS, `act ${id}`); assert.deepEqual(snap(), b); }
});

test('Results blocks every action except CONTINUE; CONTINUE -> Endless; Endless works again', () => {
  fresh(); setStatus(1); const b = snap();
  for (let id = 1; id <= 18; id++) { assert.equal(ex.act(id, 0, 0, 0), E.STATUS, `act ${id}`); assert.deepEqual(snap(), b); }
  assert.equal(ex.end_day(), E.STATUS); assert.deepEqual(snap(), b);
  assert.equal(ex.act(19, 0, 0, 0), 0); assert.equal(st().status, 2);
  assert.equal(ex.act(19, 0, 0, 0), E.STATUS); // only from Results
  assert.equal(ex.end_day(), 0);
});

test('step 11: recovery to cash >= 0 resets grace; later negative days start over', () => {
  fresh(); setCash(-1000); setLoan(100, 0);
  ex.end_day(); ex.end_day(); assert.equal(st().grace, 2);
  setCash(0); ex.end_day(); assert.equal(st().grace, 0); assert.equal(st().status, 0);
  setCash(-5); ex.end_day(); assert.equal(st().grace, 1);
});

test('step 11: negative cash with no loan never counts', () => {
  fresh(); setCash(-1000);
  for (let d = 0; d < 8; d++) { ex.end_day(); assert.equal(st().grace, 0); assert.equal(st().status, 0); }
  fresh(); setCash(-1000); setGrace(2); ex.end_day(); assert.equal(st().grace, 2); // untouched, not reset
});

test('step 11 applies in Endless too, and a loan taken on the day cash is negative counts', () => {
  fresh(); setStatus(2); setCash(-1000); setLoan(100, 0); setGrace(3);
  ex.end_day(); assert.equal(st().status, 3);
});

test('net_worth: cash only; inventory, crops and tile content excluded', () => {
  fresh(); assert.equal(ex.net_worth(), 1000);
  ex.t_give(5, 30, 0); ex.t_give(12, 9, 0); mem()[tileAt(0)] = 1;
  assert.equal(ex.net_worth(), 1000);
  setCash(-300); assert.equal(ex.net_worth(), -300);
});

test('net_worth: 50% of building cost, 50% of 180% for upgraded, 50% of land rings, minus the whole loan', () => {
  fresh(); put(0, MILL);                      // 250 -> 125
  assert.equal(ex.net_worth(), 1125);
  put(1, MILL, true);                         // 250 + 200 = 450 -> 225
  assert.equal(ex.net_worth(), 1350);
  put(2, GARAGE);                             // 500 -> 250
  assert.equal(ex.net_worth(), 1600);
  setRings(1); assert.equal(ex.net_worth(), 1600 + 300);           // 600 -> 300
  setRings(3); assert.equal(ex.net_worth(), 1600 + (600 + 1400 + 3000) / 2);
  setLoan(300, 20); assert.equal(ex.net_worth(), 1600 + 2500 - 320);
});

test('score = net worth + 100 * rep + 50 * contractsDone', () => {
  fresh(); setRep(7); setU16(0x140C, 4);
  assert.equal(ex.score(), 1000 + 700 + 200);
  put(0, MILL); setLoan(100, 0);
  assert.equal(ex.score(), 1000 + 125 - 100 + 700 + 200);
});

// --- milestones (step 10, evaluated after the day increment) ---
const milestones = () => mem()[0x1406];
const step = () => { noEvent(); assert.equal(ex.end_day(), 0); };

test('milestone 0: first processed good sold pays 100 once', () => {
  fresh(); setU16(0x1410, 1); step();
  assert.equal(milestones(), 1); assert.equal(st().cash, 1100);
  step(); assert.equal(st().cash, 1100); assert.equal(milestones(), 1);
});

test('milestone 1: net worth >= 2000 pays 200 once', () => {
  fresh(); setCash(1999); step(); assert.equal(milestones(), 0); assert.equal(st().cash, 1999);
  setCash(2000); step(); assert.equal(milestones(), 2); assert.equal(st().cash, 2200);
  step(); assert.equal(st().cash, 2200);
});

test('milestones use one net worth snapshot taken before any payout in the check', () => {
  fresh(); setCash(1900); setU16(0x1410, 1); step();
  assert.equal(milestones(), 1); assert.equal(st().cash, 2000);   // not 2200: bit 1 waits for tomorrow
  step(); assert.equal(milestones(), 3); assert.equal(st().cash, 2200);
});

test('milestone 2: three contracts pay 200', () => {
  fresh(); setU16(0x140C, 2); step(); assert.equal(milestones(), 0);
  setU16(0x140C, 3); step(); assert.equal(milestones(), 4); assert.equal(st().cash, 1200);
});

test('milestone 3: only on the rollover into day 81, with net worth >= 3000', () => {
  fresh(); setDay(80); setCash(3000); step();
  assert.equal(st().day, 81); assert.equal(milestones(), 2 | 8); assert.equal(st().cash, 3000 + 200 + 500);
  fresh(); setDay(80); setCash(2999); step(); assert.equal(milestones(), 2);     // short by 1
  fresh(); setDay(81); setCash(3500); step(); assert.equal(milestones(), 2);     // day 82: too late
  fresh(); setDay(79); setCash(3500); step(); assert.equal(milestones(), 2);     // day 80: too early
});

test('milestone 4: reputation rank 3 (8 points) pays 300', () => {
  fresh(); setRep(7); step(); assert.equal(milestones(), 0);
  setRep(8); step(); assert.equal(milestones(), 16); assert.equal(st().cash, 1300);
});

test('milestone 5: ten wine sold pays 1000', () => {
  fresh(); setU16(0x140E, 9); step(); assert.equal(milestones(), 0);
  setU16(0x140E, 10); step(); assert.equal(milestones(), 32); assert.equal(st().cash, 2000);
});

test('milestone 6: net worth 50,000 pays 0, sets the bit and ends the run in Results', () => {
  fresh(); setCash(49999); step(); assert.equal(st().status, 0);
  fresh(); setCash(50000); step();
  const s = st();
  assert.equal(s.status, 1); assert.equal(milestones(), 2 | 64); assert.equal(s.cash, 50200); assert.equal(s.day, 2);
  const b = snap(); assert.equal(ex.end_day(), E.STATUS); assert.deepEqual(snap(), b);
});

test('all seven can be earned, each exactly once, in order', () => {
  fresh(); setDay(80); setCash(60000); setU16(0x1410, 1); setU16(0x140C, 3); setRep(8); setU16(0x140E, 10); step();
  assert.equal(milestones(), 0x7F);
  assert.equal(st().cash, 60000 + 100 + 200 + 200 + 500 + 300 + 1000 + 0);
  assert.equal(st().status, 1);
});

test('run end: new day > 240 -> Results; day 240 -> 241 is the last End Day', () => {
  fresh(); setDay(239); step(); assert.equal(st().day, 240); assert.equal(st().status, 0);
  step(); assert.equal(st().day, 241); assert.equal(st().status, 1);
  const b = snap(); assert.equal(ex.end_day(), E.STATUS); assert.deepEqual(snap(), b);
});

test('precedence: the End Day that reaches day 241 sets Results and skips step 11, even at the last warning day', () => {
  fresh(); setDay(240); setCash(-1000); setLoan(100, 0); setGrace(3); noEvent();
  assert.equal(ex.end_day(), 0);
  const s = st();
  assert.equal(s.day, 241); assert.equal(s.status, 1); assert.equal(s.grace, 3);
  fresh(); setDay(239); setCash(-1000); setLoan(100, 0); setGrace(3); noEvent();   // control: mid-run it is Game Over
  ex.end_day(); assert.equal(st().status, 3);
});

test('Endless: no run end and no milestones, but bankruptcy still applies', () => {
  fresh(); setDay(300); setStatus(2); setCash(60000); setU16(0x1410, 1); step();
  assert.equal(st().status, 2); assert.equal(milestones(), 0); assert.equal(st().cash, 60000);
  fresh(); setStatus(1); assert.equal(ex.act(19, 0, 0, 0), 0); setDay(250); step();
  assert.equal(st().day, 251); assert.equal(st().status, 2);
});

// --- step 10 hint goods ---
const xs = (x) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
const draws = (w, n) => { for (let i = 0; i < n; i++) w = xs(w); return w; };

test('hint goods: exactly two draws, rng_range(13) each, last in step 10 (after weather_advance)', () => {
  for (const w0 of [12345, 987654321, 0xDEADBEEF, 77]) {
    fresh(); setDay(12); noEvent(); dv().setUint32(0x1008, w0, true);
    assert.equal(ex.end_day(), 0);
    const end = dv().getUint32(0x1008, true);
    let T = -1; for (let n = 1; n < 40; n++) if (draws(w0, n) === end) { T = n; break; }
    // 13 drift + 1 tomorrow + (1 or 2) forecast + 2 hints
    assert.ok(T === 17 || T === 18, `draw count ${T}`);
    assert.deepEqual([mem()[0x1407], mem()[0x1408]], [draws(w0, T - 1) % 13, draws(w0, T) % 13]);
  }
});

test('hint goods are always goods 0..12 and may coincide', () => {
  fresh(); noEvent();
  for (let d = 0; d < 60; d++) { setU16(0x140A, 1000); ex.end_day(); assert.ok(mem()[0x1407] <= 12 && mem()[0x1408] <= 12); }
});
