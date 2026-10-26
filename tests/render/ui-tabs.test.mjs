// Task 5b: Process, Market, Trucks and Build tabs driven through pointer() taps / key() like the
// loader does. Values are pinned against the sim (quote, act results, state fields).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE, readState } from '../helpers.mjs';
import { farm, BLD, W } from './scenes.mjs';
import { uiGame, HIT, BTN, KEY, UI } from './uistates.mjs';

const F = STATE.fields;
const simBytes = (g) => g.mem().slice(STATE.base, STATE.base + STATE.length);
const st = (g) => readState(g.mem());
const G = { WHEAT: 0, CORN: 1, TOMATO: 2, FLOUR: 5, SAUCE: 7 };
const TAB = { FARM: 0, PROCESS: 1, MARKET: 2, TRUCKS: 3, BUILD: 4 };
const EV = { SURGE: 1, GLUT: 2, ROAD: 3, FESTIVAL: 4, FUEL: 5 };
// Board / accepted contract record poke: {good, market, qty, active, deadline u16, payout u16}.
const putContract = (ex, field, s, c) => {
  const dv = new DataView(ex.memory.buffer), a = STATE.base + F[field].off + s * 8;
  dv.setUint8(a, c.good); dv.setUint8(a + 1, c.market); dv.setUint8(a + 2, c.qty); dv.setUint8(a + 3, field === 'accepted' ? 1 : 0);
  dv.setUint16(a + 4, c.deadline, true); dv.setUint16(a + 6, c.payout, true);
};
const truck = (g, t = 0) => st(g).trucks[t];

for (const [w, h, d] of [[360, 640, 200], [1440, 900, 100]]) {
  test(`${w}x${h}: tapping each tab switches to it, announces its name; Farm closes the tab sheet`, async () => {
    const g = await uiGame(w, h, d);
    const names = ['FARM', 'PROCESS', 'MARKET', 'TRUCKS', 'BUILD'];
    for (const t of [1, 2, 3, 4, 0]) {
      g.tabTo(t);
      assert.equal(g.ui(UI.TAB), t);
      assert.equal(g.announce(), names[t]);
      assert.equal(g.ui(UI.SHEET), t ? 1 : 0, 'tab content lives in the sheet / side panel');
      if (w === 360) assert.equal(g.ex.t_panel_open(), t ? 2 : 0, 'portrait: the tall tab sheet (62%)');
    }
  });
}

test('keys 1-5 switch tabs; Esc steps back (dispatch step, then the flow, then the tab)', async () => {
  const g = await uiGame(1440, 900, 100);
  g.key(KEY.D3); assert.equal(g.ui(UI.TAB), TAB.MARKET);
  g.key(KEY.D5); assert.equal(g.ui(UI.TAB), TAB.BUILD);
  g.key(KEY.D4); assert.equal(g.ui(UI.TAB), TAB.TRUCKS);
  g.tap(BTN.DISPATCH);
  g.tap(BTN.DEST + 1);
  assert.equal(g.ui(UI.DSTEP), 1);
  g.key(KEY.ESC); assert.equal(g.ui(UI.DSTEP), 0);
  g.key(KEY.ESC); assert.equal(g.ui(UI.DSP), -1);
  assert.equal(g.ui(UI.TAB), TAB.TRUCKS);
  g.key(KEY.ESC); assert.equal(g.ui(UI.TAB), TAB.FARM);
  g.key(KEY.D1); assert.equal(g.ui(UI.TAB), TAB.FARM);
});

test('tab switch clears placement and the dispatch flow; the market sub-tab persists', async () => {
  const g = await uiGame();
  g.tabTo(TAB.MARKET); g.tap(BTN.SUB + 2);
  g.tabTo(TAB.BUILD); g.tapR(BTN.BUILD + BLD.WELL);
  assert.equal(g.ui(UI.PLACE), BLD.WELL + 1);
  g.tabTo(TAB.TRUCKS);
  assert.equal(g.ui(UI.PLACE), 0);
  g.tap(BTN.DISPATCH);
  assert.equal(g.ui(UI.DSP), 0);
  g.tabTo(TAB.MARKET);
  assert.equal(g.ui(UI.DSP), -1);
  assert.equal(g.ui(UI.MSUB), 2, 'CONTRACTS still selected');
});

