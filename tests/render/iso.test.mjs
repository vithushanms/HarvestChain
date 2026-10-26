import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadGame, mergeGolden } from '../helpers.mjs';
import { palette } from '../../tools/gen-palette.mjs';

const R_FB = 0x18000;
const GOLDEN = 'tests/render/golden-render.json';
const H = { SOIL: 0, TILLED: 1, GRASS: 2, GRASS2: 3, WHEAT: 4, TOMATO: 6, BARN: 9, WOOD: 10, STONE: 11, SKY: 12, INK: 15 };
const PAL = palette();
const word = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const hc = (hue, step) => word(PAL[hue * 4 + step]);
const BG = 0xFF000000;
const luma = (w) => 0.299 * (w & 255) + 0.587 * ((w >>> 8) & 255) + 0.114 * ((w >>> 16) & 255);
const unpack = (v) => [(v << 16) >> 16, v >> 16];

async function game(w = 64, h = 48) {
  const g = await loadGame();
  g.ex.init(1);
  g.ex.resize(w, h, 100);
  g.ex.t_fill(BG);
  return g;
}
const px = (g, x, y) => g.ex.t_px(x, y) >>> 0;
const each = (g, fn) => { const w = g.ex.fb_w(), h = g.ex.fb_h(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(px(g, x, y), x, y); };
const count = (g, pred) => { let n = 0; each(g, (c) => { if (pred(c)) n++; }); return n; };
const fbHash = (g) => createHash('sha256').update(g.mem().subarray(R_FB, R_FB + g.ex.fb_w() * g.ex.fb_h() * 4)).digest('hex');

test('iso_proj: 2:1 dimetric, rounded, at hw=16 and hw=22', async () => {
  const g = await game();
  g.ex.t_iso_set(100, 50, 16);
  const P = (x, y, z) => unpack(g.ex.t_iso_proj(x, y, z));
  assert.deepEqual(P(0, 0, 0), [100, 50]);
  assert.deepEqual(P(16, 0, 0), [116, 58]);
  assert.deepEqual(P(0, 16, 0), [84, 58]);
  assert.deepEqual(P(16, 16, 0), [100, 66]);
  assert.deepEqual(P(0, 0, 16), [100, 34]);   // a 16-unit cube is hw px tall
  assert.deepEqual(P(128, 0, 0), [228, 114]);
  assert.deepEqual(P(-16, 0, 0), [84, 42]);
  g.ex.t_iso_set(100, 50, 22);
  assert.deepEqual(P(16, 0, 0), [122, 61]);
  assert.deepEqual(P(0, 16, 0), [78, 61]);
  assert.deepEqual(P(0, 0, 16), [100, 28]);
  assert.deepEqual(P(8, 0, 0), [111, 56]);    // 11, 5.5 -> 6 (round half up)
  assert.deepEqual(P(3, 5, 2), [97, 53]);     // -2.75 -> -3, 2.75 -> 3
  assert.deepEqual(P(-3, 5, 2), [89, 49]);    // -11 -> -11, -0.6875 -> -1
  assert.deepEqual(P(128, 128, 128), [100, 50]);
  assert.deepEqual(P(128, 128, 0), [100, 226]);
  // wild inputs are clamped, never overflow into garbage signs
  const [x, y] = P(-2147483648, 2147483647, 0);
  assert.ok(x < 0 && y >= 50 - 1, `${x},${y}`);
});

test('poly4: an axis-aligned diamond covers exactly its area (200 px); iso tile at hw=16 = 256 px', async () => {
  const g = await game(40, 30);
  const C = 0xFF2244EE;
  g.ex.t_poly4(10, 0, 20, 10, 10, 20, 0, 10, C);
  assert.equal(count(g, (c) => c === C), 200);
  assert.equal(px(g, 9, 0), C); assert.equal(px(g, 10, 0), BG);
  g.ex.t_fill(BG);
  g.ex.t_iso_set(16, 4, 16);
  const v = [[0, 0], [16, 0], [16, 16], [0, 16]].map(([x, y]) => unpack(g.ex.t_iso_proj(x, y, 0))).flat();
  g.ex.t_poly4(...v, C);
  assert.equal(count(g, (c) => c === C), 256);
  g.ex.t_fill(BG);
  g.ex.t_poly3(0, 0, 10, 0, 0, 10, C);                  // right triangle, area 50: the 10 pixels
  assert.equal(count(g, (c) => c === C), 45);            // centred on the hypotenuse are excluded (right edge)
});

test('shared edges: adjacent polys never leave a gap or double-cover a pixel', async () => {
  const g = await game(200, 140);
  g.ex.t_iso_mode(0, 2);                                 // pmode 2 = increment pixel word (coverage count)
  for (const hw of [16, 22, 13]) {
    g.ex.t_iso_set(100, 10, hw);
    g.ex.t_fill(BG);
    const P = (x, y) => unpack(g.ex.t_iso_proj(x, y, 0));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const v = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => P(a * 16, b * 16)).flat();
      g.ex.t_poly4(...v, BG);
    }
    assert.equal(count(g, (c) => c > BG + 1), 0, `hw ${hw}: double cover`);
    const tiles = count(g, (c) => c === BG + 1);
    g.ex.t_fill(BG);
    g.ex.t_poly4(...P(0, 0), ...P(48, 0), ...P(48, 48), ...P(0, 48), BG);
    assert.equal(tiles, count(g, (c) => c === BG + 1), `hw ${hw}: tiles == big diamond (no cracks)`);
  }
  // a quad split along its diagonal into two triangles
  g.ex.t_fill(BG);
  g.ex.t_poly3(3, 2, 61, 17, 20, 50, BG); g.ex.t_poly3(61, 17, 70, 70, 20, 50, BG);
  assert.equal(count(g, (c) => c > BG + 1), 0);
  const tri = count(g, (c) => c === BG + 1);
  g.ex.t_fill(BG); g.ex.t_poly4(3, 2, 61, 17, 70, 70, 20, 50, BG);
  assert.equal(tri, count(g, (c) => c === BG + 1));
  // the three faces of a box: no overlap, and every row of the silhouette is one solid run
  g.ex.t_fill(BG); g.ex.t_iso_set(100, 60, 22);
  g.ex.t_iso_box(3, 5, 0, 21, 13, 27, H.STONE);
  assert.equal(count(g, (c) => c > BG + 1), 0, 'box faces overlap');
  for (let y = 0; y < 140; y++) {
    const xs = []; for (let x = 0; x < 200; x++) if (px(g, x, y) !== BG) xs.push(x);
    if (xs.length) assert.equal(xs.length, xs[xs.length - 1] - xs[0] + 1, `crack in row ${y}`);
  }
  g.ex.t_iso_mode(1, 0);
});

