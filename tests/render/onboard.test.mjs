// Onboarding (Task 8a, src/22d_onboard.wat): the guided first days with spotlight hints. Scripted
// play through the public pointer / key / frame exports; t_tut only observes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE } from '../helpers.mjs';
import { farm, CROP, BLD } from './scenes.mjs';
import { uiGame, HIT, BTN, KEY, UI, OVL, SCR, RP, CODES } from './uistates.mjs';

const TUT = { STEP: 0, DONE: 1, FACTS: 2, TX: 3, TY: 4, TW: 5, TH: 6, CX: 7, CY: 8, CW: 9, CH: 10, HINT: 11, CODE: 12, TEXT: 13, LINE: 14 };
export const TB = { SKIP: 0x3DC, CARD: 0x3DD, REPLAY: 0x3DE };
const SIZES = [[360, 640, 200], [1280, 800, 100]];
const simBytes = (g) => g.mem().slice(STATE.base, STATE.base + STATE.length);

// A first visit: the Title (no save), NEW GAME -> the tutorial at step 1.
async function tutGame(w = 360, h = 640, d = 200, o = {}) {
  const g = await uiGame(w, h, d, { boot: 0, tut: true, ...o });
  g.tap(OVL.NEW); g.settle();
  g.tut = (k) => g.ex.t_tut(k);
  g.text = () => g.str(g.tut(TUT.TEXT));
  g.line = () => g.str(g.tut(TUT.LINE));
  g.target = () => ({ x: g.tut(TUT.TX), y: g.tut(TUT.TY), w: g.tut(TUT.TW), h: g.tut(TUT.TH) });
  g.card = () => ({ x: g.tut(TUT.CX), y: g.tut(TUT.CY), w: g.tut(TUT.CW), h: g.tut(TUT.CH) });
  g.px = (x, y) => new DataView(g.ex.memory.buffer).getUint32(g.ex.fb_ptr() + (y * g.ex.fb_w() + x) * 4, true);
  return g;
}
const gridN = (g) => g.mem()[STATE.base + STATE.fields.grid.off];
const inGrid = (g, i) => (i & 7) < gridN(g) && (i >> 3) < gridN(g);
const rectOf = (g, code) => { const r = g.hit(code); return r && { x: r.x, y: r.y, w: r.w, h: r.h }; };
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Follow the hints only: tap whatever the tutorial points at (a plot or a control). Returns the
// number of actions taken until the tutorial is done (or Infinity when it never finishes).
function follow(g, max = 300) {
  for (let n = 0; n < max; n++) {
    g.frame();
    const s = g.tut(TUT.STEP);
    if (s === 0) return n;
    if (s === 7) { g.tap(TB.SKIP); return n + 1; }
    const c = g.tut(TUT.CODE);
    if (g.ui(UI.SCR) !== SCR.FARM && g.ui(UI.SCR) !== SCR.GAZETTE) { g.key(KEY.ESC); continue; }
    if (c >= 0x10000) g.tapTile(c & 63);
    else if (c) { if (!g.reach(c)) throw new Error(`step ${s}: target 0x${c.toString(16)} unreachable`); g.tap(c); g.settle(); }
    else throw new Error(`step ${s}: no target (${g.text()})`);
  }
  return Infinity;
}

test('t_tut / get_flags / set_pref: bit 3 = done, bits 4-6 = the step', async () => {
  const g = await tutGame();
  assert.equal(g.tut(TUT.STEP), 1);
  assert.equal(g.ex.get_flags() & 0x78, 1 << 4);
  g.ex.set_pref(4, 3); g.frame();
  assert.equal(g.tut(TUT.STEP), 3);
  assert.equal((g.ex.get_flags() >> 4) & 7, 3);
  g.ex.set_pref(3, 1);
  assert.equal(g.ex.get_flags() & 8, 8);
  g.ex.set_pref(4, 0); g.frame();
  assert.equal(g.tut(TUT.STEP), 0);
  assert.equal(g.hit(TB.SKIP), undefined);
});

