// Render purity (Task 8b): a frame is a function of (sim state, UI state, size, flags, time) only.
// Every canned UI state and scene renders to the same bytes in a fresh instance and in one "dirty"
// instance that has drawn other states before (two orders, resizes and memory.grow in between):
// no scratch buffer, text builder, hit table, draw list, QR matrix or iso global may leak from one
// screen into the next.
//
// Session-scoped by design (normalised before each state, both fresh and dirty): the page origin
// (set_origin), the loader's measured metrics (set_metrics; the frame-time ring is refilled by the
// states that show it), the tutorial step (set_pref 4) and the stats overlay toggle. memory.size is
// shown live by the overlay and never shrinks, so every instance is grown to the maximum first.
// The replay-viewer states keep a pending shared run (WATCH SHARED RUN) for the session: they are
// compared fresh vs fresh only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadGame } from '../helpers.mjs';
import { UI_STATE_LIST, uiState } from './uistates.mjs';
import { SCENES, drawScene } from './scenes.mjs';

const SIZES = [[360, 640, 200], [1280, 800, 100]];
const SESSION = new Set(['ui-title-watch', 'ui-replay-start', 'ui-replay-mid', 'ui-replay-invalid']);
const hash = (g) => createHash('sha256').update(g.mem().slice(g.ex.fb_ptr(), g.ex.fb_ptr() + g.ex.fb_w() * g.ex.fb_h() * 4)).digest('hex');
const grown = async () => { const g = await loadGame(); g.ex.resize(1280, 539, 100); return g; };   // the largest framebuffer (44 pages)
const norm = (ex) => {
  ex.set_origin(0); ex.set_metrics(0, 0, 0, 0, 0, 0); ex.set_pref(4, 0);
  if (ex.t_ovl(0)) { ex.key(14, 1); ex.key(14, 0); }
};
const scene = (g, n) => {
  g.ex.resize(360, 640, 100); g.ex.set_flags(0, 0); g.ex.t_scene_viewport(0, 0, 0, 0); g.ex.ui_new_game(5);
  SCENES[n](g.ex); drawScene(g, 1000); return hash(g);
};
const ui = async (g, n, s) => { norm(g.ex); return hash(await uiState(n, ...s, g)); };

test('every UI state renders identically in a fresh instance, twice', async () => {
  for (const [n] of UI_STATE_LIST) for (const s of SIZES) {
    assert.equal(await ui(await grown(), n, s), await ui(await grown(), n, s), `${n} ${s.join('x')}`);
  }
});

test('UI states and scenes: fresh == dirty instance, forward and reverse order, with resizes between', async () => {
  const items = [];
  for (const [n] of UI_STATE_LIST) if (!SESSION.has(n)) for (const s of SIZES) items.push(['ui', n, s]);
  for (const n of Object.keys(SCENES)) items.push(['scene', n]);
  const ref = new Map();
  for (const it of items) ref.set(it, it[0] === 'ui' ? await ui(await grown(), it[1], it[2]) : scene(await grown(), it[1]));
  const uis = items.filter((it) => it[0] === 'ui'), scs = items.filter((it) => it[0] === 'scene');
  const mixed = uis.flatMap((it, i) => [it, scs[i % scs.length]]);   // a scene right after every UI state
  for (const order of [items, [...items].reverse(), mixed]) {
    const g = await grown();
    let k = 0;
    for (const it of order) {
      if (k++ % 5 === 4) { g.ex.resize(320 + (k % 7) * 97, 568, 100 + (k % 3) * 100); g.ex.frame(1); }   // other layouts between
      const v = it[0] === 'ui' ? await ui(g, it[1], it[2]) : scene(g, it[1]);
      assert.equal(v, ref.get(it), `${it[0]} ${it[1]} ${it[2]?.join('x') ?? ''} after ${k - 1} other renders`);
    }
  }
});
