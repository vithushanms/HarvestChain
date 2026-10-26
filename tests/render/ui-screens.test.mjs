// Task 5c: Title, morning Gazette, Journal, Results / Game Over, How to play (src/22c_screens.wat).
// Driven through pointer / key / frame like the loader; t_ui and the draw / label logs only observe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE, readState, loadGame } from '../helpers.mjs';
import { farm, CROP, BLD } from './scenes.mjs';
import { uiGame, uiState, poke, putContract, HIT, BTN, KEY, UI, SCR, OVL } from './uistates.mjs';

const simBytes = (g) => g.mem().slice(STATE.base, STATE.base + STATE.length);
const st = (g) => readState(g.mem());
const labels = (g) => g.btns().map((b) => b.label);
const has = (g, re) => g.labels().some((l) => re.test(l));
const ENV = 4242, DAILY = 20387;
// state bytes of init(seed) in a fresh instance
const initBytes = async (seed) => { const h = await loadGame(); h.ex.init(seed); return h.mem().slice(STATE.base, STATE.base + STATE.length); };
// two-step: the confirming tap only counts 400 ms after arming
const wait = (g, ms) => { for (let t = 0; t < ms; t += 50) g.frame(50); };

// ---------------------------------------------------------------- Title

test('ui_boot(0): Title with NEW GAME, DAILY SEED, HOW TO PLAY and no CONTINUE; a fresh farm behind it, no save yet', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.frame();
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  const l = labels(g);
  for (const s of ['NEW GAME', `DAILY SEED #${DAILY}`, 'HOW TO PLAY', 'JOURNAL', 'LARGE TEXT', 'AUTO GAZETTE']) assert.ok(l.includes(s), `${s} in ${l}`);
  assert.ok(!l.includes('CONTINUE'));
  assert.equal(g.ex.need_save(), 0, 'the title farm is not saved until NEW GAME');
  assert.deepEqual(simBytes(g), await initBytes(ENV));
  assert.match(g.announce(), /^HARVESTCHAIN\. .*NEW GAME, DAILY SEED #20387, HOW TO PLAY/);
  // input is blocked under the title: End Day key and taps on the (hidden) top bar do nothing
  const d = st(g).day;
  g.key(KEY.E); g.key(KEY.D3);
  assert.equal(st(g).day, d); assert.equal(g.ui(UI.TAB), 0);
  const e = g.hits().find((r) => r.code === HIT.ENDDAY);   // the static region is still there, covered
  assert.equal(g.ex.t_hit_test(e.x + (e.w >> 1), e.y + (e.h >> 1)), HIT.PANEL, 'the Title absorbs taps on the farm chrome');
});

test('ui_boot(1): CONTINUE keeps the loaded farm byte for byte and goes to the farm', async () => {
  const g = await uiGame(360, 640, 200, { boot: 1, setup: (ex) => farm(ex).crop(9, CROP.CORN, 120).day(14) });
  g.frame();
  const before = simBytes(g);
  assert.ok(labels(g).includes('CONTINUE'));
  assert.match(g.announce(), /^HARVESTCHAIN\. CONTINUE, NEW GAME/);
  g.tap(OVL.CONTINUE);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.deepEqual(simBytes(g), before);
  assert.equal(g.ex.need_save(), 0);
  assert.ok(g.hit(HIT.ENDDAY), 'farm chrome is back');
});

test('NEW GAME over a save needs a second tap after 400 ms, then equals init(env seed)', async () => {
  const g = await uiGame(360, 640, 200, { boot: 1, setup: (ex) => farm(ex).day(30) });
  const before = simBytes(g);
  g.tap(OVL.NEW);
  assert.equal(g.btn(OVL.NEW).label, 'TAP AGAIN: REPLACES SAVE');
  assert.deepEqual(simBytes(g), before, 'first tap only arms');
  g.tap(OVL.NEW);                                  // +~32 ms: too early, ignored
  assert.deepEqual(simBytes(g), before);
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  wait(g, 450);
  g.tap(OVL.NEW);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.deepEqual(simBytes(g), await initBytes(ENV));
  assert.equal(g.ex.need_save(), 1);
});

