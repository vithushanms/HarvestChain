// UI test harness + canned UI states (tests/render/ui.test.mjs, tools/dump-ppm.mjs ui-*).
// Everything goes through the public exports (pointer / key / frame) in CSS px, the way the
// loader drives the module; t_ui / t_ui_btn / t_ui_toast only observe.
import { loadGame, STATE } from '../helpers.mjs';
import { farm, CROP, BLD } from './scenes.mjs';

export const HIT = { ENDDAY: 1, HARVALL: 2, DAY: 3, CLOSE: 4, PANEL: 5, GRID: 6, TOPBAR: 7, TAB0: 10 };
// Dynamic panel button codes (src/22a_farm.wat header).
export const BTN = { PICK_PLANT: 0x200, PICK_BUILD: 0x201, HARVEST: 0x202, DEMOLISH: 0x203, UPGRADE: 0x204,
  RECIPE_PREV: 0x205, RECIPE_NEXT: 0x206, BUY_LAND: 0x207, PLANT: 0x210, BUILD: 0x220,
  // Task 5b tabs (src/22b_tabs.wat header)
  SELL: 0x208, FILL: 0x209, SEND: 0x20A, BUY_TRUCK: 0x20B, NEXT: 0x20C, BACK: 0x20D, TAKE: 0x20E, REPAY: 0x20F,
  SUB: 0x230, CANCEL: 0x233, DEST: 0x238, MINUS: 0x240, PLUS: 0x250, MAX: 0x260, ACCEPT: 0x270, DECLINE: 0x274,
  DISPATCH: 0x280, UPG: 0x290, TAG: 0x2A0, NO_TAG: 0x2A3, LOCATE: 0x300, RPREV: 0x340, RNEXT: 0x380 };
// Key codes (tools/keycodes.json).
export const KEY = { E: 1, H: 2, D1: 3, D2: 4, D3: 5, D4: 6, D5: 7, ESC: 8, UP: 9, DOWN: 10, LEFT: 11, RIGHT: 12, ENTER: 13, BACKQUOTE: 14, R: 15, SPACE: 16 };
// t_ui(k) fields.
export const UI = { SEL: 0, SHEET: 1, PICK: 2, SCROLL: 3, SCROLL_MAX: 4, HOVER: 5, BTN_N: 6, TOASTS: 7, ARM: 8, DIRTY: 9, SLIDE: 10, IN_ST: 11,
  TAB: 12, MSUB: 13, PLACE: 14, DSP: 15, DSTEP: 16, DM: 17, DC: 18, LABELS: 19 };
const LABELS = 0xA100;   // text of every $ui_label drawn last frame, NUL-separated (22_ui.wat)
const R_HIT = 0x8200;

export async function uiGame(w = 360, h = 640, dpr = 200, o = {}) {
  const g = await loadGame();
  const ex = g.ex;
  ex.t_lab_on(1);
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
  // every wrapped label line ($ui_label) drawn by the last frame
  g.labels = () => { const m = g.mem(), end = ex.t_ui(UI.LABELS), out = []; let s = '';
    for (let p = LABELS; p < end; p++) { if (m[p]) s += String.fromCharCode(m[p]); else { out.push(s); s = ''; } } return out; };
  g.tabTo = (t) => { g.tap(HIT.TAB0 + t); g.settle(); };
  // tap a panel button, scrolling the sheet (drag) until it is fully visible
  g.reach = (code) => {
    g.frame();
    const drag = (dy) => { const p = g.hit(HIT.PANEL), [x, y] = g.toCss(p.x + 3, p.y + (p.h >> 1)); g.down(x, y); g.ex.pointer(x, y + dy, 1); g.up(x, y + dy); };
    for (let i = 0; i < 40 && g.ui(UI.SCROLL) > 0 && !g.hit(code); i++) drag(30);   // up (never a dismiss: scroll > 0)
    for (let i = 0; i < 60 && !g.hit(code); i++) { const s0 = g.ui(UI.SCROLL); drag(-30); if (g.ui(UI.SCROLL) === s0) break; }
    g.frame();
    return g.hit(code);
  };
  g.tapR = (code) => { if (!g.reach(code)) throw new Error(`cannot reach 0x${code.toString(16)}`); g.tap(code); };
  g.cash = () => new DataView(ex.memory.buffer).getInt32(STATE.base + STATE.fields.cash.off, true);
  g.tile = (i) => g.mem()[STATE.base + STATE.fields.tiles.off + i * 8];
  return g;
}

// Board / accepted contract record poke {good, market, qty, deadline, payout}.
export const putContract = (ex, field, slot, c) => {
  const dv = new DataView(ex.memory.buffer), a = STATE.base + STATE.fields[field].off + slot * 8;
  dv.setUint8(a, c.good); dv.setUint8(a + 1, c.market); dv.setUint8(a + 2, c.qty); dv.setUint8(a + 3, field === 'accepted' ? 1 : 0);
  dv.setUint16(a + 4, c.deadline, true); dv.setUint16(a + 6, c.payout, true);
};
const procFarm = (ex) => {
  farm(ex).bld(10, BLD.MILL, { recipe: 1 }).bld(11, BLD.CELLAR, { recipe: 8 }).bld(2, BLD.CANNERY, { upgraded: true });
  const dv = new DataView(ex.memory.buffer), c = STATE.base + STATE.fields.cellar.off + 11 * 5;
  dv.setUint8(c, 2); dv.setUint8(c + 2, 4);
  ex.t_give(0, 9, 0); ex.t_give(2, 6, 1); ex.t_give(9, 3, 0);
};
const contractFarm = (ex) => {
  putContract(ex, 'accepted', 0, { good: 5, market: 1, qty: 6, deadline: 6, payout: 198 });
  putContract(ex, 'accepted', 1, { good: 7, market: 2, qty: 9, deadline: 3, payout: 540 });
  ex.t_give(5, 8, 0); ex.t_give(2, 6, 0); ex.t_give(0, 10, 0); ex.t_give(7, 9, 0);
};
const truckFarm = (ex) => {
  farm(ex).bld(10, BLD.GARAGE).truck(1, { phase: 1, dest: 2, daysLeft: 1, fridge: true });
  ex.t_set_cash(900);
};
// to the City: 9 Sauce (contract 1) + 4 Tomato (they spoil on the way); to Town: 6 Flour (contract 0)
const dispatch = (g, m) => {
  g.tabTo(3); g.tapR(BTN.DISPATCH); g.tapR(BTN.DEST + m);
  if (m === 2) { g.tapR(BTN.MAX + 7); for (let i = 0; i < 4; i++) g.tapR(BTN.PLUS + 2); } else for (let i = 0; i < 6; i++) g.tapR(BTN.PLUS + 5);
  g.tapR(BTN.NEXT);
};

