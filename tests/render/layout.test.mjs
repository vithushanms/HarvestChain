import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, STATE, readState } from '../helpers.mjs';
import { farm } from './scenes.mjs';

// Rect ids (src/20_layout.wat header).
const ID = { TOPBAR: 0, DAYBOX: 1, CASHBOX: 2, REPBOX: 3, HARVALL: 4, ENDDAY: 5, GRID: 6, TABS: 7,
  TAB0: 8, TAB1: 9, TAB2: 10, TAB3: 11, TAB4: 12, PANEL: 13, PANEL_CLOSE: 14, TOAST: 15 };
const HIT = { ENDDAY: 1, HARVALL: 2, DAY: 3, CLOSE: 4, PANEL: 5, GRID: 6, TOPBAR: 7, TAB0: 10, TILE: 0x100, PANEL_BASE: 0x200 };
const SIZES = [[320, 568], [360, 640], [390, 844], [640, 360], [768, 1024], [1024, 768], [1440, 900]];
const DPRS = [100, 200, 300];
const R_LAYOUT = 0x8000;

const rect = (g, id) => ({ x: g.ex.t_lay_x(id), y: g.ex.t_lay_y(id), w: g.ex.t_lay_w(id), h: g.ex.t_lay_h(id) });
const all = (g) => Object.fromEntries(Object.entries(ID).map(([k, id]) => [k, rect(g, id)]));
const overlap = (a, b) => a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 &&
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

async function setup(w, h, dpr, large = 0, open = 0) {
  const g = await loadGame();
  g.ex.init(5);
  g.ex.resize(w, h, dpr);
  g.ex.set_flags(0, large);
  if (open) g.ex.t_layout_panel(1);
  g.css = [w, h];
  return g;
}
const matrix = [];
for (const [w, h] of SIZES) for (const large of [0, 1]) for (const dpr of DPRS) for (const open of [0, 1]) matrix.push({ w, h, large, dpr, open });
const name = (c) => `${c.w}x${c.h} large=${c.large} dpr=${c.dpr} open=${c.open}`;

test('every interactive rect >= 44x44 css px (logical min_touch), inside the framebuffer', async () => {
  for (const c of matrix) {
    const g = await setup(c.w, c.h, c.dpr, c.large, c.open);
    const W = g.ex.fb_w(), H = g.ex.fb_h(), mt = g.ex.t_min_touch();
    assert.ok(mt >= 1, name(c));
    const r = all(g);
    for (const k of ['ENDDAY', 'HARVALL', 'TAB0', 'TAB1', 'TAB2', 'TAB3', 'TAB4', 'DAYBOX']) {
      assert.ok(r[k].w >= mt && r[k].h >= mt, `${name(c)} ${k} ${JSON.stringify(r[k])} mt=${mt}`);
      assert.ok(r[k].w * c.w >= 44 * W && r[k].h * c.h >= 44 * H, `${name(c)} ${k} css size`);
    }
    if (r.PANEL.w > 0) assert.ok(r.PANEL_CLOSE.w >= mt && r.PANEL_CLOSE.h >= mt, `${name(c)} close`);
    for (const [k, v] of Object.entries(r)) {
      if (k === 'PANEL' && v.w === 0) continue;
      assert.ok(v.x >= 0 && v.y >= 0 && v.x + v.w <= W && v.y + v.h <= H, `${name(c)} ${k} outside fb ${JSON.stringify(v)} ${W}x${H}`);
    }
  }
});

