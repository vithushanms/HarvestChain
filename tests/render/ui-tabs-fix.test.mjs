// Task 5b fix round 1: cargo-slot limit, stale contract tag, FILL BEST skip rule, partial SELL,
// draw-list cap, BUY TRUCK reason, announces, and semantic probes for the arrival day, the
// deadline boundary and the cargo spoil threshold. Driven through pointer() / key() like the loader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE, readState } from '../helpers.mjs';
import { farm, BLD } from './scenes.mjs';
import { uiGame, putContract, HIT, BTN, KEY, UI } from './uistates.mjs';

const G = { WHEAT: 0, CORN: 1, TOMATO: 2, APPLE: 3, GRAPE: 4, FLOUR: 5, CORNMEAL: 6, SAUCE: 7 };
const EV = { ROAD: 3 };
const E_TRUCK_FULL = 12;
const QTY = 0xA040;
const st = (g) => readState(g.mem());
const truck = (g, t = 0) => st(g).trucks[t];
const simBytes = (g) => g.mem().slice(STATE.base, STATE.base + STATE.length);
const restore = (g, b) => g.mem().set(b, STATE.base);
const qty = (g, a) => new DataView(g.ex.memory.buffer).getInt32(QTY + a * 4, true);
const slotsUsed = (g, t = 0) => truck(g, t).cargo.filter((c) => c.qty).length;
const toCargo = (g, m) => { g.tabTo(3); g.tapR(BTN.DISPATCH); g.tapR(BTN.DEST + m); };

// ---------------------------------------------------------------- #1 cargo-slot limit

// 6 goods x 2 ages (no perishables): 12 (good, age) kinds for a truck with 8 slots.
const sixByTwo = (ex) => { for (const good of [G.WHEAT, G.CORN, G.APPLE, G.FLOUR, G.CORNMEAL, G.SAUCE]) { ex.t_give(good, 2, 1); ex.t_give(good, 2, 0); } };

test('#1 FILL BEST with 6 goods x 2 ages fits 8 cargo slots, and SEND succeeds', async () => {
  const g = await uiGame(360, 640, 200, { setup: sixByTwo });
  toCargo(g, 2);
  g.tapR(BTN.FILL);
  const plan = Array.from({ length: 13 }, (_, a) => qty(g, a));
  assert.equal(plan.filter(Boolean).length, 4, `4 goods x 2 ages = 8 slots: ${plan}`);
  g.tapR(BTN.NEXT); g.tapR(BTN.NEXT);
  g.tapR(BTN.SEND);
  assert.equal(truck(g).phase, 1, `sent (toasts: ${g.toasts()})`);
  assert.equal(slotsUsed(g), 8);
  assert.ok(!g.toasts().includes('TRUCK IS FULL'));
});

test('#1 a stepper + that would need a 9th cargo slot is disabled with TOO MANY KINDS', async () => {
  const g = await uiGame(360, 640, 200, { setup: sixByTwo });
  toCargo(g, 2);
  for (const good of [G.WHEAT, G.CORN, G.APPLE, G.FLOUR]) g.tapR(BTN.MAX + good);
  g.reach(BTN.PLUS + G.SAUCE);
  const b = g.btn(BTN.PLUS + G.SAUCE);
  assert.equal(b.en, 0);
  assert.equal(b.reason, 'TOO MANY KINDS');
  g.tapR(BTN.PLUS + G.SAUCE);
  assert.equal(qty(g, G.SAUCE), 0);
  assert.ok(g.toasts().includes('TOO MANY KINDS'), JSON.stringify(g.toasts()));
  // dropping a whole good frees its two slots again
  for (let i = 0; i < 4; i++) g.tapR(BTN.MINUS + G.FLOUR);
  g.reach(BTN.PLUS + G.SAUCE);
  assert.equal(g.btn(BTN.PLUS + G.SAUCE).en, 1);
  g.tapR(BTN.MAX + G.SAUCE);
  assert.equal(qty(g, G.SAUCE), 4);
});

