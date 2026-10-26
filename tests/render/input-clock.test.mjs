// Fix round 1 (task 7c): every time-based input rule reads one clock ($now). The loader calls
// set_now(performance.now()) right before each pointer() / key(), because frame() stops being called
// when the game is idle (prefers-reduced-motion), which left $now stale at the first down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uiGame, BTN, UI, KEY } from './uistates.mjs';
import { farm, BLD } from './scenes.mjs';

const OV_ON = 0;
// a tap with no frame() in between: only the clock is set, as the loader does
// (a frame runs after each call, as the loader schedules one after every input; the clock before the first down is stale)
const tapAt = (g, t, x, y) => { g.ex.set_now(t); g.ex.pointer(x, y, 0); g.ex.frame(t + 16); g.ex.set_now(t + 40); g.ex.pointer(x, y, 2); g.ex.frame(t + 56); };
const tapHit = (g, t, code) => { const r = g.hit(code); tapAt(g, t, ...g.toCss(r.x + (r.w >> 1), r.y + (r.h >> 1))); };

test('triple tap works from idle under prefers-reduced-motion: only set_now (no frame) precedes each down', async () => {
  for (const reduced of [true, false]) {
    const g = await uiGame(360, 640, 200, { reduced });
    g.settle();
    for (let i = 0; i < 5; i++) g.ex.frame(g.t += 1000);        // idle: the loader stops calling frame()
    const t0 = g.t + 20000;                                      // far later than the last frame
    tapAt(g, t0, 10, 12); tapAt(g, t0 + 150, 10, 12);
    assert.equal(g.ex.t_ovl(OV_ON), 0, 'two taps');
    g.ex.set_now(t0 + 300); g.ex.pointer(10, 12, 0);
    assert.equal(g.ex.t_ovl(OV_ON), 1, `third tap 150 ms apart opens (reduced=${reduced})`);
  }
});

test('triple tap spread over more than 600 ms (set_now timestamps) does not open', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true });
  g.settle();
  const t0 = g.t + 20000;
  tapAt(g, t0, 10, 12); tapAt(g, t0 + 400, 10, 12);
  g.ex.set_now(t0 + 800); g.ex.pointer(10, 12, 0);
  assert.equal(g.ex.t_ovl(OV_ON), 0);
});

test('demolish: the 400 ms arm delay is measured with set_now timestamps, no frames in between', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true, setup: (ex) => farm(ex).bld(10, BLD.MILL) });
  g.tapTile(10);
  for (let i = 0; i < 5; i++) g.ex.frame(g.t += 1000);
  const t0 = g.t + 50000;
  tapHit(g, t0, BTN.DEMOLISH);
  assert.equal(g.ui(UI.ARM), BTN.DEMOLISH, 'armed');
  tapHit(g, t0 + 150, BTN.DEMOLISH);
  assert.equal(g.tile(10), 2, 'a second tap at +150 ms is ignored');
  assert.equal(g.ui(UI.ARM), BTN.DEMOLISH, 'still armed');
  tapHit(g, t0 + 450, BTN.DEMOLISH);
  assert.equal(g.tile(10), 0, 'confirmed at +450 ms');
});

test('a held press keeps frames coming (long press and its timer need them), also under reduced motion', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true, setup: (ex) => farm(ex).bld(10, BLD.MILL) });
  g.settle();
  assert.equal(g.frame(), 0, 'idle');
  const [x, y] = g.tileCss(10);
  g.ex.set_now(g.t + 10); g.ex.pointer(x, y, 0);
  assert.equal(g.frame(16), 1, 'finger down: animating');
  g.frame(300);
  assert.equal(g.ui(UI.IN_ST), 1);
  g.ex.pointer(x, y, 2);
  assert.ok(g.toasts().length > 0, 'the long press showed the tile info');
});

test('set_now only sets the clock: no state, no log, no redraw', async () => {
  const g = await uiGame(360, 640, 200, {});
  g.settle();
  const before = g.ui(UI.DIRTY);
  g.ex.set_now(123456);
  assert.equal(g.ui(UI.DIRTY), before);
  void KEY;
});