test('siblings never overlap; children sit inside their containers', async () => {
  const sib = ['DAYBOX', 'CASHBOX', 'REPBOX', 'HARVALL', 'ENDDAY', 'GRID', 'TABS', 'PANEL'];
  for (const c of matrix) {
    const g = await setup(c.w, c.h, c.dpr, c.large, c.open);
    const r = all(g);
    for (let i = 0; i < sib.length; i++) for (let j = i + 1; j < sib.length; j++)
      assert.ok(!overlap(r[sib[i]], r[sib[j]]), `${name(c)} ${sib[i]} x ${sib[j]} ${JSON.stringify([r[sib[i]], r[sib[j]]])}`);
    for (const k of ['DAYBOX', 'CASHBOX', 'REPBOX', 'HARVALL', 'ENDDAY']) assert.ok(inside(r[k], r.TOPBAR), `${name(c)} ${k} in TOPBAR`);
    for (let i = 0; i < 5; i++) assert.ok(inside(r['TAB' + i], r.TABS) && !overlap(r['TAB' + i], r['TAB' + ((i + 1) % 5)]), `${name(c)} tab ${i}`);
    for (const k of ['TOPBAR']) for (const o of ['GRID', 'TABS', 'PANEL']) assert.ok(!overlap(r[k], r[o]), `${name(c)} TOPBAR x ${o}`);
    if (r.PANEL.w > 0) assert.ok(inside(r.PANEL_CLOSE, r.PANEL), `${name(c)} close in panel`);
    // End Day is always present and never covered by the panel
    assert.ok(r.ENDDAY.w > 0 && r.ENDDAY.h > 0 && !overlap(r.ENDDAY, r.PANEL), `${name(c)} ENDDAY`);
    assert.ok(r.HARVALL.w > 0, `${name(c)} HARVALL slot reserved`);
  }
});

test('five tabs: equal-ish widths exactly covering the tab bar', async () => {
  for (const c of matrix) {
    const g = await setup(c.w, c.h, c.dpr, c.large, c.open);
    const r = all(g);
    let x = r.TABS.x;
    const ws = [];
    for (let i = 0; i < 5; i++) {
      const t = r['TAB' + i];
      assert.equal(t.x, x, `${name(c)} tab ${i} contiguous`);
      assert.equal(t.y, r.TABS.y); assert.equal(t.h, r.TABS.h);
      x += t.w; ws.push(t.w);
    }
    assert.equal(x, r.TABS.x + r.TABS.w, `${name(c)} covers bar`);
    assert.ok(Math.max(...ws) - Math.min(...ws) <= 1, `${name(c)} equal widths ${ws}`);
  }
});

test('modes and panel placement are pinned', async () => {
  const mode = async (w, h) => (await setup(w, h, 100)).ex.t_mode();
  assert.equal(await mode(360, 640), 0);
  assert.equal(await mode(767, 1000), 0);
  assert.equal(await mode(768, 1024), 1);
  assert.equal(await mode(1000, 900), 1);
  assert.equal(await mode(1024, 768), 2);
  assert.equal(await mode(640, 360), 2);
  assert.equal(await mode(700, 600), 0);
  assert.equal(await mode(1440, 900), 2);
  // portrait 360x640: closed -> no panel, grid fills between bars; open -> sheet = lower 45% incl. tabs
  let g = await setup(360, 640, 100);
  let r = all(g);
  assert.equal(r.PANEL.w, 0);
  assert.equal(r.GRID.y, r.TOPBAR.h); assert.equal(r.GRID.y + r.GRID.h, r.TABS.y);
  assert.equal(r.TABS.y + r.TABS.h, 640);
  g.ex.t_layout_panel(1);
  const r2 = all(g);
  assert.equal(r2.PANEL.y + r2.PANEL.h, r2.TABS.y); assert.equal(r2.PANEL.w, 360);
  assert.equal(r2.PANEL.y, 640 - 288);   // lower 45% of the screen, tab bar included
  assert.equal(r2.GRID.y + r2.GRID.h, r2.PANEL.y);
  assert.equal(g.ex.t_panel_open(), 1);
  // laptop: panel column is right of the grid, always present, tabs on top of it
  g = await setup(1024, 768, 100);
  r = all(g);
  assert.ok(r.PANEL.w > 0 && r.PANEL.x >= r.GRID.x + r.GRID.w);
  assert.equal(r.TABS.x, r.PANEL.x); assert.equal(r.TABS.y + r.TABS.h, r.PANEL.y);
  assert.ok(r.GRID.w > 0);
  // max grid width 640 css on a wide screen
  g = await setup(1440, 900, 100);
  assert.ok(g.ex.t_lay_w(ID.GRID) <= 640);
});