test('#1 cargo already on the truck: its (good, age) slot is reused, other kinds count against 8', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    for (let good = 0; good < 7; good++) ex.t_give([G.WHEAT, G.CORN, G.APPLE, G.FLOUR, G.CORNMEAL, G.SAUCE, 11][good], 1, 0);
    for (const good of [G.WHEAT, G.CORN, G.APPLE, G.FLOUR, G.CORNMEAL, G.SAUCE, 11]) assert.equal(ex.act(10, 0, good, 1), 0);
    ex.t_give(G.WHEAT, 5, 0); ex.t_give(G.CORN, 3, 1); ex.t_give(G.CORN, 3, 2);
  } });
  toCargo(g, 1);
  g.tapR(BTN.MAX + G.WHEAT);
  assert.equal(qty(g, G.WHEAT), 5, 'same (wheat, 0) slot: no new slot');
  g.tapR(BTN.MAX + G.CORN);
  assert.equal(qty(g, G.CORN), 3, 'the 8th slot takes the oldest corn (age 2) only');
  g.reach(BTN.PLUS + G.CORN);
  assert.equal(g.btn(BTN.PLUS + G.CORN).reason, 'TOO MANY KINDS');
  g.tapR(BTN.NEXT); g.tapR(BTN.NEXT); g.tapR(BTN.SEND);
  assert.equal(truck(g).phase, 1);
  assert.equal(slotsUsed(g), 8);
});

// Deterministic LCG for the differential test.
const rnd = (s) => () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) / 16777216;

test('#1 differential: random storage / ages / truck cargo; the UI plan always loads, and a TOO MANY KINDS + is exactly what TRUCK_LOAD rejects', async () => {
  const R = rnd(99);
  const goods = [G.WHEAT, G.CORN, G.APPLE, G.FLOUR, G.CORNMEAL, G.SAUCE, 10, 11, 12];
  let kindsSeen = 0;
  for (let it = 0; it < 14; it++) {
    const g = await uiGame(1440, 900, 100, { setup: (ex) => {
      farm(ex).bld(10, BLD.WAREHOUSE).bld(11, BLD.WAREHOUSE);
      const pick = goods.filter(() => R() < 0.6);
      for (const good of pick) for (let age = 0; age < 4; age++) if (R() < 0.5) ex.t_give(good, 1 + Math.floor(R() * 4), age);
      for (const good of pick) if (R() < 0.3 && ex.t_count(good)) ex.act(10, 0, good, 1);
    } });
    toCargo(g, 1 + (it & 1));
    const inStock = goods.filter((good) => g.ex.t_count(good));
    for (let k = 0; k < 10 && inStock.length; k++) {
      const good = inStock[Math.floor(R() * inStock.length)], r = R();
      const code = r < 0.15 ? BTN.FILL : (r < 0.55 ? BTN.MAX : r < 0.85 ? BTN.PLUS : BTN.MINUS) + good;
      if (g.reach(code)) g.tap(code);
    }
    g.frame();
    const plan = Array.from({ length: 13 }, (_, a) => qty(g, a));
    const kinds = inStock.filter((good) => { g.reach(BTN.PLUS + good); return g.btn(BTN.PLUS + good)?.reason === 'TOO MANY KINDS'; });
    const snap = simBytes(g);
    for (let a = 0; a < 13; a++) if (plan[a]) assert.equal(g.ex.act(10, 0, a, plan[a]), 0, `it ${it}: plan ${plan} loads`);
    assert.ok(slotsUsed(g) <= 8);
    for (const good of kinds) {
      kindsSeen++;
      assert.equal(g.ex.act(10, 0, good, 1), E_TRUCK_FULL, `it ${it}: one more ${good} needs a 9th slot`);
    }
    restore(g, snap);
    // and through the UI: SEND never fails with TRUCK IS FULL
    if (plan.some(Boolean) || st(g).trucks[0].cargo.some((c) => c.qty)) {
      g.tapR(BTN.NEXT); g.tapR(BTN.NEXT); g.tapR(BTN.SEND);
      assert.ok(!g.toasts().includes('TRUCK IS FULL'), `it ${it}`);
      assert.equal(truck(g).phase, 1, `it ${it}: sent (${g.toasts()})`);
    }
  }
  assert.ok(kindsSeen > 0, 'some runs hit the slot limit');
});

// ---------------------------------------------------------------- #3 semantic probes