test('NEW GAME starts step 1: the spotlight is the empty plot\'s tile rect, the rest dimmed', async () => {
  for (const [w, h, d] of SIZES) {
    const g = await tutGame(w, h, d);
    for (let i = 0; i < 3; i++) g.ex.t_toast_drop(0);   // (toasts float over everything)
    g.ex.set_flags(1, 0); g.frame();
    assert.equal(g.tut(TUT.STEP), 1, `${w}x${h}`);
    assert.equal(g.line(), 'STEP 1 OF 6');
    assert.equal(g.text(), 'TAP AN EMPTY PLOT');
    const i = g.tut(TUT.CODE) & 63;
    assert.equal(g.tut(TUT.CODE), 0x10000 | i);
    assert.equal(g.tile(i), 0, 'an empty plot');
    assert.ok(inGrid(g, i));
    const T = g.target();
    assert.deepEqual(T, { x: g.ex.t_tile_rect(i, 0), y: g.ex.t_tile_rect(i, 1), w: g.ex.t_tile_rect(i, 2), h: g.ex.t_tile_rect(i, 3) });
    // the same frame without the tutorial: the hole keeps its pixels, far pixels are darker
    const C = g.card();
    const withT = g.mem().slice(g.ex.fb_ptr(), g.ex.fb_ptr() + g.ex.fb_w() * g.ex.fb_h() * 4);
    g.ex.set_pref(4, 0); g.frame();
    const ref = g.mem().slice(g.ex.fb_ptr(), g.ex.fb_ptr() + g.ex.fb_w() * g.ex.fb_h() * 4);
    const at = (fb, x, y) => { const o = (y * g.ex.fb_w() + x) * 4; return [fb[o], fb[o + 1], fb[o + 2]]; };
    const lum = ([r, gg, b]) => r * 3 + gg * 6 + b;
    const cx = T.x + (T.w >> 1), cy = T.y + (T.h >> 1);
    for (const [x, y] of [[cx, cy], [cx - (T.w >> 3), cy], [cx + (T.w >> 3), cy], [cx, cy - (T.h >> 3)], [cx, cy + (T.h >> 3)]])
      assert.deepEqual(at(withT, x, y), at(ref, x, y), `${w}x${h} hole (${x},${y}) undimmed`);
    // far pixels: a quarter of the pixel + 3/4 ink (palette 60): (c >> 2 & 0x3F3F3F) + ink - (ink >> 2 & 0x3F3F3F)
    const ink = g.ex.t_pal(60) >>> 0, q = (v) => (v >> 2) & 0x3F, ch = (v, k) => (v >> (8 * k)) & 255;
    const dim = (c) => [0, 1, 2].map((k) => q(c[k]) + ch(ink, k) - q(ch(ink, k)));
    for (const [x, y] of [[2, g.ex.fb_h() >> 1], [g.ex.fb_w() - 3, g.ex.fb_h() - 3], [cx, Math.max(0, T.y - 40)], [cx, 2]])
      if (!overlap({ x, y, w: 1, h: 1 }, { x: C.x, y: C.y, w: C.w + 3, h: C.h + 30 })) assert.deepEqual(at(withT, x, y), dim(at(ref, x, y)), `${w}x${h} far (${x},${y}) dimmed`);
    // the card never covers the target or End Day
    assert.ok(!overlap(C, T), `${w}x${h} card off the target`);
    assert.ok(!overlap(C, rectOf(g, HIT.ENDDAY)), `${w}x${h} card off End Day`);
  }
});

