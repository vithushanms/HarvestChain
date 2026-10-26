import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadGame, readState, mergeGolden } from '../helpers.mjs';
import { SCENES, sceneGame, drawScene, farm, CROP, BLD, W, GROW } from './scenes.mjs';
import { generate as genModels, extract as extractModels } from '../../tools/gen-models.mjs';

const R_FB = 0x18000;
const GOLDEN = 'tests/render/golden-render.json';
const SIZES = [[360, 640], [1280, 800]];
const GOLDEN_SCENES = ['farm-day1', 'farm-mid', 'farm-winter', 'farm-storm', 'farm-allbld', 'farm-full',
  'farm-truck', 'farm-frost', 'farm-ripe', 'farm-rain', 'farm-drought', 'farm-heat', 'farm-autumn', 'farm-spring'];
const fbHash = (g) => createHash('sha256').update(g.mem().subarray(R_FB, R_FB + g.ex.fb_w() * g.ex.fb_h() * 4)).digest('hex');
const rect = (g, i) => [0, 1, 2, 3].map((k) => g.ex.t_tile_rect(i, k));
// Number of differing pixels between two framebuffer snapshots.
const diffPx = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
const snap = (g) => g.mem().slice(R_FB, R_FB + g.ex.fb_w() * g.ex.fb_h() * 4);

async function emptyFarm(w, h, grid = 4) {
  const g = await loadGame();
  g.ex.resize(w, h, 100);
  g.ex.t_scene_viewport(0, 0, 0, 0);   // default fit (layout tests cover the GRID viewport)
  g.ex.init(2);
  farm(g.ex).clear().grid(grid).day(25);
  return g;
}

test('committed model table matches tools/gen-models.mjs (no drift)', () => {
  assert.equal(extractModels(), genModels());
});

test('scene goldens: >= 8 canned scenes at 360x640 and 1280x800', async () => {
  const hashes = {};
  for (const name of GOLDEN_SCENES) for (const [w, h] of SIZES) {
    const g = await sceneGame(name, w, h);
    assert.equal(g.ex.t_canary_ok(), 1, `${name} canary`);
    hashes[`${name}-${g.ex.fb_w()}x${g.ex.fb_h()}`] = fbHash(g);
  }
  assert.ok(Object.keys(hashes).length >= 16);
  if (process.env.UPDATE_GOLDEN === '1') mergeGolden(GOLDEN, hashes);
  assert.ok(existsSync(GOLDEN), `${GOLDEN} is missing: run with UPDATE_GOLDEN=1 to create it, then review and commit`);
  const gold = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  for (const [k, v] of Object.entries(hashes)) assert.equal(v, gold[k], `golden ${k} (UPDATE_GOLDEN=1 after a deliberate art change)`);
});

test('scene draw is read-only: memory below the framebuffer (sim state, RNG word) unchanged', async () => {
  for (const name of Object.keys(SCENES)) for (const [w, h] of SIZES) {
    const g = await loadGame();
    g.ex.resize(w, h, 100);
    SCENES[name](g.ex);
    const before = g.mem().slice(0, R_FB);
    drawScene(g, 777, { sel: 9, hover: 10 });
    drawScene(g, 4321);
    g.ex.t_tile_at(w >> 1, h >> 1);
    const after = g.mem().slice(0, R_FB);
    assert.ok(Buffer.compare(Buffer.from(before), Buffer.from(after)) === 0, `${name} ${w}x${h} wrote below R_FB`);
    assert.equal(g.ex.t_canary_ok(), 1);
  }
});

test('same state + time + size -> identical framebuffer', async () => {
  for (const name of ['farm-mid', 'farm-storm']) {
    const a = fbHash(await sceneGame(name, 360, 640, 2500));
    const b = fbHash(await sceneGame(name, 360, 640, 2500));
    assert.equal(a, b);
    const g = await sceneGame(name, 360, 640, 2500);
    drawScene(g, 2500);
    assert.equal(fbHash(g), a, 'redraw over an old frame is identical');
  }
});

