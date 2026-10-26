// Task 7c: load metrics, the stats overlay, its sparkline and the load lines (src/23_overlay.wat;
// spec §15.1, §15.2, §15.5). Driven like the loader: set_metrics before frames, key / pointer input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stateBytes, STATE } from '../helpers.mjs';
import { uiGame, uiState, HIT, KEY, SCR, UI, METRICS, feedMetrics } from './uistates.mjs';
import { farm } from './scenes.mjs';

const OV = { ON: 0, N: 1, X: 2, Y: 3, W: 4, H: 5, SX: 6, SY: 7, SW: 8, SH: 9, LOAD: 10 };
const CLOSE = 0x3DA;
const line = (g, i) => g.str(g.ex.t_ovl_line(i));
const ov = (g, k) => g.ex.t_ovl(k);
// KB with one decimal, rounded half up, thousands commas (integer maths in the module)
const kb = (b) => { const t = Math.floor((b * 10 + 512) / 1024); return `${Math.floor(t / 10).toLocaleString('en-US')}.${t % 10}`; };
const n = (v) => v.toLocaleString('en-US');

test('set_metrics: distinct prime sentinels show exactly, with units and KB rounding', async () => {
  const g = await uiGame(360, 640, 200, {});
  const [ms, tb, enc, raw, ed, fr] = [1009, 18637, 33331, 62191, 7919, 104729];
  g.ex.set_metrics(ms, tb, enc, raw, ed, fr);
  const pages = g.ex.memory.buffer.byteLength / 65536;
  assert.equal(line(g, 0), 'STATS');
  assert.equal(line(g, 1), `WASM RAW ${kb(raw)} KB`);
  assert.equal(line(g, 1), 'WASM RAW 60.7 KB');
  assert.equal(line(g, 2), 'WASM WIRE 32.5 KB');
  assert.equal(line(g, 3), 'TRANSFER 18.2 KB');
  assert.equal(line(g, 4), 'LOAD TIME 1,009 MS');
  assert.equal(line(g, 5), `MEMORY ${pages} PAGES ^ ${n(pages * 64)} KB`);
  assert.equal(line(g, 6), 'LAST END DAY 7,919 US');
  assert.equal(line(g, 7), 'LAST FRAME 104,729 US');
  assert.equal(line(g, 8), 'FRAME MIN/AVG/MAX 104,729/104,729/104,729 US');
  assert.deepEqual([9, 10, 11].map((i) => line(g, i)), ['TYPICAL ENGINE BUILD OF A GAME', 'THIS SIZE: 5-15 MB, 2-6 S', '(TYPICAL, NOT MEASURED)']);
  assert.equal(g.str(ov(g, OV.LOAD)), 'LOADED IN 1,009 MS ^ 18.2 KB');
  // KB rounding boundaries: 1075 B = 1.0498 KB, 1076 B = 1.0508 KB; 2^31 - 1 B never overflows
  for (const [b, s] of [[1075, '1.0'], [1076, '1.1'], [1023, '1.0'], [51, '0.0'], [52, '0.1'], [10240, '10.0'], [0x7FFFFFFF, '2,097,152.0']]) {
    g.ex.set_metrics(1, b, 0, 0, 0, 0);
    assert.equal(line(g, 3), `TRANSFER ${s} KB`, `${b} B`);
    assert.equal(kb(b), s);
  }
  // memory grows with the framebuffer: the line is live
  g.ex.resize(1440, 900, 300);
  const p2 = g.ex.memory.buffer.byteLength / 65536;
  assert.ok(p2 >= pages);
  assert.equal(line(g, 5), `MEMORY ${p2} PAGES ^ ${n(p2 * 64)} KB`);
});

test('not measured / cached: "--" before the loader reports, "CACHED" for a boot with nothing transferred', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  assert.equal(g.str(ov(g, OV.LOAD)), 'LOADED IN -- MS ^ -- KB');
  for (const i of [1, 2, 3, 4, 6, 7, 8]) assert.match(line(g, i), /--/, `line ${i}`);
  g.ex.set_metrics(12, 0, 0, 62191, 0, 0);
  assert.equal(g.str(ov(g, OV.LOAD)), 'LOADED IN 12 MS ^ CACHED');
  assert.equal(line(g, 3), 'TRANSFER CACHED');
  assert.equal(ov(g, OV.N), 0, 'frame_us 0 adds no sample');
});

