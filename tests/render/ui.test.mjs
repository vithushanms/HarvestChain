import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { STATE, readState } from '../helpers.mjs';
import { farm, CROP, BLD } from './scenes.mjs';
import { uiGame, uiState, UI_STATES, HIT, BTN, KEY, UI } from './uistates.mjs';
import { generate as genStrings, strBytes, FILE as STR_FILE } from '../../tools/gen-strings.mjs';
import { extract } from '../../tools/gen-util.mjs';

const R_LAYOUT = 0x8000;
const staticN = (g) => new DataView(g.ex.memory.buffer).getInt32(R_LAYOUT + 0x128, true);
const simBytes = (g) => g.mem().slice(STATE.base, STATE.base + STATE.length);
const day = (g) => readState(g.mem()).day;
const EMPTY = 9;          // (1,1): empty owned plot on a fresh 4x4 farm
const WHEAT0 = 0;         // (0,0): starting Wheat, 2 of 3 days grown

test('string table: committed data matches tools/gen-strings.mjs; budget 2.5 KB', () => {
  assert.equal(extract('strings', STR_FILE), genStrings());
  const s = strBytes();
  assert.ok(s.size <= 2560, `string table ${s.size} B`);
  for (const e of s.out) assert.ok(e.text.length <= 32, `"${e.text}" longer than 32 chars`);
});

test('error map covers every error code in tools/balance.json', async () => {
  const bal = JSON.parse(readFileSync('tools/balance.json', 'utf8'));
  const g = await uiGame();
  for (let e = 0; e < bal.enums.errors.length; e++) {
    const t = g.str(g.ex.t_err_str(e));
    assert.ok(t.length > 2 && t === t.toUpperCase(), `${bal.enums.errors[e]} -> "${t}"`);
  }
  assert.equal(g.str(g.ex.t_err_str(5)), 'OUT OF SEASON');
  assert.equal(g.str(g.ex.t_err_str(6)), 'NOT ENOUGH CASH');
  assert.equal(g.str(g.ex.t_err_str(9)), 'STORAGE FULL');
  assert.equal(g.str(g.ex.t_err_str(8)), 'NOT RIPE YET');
});

test('tools/keycodes.json matches the key table documented in src/22_ui.wat', () => {
  const kc = JSON.parse(readFileSync('tools/keycodes.json', 'utf8'));
  const src = readFileSync('src/22_ui.wat', 'utf8');
  assert.deepEqual(
    { E: kc.KeyE, H: kc.KeyH, D1: kc.Digit1, D2: kc.Digit2, D3: kc.Digit3, D4: kc.Digit4, D5: kc.Digit5, ESC: kc.Escape, UP: kc.ArrowUp,
      DOWN: kc.ArrowDown, LEFT: kc.ArrowLeft, RIGHT: kc.ArrowRight, ENTER: kc.Enter, BACKQUOTE: kc.Backquote, R: kc.KeyR, SPACE: kc.Space }, KEY);
  for (const [code, n] of Object.entries(kc)) if (!/^_|^Digit/.test(code)) assert.ok(src.includes(`${n} ${code}`), `${code} = ${n} documented`);
  assert.ok(src.includes('3..7 Digit1..5'));
});

test('input and frames before the first resize (0x0 framebuffer) do not trap', async () => {
  const { loadGame } = await import('../helpers.mjs');
  const g = await loadGame();
  g.ex.ui_new_game(3);
  assert.equal(typeof g.ex.frame(0), 'number');
  g.ex.pointer(10, 10, 0); g.ex.pointer(30, 10, 1); g.ex.pointer(30, 10, 2);
  for (let k = 1; k <= 16; k++) g.ex.key(k, 1);
  g.ex.frame(500);
  g.ex.resize(360, 640, 200);
  g.ex.frame(600);
  assert.ok(g.ex.t_canary_ok());
});

