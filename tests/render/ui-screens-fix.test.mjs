// Task 5c fix round 1: back stack (no soft-lock), toggle / screen announcements, run-end toasts,
// year-1 deadline day, Journal from the Build tab keeps the tab's scroll, pointer cancel (type 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readState } from '../helpers.mjs';
import { farm } from './scenes.mjs';
import { uiGame, UI_STATES, poke, HIT, KEY, UI, SCR, OVL } from './uistates.mjs';

const st = (g) => readState(g.mem());
const state = async (name, w = 360, h = 640) => {
  const s = UI_STATES[name];
  const g = await uiGame(w, h, 200, s.o);
  g.frame(); s.run(g); g.frame();
  return g;
};

// ---------------------------------------------------------------- C1 back stack

test('Gazette -> J -> Esc -> Esc ends on the farm (and START DAY after the Journal too)', async () => {
  const g = await uiGame(360, 640, 200, { gazette: true });
  g.key(KEY.E);
  assert.equal(g.ui(UI.SCR), SCR.GAZETTE);
  g.key(KEY.J); assert.equal(g.ui(UI.SCR), SCR.JOURNAL);
  g.key(KEY.ESC); assert.equal(g.ui(UI.SCR), SCR.GAZETTE);
  g.key(KEY.ESC); assert.equal(g.ui(UI.SCR), SCR.FARM);
  g.tap(HIT.DAY); g.key(KEY.J); g.key(KEY.J);     // J toggles the Journal back to the Gazette
  assert.equal(g.ui(UI.SCR), SCR.GAZETTE);
  g.key(KEY.ENTER); assert.equal(g.ui(UI.SCR), SCR.FARM, 'START DAY');
  g.tap(HIT.DAY); g.key(KEY.J); g.tap(HIT.CLOSE);
  assert.equal(g.ui(UI.SCR), SCR.GAZETTE);
  g.tap(HIT.CLOSE); assert.equal(g.ui(UI.SCR), SCR.FARM);
});

test('How to play -> J -> Esc -> Esc ends on the Title', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.tap(OVL.HOWTO); g.tap(OVL.NEXT);
  g.key(KEY.J); assert.equal(g.ui(UI.SCR), SCR.JOURNAL);
  g.key(KEY.ESC); assert.equal(g.ui(UI.SCR), SCR.HOWTO);
  g.key(KEY.ESC); assert.equal(g.ui(UI.SCR), SCR.TITLE);
  g.tap(OVL.HOWTO); g.key(KEY.J); g.key(KEY.ESC);
  g.tap(OVL.NEXT); g.tap(OVL.NEXT); g.tap(OVL.NEXT);
  assert.equal(g.ui(UI.SCR), SCR.TITLE, 'DONE returns to the Title');
});

test('Build tab JOURNAL -> Esc: back on the Build tab with its scroll kept', async () => {
  const g = await uiGame(360, 640, 200, { large: true });
  g.tabTo(4);
  g.tapR(OVL.JOURNAL);
  assert.equal(g.ui(UI.SCR), SCR.JOURNAL);
  g.key(KEY.ESC);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.equal(g.ui(UI.TAB), 4);
  assert.equal(g.ui(UI.SHEET), 1);
  assert.ok(g.ui(UI.SCROLL) > 0, 'the JOURNAL button sits below the fold');
  assert.ok(g.hit(OVL.JOURNAL), 'the tab is still scrolled to the JOURNAL button');
});

test('Results -> Journal -> Esc -> Results; Esc there stays', async () => {
  const g = await state('ui-results');
  assert.equal(g.ui(UI.SCR), SCR.RESULTS);
  g.tapR(OVL.JOURNAL); assert.equal(g.ui(UI.SCR), SCR.JOURNAL);
  g.key(KEY.ESC); assert.equal(g.ui(UI.SCR), SCR.RESULTS);
  g.key(KEY.ESC); assert.equal(g.ui(UI.SCR), SCR.RESULTS);
  g.key(KEY.J); g.key(KEY.J); assert.equal(g.ui(UI.SCR), SCR.RESULTS);
});

