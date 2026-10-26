// UI test harness + canned UI states (tests/render/ui.test.mjs, tools/dump-ppm.mjs ui-*).
// Everything goes through the public exports (pointer / key / frame) in CSS px, the way the
// loader drives the module; t_ui / t_ui_btn / t_ui_toast only observe.
import { loadGame, STATE } from '../helpers.mjs';
import { farm, CROP, BLD } from './scenes.mjs';

export const HIT = { ENDDAY: 1, HARVALL: 2, DAY: 3, CLOSE: 4, PANEL: 5, GRID: 6, TOPBAR: 7, TAB0: 10 };
// Dynamic panel button codes (src/22a_farm.wat header).
export const BTN = { PICK_PLANT: 0x200, PICK_BUILD: 0x201, HARVEST: 0x202, DEMOLISH: 0x203, UPGRADE: 0x204,
  RECIPE_PREV: 0x205, RECIPE_NEXT: 0x206, BUY_LAND: 0x207, PLANT: 0x210, BUILD: 0x220 };
// Key codes (tools/keycodes.json).
export const KEY = { E: 1, H: 2, D1: 3, D2: 4, D3: 5, D4: 6, D5: 7, ESC: 8, UP: 9, DOWN: 10, LEFT: 11, RIGHT: 12, ENTER: 13, BACKQUOTE: 14, R: 15, SPACE: 16 };
// t_ui(k) fields.
export const UI = { SEL: 0, SHEET: 1, PICK: 2, SCROLL: 3, SCROLL_MAX: 4, HOVER: 5, BTN_N: 6, TOASTS: 7, ARM: 8, DIRTY: 9, SLIDE: 10, IN_ST: 11 };
const R_HIT = 0x8200;

export async function uiGame(w = 360, h = 640, dpr = 200, o = {}) {
  const g = await loadGame();
  const ex = g.ex;
  ex.resize(w, h, dpr);
  ex.set_flags(o.reduced ? 1 : 0, o.large ? 1 : 0);
  ex.ui_new_game(o.seed ?? 5);
  if (o.setup) { o.setup(ex); ex.ui_loaded(); }
  ex.ack_save();
  g.css = [w, h];
  g.t = 1000;
  g.frame = (dt = 16) => ex.frame(g.t += dt);
  g.settle = () => { for (let i = 0; i < 40; i++) g.frame(); };
  g.str = (p) => { const m = g.mem(); let s = ''; while (p && m[p]) s += String.fromCharCode(m[p++]); return s; };
  g.ui = (k) => ex.t_ui(k);
  g.toCss = (lx, ly) => [Math.floor(((lx + 0.5) * g.css[0]) / ex.fb_w()), Math.floor(((ly + 0.5) * g.css[1]) / ex.fb_h())];
  g.down = (x, y) => { ex.pointer(x, y, 0); g.frame(); };
  g.up = (x, y) => { ex.pointer(x, y, 2); g.frame(); };
  g.tapCss = (x, y) => { g.down(x, y); g.up(x, y); };
  g.hits = () => {
    const dv = new DataView(ex.memory.buffer);
    return Array.from({ length: ex.t_hit_n() }, (_, i) => {
      const a = R_HIT + i * 20;
      return { x: dv.getInt32(a, true), y: dv.getInt32(a + 4, true), w: dv.getInt32(a + 8, true), h: dv.getInt32(a + 12, true), code: dv.getInt32(a + 16, true), i };
    });
  };
  g.hit = (code) => g.hits().filter((r) => r.code === code).pop();
  g.tap = (code) => {
    g.frame();
    const r = g.hit(code);
    if (!r) throw new Error(`no hit region 0x${code.toString(16)}`);
    g.tapCss(...g.toCss(r.x + (r.w >> 1), r.y + (r.h >> 1)));
  };
  g.tileCss = (i) => g.toCss(ex.t_tile_rect(i, 0) + (ex.t_tile_rect(i, 2) >> 1), ex.t_tile_rect(i, 1) + (ex.t_tile_rect(i, 3) >> 1));
  g.tapTile = (i) => { g.frame(); g.tapCss(...g.tileCss(i)); g.settle(); };   // settle: let the sheet finish sliding in
  g.key = (code) => { ex.key(code, 1); ex.key(code, 0); g.frame(); };
  g.btns = () => Array.from({ length: g.ui(UI.BTN_N) }, (_, i) => {
    const a = ex.t_ui_btn(i), dv = new DataView(ex.memory.buffer);
    return { code: dv.getInt32(a, true), en: dv.getInt32(a + 4, true), label: g.str(a + 8), reason: g.str(a + 36) };
  });
  g.btn = (code) => g.btns().find((b) => b.code === code);
  g.toasts = () => [0, 1, 2].map((i) => g.str(ex.t_ui_toast(i))).filter(Boolean);
  g.announce = () => g.str(ex.announce_ptr()).slice(0, ex.announce_len());
  g.cash = () => new DataView(ex.memory.buffer).getInt32(STATE.base + STATE.fields.cash.off, true);
  g.tile = (i) => g.mem()[STATE.base + STATE.fields.tiles.off + i * 8];
  return g;
}

// Canned UI states: [w, h, dpr, options, script]. Rendered at a fixed time so hashes are stable.
const poor = (ex) => farm(ex).day(3);
export const UI_STATES = {
  'ui-farm': { o: {}, run: () => {} },
  'ui-plant': { o: {}, run: (g) => g.tapTile(9) },
  'ui-build': { o: {}, run: (g) => { g.tapTile(9); g.tap(BTN.PICK_BUILD); } },
  'ui-crop': { o: {}, run: (g) => g.tapTile(0) },
  'ui-recipe': { o: { setup: (ex) => farm(ex).bld(10, BLD.MILL, { recipe: 1 }).bld(17, BLD.CELLAR) }, run: (g) => g.tapTile(10) },
  'ui-toast': { o: {}, run: (g) => { g.tapTile(0); g.tap(BTN.HARVEST); } },
  'ui-large': { o: { large: true }, run: (g) => g.tapTile(9) },
  'ui-poor': { o: { setup: (ex) => { poor(ex); ex.t_set_cash(25); } }, run: (g) => { g.tapTile(9); g.tap(BTN.PICK_BUILD); } },
  'ui-ripe': { o: { setup: (ex) => farm(ex).crop(0, CROP.WHEAT, 'ripe').crop(1, CROP.TOMATO, 'ripe', { ripeAge: 1 }).crop(8, CROP.APPLE, 400) }, run: (g) => g.tapTile(1) },
  'ui-land': { o: {}, run: (g) => g.tapTile(4) },
  'ui-endday': { o: { setup: (ex) => farm(ex).crop(9, CROP.TOMATO, 'ripe', { ripeAge: 1 }).crop(10, CROP.GRAPE, 500) }, run: (g) => { g.tap(HIT.ENDDAY); g.tap(HIT.DAY); } },
};

// Build a UI state at a size and return the game handle with a freshly drawn frame.
export async function uiState(name, w = 360, h = 640, dpr = 200) {
  const s = UI_STATES[name];
  const g = await uiGame(w, h, dpr, s.o);
  g.frame();
  s.run(g);
  g.ex.set_flags(1, s.o.large ? 1 : 0);   // freeze ambient motion (scene time 0) for a stable image
  g.frame();
  return g;
}