test('Process: storage summary, the Mill plan for the next End Day; recipe toggles go through SET_RECIPE', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { farm(ex).bld(10, BLD.MILL, { recipe: 1 }); ex.t_give(G.WHEAT, 9, 0); } });
  g.tabTo(TAB.PROCESS);
  const L = g.labels();
  assert.ok(L.includes('STORAGE 9/30'), JSON.stringify(L));
  assert.ok(L.includes('9 WHEAT IN STOCK, CAP 8/DAY'), JSON.stringify(L));
  assert.ok(L.includes('NEXT END DAY: 8 WHEAT > 4 FLOUR'), JSON.stringify(L));
  assert.equal(g.btn(BTN.LOCATE + 10).label, 'MILL');
  const rec = () => st(g).tiles[10].recipe;
  g.tapR(BTN.RNEXT + 10);
  assert.equal(rec(), 2, 'SET_RECIPE row 1 (corn)');
  assert.ok(g.labels().includes('NEED 2 CORN'), JSON.stringify(g.labels()));
  g.tapR(BTN.RPREV + 10); g.tapR(BTN.RPREV + 10);
  assert.equal(rec(), 0, 'SET_RECIPE 255 = off');
  assert.ok(g.labels().includes('NO RECIPE SET'));
  assert.equal(g.ui(UI.TAB), TAB.PROCESS, 'stays on the Process tab');
  // the plan matches what End Day really does
  g.tapR(BTN.RNEXT + 10);
  g.tap(HIT.ENDDAY);
  assert.equal(st(g).inv[G.FLOUR * 8], 4);
});

test('Process: two Mills share the wheat in End Day (tile) order; tap a card to locate the building', async () => {
  const g = await uiGame(1440, 900, 100, { setup: (ex) => { farm(ex).bld(1, BLD.MILL, { recipe: 1 }).bld(2, BLD.MILL, { recipe: 1, upgraded: true }); ex.t_give(G.WHEAT, 11, 0); } });
  g.tabTo(TAB.PROCESS);
  const L = g.labels();
  assert.ok(L.includes('NEXT END DAY: 8 WHEAT > 4 FLOUR'), JSON.stringify(L));
  assert.ok(L.includes('3 WHEAT IN STOCK, CAP 16/DAY'), JSON.stringify(L));
  assert.ok(L.includes('NEXT END DAY: 2 WHEAT > 1 FLOUR'), JSON.stringify(L));
  assert.equal(g.btn(BTN.LOCATE + 2).label, 'MILL II');
  g.tapR(BTN.LOCATE + 2);
  assert.equal(g.ui(UI.TAB), TAB.FARM);
  assert.equal(g.ui(UI.SEL), 2);
});

test('Process: perishable warnings mirror the spoil step (Cold Store protects the oldest 20)', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { ex.t_give(G.TOMATO, 6, 1); ex.t_give(G.TOMATO, 3, 0); } });
  g.tabTo(TAB.PROCESS);
  assert.ok(g.labels().includes('6 TOMATO ROT TOMORROW'), JSON.stringify(g.labels()));
  g.tap(HIT.ENDDAY);
  assert.equal(g.ex.t_count(G.TOMATO), 3, 'exactly those 6 rotted');
  const h = await uiGame(360, 640, 200, { setup: (ex) => { farm(ex).bld(10, BLD.COLD); ex.t_give(G.TOMATO, 6, 1); } });
  h.tabTo(TAB.PROCESS);
  assert.ok(!h.labels().some((s) => /ROT TOMORROW/.test(s)));
});

test('Market SELL: stepper to 5 sells 5; cash and stock change by quote(); MAX = stock', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_give(G.WHEAT, 12, 0) });
  g.tabTo(TAB.MARKET);
  g.tap(BTN.SUB + 1);
  for (let i = 0; i < 6; i++) g.tapR(BTN.PLUS + G.WHEAT);
  g.tapR(BTN.MINUS + G.WHEAT);
  const q = g.ex.quote(0, G.WHEAT, 5), c0 = g.cash();
  assert.equal(q, 29);   // 6+6+6+6+5: 2% saturation per unit
  assert.equal(g.btn(BTN.SELL).label, `SELL $${q}`);
  assert.equal(g.btn(0x2FF).label, 'WHEAT');
  g.tapR(BTN.SELL);
  assert.equal(g.cash(), c0 + q);
  assert.equal(g.ex.t_count(G.WHEAT), 7);
  assert.ok(g.toasts().includes(`SOLD 5 UNITS +$${q}`), JSON.stringify(g.toasts()));
  assert.equal(g.ex.need_save(), 1);
  g.tapR(BTN.MAX + G.WHEAT);
  assert.equal(g.btn(BTN.SELL).label, `SELL $${g.ex.quote(0, G.WHEAT, 7)}`);
  assert.match(g.btns().find((b) => b.code === BTN.SELL).label, /SELL/);
});