test('top bar wraps to two rows only when needed (320x568 large), single row otherwise', async () => {
  let g = await setup(360, 640, 100, 0);
  let r = all(g);
  assert.equal(r.DAYBOX.y, r.ENDDAY.y);
  g = await setup(320, 568, 100, 1);
  r = all(g);
  assert.ok(r.ENDDAY.y > r.DAYBOX.y, 'two rows');
  assert.equal(g.ex.t_ui_ts(), 2);
  assert.equal((await setup(320, 568, 100, 0)).ex.t_ui_ts(), 1);
});

test('360x640: 8x8 grid ground diamonds >= 38 css px wide', async () => {
  const g = await setup(360, 640, 100);
  g.ex.t_layout_panel(0);
  farm(g.ex).clear().grid(8).day(30);
  g.ex.t_layout_panel(0);   // relayout so the viewport sees the new grid
  const W = g.ex.fb_w();
  for (let i = 0; i < 64; i++) {
    const w = g.ex.t_tile_rect(i, 2);
    assert.ok(w * 360 >= 38 * W, `tile ${i} diamond ${w} logical of ${W}`);
  }
});

test('GRID contains every owned tile diamond for grids 4..8, all sizes/modes, panel open or closed', async () => {
  for (const c of matrix) {
    if (c.dpr !== 100 && c.dpr !== 200) continue;
    const g = await setup(c.w, c.h, c.dpr, c.large, c.open);
    for (let n = 4; n <= 8; n++) {
      farm(g.ex).clear().grid(n).day(30);
      g.ex.t_layout_panel(c.open);
      const gr = rect(g, ID.GRID);
      for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
        const i = ty * 8 + tx;
        const t = { x: g.ex.t_tile_rect(i, 0), y: g.ex.t_tile_rect(i, 1), w: g.ex.t_tile_rect(i, 2), h: g.ex.t_tile_rect(i, 3) };
        assert.ok(inside(t, gr), `${name(c)} grid ${n} tile ${i} ${JSON.stringify(t)} outside GRID ${JSON.stringify(gr)}`);
      }
    }
  }
});

test('hit_test: topmost (last added) wins, 0 outside, edges half-open', async () => {
  const g = await loadGame();
  g.ex.resize(360, 640, 100);
  g.ex.t_hit_clear();
  assert.equal(g.ex.t_hit_n(), 0);
  assert.equal(g.ex.t_hit_add(10, 10, 100, 100, 7), 0);
  assert.equal(g.ex.t_hit_add(50, 50, 100, 100, 9), 0);
  assert.equal(g.ex.t_hit_test(60, 60), 9);
  assert.equal(g.ex.t_hit_test(20, 20), 7);
  assert.equal(g.ex.t_hit_test(10, 10), 7);
  assert.equal(g.ex.t_hit_test(9, 10), 0);
  assert.equal(g.ex.t_hit_test(49, 49), 7);
  assert.equal(g.ex.t_hit_test(109, 109), 9);
  assert.equal(g.ex.t_hit_test(110, 110), 9);
  assert.equal(g.ex.t_hit_test(149, 149), 9);
  assert.equal(g.ex.t_hit_test(150, 150), 0);
  assert.equal(g.ex.t_hit_test(-5, -5), 0);
  g.ex.t_hit_clear();
  assert.equal(g.ex.t_hit_test(60, 60), 0);
});

test('hit table: 128 entries, overflow returns 1 and corrupts nothing', async () => {
  const g = await loadGame();
  g.ex.resize(360, 640, 100);
  g.ex.t_hit_clear();
  const before = new Uint8Array(g.ex.memory.buffer.slice(0, 0x18000));
  for (let i = 0; i < 128; i++) assert.equal(g.ex.t_hit_add(i, 0, 1, 1, i + 1), 0, `add ${i}`);
  const full = new Uint8Array(g.ex.memory.buffer.slice(0, 0x18000));
  assert.equal(g.ex.t_hit_add(0, 0, 500, 500, 999), 1);
  assert.equal(g.ex.t_hit_add(0, 0, 500, 500, 998), 1);
  assert.equal(g.ex.t_hit_n(), 128);
  const after = new Uint8Array(g.ex.memory.buffer.slice(0, 0x18000));
  assert.deepEqual(after, full);
  assert.equal(g.ex.t_hit_test(100, 0), 101);
  assert.equal(g.ex.t_hit_test(300, 300), 0);
  assert.ok(before.length === after.length && g.ex.t_canary_ok() === 1);
});

