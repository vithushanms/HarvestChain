// UI robustness (Task 5a fix round 1): crash fixes, input timing, key repeat, contrast,
// scroll clamping and laptop panel placement. Everything is driven through the public
// exports in CSS px (tests/render/uistates.mjs); t_* hooks only observe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readState } from '../helpers.mjs';
import { farm, CROP, BLD } from './scenes.mjs';
import { uiGame, HIT, BTN, UI } from './uistates.mjs';

const TOASTS = 0x8D10;
const day = (g) => readState(g.mem()).day;
const dv = (g) => new DataView(g.ex.memory.buffer);
const CROPS = ['WHEAT', 'CORN', 'TOMATO', 'APPLE', 'GRAPE'];
// Press and release at the centre of a hit region with no frame in between.
const press = (g, code) => {
  const r = g.hit(code);
  if (!r) throw new Error(`no hit region 0x${code.toString(16)}`);
  const [x, y] = g.toCss(r.x + (r.w >> 1), r.y + (r.h >> 1));
  g.ex.pointer(x, y, 0); g.ex.pointer(x, y, 2);
};

test('harvesting a ripe Greenhouse crop of every kind through the sheet: no trap, crop named, save requested', async () => {
  for (let c = 0; c < 5; c++) {
    const g = await uiGame(360, 640, 200, { setup: (ex) => farm(ex).bld(9, BLD.GREENHOUSE, { gh: c + 1, progress: 900 }) });
    g.tapTile(9);
    assert.equal(g.btn(BTN.HARVEST).en, 1, CROPS[c]);
    g.tap(BTN.HARVEST);
    assert.equal(g.announce(), `HARVESTED ${CROPS[c]}`);
    assert.equal(g.ex.need_save(), 1, CROPS[c]);
    g.settle();
    assert.ok(g.ex.t_canary_ok());
  }
});

test('$str: ids outside the table give an empty string', async () => {
  const g = await uiGame();
  for (const id of [-1, -5, 128, 9999, 0x7FFFFFFF]) assert.equal(g.str(g.ex.t_str(id)), '', `id ${id}`);
  assert.equal(g.str(g.ex.t_str(0)), 'WHEAT');
});

test('long-press on any plot touches only the toast table (no stray toast slots past it)', async () => {
  for (const t of [9, 0, 27, 63]) {
    const g = await uiGame(360, 640, 200);
    g.settle();
    const [x, y] = g.tileCss(t);
    const lx = Math.floor((x * g.ex.fb_w()) / 360), ly = Math.floor((y * g.ex.fb_h()) / 640);
    const li = g.ex.t_tile_at(lx, ly), onGrid = g.ex.t_hit_test(lx, ly) === HIT.GRID;
    // markers where a toast loop that started at the tile index would land (index 3..63)
    const slots = [li, 9, 27, 63].filter((i) => i >= 3);
    for (const i of slots) { dv(g).setInt32(TOASTS + i * 64, -1, true); dv(g).setInt32(TOASTS + i * 64 + 4, 7, true); }
    g.ex.pointer(x, y, 0);
    for (let i = 0; i < 25; i++) g.frame(16);
    g.ex.pointer(x, y, 2);
    for (let i = 0; i < 5; i++) g.frame(16);
    for (const i of slots) {
      assert.equal(dv(g).getInt32(TOASTS + i * 64, true), -1, `tile ${t}: slot ${i} word 0`);
      assert.equal(dv(g).getInt32(TOASTS + i * 64 + 4, true), 7, `tile ${t}: slot ${i} word 1`);
    }
    if (li >= 0 && onGrid) assert.ok(g.toasts().some((s) => s.startsWith('PLOT')), `tile ${t}: info toast`);
    for (let i = 0; i < 3; i++) assert.ok(dv(g).getInt32(TOASTS + i * 64 + 4, true) <= 3, 'toast kinds valid');
    assert.ok(g.ex.t_canary_ok());
  }
});

test('$toast_drop is safe for any slot index', async () => {
  const g = await uiGame();
  for (const i of [-1, 3, 9, 63, 0x7FFFFFFF]) g.ex.t_toast_drop(i);
  g.frame();
  assert.ok(g.ex.t_canary_ok());
});

// Deterministic xorshift32.
const rng = (s) => () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
test('fuzz: 5k random pointer / key / frame steps at two sizes never trap', async () => {
  for (const [w, h, d, seed] of [[360, 640, 200, 7], [1280, 800, 100, 11]]) {
    const r = rng(seed);
    const g = await uiGame(w, h, d, { setup: (ex) => farm(ex).bld(10, BLD.MILL).bld(2, BLD.GREENHOUSE, { gh: 2, progress: 900 }).crop(1, CROP.WHEAT, 'ripe') });
    let px = 0, py = 0;
    for (let step = 0; step < 5000; step++) {
      const k = r() % 10;
      try {
        if (k < 3) { px = r() % w; py = r() % h; g.ex.pointer(px, py, 0); }
        else if (k < 5) { px += (r() % 41) - 20; py += (r() % 41) - 20; g.ex.pointer(px, py, 1); }
        else if (k < 7) g.ex.pointer(px, py, 2);
        else if (k < 8) g.ex.key(r() % 18, r() % 3);
        else g.ex.frame(g.t += r() % 700);
        if (step % 997 === 0) g.ex.t_set_cash(5000);
      } catch (e) {
        assert.fail(`${w}x${h} step ${step} (kind ${k}): ${e.message}`);
      }
      if (step % 250 === 0) {
        for (let i = 0; i < 3; i++) assert.ok(dv(g).getUint32(TOASTS + i * 64 + 4, true) <= 3, `${w}x${h} step ${step} toast kinds`);
        assert.ok(g.ex.t_canary_ok());
      }
    }
  }
});