test('number formatting: money with thousands separators and sign', async () => {
  const g = await uiGame();
  const f = (n, m) => g.str(g.ex.t_fmt(n, m));
  assert.equal(f(0, 0), '0');
  assert.equal(f(1234567, 0), '1234567');
  assert.equal(f(-42, 0), '-42');
  assert.equal(f(1234, 1), '$1,234');
  assert.equal(f(-50, 1), '-$50');
  assert.equal(f(2147483647, 1), '$2,147,483,647');
  assert.equal(f(1000000, 1), '$1,000,000');
});

test('tap an empty plot at 360x640 (dpr 2): sheet opens on the crop picker, tile selected', async () => {
  const g = await uiGame(360, 640, 200);
  g.frame();
  assert.equal(g.ui(UI.SHEET), 0);
  g.tapTile(EMPTY);
  assert.equal(g.ui(UI.SEL), EMPTY);
  assert.equal(g.ui(UI.SHEET), 1);
  assert.equal(g.ex.t_panel_open(), 1);
  g.settle();
  const plant = [0, 1, 2, 3, 4].map((c) => g.btn(BTN.PLANT + c));
  assert.ok(plant.every(Boolean), 'five crop rows');
  assert.equal(plant[0].label, 'WHEAT');
  assert.equal(plant[0].en, 1);
  assert.equal(plant[1].en, 0, 'Corn is out of season in Spring');
  assert.equal(plant[1].reason, 'OUT OF SEASON');
});

test('Plant Wheat through the sheet: cash drops by the seed cost, tile becomes a crop, save requested', async () => {
  const g = await uiGame();
  g.tapTile(EMPTY);
  g.settle();
  const seq = g.ex.announce_seq();
  g.tap(BTN.PLANT + CROP.WHEAT);
  assert.equal(g.cash(), 490);
  assert.equal(g.tile(EMPTY), 1);
  assert.equal(g.ex.need_save(), 1);
  g.ex.ack_save();
  assert.equal(g.ex.need_save(), 0);
  assert.ok(g.ex.announce_seq() > seq);
  assert.match(g.announce(), /PLANTED WHEAT/);
  g.settle();
  assert.ok(g.btn(BTN.HARVEST), 'sheet now shows the crop with a Harvest button');
});

test('Harvest an unripe crop: button disabled with its reason; tapping it toasts the reason, state untouched', async () => {
  const g = await uiGame();
  g.tapTile(WHEAT0);
  g.settle();
  const b = g.btn(BTN.HARVEST);
  assert.equal(b.en, 0);
  assert.equal(b.reason, 'NOT RIPE YET');
  const before = simBytes(g);
  g.tap(BTN.HARVEST);
  assert.deepEqual(simBytes(g), before);
  assert.ok(g.toasts().includes('NOT RIPE YET'), JSON.stringify(g.toasts()));
  assert.match(g.announce(), /NOT RIPE YET/);
  assert.equal(g.ex.need_save(), 0);
});

test('End Day button: day advances, toast summary, need_save until ack', async () => {
  const g = await uiGame();
  g.tap(HIT.ENDDAY);
  assert.equal(day(g), 2);
  assert.equal(g.ex.need_save(), 1);
  assert.ok(g.toasts().some((t) => t.startsWith('DAY 2')), JSON.stringify(g.toasts()));
  assert.match(g.announce(), /DAY 2/);
  assert.match(g.toasts()[0], /4 RIPE/, 'the four starting Wheat ripen overnight');
  g.ex.ack_save();
  assert.equal(g.ex.need_save(), 0);
});

test('Harvest All appears only with ripe crops; harvests them', async () => {
  const g = await uiGame();
  g.frame();
  assert.equal(g.hit(HIT.HARVALL), undefined);
  g.tap(HIT.ENDDAY);
  g.frame();
  assert.ok(g.hit(HIT.HARVALL));
  assert.equal(g.btn(HIT.HARVALL).label, 'HARVEST');
  g.tap(HIT.HARVALL);
  assert.equal(readState(g.mem()).inv[0], 16);
  assert.equal(g.tile(0), 0);
  g.frame();
  assert.equal(g.hit(HIT.HARVALL), undefined);
});