test('static chrome hit regions are registered by layout; dynamic regions can be reset', async () => {
  for (const [w, h] of [[360, 640], [1024, 768]]) {
    const g = await setup(w, h, 100, 0, 1);
    const c = (id) => { const r = rect(g, id); return [r.x + (r.w >> 1), r.y + (r.h >> 1)]; };
    assert.equal(g.ex.t_hit_test(...c(ID.ENDDAY)), HIT.ENDDAY);
    assert.equal(g.ex.t_hit_test(...c(ID.DAYBOX)), HIT.DAY);
    for (let i = 0; i < 5; i++) assert.equal(g.ex.t_hit_test(...c(ID.TAB0 + i)), HIT.TAB0 + i);
    assert.equal(g.ex.t_hit_test(...c(ID.PANEL_CLOSE)), HIT.CLOSE);
    const p = rect(g, ID.PANEL);
    assert.equal(g.ex.t_hit_test(p.x + 2, p.y + p.h - 3), HIT.PANEL);
    assert.equal(g.ex.t_hit_test(...c(ID.GRID)), HIT.GRID);
    assert.equal(g.ex.t_hit_test(...c(ID.CASHBOX)), HIT.TOPBAR);
    const n0 = g.ex.t_hit_n();
    g.ex.t_hit_add(p.x, p.y, 20, 20, HIT.PANEL_BASE + 1);
    assert.equal(g.ex.t_hit_test(p.x + 1, p.y + 1), HIT.PANEL_BASE + 1);
    g.ex.t_hit_reset_dyn();
    assert.equal(g.ex.t_hit_n(), n0);
    assert.equal(g.ex.t_hit_test(p.x + 1, p.y + 1), HIT.PANEL);
    // closing the panel in sheet mode removes its regions
    if (w === 360) { g.ex.t_layout_panel(0); assert.equal(g.ex.t_hit_test(p.x + 2, p.y + 2), HIT.GRID); }
  }
});

test('css <-> fb conversion round trips (fb px within 1; css within one logical pixel width)', async () => {
  for (const [w, h] of SIZES) for (const dpr of DPRS) {
    const g = await setup(w, h, dpr);
    const W = g.ex.fb_w(), H = g.ex.fb_h();
    for (const f of [0, 1, Math.floor(W / 3), W - 1]) {      // fb -> css (centre of the pixel) -> fb
      assert.ok(Math.abs(g.ex.t_css_to_fb_x(Math.floor((f + 0.5) * w / W)) - f) <= 1, `x ${w}x${h}@${dpr} fb ${f}`);
    }
    for (const f of [0, 1, Math.floor(H / 3), H - 1]) {
      assert.ok(Math.abs(g.ex.t_css_to_fb_y(Math.floor((f + 0.5) * h / H)) - f) <= 1, `y ${w}x${h}@${dpr} fb ${f}`);
    }
    for (const c of [0, 1, w >> 1, w - 1, w]) {              // css -> fb -> css within one logical pixel
      const back = (g.ex.t_css_to_fb_x(c) + 0.5) * w / W;
      assert.ok(Math.abs(back - c) <= w / W, `x css ${c} -> ${g.ex.t_css_to_fb_x(c)} -> ${back}`);
    }
    for (const c of [0, 1, h >> 1, h - 1, h]) {
      const back = (g.ex.t_css_to_fb_y(c) + 0.5) * h / H;
      assert.ok(Math.abs(back - c) <= h / H, `y css ${c} -> ${back}`);
    }
    assert.equal(g.ex.t_css_to_fb_x(w), W);
    assert.equal(g.ex.t_css_to_fb_y(h), H);
    assert.equal(g.ex.t_css_to_fb_x(0), 0);
  }
});

