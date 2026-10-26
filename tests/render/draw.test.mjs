import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadGame } from '../helpers.mjs';
import { palette } from '../../tools/gen-palette.mjs';
import { bodyBytes, badgeBytes, KEYS } from '../../tools/gen-font.mjs';

const R_FB = 0x18000;
const word = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;

async function game(w = 64, h = 48) {
  const g = await loadGame();
  g.ex.init(1);
  g.ex.resize(w, h, 100);
  return g;
}
const px = (g, x, y) => g.ex.t_px(x, y) >>> 0;
const putStr = (g, s, at = 0x10100) => {
  const m = g.mem();
  [...s].forEach((c, i) => { m[at + i] = c.charCodeAt(0); });
  m[at + s.length] = 0;
  return at;
};
const countOn = (g, w, h, bg) => {
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px(g, x, y) !== bg) n++;
  return n;
};
const bits = (bytes) => bytes.reduce((a, b) => a + [...b.toString(2)].filter((c) => c === '1').length, 0);
const idx = (ch) => KEYS.indexOf(ch.toUpperCase());

test('resize: logical sizes per Decision 3', async () => {
  const g = await loadGame();
  for (const [w, h, dpr, lw, lh] of [[360, 640, 200, 360, 640], [1440, 900, 100, 480, 300], [390, 844, 300, 390, 844]]) {
    g.ex.resize(w, h, dpr);
    assert.deepEqual([g.ex.fb_w(), g.ex.fb_h()], [lw, lh], `${w}x${h}@${dpr}`);
    assert.equal(g.ex.fb_ptr(), R_FB);
  }
});

test('resize: clamps to 720x1280 logical and memory covers the framebuffer + canary', async () => {
  const g = await loadGame();
  g.ex.resize(500, 5000, 100);
  assert.deepEqual([g.ex.fb_w(), g.ex.fb_h()], [500, 1280]);
  g.ex.resize(5000, 500, 100);
  assert.deepEqual([g.ex.fb_w(), g.ex.fb_h()], [1280, 500]);
  for (const [w, h, d] of [[360, 640, 200], [720, 1280, 100], [1280, 720, 100], [500, 500, 100], [360, 640, 200]]) {
    g.ex.resize(w, h, d);
    const need = g.ex.fb_ptr() + g.ex.fb_w() * g.ex.fb_h() * 4 + 4;
    assert.ok(g.ex.memory.buffer.byteLength >= need);
    assert.equal(g.ex.t_canary_ok(), 1);
  }
  g.ex.resize(360, 640, 200);
  const v = new DataView(g.ex.memory.buffer);
  assert.equal(v.getUint32(R_FB + 360 * 640 * 4, true), 0xCAFEF00D);
});

test('rect fills exactly w*h pixels, clipped at every edge, canary intact', async () => {
  const g = await game(40, 30);
  const C = word(palette()[5]);
  g.ex.t_fill(0xFF000000);
  g.ex.t_rect(5, 6, 10, 7, C);
  assert.equal(countOn(g, 40, 30, 0xFF000000), 70);
  assert.equal(px(g, 5, 6), C); assert.equal(px(g, 14, 12), C); assert.equal(px(g, 15, 12), 0xFF000000);
  g.ex.t_fill(0xFF000000);
  for (const [x, y, w, h, n] of [[-5, -5, 10, 10, 25], [35, 25, 10, 10, 25], [-100, 0, 50, 50, 0], [0, 0, 0, 5, 0], [38, -3, 100, 6, 6], [0, 0, -4, 4, 0]]) {
    g.ex.t_fill(0xFF000000);
    g.ex.t_rect(x, y, w, h, C);
    assert.equal(countOn(g, 40, 30, 0xFF000000), n, `${x},${y},${w},${h}`);
  }
  assert.equal(g.ex.t_canary_ok(), 1);
});

test('clipping: wild primitives never write outside the buffer', async () => {
  const g = await game(40, 30);
  const s = putStr(g, 'HARVEST $1,450 ABC');
  const before = g.mem().slice(0, R_FB);
  for (const [x, y] of [[-1000, -1000], [1000, 1000], [-3, -3], [37, 28], [39, 29], [2147483647, 5], [-2147483647, 5], [5, 2147483647]]) {
    g.ex.t_putpx(x, y, 0xFFABCDEF);
    g.ex.t_rect(x, y, 50, 50, 0xFF112233);
    g.ex.t_rrect(x, y, 50, 50, 2, 0xFF112233);
    g.ex.t_hline(x, y, 99, 0xFF112233);
    g.ex.t_vline(x, y, 99, 0xFF112233);
    g.ex.t_line(x, y, 20, 15, 0xFF445566);
    g.ex.t_line(20, 15, x, y, 0xFF445566);
    g.ex.t_text(x, y, s, 0xFF778899, 0);
    g.ex.t_text(x, y, s, 0xFF778899, 1);
  }
  g.ex.t_line(-50, -50, 90, 80, 0xFF123456);
  assert.equal(g.ex.t_canary_ok(), 1);
  assert.deepEqual(g.mem().slice(0, R_FB), before);
  assert.equal(g.ex.t_px(-1, 0), -1);
  assert.equal(g.ex.t_px(40, 0), -1);
});