test('NEW GAME without a save is one tap; Enter on the Title is the primary action', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.tap(OVL.NEW);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.equal(g.ex.need_save(), 1);
  const h = await uiGame(360, 640, 200, { boot: 0 });
  h.key(KEY.ENTER);
  assert.equal(h.ui(UI.SCR), SCR.FARM);
  assert.deepEqual(simBytes(h), await initBytes(ENV));
  const k = await uiGame(360, 640, 200, { boot: 1, setup: (ex) => farm(ex).day(9) });
  const b = simBytes(k);
  k.key(KEY.ENTER);
  assert.equal(k.ui(UI.SCR), SCR.FARM, 'Enter = CONTINUE with a save');
  assert.deepEqual(simBytes(k), b);
});

test('DAILY SEED: the same daily seed gives byte-identical games, another day differs', async () => {
  const run = async (daily) => { const g = await uiGame(360, 640, 200, { boot: 0, daily }); g.tap(OVL.DAILY); assert.equal(g.ui(UI.SCR), SCR.FARM); return simBytes(g); };
  const a = await run(DAILY), b = await run(DAILY), c = await run(DAILY + 1);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.notDeepEqual(a, await initBytes(ENV), 'not the random seed');
  // over a save it is two-step like NEW GAME
  const g = await uiGame(360, 640, 200, { boot: 1, setup: (ex) => farm(ex).day(30) });
  const before = simBytes(g);
  g.tap(OVL.DAILY);
  assert.deepEqual(simBytes(g), before);
  wait(g, 450); g.tap(OVL.DAILY);
  assert.deepEqual(simBytes(g), a);
});

test('HOW TO PLAY: 3 pages, NEXT / BACK navigate, BACK on page 1 and NEXT on page 3 close, Esc closes', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.tap(OVL.HOWTO);
  assert.equal(g.ui(UI.SCR), SCR.HOWTO);
  assert.equal(g.ui(UI.PAGE), 0);
  assert.ok(has(g, /^PLANT ON A PLOT\. END DAY GROWS IT\.$/));
  assert.ok(has(g, /^PAGE 1 OF 3$/));
  g.tap(OVL.NEXT); assert.equal(g.ui(UI.PAGE), 1); assert.ok(has(g, /^A MILL TURNS WHEAT INTO FLOUR:$/));
  g.tap(OVL.NEXT); assert.equal(g.ui(UI.PAGE), 2); assert.ok(has(g, /GROW YOUR NET WORTH!$/));
  assert.equal(g.btn(OVL.NEXT).label, 'DONE');
  g.tap(OVL.PREV); assert.equal(g.ui(UI.PAGE), 1);
  g.tap(OVL.NEXT); g.tap(OVL.NEXT);
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  g.tap(OVL.HOWTO); g.tap(OVL.PREV);
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  g.tap(OVL.HOWTO); g.key(KEY.ESC);
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  g.key(KEY.ESC);
  assert.equal(g.ui(UI.SCR), SCR.TITLE, 'Esc on the Title does nothing');
  for (const s of g.labels()) assert.ok(s.length <= 40, s);
});

test('LARGE TEXT toggle relayouts and flips get_flags bit 0; AUTO GAZETTE flips bit 2', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.frame();
  const h0 = g.hit(OVL.NEW).h;
  g.tap(OVL.LARGE);
  g.frame();
  assert.equal(g.ex.get_flags() & 1, 1);
  assert.equal(g.ex.t_ui_ts(), 2);
  assert.ok(g.hit(OVL.NEW).h >= h0, 'hit regions rebuilt after the relayout');
  assert.equal(g.btn(OVL.LARGE).label, 'LARGE TEXT');
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  g.tap(OVL.LARGE);
  assert.equal(g.ex.get_flags() & 1, 0);
  const f = g.ex.get_flags() & 4;
  g.tap(OVL.GAZOFF);
  assert.equal(g.ex.get_flags() & 4, f ^ 4);
  g.tap(OVL.GAZOFF);
  assert.equal(g.ex.get_flags() & 4, f);
});

// ---------------------------------------------------------------- Gazette