test('#3a arrival days: destination rows, confirm line and send toast use the real travel days (Road Closure +1 to the City)', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { ex.t_give(G.WHEAT, 4, 0); ex.t_put_event(0, EV.ROAD, 0, 0, 3); } });
  g.tabTo(3); g.tapR(BTN.DISPATCH);
  const L = g.labels();
  assert.ok(L.includes('1 DAY, ARRIVES DAY 2'), JSON.stringify(L));
  assert.ok(L.includes('3 DAYS, ARRIVES DAY 4, ROAD CLOSED'), JSON.stringify(L));
  g.tapR(BTN.DEST + 2); g.tapR(BTN.PLUS + G.WHEAT); g.tapR(BTN.NEXT); g.tapR(BTN.NEXT);
  assert.ok(g.labels().includes('CITY, ARRIVES DAY 4'), JSON.stringify(g.labels()));
  g.tapR(BTN.SEND);
  assert.ok(g.toasts().includes('TRUCK 1 SENT TO CITY, ARRIVES DAY 4'), JSON.stringify(g.toasts()));
  assert.equal(truck(g).daysLeft, 3);
});

test('#3b a contract due on the arrival day can be tagged; one due the day before cannot', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    putContract(ex, 'accepted', 0, { good: G.FLOUR, market: 2, qty: 4, deadline: 3, payout: 150 });
    putContract(ex, 'accepted', 1, { good: G.FLOUR, market: 2, qty: 4, deadline: 2, payout: 150 });
    ex.t_give(G.FLOUR, 4, 0);
  } });
  toCargo(g, 2);
  g.tapR(BTN.MAX + G.FLOUR); g.tapR(BTN.NEXT);
  assert.equal(g.btn(BTN.TAG + 0).en, 1, 'arrives day 3 == deadline 3');
  assert.equal(g.btn(BTN.TAG + 1).reason, 'PAST DEADLINE');
  g.tapR(BTN.TAG + 0);
  assert.equal(g.ui(UI.DC), 0);
  g.tapR(BTN.NEXT); g.tapR(BTN.SEND);
  assert.equal(truck(g).contract, 0, 'the sim agrees');
});

test('#3c cargo already on the truck spoils when its age + travel days reaches perishDays (exact threshold == sim)', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { ex.t_give(G.TOMATO, 3, 1); assert.equal(ex.act(10, 0, G.TOMATO, 3), 0); } });
  toCargo(g, 1);                       // age 1 + 1 day = perishDays 2
  g.tapR(BTN.NEXT); g.tapR(BTN.NEXT);
  assert.ok(g.labels().includes('3 TOMATO SPOIL ON THE WAY'), JSON.stringify(g.labels()));
  g.tapR(BTN.SEND);
  g.ex.end_day();
  assert.equal(truck(g).phase, 2);
  assert.equal(truck(g).cashBack, 0, 'all 3 spoiled in the real run');
});

// ---------------------------------------------------------------- #4 stale contract tag

test('#4 End Day while the confirm step is open drops a tag that is no longer valid; SEND then works', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    putContract(ex, 'accepted', 0, { good: G.SAUCE, market: 2, qty: 4, deadline: 3, payout: 540 });
    ex.t_give(G.SAUCE, 4, 0);
  } });
  toCargo(g, 2);
  g.tapR(BTN.MAX + G.SAUCE); g.tapR(BTN.NEXT); g.tapR(BTN.TAG + 0); g.tapR(BTN.NEXT);
  assert.equal(g.ui(UI.DC), 0);
  assert.ok(g.labels().includes('CONTRACT +$540'), JSON.stringify(g.labels()));
  g.key(KEY.E);                        // day 2: arrival day 4 > deadline 3
  g.frame();
  assert.equal(g.ui(UI.DSTEP), 3, 'still on the confirm step');
  assert.equal(g.ui(UI.DC), 255, 'tag dropped');
  assert.ok(!g.labels().some((s) => /^CONTRACT/.test(s)), JSON.stringify(g.labels()));
  g.tapR(BTN.SEND);
  assert.equal(truck(g).phase, 1, JSON.stringify(g.toasts()));
  assert.equal(truck(g).contract, 255);
});

// ---------------------------------------------------------------- #5 FILL BEST skip rule

test('#5 FILL BEST does not skip a good because of spoiling cargo already on the truck', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    ex.t_give(G.TOMATO, 3, 1); assert.equal(ex.act(10, 0, G.TOMATO, 3), 0);   // these spoil on the way to Town
    ex.t_give(G.TOMATO, 2, 0);                                               // these do not
  } });
  toCargo(g, 1);
  g.tapR(BTN.FILL);
  assert.equal(qty(g, G.TOMATO), 2);
});

// ---------------------------------------------------------------- #6 partial SELL