test('canonical path: plant, End Day, harvest, sell, Mill, truck, ALL SET (taps only)', async () => {
  for (const [w, h, d] of SIZES) {
    const g = await tutGame(w, h, d);
    const step = () => g.tut(TUT.STEP), code = () => g.tut(TUT.CODE);
    const s0 = g.ann = () => g.announce();
    assert.equal(step(), 1);
    // 1 PLANT: tap the plot, then the sheet's Wheat row
    const i = code() & 63;
    g.tapTile(i);
    assert.equal(step(), 1);
    assert.equal(code(), BTN.PLANT + CROP.WHEAT, `${w}x${h} sheet: the Wheat row`);
    assert.deepEqual(g.target(), rectOf(g, BTN.PLANT));
    assert.equal(g.text(), 'TAP PLANT, PICK WHEAT');
    g.tap(BTN.PLANT + CROP.WHEAT); g.settle();
    // 2 END DAY
    assert.equal(step(), 2);
    assert.equal(code(), HIT.ENDDAY);
    assert.deepEqual(g.target(), rectOf(g, HIT.ENDDAY));
    assert.equal(s0(), 'STEP 2 OF 6: TAP END DAY');
    g.tap(HIT.ENDDAY); g.settle();
    // 3 HARVEST: the starting Wheat is ripe now
    assert.equal(step(), 3);
    assert.equal(code(), HIT.HARVALL);
    assert.equal(g.text(), 'TAP HARVEST');
    g.tap(HIT.HARVALL); g.settle();
    // 4 SELL at the Farm Stand: Market tab, SELL, +, SELL
    assert.equal(step(), 4);
    assert.equal(code(), HIT.TAB0 + 2);
    assert.equal(g.text(), 'OPEN THE MARKET TAB');
    g.tabTo(2);
    assert.equal(code(), BTN.SUB + 1);
    g.tap(BTN.SUB + 1); g.settle();
    assert.equal(code(), BTN.PLUS + 0);
    assert.equal(g.text(), 'TAP + TO CHOOSE HOW MANY');
    for (let k = 0; k < 8; k++) g.tapR(BTN.PLUS);
    assert.equal(code(), BTN.SELL);
    assert.equal(g.text(), 'SELL YOUR WHEAT');
    g.tapR(BTN.SELL); g.settle();
    // 5 BUILD MILL: affordable on the canonical path
    assert.equal(step(), 5);
    assert.ok(g.cash() >= 250, `cash ${g.cash()}`);
    assert.equal(code(), HIT.TAB0 + 4);
    assert.equal(g.text(), 'BUILD A MILL TO MAKE FLOUR');
    g.tabTo(4);
    assert.equal(code(), BTN.BUILD + BLD.MILL);
    g.tapR(BTN.BUILD + BLD.MILL); g.settle();
    assert.ok(code() >= 0x10000, 'placement: an empty plot');
    assert.equal(g.text(), 'TAP AN EMPTY PLOT');
    g.tapTile(code() & 63);
    // 6 SEND TRUCK: Trucks tab, DISPATCH, TOWN, FILL BEST, NEXT, NEXT, SEND
    assert.equal(step(), 6);
    assert.equal(code(), HIT.TAB0 + 3);
    g.tabTo(3);
    assert.equal(code(), BTN.DISPATCH);
    assert.equal(g.text(), 'SEND A TRUCK TO TOWN');
    g.tapR(BTN.DISPATCH);
    assert.equal(code(), BTN.DEST + 1);
    g.tapR(BTN.DEST + 1);
    assert.equal(code(), BTN.FILL);
    assert.equal(g.text(), 'LOAD GOODS, THEN NEXT');
    g.tapR(BTN.FILL);
    assert.equal(code(), BTN.NEXT);
    g.tapR(BTN.NEXT);
    assert.equal(code(), BTN.NEXT);
    g.tapR(BTN.NEXT);
    assert.equal(code(), BTN.SEND);
    g.tapR(BTN.SEND); g.settle();
    // ALL SET: done is set (and persisted by the loader) before DONE is tapped
    assert.equal(step(), 7);
    assert.equal(g.text(), 'ALL SET! KEEP GROWING.');
    assert.equal(g.tut(TUT.DONE), 1);
    assert.equal(g.ex.get_flags() & 8, 8);
    assert.equal(g.btn(TB.SKIP).label, 'DONE');
    g.tap(TB.SKIP); g.settle();
    assert.equal(step(), 0);
    assert.equal(g.hit(TB.SKIP), undefined);
    assert.equal(g.hit(TB.CARD), undefined);
    // a later NEW GAME does not start it again
    g.key(KEY.ESC);
  }
});