test('demolish: the confirming tap is ignored for 400 ms after arming, live until 3 s', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => farm(ex).bld(10, BLD.MILL) });
  g.tapTile(10);
  press(g, BTN.DEMOLISH);           // arm
  g.frame(16);                      // arming time stamped here (T0)
  assert.equal(g.ui(UI.ARM), BTN.DEMOLISH);
  assert.equal(g.btn(BTN.DEMOLISH).label, 'TAP AGAIN');
  g.frame(90);                      // T0 + 90
  press(g, BTN.DEMOLISH);
  g.frame(16);
  assert.equal(g.tile(10), 2, 'a double tap at +90 ms does nothing');
  assert.equal(g.ui(UI.ARM), BTN.DEMOLISH, 'still armed');
  g.frame(400);                     // T0 + 506
  press(g, BTN.DEMOLISH);
  assert.equal(g.tile(10), 0, 'confirmed at +500 ms');
  assert.match(g.announce(), /CLEARED MILL/);
  // disarmed after 3 s: a tap at +3.2 s arms again
  const h = await uiGame(360, 640, 200, { setup: (ex) => farm(ex).bld(10, BLD.MILL) });
  h.tapTile(10);
  press(h, BTN.DEMOLISH);
  h.frame(16);
  for (let i = 0; i < 16; i++) h.frame(200);   // T0 + 3200
  assert.equal(h.ui(UI.ARM), 0);
  press(h, BTN.DEMOLISH);
  assert.equal(h.tile(10), 2, 'a tap after the timeout only re-arms');
  assert.equal(h.ui(UI.ARM), BTN.DEMOLISH);
});

test('demolish arm under reduced motion: frame keeps returning non-zero while armed, then disarms', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true, setup: (ex) => farm(ex).bld(10, BLD.MILL) });
  g.tapTile(10);
  g.tap(BTN.DEMOLISH);
  assert.equal(g.ui(UI.ARM), BTN.DEMOLISH);
  assert.notEqual(g.frame(), 0, 'armed: loader must keep calling frame');
  let c;
  for (let i = 0; i < 40; i++) c = g.frame(100);
  assert.equal(g.ui(UI.ARM), 0, 'disarmed after 3 s');
  assert.equal(g.btn(BTN.DEMOLISH).label, 'DEMOLISH');
  c = g.frame();
  assert.equal(c, 0);
});

test('reduced motion: a visible toast asks for low-rate frames (2), not full rate', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true });
  g.frame();
  g.tap(HIT.DAY);
  assert.equal(g.ui(UI.TOASTS), 1);
  assert.equal(g.frame(), 2);
  for (let i = 0; i < 40; i++) g.frame(100);
  assert.equal(g.ui(UI.TOASTS), 0);
  assert.equal(g.frame(), 0);
});

test('holding a button for 400 ms still activates it on release (long press is for plots only)', async () => {
  const g = await uiGame();
  g.frame();
  const r = g.hit(HIT.ENDDAY);
  const [x, y] = g.toCss(r.x + (r.w >> 1), r.y + (r.h >> 1));
  g.ex.pointer(x, y, 0);
  for (let i = 0; i < 25; i++) g.frame(16);
  g.ex.pointer(x, y, 2); g.frame();
  assert.equal(day(g), 2);
  // released outside the button (still within slop of a small button edge): no tap
  const h = await uiGame();
  h.frame();
  const q = h.hit(HIT.ENDDAY);
  const [qx, qy] = h.toCss(q.x + 1, q.y + 1);
  h.ex.pointer(qx, qy, 0); h.frame();
  h.ex.pointer(qx - 6, qy - 6, 2); h.frame();
  assert.equal(day(h), 1, 'release outside the pressed button cancels');
});

test('key auto-repeat is ignored: one action per press, down values other than 0 count as down', async () => {
  const g = await uiGame();
  g.ex.key(1, 1); g.ex.key(1, 1); g.ex.key(1, 1); g.frame();
  assert.equal(day(g), 2);
  g.ex.key(1, 0);
  g.ex.key(1, 2); g.ex.key(1, 2); g.frame();
  assert.equal(day(g), 3);
  g.ex.key(1, 0); g.ex.key(1, 1); g.ex.key(1, 0); g.frame();
  assert.equal(day(g), 4);
  // keys are independent: E held does not block H
  g.ex.key(1, 1); g.ex.key(8, 1); g.ex.key(8, 0); g.ex.key(1, 0);
  assert.equal(day(g), 5);
});