test('the frame ring keeps the last 120 samples: wraparound after 300 frames, min / avg / max over them', async () => {
  const g = await uiGame(360, 640, 200, {});
  for (let i = 1; i <= 300; i++) g.ex.set_metrics(...METRICS, 1000 + i);
  assert.equal(ov(g, OV.N), 120);
  // samples 181..300 held: min 1181, max 1300, avg floor(1240.5)
  assert.equal(line(g, 8), 'FRAME MIN/AVG/MAX 1,181/1,240/1,300 US');
  assert.equal(line(g, 7), 'LAST FRAME 1,300 US');
});

test('extreme values (0, 2^31 - 1, negative) never trap and read sanely in every layout', async () => {
  const MAX = 0x7FFFFFFF;
  for (const [w, h, dpr, large] of [[360, 640, 200, 0], [320, 568, 200, 1], [1280, 800, 100, 0]]) {
    const g = await uiGame(w, h, dpr, { large: !!large });
    g.key(KEY.BACKQUOTE);
    for (const v of [[0, 0, 0, 0, 0, 0], [MAX, MAX, MAX, MAX, MAX, MAX], [-1, -5, -MAX - 1, -7, -9, -11], [MAX, 0, -1, MAX, 0, MAX]]) {
      for (let i = 0; i < 130; i++) g.ex.set_metrics(...v);
      g.frame();
      for (let i = 1; i <= 8; i++) {
        const s = line(g, i);
        assert.doesNotMatch(s, /(^|[^-])-[0-9]/, `no negative number: ${s}`);
        assert.match(s, /^[A-Z/ ]+ (([0-9,.]+|--)( KB| MS| US| PAGES)?|CACHED)( \^ [0-9,]+ KB)?(\/([0-9,]+|--))*( US)?$/, s);
      }
      assert.ok(ov(g, OV.X) >= 0 && ov(g, OV.X) + ov(g, OV.W) <= g.ex.fb_w(), `${w}x${h} x`);
      assert.ok(ov(g, OV.Y) >= 0 && ov(g, OV.Y) + ov(g, OV.H) <= g.ex.fb_h(), `${w}x${h} y`);
    }
    assert.equal(line(g, 7), 'LAST FRAME 2,147,483,647 US');
    assert.equal(line(g, 8), 'FRAME MIN/AVG/MAX 10,000,000/10,000,000/10,000,000 US', 'ring samples clamp at 10 s');
    const fb = g.ex.fb_ptr(), wd = g.ex.fb_w(), ht = g.ex.fb_h();
    assert.equal(new DataView(g.ex.memory.buffer).getUint32(fb + wd * ht * 4, true), 0xCAFEF00D, 'canary');
  }
});

test('Backquote toggles the overlay anywhere and announces it; Esc and its header close it', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true });
  feedMetrics(g.ex);
  g.frame();
  assert.equal(g.ui(UI.DIRTY), 0);
  assert.equal(g.ex.frame(g.t += 16), 0, 'idle before');
  g.key(KEY.BACKQUOTE);
  assert.equal(ov(g, OV.ON), 1);
  assert.equal(g.announce(), 'STATS ON');
  assert.equal(g.ex.frame(g.t += 16), 1, 'open: a frame every frame (live sparkline)');
  const r = g.hit(CLOSE);
  assert.ok(r && r.h >= g.ex.t_min_touch() && r.w >= g.ex.t_min_touch(), 'header close region >= min_touch');
  g.key(KEY.ESC);
  assert.equal(ov(g, OV.ON), 0);
  assert.equal(g.announce(), 'STATS OFF');
  assert.equal(g.ui(UI.SCR), SCR.FARM, 'Esc only closed the overlay');
  g.key(KEY.BACKQUOTE);
  g.tap(CLOSE);
  assert.equal(ov(g, OV.ON), 0, 'header tap closes');
  // over a screen and in the replay viewer too
  g.key(KEY.J);
  assert.equal(g.ui(UI.SCR), SCR.JOURNAL);
  g.key(KEY.BACKQUOTE);
  assert.equal(ov(g, OV.ON), 1);
  assert.equal(g.ui(UI.SCR), SCR.JOURNAL);
  g.key(KEY.ESC);
  assert.equal(ov(g, OV.ON), 0);
  assert.equal(g.ui(UI.SCR), SCR.JOURNAL, 'the first Esc closes the overlay, not the Journal');
});