test('the Gazette (auto-open on) points at START DAY; then the step goes on', async () => {
  const g = await tutGame(360, 640, 200, { gazette: true });
  g.ex.set_pref(4, 2); g.frame();
  g.tap(HIT.ENDDAY); g.settle();
  assert.equal(g.ui(UI.SCR), SCR.GAZETTE);
  assert.equal(g.tut(TUT.STEP), 3);
  assert.equal(g.tut(TUT.CODE), OVL.START);
  assert.equal(g.text(), 'TAP START DAY');
  assert.deepEqual(g.target(), rectOf(g, OVL.START));
  g.tap(OVL.START); g.settle();
  assert.equal(g.tut(TUT.CODE), HIT.HARVALL);
});

test('SKIP at every step sets done, removes the overlay and leaves the sim untouched', async () => {
  for (let s = 1; s <= 6; s++) {
    const g = await tutGame();
    g.ex.set_pref(4, s); g.frame();
    assert.equal(g.tut(TUT.STEP), s);
    const sk = g.hit(TB.SKIP);
    assert.ok(sk, `step ${s}: SKIP drawn`);
    const mt = g.ex.t_min_touch();
    assert.ok(sk.w >= mt && sk.h >= mt, `SKIP ${sk.w}x${sk.h} >= ${mt}`);
    assert.equal(g.btn(TB.SKIP).label, 'SKIP');
    const before = simBytes(g);
    g.tap(TB.SKIP); g.settle();
    assert.equal(g.tut(TUT.STEP), 0, `step ${s}`);
    assert.equal(g.tut(TUT.DONE), 1);
    assert.equal(g.ex.get_flags() & 8, 8);
    assert.equal(g.hit(TB.SKIP), undefined);
    assert.equal(g.hit(TB.CARD), undefined);
    assert.deepEqual(simBytes(g), before);
  }
});

test('the card absorbs taps (nothing behind it acts); taps elsewhere pass through', async () => {
  const g = await tutGame();
  const c = g.hit(TB.CARD);
  assert.ok(c);
  const before = simBytes(g);
  g.tapCss(...g.toCss(c.x + 2, c.y + 2)); g.settle();
  assert.deepEqual(simBytes(g), before);
  assert.equal(g.tut(TUT.STEP), 1);
  // End Day under the dim still works (no input blocking)
  g.tap(HIT.ENDDAY); g.settle();
  assert.equal(g.tut(TUT.FACTS) & 2, 2, 'day fact');
});

test('Mill step: not enough cash -> "NEED $250 - SELL MORE WHEAT", the step stays', async () => {
  const g = await tutGame();
  g.ex.t_give(0, 6, 0);
  g.ex.set_pref(4, 5); g.ex.t_set_cash(100); g.frame();
  assert.equal(g.tut(TUT.STEP), 5);
  assert.equal(g.text(), 'NEED $250 - SELL MORE WHEAT');
  assert.equal(g.tut(TUT.CODE), HIT.TAB0 + 2, 'points at the Market to sell');
  for (let i = 0; i < 5; i++) g.frame();
  assert.equal(g.tut(TUT.STEP), 5);
  // nothing to sell: End Day
  const e = await tutGame();
  e.ex.set_pref(4, 5); e.ex.t_set_cash(100); e.frame();
  assert.equal(e.tut(TUT.CODE), HIT.ENDDAY);
  assert.equal(e.text(), 'NEED $250 - SELL MORE WHEAT');
  // with the cash back it points at the Build tab
  e.ex.t_set_cash(400); e.frame();
  assert.equal(e.tut(TUT.CODE), HIT.TAB0 + 4);
});

test('CONTINUE of a save never starts it; ui_boot never does; Daily Seed does', async () => {
  const g = await uiGame(360, 640, 200, { boot: 1, tut: true });
  g.frame();
  assert.equal(g.ex.t_tut(0), 0);
  g.tap(OVL.CONTINUE); g.settle();
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.equal(g.ex.t_tut(0), 0);
  assert.equal(g.hit(TB.SKIP), undefined);
  const d = await uiGame(360, 640, 200, { boot: 0, tut: true });
  d.tap(OVL.DAILY); d.settle();   // (no save on the Title: one tap)
  d.frame();
  assert.equal(d.ex.t_tut(0), 1);
  // done -> NEW GAME does not start it
  const n = await uiGame(360, 640, 200, { boot: 0 });
  n.tap(OVL.NEW); n.settle();
  assert.equal(n.ex.t_tut(0), 0);
});