// Canned UI states: [w, h, dpr, options, script]. Rendered at a fixed time so hashes are stable.
const poor = (ex) => farm(ex).day(3);
// [name, state] in order; names must be unique (asserted in tests/render/ui.test.mjs).
export const UI_STATE_LIST = [
  ['ui-farm', { o: {}, run: () => {} }],
  ['ui-plant', { o: {}, run: (g) => g.tapTile(9) }],
  ['ui-build', { o: {}, run: (g) => { g.tapTile(9); g.tap(BTN.PICK_BUILD); } }],
  ['ui-crop', { o: {}, run: (g) => g.tapTile(0) }],
  ['ui-recipe', { o: { setup: (ex) => farm(ex).bld(10, BLD.MILL, { recipe: 1 }).bld(17, BLD.CELLAR) }, run: (g) => g.tapTile(10) }],
  ['ui-toast', { o: {}, run: (g) => { g.tapTile(0); g.tap(BTN.HARVEST); } }],
  ['ui-large', { o: { large: true }, run: (g) => g.tapTile(9) }],
  ['ui-poor', { o: { setup: (ex) => { poor(ex); ex.t_set_cash(25); } }, run: (g) => { g.tapTile(9); g.tap(BTN.PICK_BUILD); } }],
  ['ui-ripe', { o: { setup: (ex) => farm(ex).crop(0, CROP.WHEAT, 'ripe').crop(1, CROP.TOMATO, 'ripe', { ripeAge: 1 }).crop(8, CROP.APPLE, 400) }, run: (g) => g.tapTile(1) }],
  ['ui-land', { o: {}, run: (g) => g.tapTile(4) }],
  ['ui-endday', { o: { setup: (ex) => farm(ex).crop(9, CROP.TOMATO, 'ripe', { ripeAge: 1 }).crop(10, CROP.GRAPE, 500) }, run: (g) => { g.tap(HIT.ENDDAY); g.tap(HIT.DAY); } }],
  // Task 5b tabs
  ['ui-process', { o: { setup: procFarm }, run: (g) => g.tabTo(1) }],
  ['ui-market-prices', { o: { setup: (ex) => { ex.t_put_event(0, 1, 2, 10, 4); ex.t_put_event(1, 3, 0, 0, 2); ex.t_set_sat(1, 5, 7600); ex.t_set_sat(0, 0, 8000); } }, run: (g) => g.tabTo(2) }],
  ['ui-market-sell', { o: { setup: (ex) => { ex.t_give(0, 12, 0); ex.t_give(5, 6, 0); ex.t_give(2, 4, 1); } },
    run: (g) => { g.tabTo(2); g.tap(BTN.SUB + 1); for (let i = 0; i < 5; i++) g.tapR(BTN.PLUS); } }],
  ['ui-market-contracts', { o: { setup: contractFarm }, run: (g) => { g.tabTo(2); g.tap(BTN.SUB + 2); } }],
  ['ui-trucks', { o: { setup: truckFarm }, run: (g) => g.tabTo(3) }],
  ['ui-dispatch-1', { o: { setup: contractFarm }, run: (g) => { g.tabTo(3); g.tapR(BTN.DISPATCH); } }],
  ['ui-dispatch-2', { o: { setup: contractFarm }, run: (g) => { g.tabTo(3); g.tapR(BTN.DISPATCH); g.tapR(BTN.DEST + 2); g.tapR(BTN.PLUS + 2); g.tapR(BTN.PLUS + 5); g.tapR(BTN.PLUS + 5); } }],
  ['ui-dispatch-3', { o: { setup: contractFarm }, run: (g) => { dispatch(g, 2); } }],
  ['ui-dispatch-4', { o: { setup: contractFarm }, run: (g) => { dispatch(g, 2); g.tapR(BTN.TAG + 1); g.tapR(BTN.NEXT); } }],
  ['ui-build-tab', { o: { setup: (ex) => farm(ex).bld(10, BLD.MILL) }, run: (g) => g.tabTo(4) }],
  ['ui-build-placement', { o: {}, run: (g) => { g.tabTo(4); g.tapR(BTN.BUILD + BLD.WELL); } }],
  ['ui-loans', { o: { setup: (ex) => { const dv = new DataView(ex.memory.buffer); dv.setInt32(STATE.base + STATE.fields.loanPrincipal.off, 600, true); dv.setInt32(STATE.base + STATE.fields.loanInterest.off, 12, true); } },
    run: (g) => { g.tabTo(4); g.reach(BTN.REPAY); } }],
];
export const UI_STATES = {};
for (const [name, s] of UI_STATE_LIST) {
  if (UI_STATES[name]) throw new Error(`duplicate UI state ${name}`);
  UI_STATES[name] = s;
}

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