test('the overlay passes taps through except its header: a plot under it still opens', async () => {
  const g = await uiGame(360, 640, 200, {});
  g.key(KEY.BACKQUOTE);
  g.frame();
  const [x, y, w, h] = [OV.X, OV.Y, OV.W, OV.H].map((k) => ov(g, k));
  const tiles = [...Array(64).keys()].filter((i) => g.ex.t_tile_rect(i, 2) > 0).filter((i) => {
    const cy = g.ex.t_tile_rect(i, 1) + (g.ex.t_tile_rect(i, 3) >> 1), cx = g.ex.t_tile_rect(i, 0) + (g.ex.t_tile_rect(i, 2) >> 1);
    return cx > x && cx < x + w && cy > y + g.hit(CLOSE).h && cy < y + h;
  });
  if (tiles.length) {
    g.tapTile(tiles[0]);
    assert.equal(g.ui(UI.SEL), tiles[0], 'tile under the panel selected');
    assert.equal(ov(g, OV.ON), 1, 'still open');
  }
  // End Day is never covered
  g.tap(HIT.ENDDAY);
  assert.equal(ov(g, OV.ON), 1);
});

test('triple tap on the top-left 44 css px corner toggles it; double taps and slow taps do not', async () => {
  const corner = (g, dt) => { g.ex.pointer(10, 12, 0); g.frame(dt); g.ex.pointer(10, 12, 2); g.frame(dt); };
  const g = await uiGame(360, 640, 200, {});
  corner(g, 16); corner(g, 16);
  assert.equal(ov(g, OV.ON), 0, 'a double tap does nothing');
  const scr = g.ui(UI.SCR);
  for (let i = 0; i < 40; i++) g.frame(16);
  corner(g, 16); corner(g, 16);
  g.ex.pointer(10, 12, 0);
  assert.equal(ov(g, OV.ON), 1, 'triple tap opens (on the third down)');
  assert.equal(g.ui(UI.IN_ST), 0, 'the third down is consumed: no press for its up to resolve');
  g.frame(); g.ex.pointer(10, 12, 2); g.frame();
  assert.equal(g.announce(), 'STATS ON');
  void scr;
  for (let i = 0; i < 40; i++) g.frame(16);
  corner(g, 16); corner(g, 16); corner(g, 16);
  assert.equal(ov(g, OV.ON), 0, 'and closes');
  // slow: first to third down over 600 ms of frame time
  for (let i = 0; i < 40; i++) g.frame(16);
  corner(g, 160); corner(g, 160); corner(g, 160);
  assert.equal(ov(g, OV.ON), 0, 'three taps spread over > 600 ms');
  // taps elsewhere reset the count
  for (let i = 0; i < 40; i++) g.frame(16);
  corner(g, 16); g.ex.pointer(200, 300, 0); g.frame(); g.ex.pointer(200, 300, 2); g.frame(); corner(g, 16); corner(g, 16);
  assert.equal(ov(g, OV.ON), 0, 'interrupted by a tap elsewhere');
  // the third tap does not reach the control under it (Title: nothing at the corner, farm: the DAY box)
  const t = await uiGame(360, 640, 200, { boot: 0 });
  t.frame();
  corner(t, 16); corner(t, 16); corner(t, 16);
  assert.equal(ov(t, OV.ON), 1);
  assert.equal(t.ui(UI.SCR), SCR.TITLE);
});

