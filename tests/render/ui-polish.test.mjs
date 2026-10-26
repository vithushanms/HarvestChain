// UI polish (Task 5a fix round 1, part 2): scroll clamping, kit contrast, laptop side panel
// placement and keeping the selected plot in view. Driven through the public exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLD } from './scenes.mjs';
import { uiGame, BTN, UI } from './uistates.mjs';
import { ICONS, ICON_ADDR } from '../../tools/gen-strings.mjs';

test('scroll is clamped before the sheet body is drawn: the first redraw after a resize registers final regions', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_set_cash(5000) });
  g.tapTile(9);
  g.tap(BTN.PICK_BUILD);
  g.settle();
  const r = g.hit(BTN.BUILD + BLD.MILL);
  const [x, y] = g.toCss(r.x + 10, r.y + 10);
  g.down(x, y); g.ex.pointer(x, y - 600, 1); g.up(x, y - 600);
  const max0 = g.ui(UI.SCROLL_MAX);
  assert.equal(g.ui(UI.SCROLL), max0);
  g.ex.resize(360, 900, 200);
  g.css = [360, 900];
  g.ex.frame(g.t += 16);           // one render after the resize
  const first = g.hits().filter((h) => h.code >= 0x200);
  assert.ok(g.ui(UI.SCROLL) <= g.ui(UI.SCROLL_MAX), 'scroll within the new range');
  g.ex.frame(g.t += 16);
  const second = g.hits().filter((h) => h.code >= 0x200);
  assert.deepEqual(first, second, 'regions from the first redraw are final');
  // a tap right after the resize (no frame in between) acts on the fresh regions
  const toBottom = (q) => {
    q.tapTile(9); q.tap(BTN.PICK_BUILD); q.settle();
    const m = q.hit(BTN.BUILD + BLD.MILL);
    const [mx, my] = q.toCss(m.x + 10, m.y + 10);
    q.down(mx, my); q.ex.pointer(mx, my - 900, 1); q.up(mx, my - 900); q.settle();
  };
  const ref = await uiGame(360, 900, 200, { setup: (ex) => ex.t_set_cash(5000) });
  toBottom(ref);
  assert.ok(ref.ui(UI.SCROLL) > 0 && ref.ui(UI.SCROLL) < max0, 'the taller sheet still scrolls, but less');
  const want = ref.hit(BTN.BUILD + BLD.GARAGE);
  const t = await uiGame(360, 640, 200, { setup: (ex) => ex.t_set_cash(5000) });
  toBottom(t);
  t.ex.resize(360, 900, 200); t.css = [360, 900];
  const [tx, ty] = t.toCss(want.x + (want.w >> 1), want.y + (want.h >> 1));
  t.ex.pointer(tx, ty, 0); t.ex.pointer(tx, ty, 2);
  assert.equal(t.tile(9), 2, 'built from the fresh layout');
  assert.match(t.announce(), /BUILT GARAGE/);
});

// WCAG contrast of every text / background pair the UI kit draws (palette from wasm memory).
test('UI kit text contrast >= 4.5:1 for every pair (dimmed inactive tabs excepted)', async () => {
  const g = await uiGame();
  const rgb = (i) => { const v = g.ex.t_pal(i) >>> 0; return [v & 255, (v >> 8) & 255, (v >> 16) & 255]; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = ([r, gg, b]) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
  const ratio = (a, b) => { const [x, y] = [L(rgb(a)), L(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const m = g.mem();
  const pairs = [];
  // button styles (0x900: border, face, pressed face, text, second line); disabled reason = 37
  for (let s = 0; s < 7; s++) {
    const [, f, pf, tc, c2] = m.slice(0x900 + s * 5, 0x905 + s * 5);
    for (const face of [f, pf]) pairs.push([`btn${s} text`, tc, face], [`btn${s} 2nd`, s === 5 ? 37 : c2, face]);
  }
  // toast text 59 on the face per kind (0x92C)
  for (let k = 1; k <= 3; k++) pairs.push([`toast ${k}`, 59, m[0x92C + k]]);
  // count badge colours at 0x935 (face, text)
  assert.ok(m[0x935] && m[0x936], 'badge colours are data');
  pairs.push(['badge', m[0x936], m[0x935]]);
  // sheet / panel text on paper 58; cards on 59 (pressed 58); active tab 61 on 59; recipe box on 57
  for (const c of [60, 61, 63, 37]) pairs.push([`sheet ${c}`, c, 58], [`card ${c}`, c, 59]);
  pairs.push(['tab active', 61, 59], ['recipe', 61, 57], ['recipe off', 63, 57]);
  for (const [n, a, b] of pairs) assert.ok(ratio(a, b) >= 4.5, `${n}: ${a} on ${b} = ${ratio(a, b).toFixed(2)}`);
  // non-text marks >= 3:1: the toggle-on check icon's stroke (icon colour 2) on the toggle face, pressed too
  const chk = ICON_ADDR + ICONS.findIndex(([n]) => n === 'CHECK') * 24;
  const [, f3, pf3] = m.slice(0x900 + 6 * 5, 0x905 + 6 * 5);   // style 6 = toggle on
  for (const face of [f3, pf3]) assert.ok(ratio(m[chk + 22], face) >= 3, `toggle check ${m[chk + 22]} on ${face} = ${ratio(m[chk + 22], face).toFixed(2)}`);
});

test('laptop: the side panel and tabs are flush with the right edge; GRID fills the rest, farm centred', async () => {
  for (const [w, h, d] of [[1280, 800, 100], [1440, 900, 100], [1024, 768, 100], [640, 360, 200]]) {
    const g = await uiGame(w, h, d);
    g.frame();
    const W = g.ex.fb_w();
    const P = { x: g.ex.t_lay_x(13), w: g.ex.t_lay_w(13) }, T = { x: g.ex.t_lay_x(7), w: g.ex.t_lay_w(7) };
    const G = { x: g.ex.t_lay_x(6), w: g.ex.t_lay_w(6) };
    assert.equal(P.x + P.w, W, `${w}x${h} panel flush`);
    assert.equal(T.x + T.w, W, `${w}x${h} tabs flush`);
    assert.ok(G.x + G.w <= P.x, `${w}x${h} grid left of the panel`);
    assert.ok(Math.abs(G.x - (P.x - G.x - G.w)) <= 1, `${w}x${h} grid centred in the free area`);
  }
});

test('a selected next-ring plot stays inside the visible GRID area (laptop and portrait)', async () => {
  for (const [w, h, d] of [[1280, 800, 100], [1440, 900, 100], [360, 640, 200], [640, 360, 200]]) {
    const g = await uiGame(w, h, d);
    g.tapTile(4);
    assert.equal(g.ui(UI.SEL), 4, `${w}x${h}`);
    const G = { x: g.ex.t_lay_x(6), y: g.ex.t_lay_y(6), w: g.ex.t_lay_w(6), h: g.ex.t_lay_h(6) };
    const x = g.ex.t_tile_rect(4, 0), y = g.ex.t_tile_rect(4, 1), tw = g.ex.t_tile_rect(4, 2), th = g.ex.t_tile_rect(4, 3);
    assert.ok(x >= G.x && x + tw <= G.x + G.w && y >= G.y && y + th <= G.y + G.h, `${w}x${h} tile 4 ${[x, y, tw, th]} in ${JSON.stringify(G)}`);
  }
});