test('End Day opens the Gazette (pref on); not with the pref off; DAY box opens it either way', async () => {
  const g = await uiGame(360, 640, 200, { gazette: true });
  g.tap(HIT.ENDDAY);
  assert.equal(st(g).day, 2);
  assert.equal(g.ui(UI.SCR), SCR.GAZETTE);
  assert.ok(has(g, /^DAY 2, SPRING, YEAR 1$/), g.labels().join('|'));
  assert.ok(has(g, /^DAY 2 \+\$0/), 'yesterday summary line');
  assert.match(g.announce(), /^MORNING GAZETTE\. DAY 2, SPRING, YEAR 1/);
  g.key(KEY.E);
  assert.equal(st(g).day, 2, 'E is blocked under the Gazette');
  g.tap(OVL.START);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  g.tap(HIT.DAY);
  assert.equal(g.ui(UI.SCR), SCR.GAZETTE);
  g.key(KEY.ESC);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  // DON'T SHOW: the pref flips and End Day no longer opens it
  g.tap(HIT.DAY); g.tap(OVL.GAZOFF);
  assert.equal(g.ex.get_flags() & 4, 4);
  g.tap(OVL.START);
  g.tap(HIT.ENDDAY);
  assert.equal(st(g).day, 3);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  const h = await uiGame(360, 640, 200);           // pref off (harness default)
  h.key(KEY.E);
  assert.equal(h.ui(UI.SCR), SCR.FARM);
});

test('Gazette content: weather, forecast with its accuracy, hint arrows from driftNext, events', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    farm(ex).day(25).weather(3); poke(ex, 'forecast', 1);
    ex.t_put_event(0, 1, 2, 10, 4); ex.t_put_event(1, 3, 0, 0, 2);
    poke(ex, 'hintGood', 2, 0); poke(ex, 'hintGood', 7, 1); poke(ex, 'driftNext', 300, 2); poke(ex, 'driftNext', -300, 7);
  } });
  g.tap(HIT.DAY);
  const s = st(g);
  assert.equal(s.weatherToday, 3);
  assert.ok(has(g, /^TODAY STORM$/));
  assert.ok(has(g, /^FORECAST RAIN, 80% SURE$/), 'forecast = state.forecast, pct from T_K');
  assert.ok(has(g, /^TOMATO \x02 TOMORROW$/));
  assert.ok(has(g, /^SAUCE \x03 TOMORROW$/));
  assert.ok(has(g, /^SURGE \x02 BREAD CITY, 4 DAYS$/));
  assert.ok(has(g, /^ROAD CLOSED, 2 DAYS$/));
  poke(g.ex, 'driftNext', 0, 2); g.ex.set_flags(0, 0); g.frame();
  assert.ok(has(g, /^TOMATO STEADY TOMORROW$/));
  for (const l of g.labels()) assert.ok(!/ROT|DUE|LOAN|UPKEEP|STORAGE/.test(l), `calm farm has no alert: ${l}`);
});

test('Gazette alerts: rot tomorrow (matches the real End Day), contract due, loan, upkeep, storage nearly full', async () => {
  const setup = (ex) => {
    farm(ex).day(12).crop(9, CROP.TOMATO, 'ripe', { ripeAge: 1 }).crop(10, CROP.TOMATO, 'ripe', { ripeAge: 0 }).crop(1, CROP.GRAPE, 'ripe', { ripeAge: 2 })
      .bld(11, BLD.MILL).bld(2, BLD.CANNERY);
    putContract(ex, 'accepted', 0, { good: 5, market: 1, qty: 6, deadline: 14, payout: 198 });
    putContract(ex, 'accepted', 1, { good: 7, market: 2, qty: 6, deadline: 20, payout: 300 });
    poke(ex, 'loanPrincipal', 600); poke(ex, 'loanInterest', 12);
    farm(ex).fillStorage();
  };
  const g = await uiGame(360, 640, 200, { setup });
  g.tap(HIT.DAY);
  assert.ok(has(g, /^2 PLOTS ROT TOMORROW$/), g.labels().join('|'));
  assert.ok(has(g, /^FLOUR DUE IN 2 DAYS$/));
  assert.ok(!has(g, /^SAUCE DUE/), 'deadline 8 days away');
  assert.ok(has(g, /^OWED \$612, \$6\/DAY$/));
  assert.ok(has(g, /^UPKEEP \$(\d+)\/DAY$/));
  const up = Number(g.labels().find((l) => /^UPKEEP/.test(l)).match(/\$(\d+)/)[1]);
  assert.equal(up, g.ex.t_bal(2, 0, 1) + g.ex.t_bal(2, 1, 1));
  assert.ok(has(g, /^STORAGE (\d+)\/\1, NEARLY FULL$/) || has(g, /^STORAGE \d+\/\d+, NEARLY FULL$/));
  // cross-check the rot count with a real End Day (clear sky, so only rot removes crops)
  const h = await uiGame(360, 640, 200, { setup: (ex) => { setup(ex); ex.t_set_weather(0); } });
  h.tap(HIT.DAY);
  assert.ok(has(h, /^2 PLOTS ROT TOMORROW$/));
  const before = [9, 10, 1].map((i) => h.tile(i));
  h.tap(OVL.START); h.tap(HIT.ENDDAY);
  const after = [9, 10, 1].map((i) => h.tile(i));
  assert.deepEqual(before, [1, 1, 1]);
  assert.deepEqual(after, [0, 1, 0], 'tomato age 1 and grape age 2 rot, the fresh tomato stays');
  // one plot: singular
  const k = await uiGame(360, 640, 200, { setup: (ex) => farm(ex).crop(9, CROP.TOMATO, 'ripe', { ripeAge: 1 }) });
  k.tap(HIT.DAY);
  assert.ok(has(k, /^1 PLOT ROT TOMORROW$/));
});