test('random walk (5k steps of Esc / Enter / J / taps): <= 4 Esc always reach a base screen', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0, gazette: true });
  let r = 12345;
  const rnd = (n) => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return (r >>> 8) % n; };
  const BASE = new Set([SCR.FARM, SCR.TITLE, SCR.RESULTS, SCR.GAMEOVER]);
  const seen = new Set();
  const check = (i) => {
    for (let k = 0; k < 4 && !BASE.has(g.ui(UI.SCR)); k++) g.key(KEY.ESC);
    assert.ok(BASE.has(g.ui(UI.SCR)), `step ${i}: stuck on screen ${g.ui(UI.SCR)} (ret ${g.ui(UI.RET)})`);
  };
  for (let i = 0; i < 5000; i++) {
    if (i % 500 === 250) { g.ex.ui_boot(1); g.frame(); }   // back to the Title now and then
    seen.add(g.ui(UI.SCR));
    const a = rnd(12);
    if (a < 3) g.key(KEY.ESC);
    else if (a < 5) g.key(KEY.J);
    else if (a < 6) g.key(KEY.ENTER);
    else if (a < 7 && g.ui(UI.SCR) === SCR.FARM) g.key([KEY.E, KEY.D5, KEY.D1][rnd(3)]);
    else {
      g.frame();
      const codes = g.hits().filter((h) => h.code === HIT.CLOSE || h.code === HIT.DAY || h.code >= 0x3C0).map((h) => h.code);
      if (codes.length) g.tap(codes[rnd(codes.length)]);
      if (rnd(8) === 0) for (let t = 0; t < 10; t++) g.frame(50);   // let two-step buttons go live
    }
    if (i % 20 === 19) check(i);
  }
  for (const s of [SCR.FARM, SCR.TITLE, SCR.GAZETTE, SCR.JOURNAL, SCR.HOWTO]) assert.ok(seen.has(s), `walk visited screen ${s}`);
});

// ---------------------------------------------------------------- I1 toggles announced

test('toggles announce their state: on tap and in the screen announcement', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.frame();
  assert.match(g.announce(), /LARGE TEXT OFF, AUTO GAZETTE OFF$/);
  g.tap(OVL.LARGE);
  assert.equal(g.announce(), 'LARGE TEXT ON');
  g.tap(OVL.LARGE);
  assert.equal(g.announce(), 'LARGE TEXT OFF');
  g.tap(OVL.GAZOFF);
  assert.equal(g.announce(), 'AUTO GAZETTE ON');
  const h = await uiGame(360, 640, 200, { gazette: true });
  h.key(KEY.E);
  assert.match(h.announce(), /START DAY, DON'T SHOW OFF$/);
  h.tap(OVL.GAZOFF);
  assert.equal(h.announce(), "DON'T SHOW ON");
});

// ---------------------------------------------------------------- I2 announcement text

test('screen announcements: exact text, no glyph codes, summary first, nothing cut off', async () => {
  const t = await state('ui-title');
  assert.equal(t.announce(), 'HARVESTCHAIN. NEW GAME, DAILY SEED #20387, HOW TO PLAY, JOURNAL, LARGE TEXT OFF, AUTO GAZETTE OFF');
  const r = await state('ui-results');
  assert.equal(r.announce(), 'YEAR 3 COMPLETE. DAY 240 OF 240, NET WORTH $17,801, REPUTATION 21 X 100 = 2,100, CONTRACTS 22 X 50 = 1,100, '
    + 'SOLD 14 WINE, SCORE 21,001, HARVESTCHAIN DAY 240, SCORE 21,001, STAR 4, 22 CONTRACTS, SHARE CODE READY: 12 CHARS, 1 DAY, LOADED IN -- MS, -- KB, COPY CODE, WATCH REPLAY, CONTINUE IN ENDLESS, NEW GAME, JOURNAL');
  const j = await state('ui-journal');
  const a = j.announce();
  assert.ok(a.startsWith('JOURNAL. 1 OF 7 DONE, DAY 57 OF 240, PLAYING, NET WORTH $1,755, STAR 3, 6 PTS TO STAR 4, SCORE 2,755, '
    + 'FIRST PROCESSED SALE, DONE, +$100, GROWING CONCERN, NET WORTH $1,755 / $2,000, +$200, '), a);
  for (const n of ['TRUSTED SUPPLIER', 'A GOOD FIRST YEAR', 'LOCAL FAVOURITE, REP STAR 3 / STAR 3', 'VINTNER, WINE 4 / 10', 'HARVEST TYCOON, NET WORTH $1,755 / $50,000 BY DAY 240'])
    assert.ok(a.includes(n), `${n} in ${a}`);
  const z = await state('ui-gazette-alerts');
  const b = z.announce();
  assert.ok(b.startsWith('MORNING GAZETTE. DAY 12, SPRING, YEAR 1, TODAY SUNNY, FORECAST SUNNY, 80% SURE, '), b);
  assert.ok(b.endsWith("START DAY, DON'T SHOW ON"), b);
  for (const s of [a, b, r.announce(), t.announce()]) assert.ok(!/[\x00-\x1f^]/.test(s), JSON.stringify(s));
});