test('iso_box: top = step 3, left = step 2, right = step 1, outline = step 0', async () => {
  const g = await game(80, 80);
  g.ex.t_iso_set(40, 40, 16);
  g.ex.t_iso_mode(1, 0);
  g.ex.t_iso_box(0, 0, 0, 16, 16, 16, H.BARN);
  assert.equal(px(g, 40, 32), hc(H.BARN, 3), 'top');
  assert.equal(px(g, 32, 44), hc(H.BARN, 2), 'left');
  assert.equal(px(g, 48, 44), hc(H.BARN, 1), 'right');
  assert.equal(px(g, 23, 40), hc(H.BARN, 0), 'outline left of silhouette');
  assert.equal(px(g, 40, 23), hc(H.BARN, 0), 'outline above top vertex');
  assert.equal(px(g, 20, 40), BG);
  g.ex.t_fill(BG); g.ex.t_iso_mode(0, 0);
  g.ex.t_iso_box(0, 0, 0, 16, 16, 16, H.BARN);
  assert.equal(px(g, 23, 40), BG, 'no outline when off');
  g.ex.t_iso_mode(1, 0);
});

test('painter order: a taller box in front hides the one behind', async () => {
  const g = await game(100, 100);
  g.ex.t_iso_set(50, 50, 16);
  g.ex.t_iso_box(0, 0, 0, 16, 16, 8, H.STONE);
  const probe = [44, 50];
  assert.equal(px(g, ...probe), hc(H.STONE, 3));
  g.ex.t_iso_box(16, 16, 0, 16, 16, 32, H.BARN);
  assert.equal(px(g, ...probe), hc(H.BARN, 2));
});

test('iso_prism: two slopes shaded differently plus a gable, both axes', async () => {
  const g = await game(120, 100);
  g.ex.t_iso_set(60, 50, 16);
  for (const axis of [0, 1]) {
    g.ex.t_fill(BG);
    g.ex.t_iso_prism(0, 0, 0, 32, 32, 12, H.BARN, axis);
    const seen = new Set(); each(g, (c) => { if (c !== BG) seen.add(c); });
    for (const s of [0, 1, 2, 3]) assert.ok(seen.has(hc(H.BARN, s)), `axis ${axis} step ${s}`);
    assert.equal(seen.size, 4);
  }
});