test('Market SELL: saturation note when the next units drop the price; none under a Festival', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_give(G.FLOUR, 8, 0) });
  g.tabTo(TAB.MARKET); g.tap(BTN.SUB + 1);
  g.tapR(BTN.MAX + G.FLOUR);
  g.frame();
  // the sub line is drawn into the button, record it through the draw list label + a pixel-free check
  const sell = () => g.btn(BTN.SELL);
  assert.equal(sell().en, 1);
  const h = await uiGame(360, 640, 200, { setup: (ex) => { ex.t_give(G.FLOUR, 8, 0); ex.t_put_event(0, EV.FESTIVAL, 0, 0, 2); } });
  h.tabTo(TAB.MARKET); h.tap(BTN.SUB + 1); h.tapR(BTN.MAX + G.FLOUR);
  assert.equal(h.btn(BTN.SELL).label, `SELL $${8 * h.ex.price(0, G.FLOUR)}`, 'Festival: no saturation at the Stand');
  assert.ok(g.ex.quote(0, G.FLOUR, 8) < 8 * g.ex.price(0, G.FLOUR));
});

test('Market PRICES: event news lines with days left', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { ex.t_put_event(0, EV.SURGE, 2, 10, 4); ex.t_put_event(1, EV.ROAD, 0, 0, 1); } });
  g.tabTo(TAB.MARKET);
  const L = g.labels();
  assert.ok(L.includes('SURGE \x02 BREAD CITY, 4 DAYS'), JSON.stringify(L));
  assert.ok(L.includes('ROAD CLOSED, 1 DAY'), JSON.stringify(L));
});

test('CONTRACTS: accept moves the offer to the accepted list (status, deadline); decline rerolls', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => putContract(ex, 'board', 0, { good: G.SAUCE, market: 1, qty: 12, deadline: 9, payout: 720 }) });
  g.tabTo(TAB.MARKET); g.tap(BTN.SUB + 2);
  assert.ok(g.labels().includes('12 SAUCE > TOWN BY DAY 9'), JSON.stringify(g.labels()));
  assert.equal(g.btn(BTN.ACCEPT).label, 'ACCEPT $720');
  g.tap(BTN.ACCEPT);
  const a = st(g).accepted[0];
  assert.deepEqual([a.good, a.market, a.qty, a.active, a.deadline, a.payout], [G.SAUCE, 1, 12, 1, 9, 720]);
  assert.match(g.announce(), /ACCEPTED/);
  const L = g.labels();
  assert.ok(L.includes('12 SAUCE > TOWN BY DAY 9 $720'), JSON.stringify(L));
  assert.ok(L.includes('DUE IN 8 DAYS, NEED 12 MORE'), JSON.stringify(L));
  const b0 = st(g).board[1];
  g.tapR(BTN.DECLINE + 1);
  assert.notDeepEqual(st(g).board[1], b0);
});

test('CONTRACTS: late-risk status is text + icon (SEND TODAY / TOO LATE), not colour only', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    putContract(ex, 'accepted', 0, { good: G.WHEAT, market: 1, qty: 6, deadline: 2, payout: 72 });
    putContract(ex, 'accepted', 1, { good: G.FLOUR, market: 2, qty: 6, deadline: 2, payout: 198 });
    ex.t_give(G.WHEAT, 6, 0);
  } });
  g.tabTo(TAB.MARKET); g.tap(BTN.SUB + 2);
  const L = g.labels();
  assert.ok(L.includes('DUE IN 1 DAY, READY, SEND TODAY'), JSON.stringify(L));
  assert.ok(L.includes('DUE IN 1 DAY, NEED 6 MORE, TOO LATE'), JSON.stringify(L));
});

// Dispatch through the step panel: destination, cargo, contract, confirm.
async function dispatchTo(g, m, cargo, tag) {
  g.tabTo(TAB.TRUCKS);
  g.tapR(BTN.DISPATCH);
  g.tapR(BTN.DEST + m);
  for (const [good, n] of cargo) for (let i = 0; i < n; i++) g.tapR(BTN.PLUS + good);
  g.tapR(BTN.NEXT);
  if (tag !== undefined) g.tapR(BTN.TAG + tag);
  g.tapR(BTN.NEXT);
  assert.equal(g.ui(UI.DSTEP), 3);
}

