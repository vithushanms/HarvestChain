// Task 7a: replay viewer screen (scr 7), Title WATCH, Results share slot, copy handshake
// (src/24_replay.wat). Driven through pointer() / key() / frame() like the loader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, stateBytes, STATE } from '../helpers.mjs';
import { runBot } from '../sim/bot.mjs';
import { uiGame, uiState, HIT, KEY, SCR, OVL, UI, RP, RPF, CODES } from './uistates.mjs';

const LEN = STATE.length;
const bytes = (g) => stateBytes(g.mem(), LEN);
const rp = (g, k) => g.ex.t_rp(k);

// Straight playthrough of the 40-day seed-1 bot: state after every End Day (index = days played).
const SNAPS = await (async () => {
  const g = await loadGame(); g.ex.init(1);
  const out = [bytes(g)];
  const ed = g.ex.end_day;
  runBot({ ...g.ex, end_day: () => { const e = ed(); if (!e) out.push(bytes(g)); return e; } }, g.mem, 40);
  out.final = bytes(g);
  return out;
})();

async function viewer(o = {}) {
  const g = await uiGame(360, 640, 200, { boot: 0, ...o });
  g.frame();
  const pre = bytes(g);
  assert.equal(g.load(o.code ?? CODES.BOT40), 0);
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  assert.equal(rp(g, RPF.PEND), 1);
  assert.deepEqual(bytes(g), pre, 'a pending replay changes nothing');
  g.tap(RP.WATCH);
  return { g, pre };
}

test('Title offers WATCH SHARED RUN for a pending code; WATCH opens the viewer at day 0 of N', async () => {
  const { g } = await viewer();
  assert.equal(g.ui(UI.SCR), RP.SCR);
  assert.equal(rp(g, RPF.N), 40);
  assert.equal(rp(g, RPF.DAY), 0);
  assert.deepEqual(bytes(g), SNAPS[0]);
  assert.equal(g.ex.need_save(), 0);
  assert.match(g.announce(), /^REPLAY\. DAY 0 OF 40, /);
  for (const c of [RP.RESTART, RP.PREV, RP.PLAY, RP.NEXT, RP.SPEED, RP.TAKE, RP.EXIT, RP.SCRUB]) assert.ok(g.hit(c), `0x${c.toString(16)}`);
  assert.deepEqual(g.btns().filter((b) => b.code >= 0x3D0).map((b) => b.label),
    ['RESTART', '-1 DAY', '+1 DAY', 'PLAY', 'SPEED X1', 'TAKE OVER', 'EXIT']);
});

test('the Title without a pending replay has no WATCH; garbage loads leave it so', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.frame();
  assert.equal(g.hit(RP.WATCH), undefined);
  assert.notEqual(g.load('not a code!'), 0);
  assert.equal(g.hit(RP.WATCH), undefined);
});

test('stepping, RESTART and the scrubber show the recorded state of that day', async () => {
  const { g } = await viewer();
  g.tap(RP.NEXT); g.tap(RP.NEXT);
  assert.equal(rp(g, RPF.DAY), 2); assert.deepEqual(bytes(g), SNAPS[2]);
  g.tap(RP.PREV);
  assert.equal(rp(g, RPF.DAY), 1); assert.deepEqual(bytes(g), SNAPS[1]);
  const s = g.hit(RP.SCRUB);
  for (const target of [30, 12, 40, 0, 25]) {
    const lx = Math.min(s.x + Math.round((s.w * target) / 40), s.x + s.w - 1);
    g.down(...g.toCss(lx, s.y + (s.h >> 1)));
    const d = rp(g, RPF.DAY);
    assert.ok(Math.abs(d - target) <= 1, `scrub to ${target}: ${d}`);
    assert.deepEqual(bytes(g), d === 40 ? SNAPS.final : SNAPS[d], `day ${d}`);
    g.up(...g.toCss(lx, s.y + (s.h >> 1)));
  }
  // drag along the bar seeks continuously
  const y = s.y + (s.h >> 1);
  g.down(...g.toCss(s.x + 2, y));
  g.ex.pointer(...g.toCss(s.x + (s.w >> 1), y), 1); g.frame();   // (moves coalesce: the frame seeks)
  assert.ok(Math.abs(rp(g, RPF.DAY) - 20) <= 1, `drag ${rp(g, RPF.DAY)}`);
  g.ex.pointer(...g.toCss(s.x + s.w - 1, y), 1); g.frame();
  assert.equal(rp(g, RPF.DAY), 40);
  assert.deepEqual(bytes(g), SNAPS.final);
  g.up(...g.toCss(s.x + s.w - 1, y));
  g.tap(RP.RESTART);
  assert.equal(rp(g, RPF.DAY), 0); assert.deepEqual(bytes(g), SNAPS[0]);
  g.key(KEY.RIGHT); g.key(KEY.RIGHT); g.key(KEY.LEFT);
  assert.equal(rp(g, RPF.DAY), 1);
});