test('HOW TO PLAY: REPLAY TUTORIAL restarts at step 1 (CONTINUE with a save, NEW GAME without)', async () => {
  for (const boot of [1, 0]) {
    const g = await uiGame(360, 640, 200, { boot, setup: boot ? (ex) => farm(ex).day(9).bld(10, BLD.MILL) : undefined });
    const day = () => new DataView(g.ex.memory.buffer).getUint16(STATE.base + STATE.fields.day.off, true);
    const d0 = day();
    g.tap(OVL.HOWTO); g.settle();
    assert.ok(g.btn(TB.REPLAY), 'REPLAY TUTORIAL on How to play');
    assert.equal(g.btn(TB.REPLAY).label, 'REPLAY TUTORIAL');
    g.tap(TB.REPLAY); g.settle();
    assert.equal(g.ui(UI.SCR), SCR.FARM);
    assert.equal(g.ex.t_tut(0), 1, `boot ${boot}`);
    assert.equal(g.ex.t_tut(1), 0);
    assert.equal(g.ex.get_flags() & 8, 0);
    if (boot) {
      assert.equal(day(), d0, 'the save continues');
      assert.equal(g.ex.t_tut(2) & 16, 16, 'the Mill that exists already counts');
    }
  }
});

test('out of order: Mill first, End Day before planting, harvest before selling', async () => {
  const g = await tutGame();
  const step = () => g.tut(TUT.STEP);
  // Mill first, through the plot sheet's BUILD picker
  const i = g.tut(TUT.CODE) & 63;
  g.tapTile(i); g.tap(BTN.PICK_BUILD); g.tapR(BTN.BUILD + BLD.MILL); g.settle();
  assert.equal(g.tile(i), 2, 'Mill built');
  assert.equal(step(), 1, 'still: plant');
  assert.equal(g.tut(TUT.FACTS) & 16, 16);
  // End Day before planting, then harvest
  g.key(KEY.ESC);
  g.key(KEY.E); g.settle();
  assert.equal(step(), 1);
  g.key(KEY.H); g.settle();
  assert.equal(step(), 1);
  assert.equal(g.tut(TUT.FACTS) & 7, 6, 'day + harvest seen');
  // plant -> straight to SELL (End Day, harvest done)
  g.tapTile(g.tut(TUT.CODE) & 63); g.tap(BTN.PLANT + CROP.WHEAT); g.settle();
  assert.equal(step(), 4);
  // sell -> the Mill exists: straight to the truck
  g.tabTo(2); g.tap(BTN.SUB + 1); g.tapR(BTN.MAX); g.tapR(BTN.SELL); g.settle();
  assert.equal(step(), 6);
});

test('keyboard: E and H advance the steps too', async () => {
  const g = await tutGame();
  g.ex.set_pref(4, 2); g.frame();
  g.key(KEY.E); g.settle();
  assert.equal(g.tut(TUT.STEP), 3);
  g.key(KEY.H); g.settle();
  assert.equal(g.tut(TUT.STEP), 4);
});

test('replay viewer suppresses it (no card, no SKIP); back on the farm it shows again, no facts from the replay', async () => {
  const g = await tutGame();
  assert.equal(g.load(CODES.BOT40), 0);
  assert.equal(g.ui(UI.SCR), SCR.TITLE, 'a pasted code: the Title offers WATCH');
  g.tap(RP.WATCH); g.frame();
  assert.equal(g.ui(UI.SCR), RP.SCR);
  assert.equal(g.tut(TUT.STEP), 1);
  assert.equal(g.hit(TB.SKIP), undefined);
  assert.equal(g.hit(TB.CARD), undefined);
  assert.equal(g.tut(TUT.CW), 0);
  for (let k = 0; k < 3; k++) g.tap(RP.NEXT);   // replayed days: other crops, cash, storage
  g.tap(RP.EXIT); g.settle();
  g.tap(OVL.CONTINUE); g.settle();
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.ok(g.hit(TB.SKIP));
  assert.equal(g.tut(TUT.STEP), 1);
  assert.equal(g.tut(TUT.FACTS), 0, 'nothing observed from the replayed states');
});