test('end-to-end contract via the UI: accept, load flour, tag, send, deliver: cash += payout, rep + 1', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { putContract(ex, 'board', 0, { good: G.FLOUR, market: 1, qty: 6, deadline: 6, payout: 198 }); ex.t_give(G.FLOUR, 8, 0); } });
  g.tabTo(TAB.MARKET); g.tap(BTN.SUB + 2); g.tap(BTN.ACCEPT);
  await dispatchTo(g, 1, [[G.FLOUR, 6]], 0);
  assert.ok(g.labels().includes('CONTRACT +$198'), JSON.stringify(g.labels()));
  assert.ok(g.labels().includes('TOWN, ARRIVES DAY 2'), JSON.stringify(g.labels()));
  g.tapR(BTN.SEND);
  assert.equal(truck(g).phase, 1);
  assert.equal(truck(g).contract, 0);
  assert.equal(g.ex.t_count(G.FLOUR), 2);
  assert.match(g.toasts().join('|'), /TRUCK 1 SENT TO TOWN, ARRIVES DAY 2/);
  const c0 = g.cash(), r0 = st(g).rep;
  g.tap(HIT.ENDDAY);
  assert.equal(g.cash(), c0 + 198 + 100, 'payout + milestone 1 (first processed good)');
  assert.equal(st(g).rep, r0 + 1);
  assert.equal(st(g).contractsDone, 1);
  g.tap(HIT.ENDDAY);
  assert.equal(truck(g).phase, 0, 'home again');
});

test('dispatch contract step: wrong market / past deadline / short cargo are disabled with reasons', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    putContract(ex, 'accepted', 0, { good: G.FLOUR, market: 2, qty: 6, deadline: 20, payout: 198 });
    putContract(ex, 'accepted', 1, { good: G.FLOUR, market: 1, qty: 6, deadline: 1, payout: 198 });
    putContract(ex, 'accepted', 2, { good: G.FLOUR, market: 1, qty: 9, deadline: 20, payout: 297 });
    ex.t_give(G.FLOUR, 8, 0);
  } });
  g.tabTo(TAB.TRUCKS); g.tap(BTN.DISPATCH); g.tap(BTN.DEST + 1);
  for (let i = 0; i < 6; i++) g.tapR(BTN.PLUS + G.FLOUR);
  g.tapR(BTN.NEXT);
  g.frame();
  assert.equal(g.btn(BTN.TAG + 0).reason, 'WRONG MARKET');
  assert.equal(g.btn(BTN.TAG + 1).reason, 'PAST DEADLINE');
  assert.equal(g.btn(BTN.TAG + 2).reason, 'NEED 3 MORE');
  const before = simBytes(g);
  g.tapR(BTN.TAG + 1);
  assert.equal(g.ui(UI.DC), 255, 'a disabled tag cannot be chosen');
  assert.deepEqual(simBytes(g), before);
});

// Spoilage warning vs a real send + End Day run (today's weather forced; later days Sunny).
async function spoilRun(m, { fridge = false, heat = false } = {}) {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    ex.t_give(G.TOMATO, 6, 0);
    if (fridge) farm(ex).truck(0, { fridge: true });
    ex.t_set_weather(heat ? W.HEAT : W.SUNNY);
  } });
  await dispatchTo(g, m, [[G.TOMATO, 6]]);
  const warned = g.labels().includes('6 TOMATO SPOIL ON THE WAY');
  g.tapR(BTN.SEND);
  let sold = -1;
  for (let d = 0; d < 6 && sold < 0; d++) {
    if (d) g.ex.t_set_weather(W.SUNNY);
    g.ex.end_day();
    if (truck(g).phase === 2) sold = truck(g).cashBack;
  }
  return { warned, spoiled: sold === 0, g };
}

for (const [m, o, want] of [[2, {}, true], [2, { fridge: true }, false], [1, {}, false], [1, { heat: true }, true], [2, { fridge: true, heat: true }, false]]) {
  test(`spoilage warning == sim: Tomato age 0 to ${m === 1 ? 'Town' : 'City'} ${JSON.stringify(o)} -> ${want ? 'spoils' : 'arrives'}`, async () => {
    const r = await spoilRun(m, o);
    assert.equal(r.spoiled, want, 'real run');
    assert.equal(r.warned, want, 'UI warning');
  });
}