test('keyboard: E, H, 1-5, Esc, arrows + Enter', async () => {
  const g = await uiGame(1440, 900, 100);
  g.key(KEY.E);
  assert.equal(day(g), 2);
  g.key(KEY.H);
  assert.equal(readState(g.mem()).inv[0], 16);
  g.key(KEY.RIGHT);
  assert.equal(g.ui(UI.SEL), 0, 'first arrow focuses the top-left plot');
  g.key(KEY.RIGHT); g.key(KEY.DOWN);
  assert.equal(g.ui(UI.SEL), 9);
  assert.match(g.announce(), /PLOT 2,2/);
  g.key(KEY.LEFT); g.key(KEY.UP); g.key(KEY.UP);
  assert.equal(g.ui(UI.SEL), 0, 'clamped at the board edge');
  g.ex.resize(360, 640, 200); g.css = [360, 640];
  g.key(KEY.ENTER);
  assert.equal(g.ui(UI.SHEET), 1);
  g.key(KEY.D2);
  assert.equal(g.ui(UI.SHEET), 1, 'tabs 2-5 are not built yet: ignored');
  g.key(KEY.D1);
  g.key(KEY.ESC);
  assert.equal(g.ui(UI.SHEET), 0);
  assert.equal(g.ui(UI.SEL), -1);
  const before = simBytes(g);
  for (const k of [KEY.BACKQUOTE, KEY.R, 99, -1]) g.key(k);
  assert.deepEqual(simBytes(g), before, 'unmapped keys do nothing');
});

test('drag >= 40 css px down on the sheet dismisses it; a short drag does not', async () => {
  const g = await uiGame();
  g.tapTile(EMPTY);
  g.settle();
  const p = g.hit(HIT.PANEL);
  const [x, y] = g.toCss(p.x + 20, p.y + 30);
  g.down(x, y); g.ex.pointer(x, y + 20, 1); g.up(x, y + 20);
  assert.equal(g.ui(UI.SHEET), 1, '20 px drag keeps the sheet');
  g.down(x, y); g.ex.pointer(x, y + 20, 1); g.ex.pointer(x, y + 45, 1); g.up(x, y + 45);
  assert.equal(g.ui(UI.SHEET), 0);
  assert.equal(g.ui(UI.SEL), -1);
});

test('a slop-sized wiggle is still a tap; tap outside the sheet (sky) dismisses it', async () => {
  const g = await uiGame();
  g.frame();
  const [x, y] = g.tileCss(EMPTY);
  g.down(x, y); g.ex.pointer(x + 6, y - 5, 1); g.up(x + 6, y - 5);
  assert.equal(g.ui(UI.SHEET), 1, 'wiggle within 8 css px = tap');
  g.settle();
  g.tapCss(180, 90);   // sky above the farm
  assert.equal(g.ui(UI.SHEET), 0);
});

test('long-press a plot (held across frame timestamps) shows tile info without opening the sheet', async () => {
  const g = await uiGame();
  g.frame();
  const [x, y] = g.tileCss(WHEAT0);
  g.ex.pointer(x, y, 0);
  for (let i = 0; i < 25; i++) g.frame(16);   // 400 ms
  g.ex.pointer(x, y, 2); g.frame();
  assert.equal(g.ui(UI.SHEET), 0);
  assert.ok(g.toasts().some((t) => /WHEAT/.test(t)), JSON.stringify(g.toasts()));
});

test('demolish needs two taps within 3 s', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => farm(ex).bld(EMPTY, BLD.WELL) });
  g.tapTile(EMPTY);
  g.settle();
  g.tap(BTN.DEMOLISH);
  assert.equal(g.tile(EMPTY), 2, 'first tap only arms');
  g.frame();
  assert.equal(g.btn(BTN.DEMOLISH).label, 'TAP AGAIN');
  for (let i = 0; i < 200; i++) g.frame(20);    // 4 s: disarms
  assert.equal(g.btn(BTN.DEMOLISH).label, 'DEMOLISH');
  g.tap(BTN.DEMOLISH); g.tap(BTN.DEMOLISH);
  assert.equal(g.tile(EMPTY), 0);
  assert.match(g.announce(), /CLEARED WELL/);
});