test('apple: bare in winter, mature apple shows full tree; rotting tomato differs from fresh', async () => {
  const draw = async (fn) => { const g = await emptyFarm(360, 640); fn(farm(g.ex)); drawScene(g, 0, { reduced: true }); return fbHash(g); };
  const summer = await draw((f) => f.crop(9, CROP.APPLE, 700));
  const winter = await draw((f) => f.day(70).crop(9, CROP.APPLE, 700));
  const wEmpty = await draw((f) => f.day(70));
  const sEmpty = await draw(() => {});
  assert.notEqual(summer, winter);
  assert.notEqual(winter, wEmpty);
  assert.notEqual(summer, sEmpty);
  const fresh = await draw((f) => f.crop(9, CROP.TOMATO, 'ripe'));
  const rot = await draw((f) => f.crop(9, CROP.TOMATO, 'ripe', { ripeAge: 1 }));
  assert.notEqual(fresh, rot);
  const young = await draw((f) => f.crop(9, CROP.APPLE, 50));
  const mature = await draw((f) => f.crop(9, CROP.APPLE, 50, { mature: true }));
  assert.notEqual(young, mature, 'a mature (regrowing) apple is drawn as a full tree');
});

test('buildings: each of the 10 models differs, upgraded and recipe-active variants differ', async () => {
  const draw = async (b, o = {}) => { const g = await emptyFarm(360, 640); farm(g.ex).bld(9, b, o); drawScene(g, 0, { reduced: true }); return fbHash(g); };
  const base = [];
  for (let b = 0; b < 10; b++) base.push(await draw(b));
  assert.equal(new Set(base).size, 10);
  for (let b = 0; b < 10; b++) assert.notEqual(await draw(b, { upgraded: true }), base[b], `building ${b} upgraded`);
  for (const b of [BLD.MILL, BLD.CANNERY, BLD.PRESS, BLD.BAKERY, BLD.CELLAR]) assert.notEqual(await draw(b, { recipe: 1 }), base[b], `building ${b} active`);
  assert.notEqual(await draw(BLD.GREENHOUSE, { gh: CROP.TOMATO + 1, progress: 100 }), base[BLD.GREENHOUSE], 'greenhouse crop visible');
});

test('trucks: home, away (both legs) and fridge/fast variants are all drawn differently', async () => {
  const draw = async (o) => { const g = await emptyFarm(360, 640); farm(g.ex).truck(0, o); drawScene(g, 0, { reduced: true }); return fbHash(g); };
  const hs = [await draw({}), await draw({ fridge: true }), await draw({ fast: true }),
    await draw({ phase: 1, dest: 2, daysLeft: 2 }), await draw({ phase: 1, dest: 2, daysLeft: 1 }), await draw({ phase: 2, dest: 2, daysLeft: 1 })];
  assert.equal(new Set(hs).size, hs.length);
});

test('weather: every weather draws a different frame', async () => {
  const hs = new Set();
  for (const w of Object.values(W)) {
    const g = await emptyFarm(360, 640);
    farm(g.ex).weather(w).crop(0, CROP.WHEAT, 100);
    drawScene(g, 1500);
    hs.add(fbHash(g));
  }
  assert.equal(hs.size, 6);
});

test('seasons: each season draws a different frame', async () => {
  const hs = new Set();
  for (const d of [5, 25, 45, 65]) {
    const g = await emptyFarm(360, 640);
    farm(g.ex).day(d).crop(0, CROP.APPLE, 'ripe', { mature: true });
    drawScene(g, 0, { reduced: true });
    hs.add(fbHash(g));
  }
  assert.equal(hs.size, 4);
});

test('reduced motion: frame independent of time (no particles/sparkle/drift); animated otherwise', async () => {
  // Defined as: with reduced = 1 the frame at any time equals the frame at t = 0.
  for (const name of ['farm-storm', 'farm-ripe', 'farm-mid', 'farm-autumn', 'farm-drought']) {
    const r0 = fbHash(await sceneGame(name, 360, 640, 0, { reduced: true }));
    const r1 = fbHash(await sceneGame(name, 360, 640, 4321, { reduced: true }));
    const r2 = fbHash(await sceneGame(name, 360, 640, 98765, { reduced: true }));
    assert.equal(r0, r1, `${name}: reduced motion must not depend on time`);
    assert.equal(r0, r2);
    const a = fbHash(await sceneGame(name, 360, 640, 1000));
    const b = fbHash(await sceneGame(name, 360, 640, 2700));
    assert.notEqual(a, b, `${name}: frames at two times differ when motion is on`);
    assert.notEqual(fbHash(await sceneGame(name, 360, 640, 4321)), r1, `${name}: reduced removes motion`);
  }
});