test('layouts: the panel fits the farm viewport at 360x640, large 320x568 and 1280x800, clear of the chrome', async () => {
  const L = { TOPBAR: 0, ENDDAY: 5, GRID: 6, TABS: 7, PANEL: 13 };
  const rect = (g, id) => [0, 1, 2, 3].map((k) => [g.ex.t_lay_x, g.ex.t_lay_y, g.ex.t_lay_w, g.ex.t_lay_h][k](id));
  const meet = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  for (const [w, h, dpr, large, ts] of [[360, 640, 200, 0, 1], [320, 568, 200, 1, 2], [1280, 800, 100, 0, 1], [360, 640, 200, 1, 2]]) {
    const g = await uiGame(w, h, dpr, { large: !!large });
    feedMetrics(g.ex);
    g.key(KEY.BACKQUOTE);
    g.frame();
    const p = [OV.X, OV.Y, OV.W, OV.H].map((k) => ov(g, k)), gr = rect(g, L.GRID);
    const tag = `${w}x${h}${large ? ' large' : ''}`;
    assert.ok(p[0] >= gr[0] && p[1] >= gr[1] && p[0] + p[2] <= gr[0] + gr[2] && p[1] + p[3] <= gr[1] + gr[3], `${tag}: inside the viewport ${p} / ${gr}`);
    for (const id of [L.TOPBAR, L.ENDDAY, L.TABS, L.PANEL]) {
      const r = rect(g, id);
      if (r[2] && r[3]) assert.ok(!meet(p, r), `${tag}: clear of rect ${id}`);
    }
    const c = g.hit(CLOSE);
    assert.ok(c.w >= g.ex.t_min_touch() && c.h >= g.ex.t_min_touch(), `${tag}: close >= min_touch`);
    assert.equal(g.ex.t_ui_ts(), ts, `${tag}: text scale`);
    // the sparkline is inside the panel; the text scale stays the UI one (it fits)
    const s = [OV.SX, OV.SY, OV.SW, OV.SH].map((k) => ov(g, k));
    assert.ok(s[0] >= p[0] && s[1] > p[1] && s[0] + s[2] <= p[0] + p[2] && s[1] + s[3] < p[1] + p[3], `${tag}: sparkline in the panel`);
    assert.ok(g.hits().length <= 128);
  }
});

test('sparkline: the newest sample is the right-most bar; bars move with the samples', async () => {
  const g = await uiGame(360, 640, 200, { reduced: true });
  for (let i = 0; i < 120; i++) g.ex.set_metrics(...METRICS, 2000);
  g.key(KEY.BACKQUOTE);
  g.frame();
  const [sx, sy, sw, sh] = [OV.SX, OV.SY, OV.SW, OV.SH].map((k) => ov(g, k));
  const k = sw / 120;
  const col = (x) => { const m = new DataView(g.ex.memory.buffer), fb = g.ex.fb_ptr(), w = g.ex.fb_w(); let lit = 0, bg = m.getUint32(fb + (sy * w + x) * 4, true);
    for (let y = sy; y < sy + sh; y++) if (m.getUint32(fb + (y * w + x) * 4, true) !== bg) lit++; return lit; };
  const hash = () => createHash('sha1').update(Buffer.from(g.mem().slice(g.ex.fb_ptr(), g.ex.fb_ptr() + g.ex.fb_w() * g.ex.fb_h() * 4))).digest('hex');
  const flat = col(sx + sw - 1);
  assert.ok(flat >= 1 && flat <= Math.ceil(sh * 2000 / 20000) + 1, `2 ms bar ${flat} px`);
  const h0 = hash();
  g.ex.set_metrics(...METRICS, 15000);
  g.frame();
  assert.deepEqual([OV.SX, OV.SY, OV.SW, OV.SH].map((q) => ov(g, q)), [sx, sy, sw, sh], 'the panel does not move with the numbers');
  assert.notEqual(hash(), h0);
  assert.ok(col(sx + sw - 1) > flat * 4, `15 ms bar on the right: ${col(sx + sw - 1)} px`);
  assert.ok(col(sx + sw - 1 - k) <= flat + 1, 'the previous sample stays short');
  // one more sample moves the spike one bar left
  g.ex.set_metrics(...METRICS, 2000);
  g.frame();
  assert.ok(col(sx + sw - 1 - k) > flat * 4, 'spike shifted left');
  assert.ok(col(sx + sw - 1) <= flat + 1);
});

test('render-only frames with the overlay open leave sim state, RNG and the input log identical', async () => {
  const g = await uiGame(360, 640, 200, { setup: (ex) => farm(ex).weather(3) });
  g.key(KEY.E);
  const s = stateBytes(g.mem(), STATE.length), log = Buffer.from(g.mem().slice(0x5000, 0x5000 + g.ex.t_log_len()));
  g.key(KEY.BACKQUOTE);
  for (let i = 0; i < 200; i++) { g.ex.set_metrics(...METRICS, 1500 + i * 13); g.frame(16); }
  g.ex.resize(1280, 800, 100); g.frame(); g.ex.resize(320, 568, 200); g.ex.set_flags(0, 1); g.frame();
  g.key(KEY.BACKQUOTE);
  assert.deepEqual(stateBytes(g.mem(), STATE.length), s);
  assert.deepEqual(Buffer.from(g.mem().slice(0x5000, 0x5000 + g.ex.t_log_len())), log);
});