test('resize / rotate mid-step keeps the right target rect', async () => {
  const g = await tutGame(360, 640, 200);
  const i = g.tut(TUT.CODE) & 63;
  for (const [w, h, d] of [[640, 360, 200], [1280, 800, 100], [320, 568, 200], [360, 640, 200]]) {
    g.ex.resize(w, h, d); g.css = [w, h]; g.frame();
    assert.equal(g.tut(TUT.CODE), 0x10000 | i);
    assert.deepEqual(g.target(), { x: g.ex.t_tile_rect(i, 0), y: g.ex.t_tile_rect(i, 1), w: g.ex.t_tile_rect(i, 2), h: g.ex.t_tile_rect(i, 3) }, `${w}x${h}`);
  }
  g.ex.set_pref(4, 2);
  for (const [w, h, d] of [[640, 360, 200], [360, 640, 200]]) {
    g.ex.resize(w, h, d); g.css = [w, h]; g.frame();
    assert.deepEqual(g.target(), rectOf(g, HIT.ENDDAY), `${w}x${h} End Day`);
  }
});

test('every step state: card inside the screen, off the target, End Day and its own SKIP; large text 320x568', async () => {
  const states = [
    ['plot', () => {}], ['sheet', (g) => g.tapTile(g.tut(TUT.CODE) & 63)], ['endday', (g) => { g.ex.set_pref(4, 2); }],
    ['harvest', (g) => { g.ex.set_pref(4, 2); g.tap(HIT.ENDDAY); }], ['market', (g) => { g.ex.t_give(0, 8, 0); g.ex.set_pref(4, 4); }],
    ['sell', (g) => { g.ex.t_give(0, 8, 0); g.ex.set_pref(4, 4); g.tabTo(2); g.tap(BTN.SUB + 1); }],
    ['mill', (g) => { g.ex.set_pref(4, 5); g.tabTo(4); }], ['place', (g) => { g.ex.set_pref(4, 5); g.tabTo(4); g.tapR(BTN.BUILD); }],
    ['truck', (g) => { g.ex.t_give(0, 8, 0); g.ex.set_pref(4, 6); g.tabTo(3); }], ['done', (g) => g.ex.set_pref(4, 7)],
  ];
  for (const [w, h, d, large] of [[360, 640, 200, 0], [320, 568, 200, 1], [1280, 800, 100, 0], [1280, 800, 100, 1], [640, 360, 200, 1]]) {
    for (const [name, run] of states) {
      const g = await tutGame(w, h, d, { large: !!large });
      run(g); g.settle(); g.frame();
      const tag = `${name} ${w}x${h} large=${large}`;
      const C = g.card(), W = g.ex.fb_w(), H = g.ex.fb_h(), mt = g.ex.t_min_touch();
      assert.ok(C.w > 0 && C.x >= 0 && C.y >= 0 && C.x + C.w <= W && C.y + C.h <= H, `${tag}: card ${JSON.stringify(C)} in ${W}x${H}`);
      const T = g.target();
      if (T.w) assert.ok(!overlap(C, T), `${tag}: card ${JSON.stringify(C)} covers the target ${JSON.stringify(T)}`);
      const E = rectOf(g, HIT.ENDDAY);
      if (E && g.ui(UI.SCR) === SCR.FARM) assert.ok(!overlap(C, E), `${tag}: card covers End Day`);
      const S = g.hit(TB.SKIP);
      assert.ok(S && S.w >= mt && S.h >= mt, `${tag}: SKIP ${S && S.w}x${S && S.h}`);
      assert.ok(S.x >= C.x && S.y >= C.y && S.x + S.w <= C.x + C.w && S.y + S.h <= C.y + C.h, `${tag}: SKIP inside the card`);
      if (T.w) assert.ok(!overlap(S, T), `${tag}: SKIP off the target`);
      assert.ok(g.ex.t_canary_ok());
    }
  }
});