test('PLAY advances one day per 300 ms of frame time; SPEED x2 / x4; pauses at the end', async () => {
  const { g } = await viewer();
  g.tap(RP.PLAY);
  assert.equal(rp(g, RPF.PLAY), 1);
  assert.equal(g.btn(RP.PLAY).label, 'PAUSE');
  const t0 = g.t;
  const run = (ms) => { const end = g.t + ms; while (g.t < end) assert.equal(g.frame(10), 1); };
  run(290);
  assert.equal(rp(g, RPF.DAY), 0, `${g.t - t0} ms`);
  run(20);
  assert.equal(rp(g, RPF.DAY), 1);
  run(600);
  assert.equal(rp(g, RPF.DAY), 3);
  g.tap(RP.SPEED);
  assert.equal(rp(g, RPF.SPD), 1); assert.equal(g.btn(RP.SPEED).label, 'SPEED X2');
  const d0 = rp(g, RPF.DAY); run(600);
  assert.ok(Math.abs(rp(g, RPF.DAY) - d0 - 4) <= 1, `x2: ${rp(g, RPF.DAY) - d0}`);
  g.tap(RP.SPEED);
  assert.equal(g.btn(RP.SPEED).label, 'SPEED X4');
  const d1 = rp(g, RPF.DAY); run(600);
  assert.ok(Math.abs(rp(g, RPF.DAY) - d1 - 8) <= 1, `x4: ${rp(g, RPF.DAY) - d1}`);
  assert.deepEqual(bytes(g), SNAPS[rp(g, RPF.DAY)]);
  for (let i = 0; i < 500; i++) g.frame(10);
  assert.equal(rp(g, RPF.DAY), 40); assert.equal(rp(g, RPF.PLAY), 0, 'stops at the end');
  assert.deepEqual(bytes(g), SNAPS.final);
  g.tap(RP.SPEED);
  assert.equal(rp(g, RPF.SPD), 0, 'x4 -> x1');
  // Space plays again from the start; a step pauses
  g.key(KEY.SPACE);
  assert.equal(rp(g, RPF.PLAY), 1); assert.equal(rp(g, RPF.DAY), 0);
  g.tap(RP.NEXT);
  assert.equal(rp(g, RPF.PLAY), 0);
});

test('EXIT / Esc restore the pre-viewer state byte-identically; nothing is saved while watching', async () => {
  const { g, pre } = await viewer({ boot: 1, setup: (ex) => { ex.act(1, 9, 0, 0); ex.end_day(); } });
  g.tap(RP.NEXT); g.tap(RP.NEXT); g.tap(RP.NEXT);
  assert.notDeepEqual(bytes(g), pre);
  const dv = new DataView(g.ex.memory.buffer);
  const live = Buffer.from(g.mem().slice(0x5000, 0x5000 + g.ex.t_log_len()));
  g.tap(RP.EXIT);
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  assert.deepEqual(bytes(g), pre);
  assert.deepEqual(Buffer.from(g.mem().slice(0x5000, 0x5000 + g.ex.t_log_len())), live, 'the live log is untouched');
  assert.equal(g.ex.need_save(), 0);
  assert.ok(g.hit(RP.WATCH), 'the shared run still waits');
  g.tap(RP.WATCH); g.tap(RP.NEXT);
  g.key(KEY.ESC);
  assert.equal(g.ui(UI.SCR), SCR.TITLE);
  assert.deepEqual(bytes(g), pre);
  void dv;
});

test('while watching, other input is blocked: E, H, J, tabs, End Day position, Enter on the Title', async () => {
  const { g } = await viewer();
  g.tap(RP.NEXT);
  const s = bytes(g);
  for (const k of [KEY.E, KEY.H, KEY.J, KEY.D1, KEY.D5, KEY.R]) g.key(k);
  assert.equal(g.ui(UI.SCR), RP.SCR);
  assert.deepEqual(bytes(g), s);
  const e = g.hits().filter((r) => r.code === HIT.ENDDAY).pop();
  g.tapCss(...g.toCss(e.x + (e.w >> 1), e.y + (e.h >> 1)));
  assert.equal(g.ui(UI.SCR), RP.SCR);
  assert.deepEqual(bytes(g), s);
  assert.equal(g.toasts().length, 0, 'no toasts while watching');
  // a second code cannot replace the one being watched
  assert.equal(g.load(CODES.BAD_LOG), 6);
});

