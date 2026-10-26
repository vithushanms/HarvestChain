// Spec 14.2 item 4 (final review I2): the loader forwards mouse wheel / trackpad deltas (CSS px) to
// wheel(dx, dy), which scrolls the open sheet / side panel / screen card the way a drag would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGame } from '../helpers.mjs';
import { uiState, UI, KEY } from './uistates.mjs';

const scroll = (g) => g.ui(UI.SCROLL), max = (g) => g.ui(UI.SCROLL_MAX);
const wheel = (g, dy, dx = 0) => { g.ex.set_now(g.t); g.ex.wheel(dx, dy); g.frame(); };

test('wheel scrolls a long tab body down and up, clamped to [0, scroll_max]', async () => {
  const g = await uiState('ui-build-tab');
  assert.ok(max(g) > 0, 'the Build tab overflows');
  assert.equal(scroll(g), 0);
  wheel(g, 40);
  assert.equal(scroll(g), Math.min(max(g), g.ex.t_css_to_fb_y(40)));
  wheel(g, -15);
  assert.equal(scroll(g), Math.min(max(g), g.ex.t_css_to_fb_y(40)) - g.ex.t_css_to_fb_y(15));
  wheel(g, 100000);
  assert.equal(scroll(g), max(g));
  wheel(g, -100000);
  assert.equal(scroll(g), 0);
});

test('wheel matches a drag of the same distance', async () => {
  const a = await uiState('ui-build-tab'), b = await uiState('ui-build-tab');
  wheel(a, 30);
  const p = b.hit(5), [x, y] = b.toCss(p.x + 3, p.y + (p.h >> 1));   // HIT.PANEL
  b.down(x, y); b.ex.pointer(x, y - 30, 1); b.up(x, y - 30);
  assert.equal(scroll(a), scroll(b));
});

test('wheel scrolls a screen card (Journal) and does nothing where nothing overflows', async () => {
  const g = await uiState('ui-journal-large', 1280, 720, 100);   // laptop: a wheel is likely there
  assert.ok(max(g) > 0, 'the large-text Journal overflows');
  wheel(g, 60);
  assert.ok(scroll(g) > 0);
  const f = await uiState('ui-farm');
  assert.equal(max(f), 0);
  wheel(f, 60);
  assert.equal(scroll(f), 0);
  assert.equal(f.ex.frame(f.t += 16), 0, 'no redraw for a no-op wheel');
});

test('wheel is ignored while a press / drag is active, and horizontal deltas do nothing', async () => {
  const g = await uiState('ui-build-tab');
  const p = g.hit(5), [x, y] = g.toCss(p.x + 3, p.y + (p.h >> 1));
  g.down(x, y);
  wheel(g, 50);
  assert.equal(scroll(g), 0, 'no wheel scroll under a held press');
  g.up(x, y);
  wheel(g, 0, 80);
  assert.equal(scroll(g), 0);
});

test('shipping binary exports wheel(dx, dy)', async () => {
  const names = WebAssembly.Module.exports(new WebAssembly.Module(readFileSync('build/game.wasm'))).map((e) => e.name);
  assert.ok(names.includes('wheel'));
  const { ex } = await loadGame('build/game.wasm');
  ex.resize(360, 640, 200); ex.ui_new_game(5); ex.frame(1000);
  assert.doesNotThrow(() => { ex.key(KEY.J, 1); ex.key(KEY.J, 0); ex.wheel(0, 50); ex.frame(1016); });
});