test('recipe selector cycles OFF and the valid recipes of the building', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => farm(ex).bld(EMPTY, BLD.MILL) });
  g.tapTile(EMPTY);
  g.settle();
  const rec = () => g.mem()[STATE.base + STATE.fields.tiles.off + EMPTY * 8 + 7];
  assert.equal(rec(), 0);
  g.tap(BTN.RECIPE_NEXT); assert.equal(rec(), 1);
  g.tap(BTN.RECIPE_NEXT); assert.equal(rec(), 2);
  g.tap(BTN.RECIPE_NEXT); assert.equal(rec(), 0);
  g.tap(BTN.RECIPE_PREV); assert.equal(rec(), 2);
  assert.match(g.announce(), /CORN/);
});

test('build picker scrolls by vertical drag (clamped); only fully visible rows are tappable', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_set_cash(5000) });
  g.tapTile(EMPTY);
  g.tap(BTN.PICK_BUILD);
  g.settle();
  const max = g.ui(UI.SCROLL_MAX);
  assert.ok(max > 0, 'ten buildings overflow the sheet');
  assert.equal(g.hit(BTN.BUILD + BLD.GARAGE), undefined, 'Garage row is below the fold');
  assert.ok(g.btn(BTN.BUILD + BLD.GARAGE), 'but it is drawn into the list');
  const p = g.hit(BTN.BUILD + BLD.MILL);
  const [x, y] = g.toCss(p.x + 10, p.y + 10);
  g.down(x, y); g.ex.pointer(x, y - 30, 1); g.ex.pointer(x, y - 600, 1); g.up(x, y - 600);
  assert.equal(g.ui(UI.SCROLL), max, 'clamped at the bottom');
  assert.equal(g.tile(EMPTY), 0, 'a drag is not a tap');
  g.settle();
  assert.ok(g.hit(BTN.BUILD + BLD.GARAGE));
  g.tap(BTN.BUILD + BLD.GARAGE);
  assert.equal(g.tile(EMPTY), 2);
  assert.match(g.announce(), /BUILT GARAGE/);
  assert.equal(g.ui(UI.SCROLL), 0, 'a new plot view starts at the top');
});

test('disabled build buttons show their unlock / cash reasons', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_set_cash(260) });
  g.tapTile(EMPTY);
  g.tap(BTN.PICK_BUILD);
  g.settle();
  const r = (b) => g.btn(BTN.BUILD + b);
  assert.equal(r(BLD.MILL).en, 1);
  assert.equal(r(BLD.CANNERY).reason, 'NOT ENOUGH CASH');
  assert.equal(r(BLD.BAKERY).reason, 'NEEDS MILL');
  assert.equal(r(BLD.CELLAR).reason, 'NEEDS \x013');
  assert.equal(r(BLD.COLD).reason, 'NEEDS \x012');
  assert.equal(r(BLD.GREENHOUSE).reason, 'FROM DAY 41');
});

test('BUY LAND from an unowned next-ring plot refits: all owned tiles inside GRID', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => ex.t_set_cash(2000) });
  g.tapTile(4);                          // (4,0): the 5x5 ring
  g.settle();
  assert.ok(g.btn(BTN.BUY_LAND));
  g.tap(BTN.BUY_LAND);
  assert.equal(readState(g.mem()).grid, 5);
  assert.equal(g.cash(), 1400);
  assert.equal(g.ex.need_save(), 1);
  g.settle();
  const G = { x: g.ex.t_lay_x(6), y: g.ex.t_lay_y(6), w: g.ex.t_lay_w(6), h: g.ex.t_lay_h(6) };
  for (let i = 0; i < 64; i++) {
    if ((i & 7) >= 5 || (i >> 3) >= 5) continue;
    const x = g.ex.t_tile_rect(i, 0), y = g.ex.t_tile_rect(i, 1), w = g.ex.t_tile_rect(i, 2), h = g.ex.t_tile_rect(i, 3);
    assert.ok(x >= G.x && y >= G.y && x + w <= G.x + G.w && y + h <= G.y + G.h, `tile ${i}`);
  }
  g.tapTile(6 * 8 + 6);                   // (6,6): beyond the next ring
  g.settle();
  assert.equal(g.btn(BTN.BUY_LAND), undefined);
});