// ---------------------------------------------------------------- Journal

test('Journal: header numbers and milestone rows equal the sim values', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => {
    farm(ex).day(57).bld(10, BLD.MILL);
    poke(ex, 'cash', 1180); poke(ex, 'rep', 9); poke(ex, 'contractsDone', 2); poke(ex, 'wineSold', 4); poke(ex, 'procSold', 3);
    poke(ex, 'milestones', 0b10001);
  } });
  g.tabTo(4);
  g.tapR(OVL.JOURNAL);
  assert.equal(g.ui(UI.SCR), SCR.JOURNAL);
  const nw = g.ex.net_worth(), sc = g.ex.score();
  const money = (n) => '$' + n.toLocaleString('en-US');
  assert.ok(has(g, /^DAY 57 OF 240, PLAYING$/), g.labels().join('|'));
  assert.ok(has(g, new RegExp(`^NET WORTH \\${money(nw)}$`)));
  assert.equal(g.ex.rank(), 3);
  assert.ok(has(g, /^\x013, 6 PTS TO \x014$/));
  assert.ok(has(g, new RegExp(`^SCORE ${sc.toLocaleString('en-US')}$`)));
  assert.equal(sc, nw + 9 * 100 + 2 * 50);
  const rows = g.btns().filter((b) => b.code === OVL.MILE);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => r.label), ['FIRST PROCESSED SALE', 'GROWING CONCERN', 'TRUSTED SUPPLIER', 'A GOOD FIRST YEAR', 'LOCAL FAVOURITE', 'VINTNER', 'HARVEST TYCOON']);
  // progress / DONE second lines and payouts (label log)
  for (const s of ['DONE', `NET WORTH ${money(nw)} / $2,000`, 'CONTRACTS 2 / 3', `NET WORTH ${money(nw)} / $3,000 BY DAY 81`, 'WINE 4 / 10', `NET WORTH ${money(nw)} / $50,000 BY DAY 240`, '+$100', '+$1,000'])
    assert.ok(g.labels().includes(s), `${s} in ${g.labels().join('|')}`);
  assert.equal(g.labels().filter((l) => l === 'DONE').length, 2, 'milestones 0 and 4 done');
  assert.ok(!g.labels().includes('+$0'), 'the run target pays nothing: no reward text');
  // past day 81 the year-1 milestone can no longer fire
  poke(g.ex, 'day', 90); g.ex.set_flags(0, 0); g.frame();
  assert.ok(g.labels().includes('PAST DEADLINE'));
  // back to the Build tab (Esc), J toggles from the farm
  g.key(KEY.ESC);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.equal(g.ui(UI.TAB), 4);
  g.key(KEY.J); assert.equal(g.ui(UI.SCR), SCR.JOURNAL);
  g.key(KEY.J); assert.equal(g.ui(UI.SCR), SCR.FARM);
  // from the Title and back to it
  const t = await uiGame(360, 640, 200, { boot: 0 });
  t.tap(OVL.JOURNAL);
  assert.equal(t.ui(UI.SCR), SCR.JOURNAL);
  t.tap(HIT.CLOSE);
  assert.equal(t.ui(UI.SCR), SCR.TITLE);
});