// ---------------------------------------------------------------- I3 run-end toasts

test('Results / Game Over open with no End Day toast over them', async () => {
  for (const n of ['ui-results', 'ui-gameover']) {
    const g = await state(n);
    assert.ok([SCR.RESULTS, SCR.GAMEOVER].includes(g.ui(UI.SCR)));
    assert.deepEqual(g.toasts(), [], n);
  }
});

// ---------------------------------------------------------------- M1 year-1 deadline

test('Journal: year-1 milestone reads PAST DEADLINE from the day-81 morning (day 80 still shows the target)', async () => {
  for (const [d, past] of [[80, false], [81, true]]) {
    const g = await uiGame(360, 640, 200, { setup: (ex) => { farm(ex).day(d); } });
    g.key(KEY.J);
    assert.equal(g.labels().includes('PAST DEADLINE'), past, `day ${d}: ${g.labels().join('|')}`);
    assert.equal(g.labels().some((l) => / \$3,000 BY DAY 81$/.test(l)), !past, `day ${d}`);
  }
});

// ---------------------------------------------------------------- loader cancel (pointer type 3)

test('pointer type 3 cancels a press on a button, a plot and a sheet drag: no tap, no scroll, no dismiss', async () => {
  const g = await uiGame(360, 640, 200);
  // END DAY button
  const e = g.hit(HIT.ENDDAY), [ex, ey] = g.toCss(e.x + (e.w >> 1), e.y + (e.h >> 1));
  g.down(ex, ey); g.ex.pointer(-1, -1, 3); g.frame();
  assert.equal(st(g).day, 1); assert.equal(g.ui(UI.IN_ST), 0);
  g.up(ex, ey);
  assert.equal(st(g).day, 1, 'a later up is not a tap');
  // a plot
  g.down(...g.tileCss(9)); g.ex.pointer(-1, -1, 3); g.settle();
  assert.equal(g.ui(UI.SEL), -1); assert.equal(g.ui(UI.SHEET), 0);
  // sheet drag: scroll stays where the drag left it, then a downward drag at the top is not a dismiss
  g.tabTo(4);
  const p = g.hit(HIT.PANEL), [px, py] = g.toCss(p.x + 3, p.y + (p.h >> 1));
  g.down(px, py); g.ex.pointer(px, py - 30, 1); g.frame();
  const s = g.ui(UI.SCROLL);
  assert.ok(s > 0);
  g.ex.pointer(-1, -1, 3); g.frame();
  assert.equal(g.ui(UI.SCROLL), s, 'no jump');
  g.ex.pointer(px, py, 2); g.frame();
  assert.equal(g.ui(UI.SCROLL), s);
  for (let i = 0; i < 40 && g.ui(UI.SCROLL) > 0; i++) { g.down(px, py); g.ex.pointer(px, py + 30, 1); g.up(px, py + 30); }
  assert.equal(g.ui(UI.SCROLL), 0);
  g.down(px, py); g.ex.pointer(px, py + 60, 1); g.frame(); g.ex.pointer(-1, -1, 3); g.frame();
  assert.equal(g.ui(UI.SHEET), 1, 'not dismissed');
  assert.equal(g.ui(UI.TAB), 4);
});

// ---------------------------------------------------------------- M2 Title large text

test('Title in large text on a phone: the pair rows stack one per line (full width); side by side otherwise', async () => {
  for (const [w, h, d, large, save, stacked] of [[360, 640, 200, true, 1, true], [320, 568, 200, true, 1, true], [360, 640, 200, false, 1, false],
    [1280, 800, 100, false, 0, false], [1024, 600, 100, true, 1, false]]) {
    const g = await uiGame(w, h, d, { boot: save, large });
    g.frame();
    const full = g.hit(OVL.NEW).w;
    const rows = [OVL.HOWTO, OVL.JOURNAL, OVL.LARGE, OVL.GAZOFF].map((c) => g.hit(c));
    for (const r of rows) assert.equal(r.w === full, stacked, `${w}x${h} large=${large}: 0x${r.code.toString(16)} w ${r.w} vs ${full}`);
    // no two Title buttons overlap
    const all = g.hits().filter((r) => r.code >= 0x3C0);
    for (const a of all) for (const b of all) if (a !== b)
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${w}x${h} overlap 0x${a.code.toString(16)} 0x${b.code.toString(16)}`);
  }
});