test('TAKE OVER (no save: one tap) truncates the log at the position, keeps the seed, becomes the live game', async () => {
  const { g } = await viewer();
  g.ex.t_rp_seek(17);
  g.tap(RP.TAKE);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.deepEqual(bytes(g), SNAPS[17]);
  assert.equal(g.ex.need_save(), 1);
  assert.equal(g.ex.t_log_st(), 0);
  const log = Buffer.from(g.mem().slice(0x5000, 0x5000 + g.ex.t_log_len()));
  assert.equal(log.readUInt32LE(2), 1, 'seed kept');
  // the new log replays to the same state; recording continues
  g.key(KEY.E);
  const after = bytes(g);
  const h = await uiGame(360, 640, 200, { boot: 0 });
  assert.equal(h.load(g.code()), 0);
  assert.equal(h.ex.t_rp(RPF.N), 18);
  h.tap(RP.WATCH); h.ex.t_rp_seek(18);
  assert.deepEqual(bytes(h), after);
  assert.equal(rp(h, RPF.PEND), 1);
});

test('TAKE OVER over a save needs a second tap 0.4 s later ("REPLACES SAVE")', async () => {
  const { g } = await viewer({ boot: 1 });
  g.ex.t_rp_seek(5);
  g.tap(RP.TAKE);
  assert.equal(g.ui(UI.SCR), RP.SCR, 'first tap only arms');
  assert.equal(g.btn(RP.TAKE).label, 'TAP AGAIN: REPLACES SAVE');
  for (let i = 0; i < 30; i++) g.frame(16);
  g.tap(RP.TAKE);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.deepEqual(bytes(g), SNAPS[5]);
  assert.equal(rp(g, RPF.PEND), 0, 'the shared run is now the game');
});

test('an invalid record mid-playback: "REPLAY STOPPED AT DAY 4: INVALID MOVE", playback stops, EXIT restores', async () => {
  const { g, pre } = await viewer({ code: CODES.BAD_LOG });
  assert.equal(rp(g, RPF.N), 3);
  g.tap(RP.PLAY);
  for (let i = 0; i < 80; i++) g.frame(16);
  assert.equal(rp(g, RPF.BAD), 4);
  assert.equal(rp(g, RPF.PLAY), 0);
  g.frame();
  assert.ok(g.labels().includes('REPLAY STOPPED AT DAY 4: INVALID MOVE'), JSON.stringify(g.labels()));
  g.tap(RP.PREV);
  assert.equal(rp(g, RPF.BAD), 0, 'stepping back is fine');
  g.tap(RP.EXIT);
  assert.deepEqual(bytes(g), pre);
});

test('a daily-seed run replays identically', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0, daily: 20400 });
  g.frame();
  g.tap(OVL.DAILY);
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  g.tapTile(9); g.tap(0x210);
  for (let i = 0; i < 6; i++) g.key(KEY.E);
  const want = bytes(g);
  const seed = Math.imul(20400, 0x9E3779B1) | 0;
  assert.equal(new DataView(g.ex.memory.buffer).getInt32(0x5002, true), seed);
  const h = await uiGame(360, 640, 200, { boot: 0 });
  assert.equal(h.load(g.code()), 0);
  h.tap(RP.WATCH); h.ex.t_rp_seek(6);
  assert.deepEqual(bytes(h), want);
});

test('Results: share code line, COPY CODE (want_copy -> ack_copy toasts COPIED!), WATCH REPLAY and R watch the run', async () => {
  const g = await uiState('ui-results-share');
  assert.equal(g.ui(UI.SCR), SCR.RESULTS);
  assert.ok(g.hit(RP.COPY) && g.hit(RP.OWN));
  assert.equal(g.ex.want_copy(), 0);
  g.tap(RP.COPY);
  assert.equal(g.ex.want_copy(), 1);
  const url = Buffer.from(g.mem().slice(g.ex.share_url_ptr(), g.ex.share_url_ptr() + g.ex.share_url_len())).toString('latin1');
  assert.equal(url, g.code());
  // final review M1: the loader acks with 0 at once (clears the request, no toast) and with 1 only
  // after the clipboard write resolves
  g.ex.ack_copy(0); g.frame();
  assert.equal(g.ex.want_copy(), 0);
  assert.deepEqual(g.toasts(), [], 'no COPIED! before the write succeeded');
  g.ex.ack_copy(1); g.frame();
  assert.equal(g.ex.want_copy(), 0);
  assert.deepEqual(g.toasts(), ['COPIED!']);
  const end = bytes(g);
  g.tap(RP.OWN);
  assert.equal(g.ui(UI.SCR), RP.SCR);
  assert.equal(rp(g, RPF.N), 1);
  g.tap(RP.EXIT);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS);
  assert.deepEqual(bytes(g), end);
  g.key(KEY.R);
  assert.equal(g.ui(UI.SCR), RP.SCR);
  g.key(KEY.ESC);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS);
});