test('iso_sphere: brightest pixel upper-left, darkest lower-right', async () => {
  const g = await game(80, 80);
  g.ex.t_iso_mode(0, 0);
  g.ex.t_iso_sphere(40, 40, 20, H.GRASS);
  // centroids of the brightest and of the darkest colour present
  const ls = []; each(g, (c, x, y) => { if (c !== BG) ls.push([luma(c), x, y]); });
  const hi = Math.max(...ls.map((p) => p[0])), lo = Math.min(...ls.map((p) => p[0]));
  const cen = (l) => { const s = ls.filter((p) => p[0] === l); return [s.reduce((a, p) => a + p[1], 0) / s.length, s.reduce((a, p) => a + p[2], 0) / s.length]; };
  const [bx, by] = cen(hi), [dx, dy] = cen(lo);
  assert.ok(bx < 36 && by < 36, `brightest centroid ${bx},${by}`);
  assert.ok(dx > 44 && dy > 44, `darkest centroid ${dx},${dy}`);
  assert.ok(new Set(ls.map((p) => p[0])).size >= 4, 'at least 4 shades');
  const n = count(g, (c) => c !== BG);
  assert.ok(Math.abs(n - Math.PI * 20.5 * 20.5) < 40, `area ${n}`);
  for (const [x, y] of [[40, 19], [40, 61], [19, 40], [61, 40]]) assert.equal(px(g, x, y), BG);
  g.ex.t_iso_mode(1, 0);
});

test('iso_cyl: side luminance non-increasing left to right (per-column averages)', async () => {
  const g = await game(120, 120);
  g.ex.t_iso_set(60, 90, 16);
  g.ex.t_iso_mode(0, 0);
  g.ex.t_iso_cyl(0, 0, 0, 24, 48, H.STONE);
  const top = unpack(g.ex.t_iso_proj(0, 0, 48)), base = unpack(g.ex.t_iso_proj(0, 0, 0));
  const rx = Math.round(24 * 16 * Math.SQRT2 / 16);
  assert.equal(px(g, 60, top[1]), hc(H.STONE, 3), 'top face centre');
  const y0 = top[1] + rx / 2 + 2, y1 = base[1];
  const avg = [];
  for (let x = 60 - rx + 1; x < 60 + rx; x++) {
    let s = 0; for (let y = y0; y < y1; y++) s += luma(px(g, x, y));
    avg.push(s / (y1 - y0));
  }
  const step = Math.max(...[1, 2, 3].map((s) => luma(hc(H.STONE, s)) - luma(hc(H.STONE, s - 1))));
  for (let i = 1; i < avg.length; i++) assert.ok(avg[i] <= avg[i - 1] + step / 2, `column ${i}: ${avg[i - 1]} -> ${avg[i]}`);
  assert.ok(avg[0] > avg[avg.length - 1] + step, 'left lit, right dark');
  g.ex.t_iso_mode(1, 0);
});

test('iso_shadow darkens the ground 50% toward dark soil without erasing it', async () => {
  const g = await game(100, 80);
  const grass = hc(H.GRASS, 2);
  g.ex.t_fill(grass);
  g.ex.t_iso_set(50, 20, 16);
  g.ex.t_iso_shadow(0, 0, 16, 16);
  const c = px(g, 50, 28);
  assert.notEqual(c, grass);
  assert.equal(c, g.ex.t_blend50(grass, hc(H.TILLED, 0)) >>> 0);
  const ch = (w) => [w & 255, (w >>> 8) & 255, (w >>> 16) & 255];
  assert.ok(ch(c)[1] > ch(c)[0] && ch(c)[1] > ch(c)[2], 'still green');
  assert.ok(luma(c) < luma(grass));
  assert.equal(px(g, 2, 2), grass);
  // the shadow reaches further right than the footprint (sun from the upper-left)
  assert.notEqual(px(g, 67, 28), grass);
  assert.equal(px(g, 33, 28), grass);
});

test('everything clips: wild coordinates never write outside the framebuffer and terminate fast', async () => {
  const g = await game(40, 30);
  const before = g.mem().slice(0, R_FB);
  const t0 = Date.now();
  const W = [-100000, 100000, -2147483648, 2147483647, -20, 35, 0];
  for (const ox of [20, -2147483648, 2147483647]) for (const hw of [16, 64, 999, -5]) {
    g.ex.t_iso_set(ox, 15, hw);
    for (const a of W) for (const b of W) {
      g.ex.t_iso_box(a, b, a, 2147483647, 50, b, 99);
      g.ex.t_iso_box(b, a, 0, 16, 16, 16, 3);
      g.ex.t_iso_prism(a, b, b, 40, -30, a, 9, 1);
      g.ex.t_iso_cyl(a, b, a, b, a, 4);
      g.ex.t_iso_cyl(0, 0, 0, a, 40, 4);
      g.ex.t_iso_shadow(a, b, a, b);
    }
  }
  for (const a of W) for (const b of W) {
    g.ex.t_iso_sphere(a, b, 20, 2); g.ex.t_iso_sphere(10, 10, a, 2); g.ex.t_iso_sphere(b, 10, b, 2);
    g.ex.t_poly4(a, b, b, a, -a, b, 10, 10, 0xFF123456);
    g.ex.t_poly3(a, a, b, b, 5, 7, 0xFF123456);
  }
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  assert.equal(g.ex.t_canary_ok(), 1);
  assert.deepEqual(g.mem().slice(0, R_FB), before);
});