test('Journal: year-1 milestone before day 81 shows its target, rank 5 has no next star', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { farm(ex).day(20); poke(ex, 'rep', 30); } });
  g.key(KEY.J);
  assert.ok(g.labels().some((l) => /^NET WORTH \$[\d,]+ \/ \$3,000 BY DAY 81$/.test(l)), g.labels().join('|'));
  assert.ok(has(g, /^\x015$/));
  assert.ok(g.labels().includes('REP \x015 / \x013'), 'reached, pays at the next End Day');
});

// ---------------------------------------------------------------- Results / Game Over

const lastDay = (ex) => {
  farm(ex).day(240).bld(10, BLD.MILL);
  poke(ex, 'cash', 4000); poke(ex, 'rep', 12); poke(ex, 'contractsDone', 22); poke(ex, 'wineSold', 14);
};

test('Results right after the End Day that ends day 240: total = score(), CONTINUE IN ENDLESS -> status 2 + farm', async () => {
  const g = await uiGame(360, 640, 200, { gazette: true, setup: lastDay });
  g.tap(HIT.ENDDAY);
  const s = st(g);
  assert.equal(s.status, 1);
  assert.equal(s.day, 241);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS, 'Results, not the Gazette');
  assert.ok(has(g, /^YEAR 3 COMPLETE$/) || g.announce().startsWith('YEAR 3 COMPLETE.'));
  const sc = g.ex.score(), nw = g.ex.net_worth();
  const n = (v) => v.toLocaleString('en-US');
  assert.ok(has(g, new RegExp(`^SCORE ${n(sc)}$`)), g.labels().join('|'));
  assert.ok(has(g, new RegExp(`^NET WORTH \\$${n(nw)}$`)));
  assert.ok(has(g, /^REPUTATION 12 X 100 = 1,200$/));
  assert.ok(has(g, /^CONTRACTS 22 X 50 = 1,100$/));
  assert.equal(sc, nw + 1200 + 1100);
  assert.ok(has(g, /^SOLD 14 WINE$/));
  assert.ok(has(g, /^DAY 240 OF 240$/), 'days played');
  assert.ok(has(g, new RegExp(`^HARVESTCHAIN DAY 240 \\^ SCORE ${n(sc)} \\^ \\x01${g.ex.rank()} \\^ 22 CONTRACTS$`)));
  assert.ok(labels(g).includes('CONTINUE IN ENDLESS'));
  g.key(KEY.ESC);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS, 'Esc does not dismiss Results');
  g.tap(OVL.JOURNAL);
  assert.equal(g.ui(UI.SCR), SCR.JOURNAL);
  assert.ok(labels(g).includes('YEAR 3 COMPLETE'), 'Journal re-opens Results');
  g.tap(OVL.RESULTS);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS);
  g.ex.ack_save();
  g.tap(OVL.ENDLESS);
  assert.equal(st(g).status, 2);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.equal(g.ex.need_save(), 1);
  g.tap(HIT.ENDDAY);
  assert.equal(st(g).day, 242, 'Endless keeps playing');
  assert.equal(g.ui(UI.SCR), SCR.GAZETTE);
});

test('RUN COMPLETE! when the net worth target fires; Continue on a finished save opens Results', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => { farm(ex).day(100); poke(ex, 'cash', 60000); } });
  g.tap(HIT.ENDDAY);
  assert.equal(st(g).status, 1);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS);
  assert.match(g.announce(), /^RUN COMPLETE!\./);
  const h = await uiGame(360, 640, 200, { boot: 1, setup: (ex) => { farm(ex).day(241); poke(ex, 'status', 1); } });
  h.tap(OVL.CONTINUE);
  assert.equal(h.ui(UI.SCR), SCR.RESULTS);
});

