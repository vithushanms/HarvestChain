// Final review I1: a zero CSS width / height (display:none iframe, prerender, a rotation in
// flight) must never make frame() / pointer() / key() trap (it used to divide by zero in $cu).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers.mjs';
import { UI_STATE_LIST, uiState } from './uistates.mjs';

const ZERO = [[0, 640], [360, 0], [0, 0], [0, 400], [1, 1]];

// Resize to a degenerate size, frame, poke input, frame, then come back to a real size.
const poke = (ex, t, w, h) => {
  ex.resize(w, h, 200); ex.frame(t + 16);
  ex.pointer(0, 0, 0); ex.frame(t + 32); ex.pointer(0, 0, 2); ex.frame(t + 48);
  ex.key(9, 1); ex.key(9, 0); ex.frame(t + 64);
  ex.resize(360, 640, 200); ex.frame(t + 80);
};

test('every UI state survives resize(0,h) / (w,0) / (0,0) then frame() and input (test binary)', async () => {
  for (const [name] of UI_STATE_LIST) {
    for (const [w, h] of ZERO.slice(0, 3)) {
      const g = await uiState(name);
      assert.doesNotThrow(() => poke(g.ex, 1e6, w, h), `${name} at ${w}x${h}`);
      assert.ok(g.ex.t_canary_ok(), `${name} at ${w}x${h}: canary`);
    }
  }
});

test('shipping binary: Title, farm and sheets survive a zero CSS size', async () => {
  for (const [w, h] of ZERO) {
    const g = await loadGame('build/game.wasm');
    const { ex } = g;
    let t = 1000;
    // zero size before the first frame (the boot window), then the Title
    ex.resize(w, h, 200); ex.ui_boot(0);
    assert.doesNotThrow(() => ex.frame(t += 16), `boot at ${w}x${h}`);
    ex.resize(360, 640, 200); ex.frame(t += 16);
    assert.doesNotThrow(() => poke(ex, t += 100, w, h), `title at ${w}x${h}`);
    ex.ui_new_game(5); ex.frame(t += 100);
    assert.doesNotThrow(() => poke(ex, t += 100, w, h), `farm at ${w}x${h}`);
    ex.pointer(180, 330, 0); ex.frame(t += 16); ex.pointer(180, 330, 2);
    for (let i = 0; i < 30; i++) ex.frame(t += 16);
    assert.doesNotThrow(() => poke(ex, t += 100, w, h), `sheet at ${w}x${h}`);
    ex.key(17, 1); ex.key(17, 0); ex.frame(t += 16);   // Journal
    assert.doesNotThrow(() => poke(ex, t += 100, w, h), `journal at ${w}x${h}`);
    assert.ok(ex.fb_w() > 0 && ex.fb_h() > 0);
  }
});