test('storage full: a ripe tile shows a different badge when storage cannot take the harvest', async () => {
  const draw = async (full) => {
    const g = await emptyFarm(360, 640);
    const f = farm(g.ex).crop(9, CROP.WHEAT, 'ripe');
    if (full) f.fillStorage();
    drawScene(g, 0, { reduced: true });
    return fbHash(g);
  };
  assert.notEqual(await draw(false), await draw(true));
});

test('selection and hover highlights change the frame', async () => {
  const hs = new Set();
  for (const o of [{}, { sel: 5 }, { hover: 5 }, { sel: 6 }]) {
    const g = await sceneGame('farm-mid', 360, 640, 0, { reduced: true, ...o });
    hs.add(fbHash(g));
  }
  assert.equal(hs.size, 4);
});

test('tile rects: inside the framebuffer, non-overlapping centres, tile_at(centre) = tile', async () => {
  for (const [w, h] of [...SIZES, [720, 1280], [1440, 900]]) for (const grid of [4, 6, 8]) {
    const g = await emptyFarm(w, h, grid);
    drawScene(g, 0);
    const W = g.ex.fb_w(), Hh = g.ex.fb_h();
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
      const i = y * 8 + x;
      const [rx, ry, rw, rh] = rect(g, i);
      assert.ok(rx >= 0 && ry >= 0 && rx + rw <= W && ry + rh <= Hh, `${w}x${h} g${grid} tile ${i} rect ${[rx, ry, rw, rh]} inside`);
      assert.ok(rw >= 2 * rh - 2 && rw <= 2 * rh + 2 && rw > 16, `diamond 2:1 (${rw}x${rh})`);
      assert.equal(g.ex.t_tile_at(rx + (rw >> 1), ry + (rh >> 1)), i, `${w}x${h} g${grid} tile_at centre of ${i}`);
    }
    assert.equal(g.ex.t_tile_at(2, 2), -1, 'sky is not a tile');
    assert.equal(g.ex.t_tile_at(-5, 10), -1);
    assert.equal(g.ex.t_tile_at(W + 5, Hh >> 1), -1);
  }
});

test('8x8 grid on a 360px-wide phone: tiles at least 38px wide', async () => {
  const g = await emptyFarm(360, 640, 8);
  drawScene(g, 0);
  assert.ok(rect(g, 0)[2] >= 38, `tile width ${rect(g, 0)[2]}`);
});

function idxOf(x, y) { return y * 8 + x; }

test('viewport: an explicit rect places the farm inside it', async () => {
  const g = await emptyFarm(1280, 800, 6);
  g.ex.t_scene_viewport(700, 100, 560, 600);
  drawScene(g, 0);
  for (let i = 0; i < 64; i++) {
    if ((i & 7) >= 6 || (i >> 3) >= 6) continue;
    const [rx, ry, rw, rh] = rect(g, i);
    assert.ok(rx >= 700 && rx + rw <= 1260 && ry >= 100 && ry + rh <= 700, `tile ${i} in viewport`);
  }
});

// ---------------------------------------------------------------- fix round 1 (Task 3 review)

// Ground tile of a pixel (pixel-centre inverse projection, same maths as $tile_at's ground
// step). Projection origin from tile 0's rect: top vertex = (ox, oy), width = 2 hw.
function groundMap(g) {
  const [rx, ry, rw] = rect(g, 0);
  const hw = rw >> 1, ox = rx + hw, oy = ry, D = 64 * hw;
  return (px, py) => {
    const cx = 2 * (px - ox) + 1, cy = 2 * (py - oy) + 1;
    const u = 16 * cx + 32 * cy, v = 32 * cy - 16 * cx;
    if (u < 0 || v < 0) return -1;
    const tx = Math.floor(u / D), ty = Math.floor(v / D);
    return tx < 8 && ty < 8 ? ty * 8 + tx : -1;
  };
}