test('Game Over: BANKRUPT with the cause; TRY AGAIN starts a different seed', async () => {
  const g = await uiGame(360, 640, 200, { gazette: true, setup: (ex) => {
    farm(ex).day(57); poke(ex, 'cash', -420); poke(ex, 'loanPrincipal', 1500); poke(ex, 'grace', 3);
  } });
  const seed0 = st(g).seed;
  g.tap(HIT.ENDDAY);
  assert.equal(st(g).status, 3);
  assert.equal(g.ui(UI.SCR), SCR.GAMEOVER);
  assert.match(g.announce(), /^BANKRUPT\. /);
  assert.ok(has(g, /^LOAN UNPAID, GRACE OVER$/));
  assert.ok(has(g, new RegExp(`^SCORE ${g.ex.score().toLocaleString('en-US')}$`)));
  assert.ok(!labels(g).includes('CONTINUE IN ENDLESS'));
  g.tap(OVL.TRY);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  const s = st(g);
  assert.equal(s.status, 0); assert.equal(s.day, 1);
  assert.notEqual(s.seed, seed0);
  assert.equal(s.seed, ENV, 'the session env seed (the ended game came from seed 5)');
  // a game started from the env seed: TRY AGAIN skips it
  const h = await uiGame(360, 640, 200, { boot: 0 });
  h.tap(OVL.NEW);
  poke(h.ex, 'cash', -420); poke(h.ex, 'loanPrincipal', 1500); poke(h.ex, 'grace', 3);
  h.key(KEY.E);
  assert.equal(h.ui(UI.SCR), SCR.GAMEOVER);
  h.tap(OVL.TRY);
  assert.equal(st(h).seed, ENV + 1);
  assert.equal(g.ex.need_save(), 1);
});

test('Results NEW GAME is two-step and starts the next env seed', async () => {
  const g = await uiGame(360, 640, 200, { setup: lastDay });
  g.tap(HIT.ENDDAY);
  const b = simBytes(g);
  g.tap(OVL.NEW);
  assert.deepEqual(simBytes(g), b);
  wait(g, 450); g.tap(OVL.NEW);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.equal(st(g).day, 1);
});

// ---------------------------------------------------------------- frames, purity, resize

test('frame codes: Results confetti animates (1) then stops; reduced motion is idle; static overlays 2 / 0', async () => {
  const g = await uiGame(360, 640, 200, { setup: lastDay });
  g.tap(HIT.ENDDAY);
  assert.equal(g.frame(), 1, 'confetti');
  for (let i = 0; i < 80; i++) g.frame(100);
  assert.equal(g.frame(), 2, 'after the burst: ambient only');
  const r = await uiGame(360, 640, 200, { reduced: true, setup: lastDay });
  r.tap(HIT.ENDDAY);
  for (let i = 0; i < 40; i++) r.frame(100);   // the End Day toast expires
  assert.equal(r.frame(), 0);
  const t = await uiGame(360, 640, 200, { reduced: true, boot: 0 });
  t.frame();
  assert.equal(t.frame(), 0);
  const u = await uiGame(360, 640, 200, { boot: 0 });
  u.frame();
  assert.equal(u.frame(), 2);
});

test('render-only frames on every screen leave the sim state and RNG identical; resize keeps the screen', async () => {
  for (const name of ['ui-title', 'ui-title-save', 'ui-howto', 'ui-gazette-storm', 'ui-gazette-alerts', 'ui-journal', 'ui-results', 'ui-gameover']) {
    const g = await uiState(name);
    const b = simBytes(g), scr = g.ui(UI.SCR);
    for (let i = 0; i < 5; i++) g.frame(37);
    for (const [w, h, d] of [[640, 360, 200], [1280, 800, 100], [320, 568, 200]]) {
      g.ex.resize(w, h, d); g.css = [w, h]; g.frame();
      assert.equal(g.ui(UI.SCR), scr, `${name} kept at ${w}x${h}`);
      assert.ok(g.hits().every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= g.ex.fb_w() && r.y + r.h <= g.ex.fb_h()), `${name} ${w}x${h} hits inside`);
    }
    assert.deepEqual(simBytes(g), b, name);
    assert.equal(g.ex.t_canary_ok(), 1);
  }
});

test('overlay draw lists stay small and every overlay button is reachable (scrolling if needed) at 320x568 large', async () => {
  for (const name of ['ui-title-large', 'ui-journal-large']) {
    const g = await uiState(name, 320, 568, 200);
    assert.ok(g.ui(UI.BTN_N) <= 24, `${name}: ${g.ui(UI.BTN_N)} buttons`);
    assert.ok(g.hits().length <= 128);
  }
  const g = await uiGame(320, 568, 200, { large: true, setup: lastDay });
  g.tap(HIT.ENDDAY);
  for (const c of [OVL.ENDLESS, OVL.NEW, OVL.JOURNAL]) assert.ok(g.reach(c), `0x${c.toString(16)} reachable`);
});