test('resize / rotate mid-sheet keeps the selection; hit table holds no stale panel buttons', async () => {
  const g = await uiGame();
  g.tapTile(EMPTY);
  g.settle();
  assert.ok(g.hits().some((r) => r.code >= 0x200));
  for (const [w, h, d] of [[640, 360, 200], [1440, 900, 100], [768, 1024, 100], [360, 640, 200]]) {
    g.ex.resize(w, h, d); g.css = [w, h];
    assert.equal(g.ex.t_hit_n(), staticN(g), `${w}x${h}: only static regions before the next draw`);
    g.frame();
    assert.equal(g.ui(UI.SEL), EMPTY);
    const W = g.ex.fb_w(), H = g.ex.fb_h();
    for (const r of g.hits()) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${w}x${h} region ${JSON.stringify(r)}`);
  }
  g.tap(BTN.PLANT);
  assert.equal(g.tile(EMPTY), 1);
});

test('pointer events during the slide never crash and act on what is drawn', async () => {
  const g = await uiGame();
  g.frame();
  g.tapCss(...g.tileCss(EMPTY));
  assert.ok(g.ui(UI.SLIDE) < 256);
  for (let i = 0; i < 6; i++) { const [x, y] = g.toCss(180, 500 + i * 20); g.tapCss(x, y); }
  g.settle();
  assert.ok(g.ex.t_canary_ok());
});

test('frame() return codes: 0 idle under reduced motion, 2 ambient clouds, 1 during the slide', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true });
  g.frame();
  assert.equal(g.frame(), 0);
  assert.equal(g.ex.frame(g.t += 100), 0);
  const a = await uiGame(360, 640, 200);
  a.frame();
  assert.equal(a.frame(), 2);
  a.tapCss(...a.tileCss(EMPTY));
  assert.equal(a.ex.frame(a.t + 20), 1, 'slide in progress');
  a.settle();
  assert.equal(a.frame(), 2);
  a.ex.set_flags(0, 0);
  const s = await uiGame(360, 640, 200, { setup: (ex) => farm(ex).weather(1) });
  s.frame();
  assert.equal(s.frame(), 1, 'rain particles animate every frame');
});

test('frames without input or animation do not redraw under reduced motion (framebuffer untouched)', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true });
  g.frame();
  const fb = () => g.mem().slice(g.ex.fb_ptr(), g.ex.fb_ptr() + g.ex.fb_w() * g.ex.fb_h() * 4);
  const f0 = fb();
  g.ex.t_fill(0);
  g.frame();
  assert.ok(fb().every((v) => v === 0), 'no draw happened');
  g.tapTile(EMPTY);
  assert.notDeepEqual(fb(), f0);
});

test('render-only frames, hover and long presses leave sim state and RNG byte-identical', async () => {
  const g = await uiGame(1440, 900, 100, { setup: (ex) => farm(ex).weather(3).crop(5, CROP.GRAPE, 'ripe') });
  const before = simBytes(g);
  for (let i = 0; i < 30; i++) { g.frame(37); g.ex.pointer(100 + i * 20, 200 + i * 9, 1); }
  g.tapTile(EMPTY); g.key(KEY.ESC); g.key(KEY.RIGHT); g.key(KEY.D3);
  const [x, y] = g.tileCss(1); g.ex.pointer(x, y, 0); for (let i = 0; i < 30; i++) g.frame(); g.ex.pointer(x, y, 2);
  g.frame();
  assert.deepEqual(simBytes(g), before);
});

test('hover on laptop highlights the tile and prints a status line', async () => {
  const g = await uiGame(1440, 900, 100);
  g.frame();
  const [x, y] = g.tileCss(WHEAT0);
  g.ex.pointer(x, y, 1);
  assert.equal(g.ui(UI.HOVER), WHEAT0);
  g.frame();
  g.ex.pointer(2, 2, 1);
  assert.equal(g.ui(UI.HOVER), -1);
});

test('toasts stack at most 3 and expire after 3 s', async () => {
  const g = await uiGame();
  g.tapTile(WHEAT0);
  g.settle();
  for (let i = 0; i < 5; i++) g.tap(BTN.HARVEST);
  assert.equal(g.ui(UI.TOASTS), 3);
  for (let i = 0; i < 200; i++) g.frame(20);
  assert.equal(g.ui(UI.TOASTS), 0);
});

test('announce sequence counter increments with every message; buffer >= 256 bytes ring', async () => {
  const g = await uiGame();
  const s0 = g.ex.announce_seq();
  for (let i = 0; i < 40; i++) g.tap(HIT.ENDDAY);
  assert.equal(g.ex.announce_seq(), s0 + 40);
  assert.match(g.announce(), /^DAY 41/);
  const p = g.ex.announce_ptr();
  assert.ok(p >= 0x8000 && p + g.ex.announce_len() <= 0x10000);
});

test('ui_new_game and ui_loaded reset UI state and refit', async () => {
  const g = await uiGame();
  g.tapTile(EMPTY);
  g.ex.ui_new_game(77);
  assert.equal(g.ui(UI.SEL), -1);
  assert.equal(g.ui(UI.SHEET), 0);
  assert.equal(g.ex.need_save(), 1);
  assert.equal(readState(g.mem()).seed, 77);
  g.ex.ack_save();
  farm(g.ex).grid(6);
  g.ex.ui_loaded();
  assert.equal(g.ex.need_save(), 0);
  g.frame();
  const G = { y: g.ex.t_lay_y(6), h: g.ex.t_lay_h(6) };
  const y = g.ex.t_tile_rect(5 * 8 + 5, 1) + g.ex.t_tile_rect(5 * 8 + 5, 3);
  assert.ok(y <= G.y + G.h, 'refit to 6x6');
});

// Every UI state x size: registered dynamic hit regions (buttons) are >= min_touch and in the framebuffer.
const SIZES = [[360, 640, 200], [320, 568, 200], [1280, 800, 100], [1440, 900, 100], [768, 1024, 100], [640, 360, 200]];
test('every dynamic hit region is >= 44 css px (min_touch) in every UI state, size and text size', async () => {
  for (const name of Object.keys(UI_STATES)) for (const [w, h, d] of SIZES) for (const large of [false, true]) {
    const g = await uiState(name, w, h, d);
    g.ex.set_flags(1, large ? 1 : 0);
    g.frame();
    const mt = g.ex.t_min_touch(), W = g.ex.fb_w(), H = g.ex.fb_h();
    for (const r of g.hits().slice(staticN(g))) {
      assert.ok(r.w >= mt && r.h >= mt, `${name} ${w}x${h} large=${large} 0x${r.code.toString(16)} ${r.w}x${r.h} < ${mt}`);
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${name} ${w}x${h} inside fb`);
    }
    assert.ok(g.ex.t_canary_ok());
  }
});

// Golden render hashes (UPDATE_GOLDEN=1 to refresh after a deliberate visual change; review the PNGs).
const GOLD = 'tests/render/golden-render.json';
test('UI golden render hashes', async () => {
  const gold = existsSync(GOLD) ? JSON.parse(readFileSync(GOLD, 'utf8')) : {};
  const got = {};
  for (const name of Object.keys(UI_STATES)) for (const [w, h, d] of [[360, 640, 200], [1280, 800, 100]]) {
    const g = await uiState(name, w, h, d);
    const fb = g.mem().slice(g.ex.fb_ptr(), g.ex.fb_ptr() + g.ex.fb_w() * g.ex.fb_h() * 4);
    got[`${name}-${w}x${h}`] = createHash('sha256').update(fb).digest('hex');
  }
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(GOLD, JSON.stringify({ ...gold, ...got }, null, 2) + '\n');
    return;
  }
  for (const [k, v] of Object.entries(got)) assert.equal(v, gold[k], `${k} changed (UPDATE_GOLDEN=1 after review)`);
});