test('tile_at: every owned tile keeps >= 30% of its ground diamond and its centre (tall models in front)', async () => {
  for (const name of ['farm-full', 'farm-mid', 'farm-allbld']) for (const [w, h] of [[360, 640], [1280, 800]]) {
    const g = await sceneGame(name, w, h, 0, { reduced: true });
    const W = g.ex.fb_w(), Hh = g.ex.fb_h(), gm = groundMap(g);
    const grid = readState(g.mem()).grid;
    const tot = new Array(64).fill(0), hit = new Array(64).fill(0);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const t = gm(x, y);
      if (t < 0 || (t & 7) >= grid || (t >> 3) >= grid) continue;
      tot[t]++;
      if (g.ex.t_tile_at(x, y) === t) hit[t]++;
    }
    for (let ty = 0; ty < grid; ty++) for (let tx = 0; tx < grid; tx++) {
      const i = ty * 8 + tx;
      assert.ok(tot[i] > 0);
      assert.ok(hit[i] >= 0.3 * tot[i], `${name} ${W}x${Hh} tile ${i}: ${hit[i]}/${tot[i]} ground px map to it`);
      const [rx, ry, rw, rh] = rect(g, i);
      assert.equal(g.ex.t_tile_at(rx + (rw >> 1), ry + (rh >> 1)), i, `${name} ${W}x${Hh} centre of ${i}`);
    }
  }
});

// Crowns / roofs: the part of a tall model drawn above its own ground diamond overhangs the
// tiles behind. $tile_at gives the core (inner 5/8) of every diamond to its own tile (so plots
// behind tall models stay tappable, test above); everywhere else on the overhang inside the
// body box the model's tile wins. Asserted: every overhang pixel outside all cores and inside
// the body box selects the model, >= 35% of all overhang pixels do, and fixed crown probes.
test('tile_at: crowns / roofs of tall models select their own tile', async () => {
  const tall = [['apple', (f, i) => f.crop(i, CROP.APPLE, 100, { mature: true }), 27 - 3],
    ['apple sapling', (f, i) => f.crop(i, CROP.APPLE, 400), 0]];
  for (let b = 0; b < 10; b++) tall.push([`building ${b}`, (f, i) => f.bld(i, b), b === BLD.MILL ? 26 : 0]);
  for (let b = 0; b < 10; b++) tall.push([`building ${b} upgraded`, (f, i) => f.bld(i, b, { upgraded: true }), 0]);
  const T = idxOf(2, 3);
  for (const [w, h] of [[360, 640], [1280, 800]]) {
    const e = await emptyFarm(w, h, 6);
    drawScene(e, 0, { reduced: true });
    const empty = snap(e);
    for (const [name, put, probeZ] of tall) {
      const g = await emptyFarm(w, h, 6);
      put(farm(g.ex), T);
      drawScene(g, 0, { reduced: true });
      const W = g.ex.fb_w(), m = snap(g), [rx, ry, rw] = rect(g, T), hw = rw >> 1, cx = rx + hw;
      const [r0x, r0y] = rect(g, 0), ox = r0x + hw, oy = r0y, D = 64 * hw;
      const inCore = (px, py) => {
        const u = 16 * (2 * (px - ox) + 1) + 32 * (2 * (py - oy) + 1), v = 32 * (2 * (py - oy) + 1) - 16 * (2 * (px - ox) + 1);
        if (u < 0 || v < 0) return false;
        const c = (f) => 8 * Math.abs(2 * (f % D) - D) <= 5 * D;
        return c(u) && c(v);
      };
      let n = 0, ok = 0, ring = 0, ringOk = 0;
      for (let y = 0; y < ry; y++) for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (m[o] === empty[o] && m[o + 1] === empty[o + 1] && m[o + 2] === empty[o + 2]) continue;
        const hit = g.ex.t_tile_at(x, y) === T;
        n++; ok += hit;
        if (!inCore(x, y) && Math.abs(x - cx) * 8 <= 5 * hw) { ring++; ringOk += hit; }
      }
      if (n < 20) continue;   // does not overhang (e.g. the low cellar mound)
      assert.equal(ringOk, ring, `${w}x${h} ${name}: overhang outside the cores selects tile ${T}`);
      assert.ok(ok >= 0.35 * n, `${w}x${h} ${name}: ${ok}/${n} overhang px select tile ${T}`);
      if (probeZ) {
        const py = ry + (rw >> 2) - Math.round(probeZ * hw / 16);
        assert.equal(g.ex.t_tile_at(cx, py), T, `${w}x${h} ${name}: crown probe z=${probeZ}`);
      }
    }
  }
});