test('a resumed save without its log, or an overflowed log, explains instead of sharing', async () => {
  const src = await uiState('ui-results-share');
  const save = bytes(src);
  const g = await uiGame(360, 640, 200, {});
  g.mem().set(save, g.ex.io_buf());
  assert.equal(g.ex.load(g.ex.io_buf(), save.length), 0);
  g.ex.ui_boot(1); g.frame();
  g.tap(OVL.CONTINUE);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS);
  assert.equal(g.hit(RP.COPY), undefined);
  assert.ok(g.labels().includes('SHARE ONLY FOR RUNS STARTED THIS SESSION'), JSON.stringify(g.labels()));
  g.key(KEY.R);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS, 'R needs a log');
  const o = await uiGame(360, 640, 200, { gazette: true, setup: (ex) => {
    for (let i = 0; i < 1100; i++) { ex.act(17, 1000, 0, 0); ex.act(18, 1000, 0, 0); }
    new DataView(ex.memory.buffer).setUint16(STATE.base + STATE.fields.day.off, 240, true);
  } });
  assert.equal(o.ex.t_log_st(), 1);
  o.tap(HIT.ENDDAY);
  assert.equal(o.ui(UI.SCR), SCR.RESULTS);
  assert.equal(o.hit(RP.COPY), undefined);
  assert.ok(o.labels().includes('RUN TOO LONG TO SHARE'));
});

test('render-only frames in the viewer leave sim state and RNG identical; seeking 240 days is fast', async () => {
  const { g } = await viewer();
  g.ex.t_rp_seek(20);
  const s = bytes(g);
  for (let i = 0; i < 20; i++) g.frame(50);
  g.ex.resize(1280, 800, 100); g.frame(); g.ex.resize(360, 640, 200); g.frame();
  assert.deepEqual(bytes(g), s);
  // a 240-day bot log: seek 0 -> 240 -> 0 -> 240
  const b = await loadGame(); b.ex.init(1); runBot(b.ex, b.mem, 240);
  const n = b.ex.share_build();
  const code = Buffer.from(b.mem().slice(b.ex.share_ptr(), b.ex.share_ptr() + n)).toString('latin1');
  const h = await uiGame(360, 640, 200, { boot: 0 });
  assert.equal(h.load(code), 0);
  h.tap(RP.WATCH);
  let worst = 0;
  for (let i = 0; i < 5; i++) {
    h.ex.t_rp_seek(0);
    const t0 = performance.now(); h.ex.t_rp_seek(240); worst = Math.max(worst, performance.now() - t0);
  }
  console.log(`seek 0 -> 240 days: worst ${worst.toFixed(2)} ms`);
  assert.deepEqual(bytes(h), bytes(b));
  assert.ok(worst < 25, `${worst} ms`);
});

test('fuzzed logs that pass validation play to their end in the viewer without trapping', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  const base = Buffer.from(CODES.BOT40, 'base64url');
  let seed = 99, played = 0, bad = 0;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const t0 = performance.now();
  for (let i = 0; i < 4000 && played < 300; i++) {
    const b = Buffer.from(base);
    for (let j = 1 + rnd(3); j--;) b[8 + rnd(b.length - 8)] = rnd(256);
    if (g.load(b.toString('base64url')) !== 0) continue;
    g.tap(RP.WATCH);
    assert.equal(g.ui(UI.SCR), RP.SCR);
    g.ex.t_rp_seek(65535);
    if (rp(g, RPF.BAD)) bad++;
    g.key(KEY.ESC);
    assert.equal(g.ui(UI.SCR), SCR.TITLE);
    played++;
  }
  console.log(`fuzz playback: ${played} valid mutants played (${bad} invalid mid-run) in ${(performance.now() - t0).toFixed(0)} ms`);
  assert.ok(played >= 100);
});