test('reduced motion: a static ring and frame() never asks for animation; otherwise it pulses', async () => {
  const g = await tutGame(360, 640, 200, { reduced: true });
  for (let i = 0; i < 5; i++) g.frame();
  const shot = () => g.mem().slice(g.ex.fb_ptr(), g.ex.fb_ptr() + g.ex.fb_w() * g.ex.fb_h() * 4);
  const a = shot();
  g.t += 470; const r = g.frame();
  assert.notEqual(r, 1);
  assert.deepEqual(shot(), a);
  const m = await tutGame(360, 640, 200);
  const T = m.target(), ring = [];
  for (let k = 0; k < 8; k++) { m.t += 130; m.frame(); ring.push(Array.from({ length: 20 }, (_, i) => m.px(T.x - 1 - i, T.y + (T.h >> 1))).join()); }
  assert.ok(new Set(ring).size > 1, 'the glow pulses');
});

test('render-only frames leave the sim state and the RNG identical', async () => {
  const g = await tutGame();
  g.ex.t_give(0, 8, 0);
  for (let s = 1; s <= 7; s++) {
    g.ex.set_pref(4, s);
    const before = simBytes(g);   // (the RNG state is part of the sim state)
    for (let i = 0; i < 4; i++) g.frame(97);
    g.ex.resize(1280, 800, 100); g.frame(); g.ex.resize(360, 640, 200); g.frame();
    assert.deepEqual(simBytes(g), before, `step ${s}`);
  }
});

test('announce: each new hint is announced once, with the step', async () => {
  const g = await tutGame();
  assert.equal(g.announce(), 'STEP 1 OF 6: TAP AN EMPTY PLOT');
  const seq = g.ex.announce_seq();
  for (let i = 0; i < 5; i++) g.frame();
  assert.equal(g.ex.announce_seq(), seq, 'not repeated');
  g.ex.set_pref(4, 6); g.ex.t_give(0, 8, 0); g.frame();
  assert.equal(g.announce(), 'STEP 6 OF 6: OPEN THE TRUCKS TAB');
  g.ex.set_pref(4, 7); g.frame();
  assert.equal(g.announce(), 'ALL SET! KEEP GROWING.');
});