test('Title and Results load lines show the measured numbers (and redraw when they arrive)', async () => {
  const t = await uiGame(360, 640, 200, { boot: 0 });
  t.frame();
  for (let i = 0; i < 5; i++) t.frame();
  assert.equal(t.ex.frame(t.t += 16) & 1, 0);
  const fb = () => Buffer.from(t.mem().slice(t.ex.fb_ptr(), t.ex.fb_ptr() + t.ex.fb_w() * t.ex.fb_h() * 4));
  t.ex.set_flags(1, 0); t.frame(); const before = fb();
  t.ex.set_metrics(47, 18637, 33255, 62191, 0, 900);
  assert.equal(t.ui(UI.DIRTY), 1, 'new load numbers redraw the Title');
  t.frame();
  assert.notDeepEqual(fb(), before);
  assert.equal(t.str(ov(t, OV.LOAD)), 'LOADED IN 47 MS ^ 18.2 KB');
  t.ex.set_metrics(47, 18637, 33255, 62191, 0, 950);
  assert.equal(t.ui(UI.DIRTY), 0, 'only a frame time: no redraw');
  const r = await uiState('ui-results-loaded');
  assert.equal(r.ui(UI.SCR), SCR.RESULTS);
  assert.ok(r.labels().includes('LOADED IN 47 MS ^ 18.2 KB'), JSON.stringify(r.labels()));
  const c = await uiState('ui-title-cached');
  assert.equal(c.str(ov(c, OV.LOAD)), 'LOADED IN 12 MS ^ CACHED');
});

test('steady frames: storm + rain particles at 360x640, 300 frames of module render time stay flat', async () => {
  // Timed in process CPU time (process.cpuUsage, us) as well as wall time: npm test runs the test files in
  // parallel, so wall time also measures the other processes; CPU time is what the frame itself costs.
  const g = await uiGame(360, 640, 200, { setup: (ex) => farm(ex).weather(3) });
  g.key(KEY.BACKQUOTE);
  const run = (k) => {
    const cpu = [], wall = [];
    for (let i = 0; i < k; i++) {
      g.ex.set_metrics(...METRICS, 2000);
      const a = performance.now(), c = process.cpuUsage();
      assert.equal(g.ex.frame(g.t += 16), 1);
      const d = process.cpuUsage(c);
      wall.push(performance.now() - a); cpu.push((d.user + d.system) / 1000);
    }
    return { cpu, wall };
  };
  const stat = (t) => {
    t = [...t].sort((a, b) => a - b);
    const mean = t.reduce((s, v) => s + v, 0) / t.length;
    return { mean, sd: Math.sqrt(t.reduce((s, v) => s + (v - mean) ** 2, 0) / t.length), p99: t[Math.floor(t.length * 0.99)], max: t[t.length - 1] };
  };
  const f = (s) => `mean ${s.mean.toFixed(3)} ms, sd ${s.sd.toFixed(3)} ms, p99 ${s.p99.toFixed(3)} ms, max ${s.max.toFixed(3)} ms`;
  run(60);                                                  // warm up (JIT tiers)
  // best of three 300-frame runs (a real regression - allocation, a slow storm path - fails all three)
  let best;
  for (let k = 0; k < 3; k++) {
    const r = run(300), c = stat(r.cpu), w = stat(r.wall);
    if (!best || c.max < best.c.max) best = { c, w };
    if (c.sd < 0.5 && c.max < 4) break;
  }
  console.log(`storm + overlay frame (module render) at 360x640: CPU ${f(best.c)}; wall ${f(best.w)}`);
  assert.ok(best.c.sd < 0.5, `stddev ${best.c.sd} ms`);
  assert.ok(best.c.max < 4, `max ${best.c.max} ms`);
  assert.ok(best.c.mean < 4, `mean ${best.c.mean} ms`);
});