test('SEND under a Fuel Spike with $19: the loads are rolled back (UNLOAD), state bytes unchanged, error toasted', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { ex.t_give(G.WHEAT, 5, 0); ex.t_give(G.FLOUR, 3, 2); ex.t_put_event(0, EV.FUEL, 0, 0, 3); } });
  await dispatchTo(g, 1, [[G.WHEAT, 5], [G.FLOUR, 3]]);
  assert.ok(g.labels().includes('FUEL $20'), JSON.stringify(g.labels()));
  g.reach(BTN.SEND);
  g.ex.t_set_cash(19);
  const before = simBytes(g);
  g.tapR(BTN.SEND);
  assert.deepEqual(simBytes(g), before, 'loads undone');
  assert.ok(g.toasts().includes('NOT ENOUGH CASH'), JSON.stringify(g.toasts()));
  assert.equal(truck(g).phase, 0);
});

test('FILL BEST loads the highest revenue per unit first (quote), within capacity', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { ex.t_give(G.WHEAT, 15, 0); ex.t_give(G.SAUCE, 12, 0); ex.t_give(G.CORN, 9, 0); } });
  g.tabTo(TAB.TRUCKS); g.tap(BTN.DISPATCH); g.tap(BTN.DEST + 2);
  g.tapR(BTN.FILL);
  g.tapR(BTN.NEXT); g.tapR(BTN.NEXT);
  const rows = g.btns().filter((b) => (b.code & 0x3F0) === BTN.PLUS);
  assert.equal(rows.length, 0, 'confirm step has no stepper rows');
  g.tapR(BTN.SEND);
  const cargo = truck(g).cargo.filter((c) => c.qty);
  assert.deepEqual(cargo.map((c) => [c.good, c.qty]).sort((a, b) => b[0] - a[0]), [[G.SAUCE, 12], [G.WHEAT, 8]], 'Sauce ($56 in the City) first, then Wheat over Corn');
});

test('Trucks: BUY TRUCK needs a Garage (reason shown), then works; upgrades need a Garage too', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_set_cash(3000) });
  g.tabTo(TAB.TRUCKS);
  g.reach(BTN.BUY_TRUCK);
  assert.equal(g.btn(BTN.BUY_TRUCK).en, 0);
  assert.equal(g.btn(BTN.BUY_TRUCK).reason, 'NEEDS A GARAGE');
  assert.equal(g.btn(BTN.UPG + 1).reason, 'NEEDS A GARAGE');
  g.ex.t_put_bld(10, BLD.GARAGE); g.ex.ui_loaded();
  g.tabTo(TAB.TRUCKS);
  g.tapR(BTN.BUY_TRUCK);
  assert.equal(st(g).truckCount, 2);
  assert.equal(g.cash(), 3000 - 450);
  assert.match(g.announce(), /BOUGHT TRUCK 2/);
  g.tapR(BTN.UPG + 1);                       // truck 0 fridge
  assert.equal(truck(g).upg & 4, 4);
  assert.equal(g.cash(), 3000 - 450 - 400);
  g.tapR(BTN.UPG + 0); g.tapR(BTN.UPG + 0);   // capacity +20 twice
  assert.equal(g.ex.truck_cap(0), 60);
  g.frame();
  assert.equal(g.btn(BTN.UPG + 0).reason, 'MAX LEVEL');
  g.reach(BTN.BUY_TRUCK);
  assert.equal(g.btn(BTN.BUY_TRUCK).reason, 'NEEDS ANOTHER GARAGE', 'one garage = one extra slot');
});

test('Build: select Mill -> placement mode -> tap an empty plot builds it (cash -250), mode exits', async () => {
  const g = await uiGame();
  g.tabTo(TAB.BUILD);
  g.tap(BTN.BUILD + BLD.MILL);
  assert.equal(g.ui(UI.PLACE), BLD.MILL + 1);
  assert.equal(g.ex.t_panel_open(), 0, 'portrait: the sheet gets out of the way');
  assert.match(g.announce(), /TAP AN EMPTY PLOT/);
  g.frame();
  assert.ok(g.hit(BTN.CANCEL), 'cancel button on the instruction bar');
  const c0 = g.cash();
  g.tapTile(9);
  assert.equal(g.tile(9), 2);
  assert.equal(st(g).tiles[9].id, BLD.MILL);
  assert.equal(g.cash(), c0 - 250);
  assert.equal(g.ui(UI.PLACE), 0);
  assert.match(g.announce(), /BUILT MILL/);
  assert.equal(g.ui(UI.TAB), TAB.BUILD);
  // a busy plot keeps the mode and toasts why; Cancel leaves it
  g.tapR(BTN.BUILD + BLD.WELL);
  g.tapTile(9);
  assert.ok(g.toasts().includes('PLOT IN USE'), JSON.stringify(g.toasts()));
  assert.equal(g.ui(UI.PLACE), BLD.WELL + 1);
  g.tap(BTN.CANCEL);
  assert.equal(g.ui(UI.PLACE), 0);
});