// xorshift for the fuzz (JS side; the sim RNG is never touched by the UI)
const rnd = (s) => () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
test('fuzz: random taps / keys with the tutorial on never trap or stick; the hints always lead to the end', async () => {
  for (const seed of [1, 2, 3]) {
    const g = await tutGame(seed === 2 ? 1280 : 360, seed === 2 ? 800 : 640, seed === 2 ? 100 : 200);
    const r = rnd(seed * 7919);
    const keys = [KEY.E, KEY.H, KEY.D1, KEY.D2, KEY.D3, KEY.D4, KEY.D5, KEY.ESC, KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT, KEY.ENTER, KEY.SPACE];
    for (let n = 0; n < 5000; n++) {
      const k = r() % 10;
      if (k < 6) {
        // a tap on a random drawn region (or anywhere)
        const hs = g.hits().filter((x) => x.code !== TB.SKIP);   // (SKIP would end the fuzz early)
        const h = hs[r() % hs.length];
        if (h && k < 5) g.tapCss(...g.toCss(h.x + (r() % Math.max(1, h.w)), h.y + (r() % Math.max(1, h.h))));
        else g.tapCss(r() % g.css[0], r() % g.css[1]);
      } else if (k < 9) g.key(keys[r() % keys.length]);
      else g.frame(r() % 400);
      if (g.ui(UI.SCR) === SCR.TITLE || g.ui(UI.SCR) >= 4) {
        // a finished run / the Title: start over (a NEW GAME restarts the tutorial while not done)
        if (g.ui(UI.SCR) === SCR.TITLE) { g.tap(OVL.NEW); g.tap(OVL.NEW); } else g.key(KEY.ESC);
      }
      const s = g.tut(TUT.STEP);
      assert.ok(s >= 0 && s <= 7, `step ${s}`);
      if (s && g.ui(UI.SCR) === SCR.FARM) assert.ok(g.hit(TB.SKIP), `n=${n}: SKIP always there`);
      if (n % 500 === 0) {
        const io = g.ex.io_buf(), len = g.ex.save_len();
        const save = g.mem().slice(g.ex.save_ptr(), g.ex.save_ptr() + len);
        assert.ok(g.ex.t_canary_ok());
        // the sim state stays loadable (load validates every field) and is untouched by the load check
        const before = simBytes(g);
        g.mem().set(save, io);
        assert.equal(g.ex.load(io, len), 0, `n=${n}: valid state`);
        assert.deepEqual(simBytes(g), before);
      }
    }
    // from whatever state the fuzz left: (re)start and follow the hints to the end
    if (g.tut(TUT.STEP) === 0) { g.ex.set_pref(3, 0); g.ex.set_pref(4, 1); }
    // (a broke farm is the economy, not the guide: seed money so the hints can be followed)
    if (g.cash() < 300) g.ex.t_set_cash(300);
    if (g.ui(UI.SCR) !== SCR.FARM) g.key(KEY.ESC);
    const n = follow(g, 400);
    assert.ok(n < 400, `seed ${seed}: following the hints finishes (step ${g.tut(TUT.STEP)}: ${g.text()}; cash ${g.cash()} day ${new DataView(g.ex.memory.buffer).getUint16(STATE.base + STATE.fields.day.off, true)} code ${g.tut(TUT.CODE).toString(16)} toasts ${g.toasts()} scr ${g.ui(UI.SCR)})`);
    assert.equal(g.tut(TUT.DONE), 1);
  }
});

// Merge with Task 7c (set_now clock, overlay panel absorbing taps): the loader stamps every input
// with set_now() and may not call frame() between events; the stats overlay over a screen absorbs
// taps through its body, on the farm it leaves the tutorial card and SKIP usable.
test('merge 7c: set_now-stamped taps drive the tutorial; the overlay keeps the card / SKIP working on the farm', async () => {
  const g = await tutGame();
  // plant via set_now-only taps (frames only after each event, as the loader schedules)
  const at = (x, y) => { const t = g.t += 5000; g.ex.set_now(t); g.ex.pointer(x, y, 0); g.ex.set_now(t + 40); g.ex.pointer(x, y, 2); g.ex.frame(t + 56); };
  const i = g.tut(TUT.CODE) & 63;
  at(...g.tileCss(i)); g.settle();
  const w = g.tut(TUT.CODE);
  const r = g.hit(w);
  assert.ok(r, 'the plot sheet target');
  at(...g.toCss(r.x + (r.w >> 1), r.y + (r.h >> 1))); g.settle();
  assert.equal(g.tut(TUT.FACTS) & 1, 1, 'plant fact');
  // the stats overlay opens (Backquote); the card and SKIP stay reachable on the farm
  g.key(KEY.BACKQUOTE); g.settle();
  assert.equal(g.ex.t_ovl(0), 1);
  assert.ok(g.hit(TB.SKIP), 'SKIP still registered');
  const before = simBytes(g);
  g.tap(TB.SKIP); g.settle();
  assert.equal(g.tut(TUT.DONE), 1);
  assert.deepEqual(simBytes(g), before);
});

test('ALL SET left open, then a NEW GAME (a shared link opens the Title): the card does not come back (done)', async () => {
  const g = await tutGame();
  g.ex.set_pref(4, 7); g.settle();
  assert.equal(g.tut(TUT.STEP), 7);
  assert.equal(g.tut(TUT.DONE), 1);
  assert.equal(g.load(CODES.BOT40), 0); g.settle();
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  g.tap(OVL.NEW); g.t += 500; g.tap(OVL.NEW); g.settle();
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.equal(g.tut(TUT.STEP), 0);
  assert.equal(g.hit(TB.SKIP), undefined);
});