test('min_touch pinned values (ceil(44 css px) in logical px)', async () => {
  const mt = async (w, h, d) => (await setup(w, h, d)).ex.t_min_touch();
  assert.equal(await mt(360, 640, 100), 44);
  assert.equal(await mt(360, 640, 200), 44);   // 360x640 @2x -> pixelScale 2 -> logical 360x640
  assert.equal(await mt(1440, 900, 100), 15);  // logical 480x300 (scale 3): 44*480/1440 = 14.67 -> 15
  assert.equal(await mt(1440, 900, 200), 18);  // logical 576x360 (scale 5): 17.6 -> 18
});

test('set_flags(large) is deterministic, reversible, and only touches layout memory', async () => {
  const g = await setup(360, 640, 100);
  const snapR = () => new Uint8Array(g.ex.memory.buffer.slice(R_LAYOUT, R_LAYOUT + 0x200));
  const base = snapR();
  const all0 = all(g);
  g.ex.set_flags(0, 1);
  const big = all(g);
  assert.notDeepEqual(big, all0);
  assert.equal(g.ex.t_ui_ts(), 2);
  assert.ok(big.ENDDAY.h > all0.ENDDAY.h, 'bigger rects');
  assert.ok(big.TABS.h > all0.TABS.h);
  const bigAgain = (g.ex.set_flags(0, 1), all(g));
  assert.deepEqual(bigAgain, big);
  g.ex.set_flags(0, 0);
  assert.deepEqual(all(g), all0);
  assert.deepEqual(snapR(), base);
  g.ex.set_flags(1, 0);   // reduced motion alone does not move anything
  assert.deepEqual(all(g), all0);
});

test('same inputs -> identical rects on two instances; layout never touches sim state or rng', async () => {
  const a = await setup(390, 844, 200, 1, 1), b = await setup(390, 844, 200, 1, 1);
  assert.deepEqual(all(a), all(b));
  const g = await loadGame();
  g.ex.init(9);
  const sim = () => g.mem().slice(STATE.base, STATE.base + 0x1000);
  const s0 = sim();
  const r0 = g.ex.t_rng_next();
  g.ex.init(9);
  for (const [w, h, d, l] of [[360, 640, 100, 0], [1440, 900, 200, 1], [320, 568, 100, 1], [768, 1024, 200, 0]]) {
    g.ex.resize(w, h, d); g.ex.set_flags(0, l); g.ex.t_layout_panel(1); g.ex.set_env(123, 456);
  }
  g.ex.t_layout_panel(0);
  assert.deepEqual(sim(), s0);
  assert.equal(g.ex.t_rng_next(), r0);
  assert.equal(g.ex.t_canary_ok(), 1);
});

test('set_env stores seed and daily seed in the UI block', async () => {
  const g = await setup(360, 640, 100);
  g.ex.set_env(0xdeadbeef | 0, 20261026);
  const dv = new DataView(g.ex.memory.buffer);
  assert.equal(dv.getUint32(R_LAYOUT + 0x118, true), 0xdeadbeef);
  assert.equal(dv.getInt32(R_LAYOUT + 0x11c, true), 20261026);
});

test('layout survives hostile sizes (0, huge, no resize)', async () => {
  const g = await loadGame();
  g.ex.set_flags(1, 1);                       // before any resize: nothing to lay out
  assert.equal(g.ex.t_lay_w(ID.ENDDAY), 0);
  for (const [w, h, d] of [[0, 0, 100], [1, 1, 100], [2147483647, 2147483647, 2147483647], [100, 5000, 100], [5000, 100, 100]]) {
    g.ex.resize(w, h, d);
    g.ex.set_flags(0, 1);
    for (let id = 0; id < 16; id++) g.ex.t_lay_w(id);
    assert.equal(g.ex.t_canary_ok(), 1);
  }
});