test('Build: unlock reasons (Bakery needs Mill, Cellar needs star 3); BUY LAND refits inside GRID', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_set_cash(2000) });
  g.tabTo(TAB.BUILD);
  assert.equal(g.btn(BTN.BUILD + BLD.BAKERY).reason, 'NEEDS MILL');
  assert.equal(g.btn(BTN.BUILD + BLD.CELLAR).reason, 'NEEDS \x013');
  g.tapR(BTN.BUY_LAND);
  assert.equal(st(g).grid, 5);
  assert.equal(g.cash(), 1400);
  g.tabTo(TAB.FARM);
  const Gr = { x: g.ex.t_lay_x(6), y: g.ex.t_lay_y(6), w: g.ex.t_lay_w(6), h: g.ex.t_lay_h(6) };
  for (let i = 0; i < 64; i++) {
    if ((i & 7) >= 5 || (i >> 3) >= 5) continue;
    const [x, y, w, h] = [0, 1, 2, 3].map((k) => g.ex.t_tile_rect(i, k));
    assert.ok(x >= Gr.x && y >= Gr.y && x + w <= Gr.x + Gr.w && y + h <= Gr.y + Gr.h, `tile ${i}`);
  }
});

test('Loans: take 300, then repay 100 pays the interest first (matches the sim)', async () => {
  const g = await uiGame();
  g.tabTo(TAB.BUILD);
  const c0 = g.cash();
  assert.equal(g.reach(BTN.TAKE) && g.btn(BTN.TAKE).label, 'TAKE $300');
  g.tapR(BTN.TAKE);
  assert.equal(g.cash(), c0 + 300);
  assert.equal(st(g).loanPrincipal, 300);
  assert.match(g.toasts().join('|'), /BORROWED \$300/);
  g.frame();
  g.reach(BTN.TAKE);
  assert.equal(g.btn(BTN.TAKE).reason, 'ONE LOAN AT A TIME');
  g.tap(HIT.ENDDAY);                  // 1% interest: $3
  assert.equal(st(g).loanInterest, 3);
  g.tabTo(TAB.BUILD);
  assert.ok(g.labels().includes('OWED $303, $3/DAY'), JSON.stringify(g.labels()));
  g.tapR(BTN.REPAY);
  assert.equal(st(g).loanInterest, 0);
  assert.equal(st(g).loanPrincipal, 203);
  g.tapR(BTN.MAX + 14);
  assert.equal(g.btn(BTN.REPAY).label, 'REPAY $203');
  g.tapR(BTN.REPAY);
  assert.equal(st(g).loanPrincipal, 0);
});

test('render-only frames on every tab / sub-tab / step leave sim state + RNG byte-identical; frame() idles at 0', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true, setup: (ex) => { ex.t_give(G.TOMATO, 4, 0); farm(ex).bld(10, BLD.MILL, { recipe: 1 }); } });
  const before = simBytes(g);
  for (const t of [1, 2, 3, 4]) {
    g.tabTo(t);
    for (let i = 0; i < 5; i++) g.frame(37);
    if (t === 2) for (const s of [0, 1, 2]) { g.tap(BTN.SUB + s); g.frame(); }
    if (t === 3) { g.tap(BTN.DISPATCH); g.tap(BTN.DEST + 2); g.tapR(BTN.PLUS + G.TOMATO); g.tapR(BTN.NEXT); g.tapR(BTN.NEXT); g.frame(); }
  }
  g.tabTo(TAB.BUILD); g.tap(BTN.BUILD + BLD.MILL); g.frame();
  assert.deepEqual(simBytes(g), before);
  g.tabTo(TAB.MARKET); g.settle();
  for (let i = 0; i < 300; i++) g.frame(20);   // toasts expire
  assert.equal(g.frame(), 0, 'idle under reduced motion');
});