test('hline/vline/rrect/line basics', async () => {
  const g = await game(40, 30);
  const C = 0xFF3344EE, BG = 0xFF000000;
  g.ex.t_fill(BG);
  g.ex.t_hline(2, 3, 10, C);
  assert.equal(countOn(g, 40, 30, BG), 10);
  g.ex.t_fill(BG); g.ex.t_vline(2, 3, 7, C);
  assert.equal(countOn(g, 40, 30, BG), 7);
  g.ex.t_fill(BG); g.ex.t_rrect(4, 4, 12, 10, 2, C);
  assert.equal(px(g, 4, 4), BG, 'corner cut');
  assert.equal(px(g, 15, 13), BG, 'corner cut');
  assert.equal(px(g, 5, 5), C); assert.equal(px(g, 8, 4), C); assert.equal(px(g, 4, 8), C);
  assert.equal(countOn(g, 40, 30, BG), 12 * 10 - 4 * 3);
  g.ex.t_fill(BG); g.ex.t_line(0, 0, 9, 9, C);
  assert.equal(countOn(g, 40, 30, BG), 10);
  for (let i = 0; i < 10; i++) assert.equal(px(g, i, i), C);
  g.ex.t_fill(BG); g.ex.t_line(3, 5, 20, 5, C);
  assert.equal(countOn(g, 40, 30, BG), 18);
  g.ex.t_fill(BG); g.ex.t_line(10, 2, 4, 20, C);       // reversed + steep
  assert.equal(px(g, 10, 2), C); assert.equal(px(g, 4, 20), C);
  assert.equal(countOn(g, 40, 30, BG), 19);
});

test('text: width formula and pixel counts', async () => {
  const g = await game(120, 40);
  const BG = 0xFF000000, C = 0xFFFFFFFF;
  const s = putStr(g, 'HARVEST');
  assert.equal(g.ex.t_text_w(s, 0), 7 * 6 - 1);
  assert.equal(g.ex.t_text_w(s, 1), 7 * 4 - 1);
  assert.equal(g.ex.t_text_w(putStr(g, '', 0x10200), 0), 0);
  for (const [font, glyphs] of [[0, bodyBytes()], [1, badgeBytes()]]) {
    g.ex.t_fill(BG);
    const w = g.ex.t_text(3, 4, s, C, font);
    assert.equal(w, font ? 27 : 41);
    const expected = [...'HARVEST'].reduce((a, ch) => a + bits(glyphs[idx(ch)]), 0);
    assert.equal(countOn(g, 120, 40, BG), expected, `font ${font}`);
  }
  // lowercase folds, star code 1
  g.ex.t_fill(BG); g.ex.t_text(0, 0, putStr(g, 'harvest'), C, 0);
  const lower = countOn(g, 120, 40, BG);
  g.ex.t_fill(BG); g.ex.t_text(0, 0, putStr(g, 'HARVEST'), C, 0);
  assert.equal(lower, countOn(g, 120, 40, BG));
  g.ex.t_fill(BG); g.ex.t_text(0, 0, putStr(g, '\x01'), C, 0);
  assert.equal(countOn(g, 120, 40, BG), bits(bodyBytes()[idx('STAR')]));
});

test('noise is a stable integer hash; dither is ordered Bayer 4x4', async () => {
  const g = await game();
  assert.equal(g.ex.t_noise(1, 2), g.ex.t_noise(1, 2));
  const seen = new Set();
  for (let i = 0; i < 64; i++) seen.add(g.ex.t_noise(i, 7));
  assert.ok(seen.size > 60);
  for (let lvl = 0; lvl <= 16; lvl++) {
    let n = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) n += g.ex.t_dither(x + 4, y + 8, lvl);
    assert.equal(n, lvl);
  }
  assert.equal(g.ex.t_dither(0, 0, 0), 0);
  assert.equal(g.ex.t_dither(3, 3, 16), 1);
});

test('blend50 averages channels and keeps alpha opaque', async () => {
  const g = await game();
  assert.equal(g.ex.t_blend50(0xFF000000, 0xFFFFFFFF) >>> 0, 0xFF7F7F7F);
  const r = g.ex.t_blend50(0xFF204060, 0xFF402000) >>> 0;
  assert.equal(r >>> 24, 255);
  assert.equal(r & 0xFF, 0x30); assert.equal((r >> 8) & 0xFF, 0x30); assert.equal((r >> 16) & 0xFF, 0x30);
});

test('t_pal returns the 0xAABBGGRR word of palette entries', async () => {
  const g = await game();
  const pal = palette();
  for (const i of [0, 1, 17, 42, 63]) assert.equal(g.ex.t_pal(i) >>> 0, word(pal[i]));
});

test('rendering never touches sim state, RNG or anything below the framebuffer', async () => {
  const g = await game(360, 640);
  g.ex.t_set_cash(1234);
  const rngBefore = new DataView(g.ex.memory.buffer).getUint32(0x1008, true);
  const outside = (m) => [m.slice(0, 0x8000), m.slice(0x10000, R_FB)];   // R_LAYOUT (0x8000..0xFFFF) is UI state
  const before = outside(g.mem());
  for (let k = 0; k < 3; k++) g.ex.t_demo(k % 2);
  g.ex.resize(720, 1280, 100);
  g.ex.t_demo(0);
  const after = outside(g.mem());
  assert.deepEqual(after, before);
  assert.equal(new DataView(g.ex.memory.buffer).getUint32(0x1008, true), rngBefore);
  assert.equal(g.ex.t_canary_ok(), 1);
});

test('demo scene framebuffer hash is stable run to run and nontrivial', async () => {
  const hash = async () => {
    const g = await game(360, 640);
    g.ex.t_demo(0);
    const n = g.ex.fb_w() * g.ex.fb_h() * 4;
    return createHash('sha256').update(g.mem().subarray(R_FB, R_FB + n)).digest('hex');
  };
  const a = await hash(), b = await hash();
  assert.equal(a, b);
  const g = await game(360, 640);
  g.ex.t_demo(0);
  const seen = new Set();
  for (let y = 0; y < 640; y += 5) for (let x = 0; x < 360; x += 5) seen.add(px(g, x, y));
  assert.ok(seen.size > 20, `distinct colours ${seen.size}`);
});