test('iso demo: never touches sim state or the RNG; framebuffer hash stable and golden', async () => {
  const hashes = {};
  for (const [w, h] of [[360, 640], [180, 320]]) {
    const g = await game(w, h);
    g.ex.t_set_cash(4321);
    const rng = new DataView(g.ex.memory.buffer).getUint32(0x1008, true);
    const before = g.mem().slice(0, R_FB);
    g.ex.t_iso_demo(0);
    assert.deepEqual(g.mem().slice(0, R_FB), before);
    assert.equal(new DataView(g.ex.memory.buffer).getUint32(0x1008, true), rng);
    assert.equal(g.ex.t_canary_ok(), 1);
    const a = fbHash(g);
    g.ex.t_iso_demo(0);
    assert.equal(fbHash(g), a, 'redraw identical');
    const seen = new Set(); each(g, (c) => seen.add(c));
    assert.ok(seen.size > 30, `distinct colours ${seen.size}`);
    hashes[`iso-${w}x${h}`] = a;
  }
  if (process.env.UPDATE_GOLDEN === '1') mergeGolden(GOLDEN, hashes);
  assert.ok(existsSync(GOLDEN), `${GOLDEN} is missing: run with UPDATE_GOLDEN=1 to create it, then review and commit`);
  const gold = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  for (const k of Object.keys(hashes)) assert.equal(hashes[k], gold[k], k);
});

// ---- Task 1 review cleanups (21_draw.wat) ----
test('rrect: huge radius is clamped (min(r, w/2, h/2, 32)) and returns quickly; off-screen returns early', async () => {
  const g = await game(80, 60);
  const C = 0xFF3344EE;
  const t0 = Date.now();
  g.ex.t_rrect(4, 4, 40, 30, 2147483647, C);
  assert.ok(Date.now() - t0 < 200);
  const huge = count(g, (c) => c === C);
  g.ex.t_fill(BG); g.ex.t_rrect(4, 4, 40, 30, 15, C);
  assert.equal(huge, count(g, (c) => c === C));
  g.ex.t_fill(BG); g.ex.t_rrect(4, 4, 12, 10, 2, C);
  assert.equal(count(g, (c) => c === C), 12 * 10 - 4 * 3, 'r=2 shape unchanged');
  g.ex.t_fill(BG); g.ex.t_rrect(0, 0, 80, 60, -7, C);
  assert.equal(count(g, (c) => c === C), 80 * 60, 'negative r = plain rect');
  g.ex.t_fill(BG);
  for (const [x, y] of [[80, 0], [0, 60], [-50, 0], [0, -40], [2147483647, 0], [-2147483648, -2147483648]]) g.ex.t_rrect(x, y, 50, 40, 9, C);
  assert.equal(count(g, (c) => c === C), 0);
  assert.equal(g.ex.t_canary_ok(), 1);
});

test('text/glyph/text_w mask the font argument to 0/1', async () => {
  const g = await game(80, 20);
  const at = 0x10100; const m = g.mem(); [...'AB1'].forEach((c, i) => { m[at + i] = c.charCodeAt(0); }); m[at + 3] = 0;
  assert.equal(g.ex.t_text_w(at, 7), g.ex.t_text_w(at, 1));
  assert.equal(g.ex.t_text_w(at, -2), g.ex.t_text_w(at, 0));
  assert.equal(g.ex.t_text(2, 2, at, 0xFFFFFFFF, 7), g.ex.t_text(2, 2, at, 0xFFFFFFFF, 1));
  const a = fbHash(g);
  g.ex.t_fill(BG); g.ex.t_text(2, 2, at, 0xFFFFFFFF, 1); g.ex.t_text(2, 2, at, 0xFFFFFFFF, 1);
  assert.equal(fbHash(g), a);
  assert.equal(g.ex.t_canary_ok(), 1);
});

test('dither clamps its level to 0..16', async () => {
  const g = await game();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    assert.equal(g.ex.t_dither(x, y, -5), 0);
    assert.equal(g.ex.t_dither(x, y, 99), 1);
    assert.equal(g.ex.t_dither(x, y, -2147483648), 0);
  }
});

test('resize: clamp path keeps memory sufficient (memory.grow failure itself cannot be simulated)', async () => {
  const g = await loadGame();
  g.ex.resize(2147483647, 2147483647, 2147483647);
  assert.ok(g.ex.fb_w() * g.ex.fb_h() > 0 && g.ex.fb_w() <= 1280 && g.ex.fb_h() <= 1280);
  assert.ok(g.ex.memory.buffer.byteLength >= R_FB + g.ex.fb_w() * g.ex.fb_h() * 4 + 4);
  assert.equal(g.ex.t_canary_ok(), 1);
});