test('#6 a SELL whose later line fails: earlier lines are zeroed (no double sale), sale and failure toasted', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { ex.t_give(G.WHEAT, 5, 0); ex.t_give(G.FLOUR, 3, 0); } });
  g.tabTo(2); g.tap(BTN.SUB + 1);
  g.tapR(BTN.MAX + G.WHEAT); g.tapR(BTN.MAX + G.FLOUR);
  const q = g.ex.quote(0, G.WHEAT, 5), c0 = g.cash();
  g.reach(BTN.SELL); g.frame();
  const r = g.hit(BTN.SELL), [x, y] = g.toCss(r.x + (r.w >> 1), r.y + (r.h >> 1));
  g.down(x, y);
  g.mem()[STATE.base + STATE.fields.inv.off + G.FLOUR * 16] = 0;   // flour gone before the tap lands
  g.up(x, y);
  assert.equal(g.cash(), c0 + q, 'wheat sold');
  assert.equal(qty(g, G.WHEAT), 0, 'wheat line zeroed');
  const T = g.toasts();
  assert.ok(T.includes(`SOLD 5 UNITS +$${q}`), JSON.stringify(T));
  assert.ok(T.includes('NOT IN STOCK'), JSON.stringify(T));
  g.tapR(BTN.SELL);
  assert.equal(g.cash(), c0 + q, 'a second tap does not sell the wheat again');
});

// ---------------------------------------------------------------- #8 draw-list cap

test('#8 32 Mills on an 8x8 farm (Process tab): no trap, every drawn button has a record, "+N MORE" line', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    const f = farm(ex).clear().grid(8);
    for (let i = 0; i < 32; i++) f.bld(i * 2, BLD.MILL, { recipe: 1 });
  } });
  g.tabTo(1);
  for (let k = 0; k < 40; k++) {
    g.frame();
    assert.ok(g.ui(UI.BTN_N) <= 64);
    for (const h of g.hits()) if (h.code >= 0x200) assert.ok(g.btn(h.code), `0x${h.code.toString(16)} has a record`);
    const p = g.hit(HIT.PANEL), [x, y] = g.toCss(p.x + 3, p.y + (p.h >> 1));
    g.down(x, y); g.ex.pointer(x, y - 60, 1); g.up(x, y - 60);
  }
  assert.ok(g.labels().some((s) => /^\+\d+ MORE$/.test(s)), JSON.stringify(g.labels().slice(-3)));
  assert.ok(g.ex.t_canary_ok());
});

// ---------------------------------------------------------------- #9 BUY TRUCK reason

test('#9 BUY TRUCK: NEEDS A GARAGE with none, NEEDS ANOTHER GARAGE when the Garage slots are used', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_set_cash(3000) });
  g.tabTo(3); g.reach(BTN.BUY_TRUCK);
  assert.equal(g.btn(BTN.BUY_TRUCK).reason, 'NEEDS A GARAGE');
  g.ex.t_put_bld(10, BLD.GARAGE); g.ex.ui_loaded();
  g.tabTo(3); g.tapR(BTN.BUY_TRUCK);
  g.reach(BTN.BUY_TRUCK);
  assert.equal(g.btn(BTN.BUY_TRUCK).reason, 'NEEDS ANOTHER GARAGE');
});

// ---------------------------------------------------------------- #10 announces

test('#10 placement, dispatch steps and market sub-tabs are announced', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_give(G.WHEAT, 4, 0) });
  g.tabTo(4); g.tapR(BTN.BUILD + BLD.MILL);
  assert.equal(g.announce(), 'TAP AN EMPTY PLOT FOR MILL');
  g.tabTo(2); g.tap(BTN.SUB + 1);
  assert.equal(g.announce(), 'MARKET SELL');
  g.tap(BTN.SUB + 2);
  assert.equal(g.announce(), 'MARKET CONTRACTS');
  g.tabTo(3); g.tapR(BTN.DISPATCH);
  assert.equal(g.announce(), 'TRUCK 1, STEP 1 OF 4: WHERE TO?');
  g.tapR(BTN.DEST + 1);
  assert.equal(g.announce(), 'TRUCK 1, STEP 2 OF 4: CARGO');
  g.tapR(BTN.PLUS + G.WHEAT); g.tapR(BTN.NEXT);
  assert.equal(g.announce(), 'TRUCK 1, STEP 3 OF 4: CONTRACT');
  g.key(KEY.ESC);
  assert.equal(g.announce(), 'TRUCK 1, STEP 2 OF 4: CARGO');
});