test('tile_at: unowned slab tiles return their own index (stable), off-slab -1', async () => {
  for (const [w, h] of SIZES) {
    const g = await emptyFarm(w, h, 4);
    drawScene(g, 0, { reduced: true });
    for (let i = 0; i < 64; i++) {
      if ((i & 7) < 4 && (i >> 3) < 4) continue;
      const [rx, ry, rw, rh] = rect(g, i);
      const cx = rx + (rw >> 1), cy = ry + (rh >> 1);
      if (cx < 0 || cy < 0 || cx >= g.ex.fb_w() || cy >= g.ex.fb_h()) continue;
      assert.equal(g.ex.t_tile_at(cx, cy), i, `${w}x${h} unowned tile ${i}`);
      assert.equal(g.ex.t_tile_at(cx, cy), i, 'stable');
    }
    const gm = groundMap(g);
    let off = 0;
    for (let y = 0; y < g.ex.fb_h(); y += 3) for (const x of [0, g.ex.fb_w() - 1]) {
      if (gm(x, y) >= 0) continue;
      off++;
      assert.equal(g.ex.t_tile_at(x, y), -1, `off-slab (${x},${y})`);
    }
    assert.ok(off > 0);
  }
});

test('tiny framebuffers: scene_draw is fast (horizon never below the framebuffer) and in bounds', async () => {
  for (const [w, h] of [[1, 1], [2, 3], [360, 5], [5, 360]]) for (const name of ['farm-mid', 'farm-storm', 'farm-frost', 'farm-heat']) {
    const g = await loadGame();
    g.ex.resize(w, h, 100);
    SCENES[name](g.ex);
    drawScene(g, 1000);   // warm-up
    const t0 = process.hrtime.bigint();
    drawScene(g, 1000);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 5, `${name} ${g.ex.fb_w()}x${g.ex.fb_h()}: ${ms.toFixed(2)} ms`);
    assert.equal(g.ex.t_canary_ok(), 1);
  }
});

test('0x0 framebuffer (no resize / failed grow): scene_draw and tile_at do not trap', async () => {
  for (const name of ['farm-storm', 'farm-mid', 'farm-frost', 'farm-drought', 'farm-winter']) {
    const g = await loadGame();
    SCENES[name](g.ex);
    assert.equal(g.ex.fb_w() * g.ex.fb_h(), 0);
    for (const t of [0, 90, 1000]) drawScene(g, t);
    assert.equal(g.ex.t_tile_at(0, 0), -1);
  }
});

test('trucks: a returning truck with daysLeft 0 is drawn like daysLeft 1 (no wrap-around)', async () => {
  const draw = async (o) => { const g = await emptyFarm(360, 640); if (o) farm(g.ex).truck(0, o); drawScene(g, 0, { reduced: true }); assert.equal(g.ex.t_canary_ok(), 1); return fbHash(g); };
  const none = await draw(null);
  const d1 = await draw({ phase: 2, dest: 1, daysLeft: 1 });
  const d0 = await draw({ phase: 2, dest: 1, daysLeft: 0 });
  assert.notEqual(d1, none);
  assert.equal(d0, d1);
  assert.notEqual(await draw({ phase: 1, dest: 1, daysLeft: 0 }), none, 'outbound daysLeft 0 still on screen');
});


test('each crop: stages and ripe differ pairwise by >= 20 pixels', async () => {
  for (const c of Object.values(CROP)) {
    const fr = [];
    for (const p of [0, Math.floor(GROW[c] * 0.45), Math.floor(GROW[c] * 0.8), GROW[c]]) {
      const g = await emptyFarm(360, 640);
      farm(g.ex).crop(9, c, p);
      drawScene(g, 0, { reduced: true });
      fr.push(snap(g));
    }
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      const n = diffPx(fr[a], fr[b]);
      assert.ok(n >= 20, `crop ${c}: frames ${a}/${b} differ by ${n} px`);
    }
  }
});
