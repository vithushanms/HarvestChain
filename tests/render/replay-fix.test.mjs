// Task 7a review fixes (A1-A4, A6, A9-A11): the viewer's need_save mask, byte-exact state
// restore at both ends, coalesced scrubbing, replay_restore while the viewer is open, the no-op
// check at the log cap, the Results share line, the COPY icon and the large-text viewer card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateBytes, STATE } from '../helpers.mjs';
import { uiGame, uiState, KEY, SCR, OVL, UI, RP, RPF, CODES } from './uistates.mjs';
import { ICONS } from '../../tools/gen-strings.mjs';

const LEN = STATE.length;
const bytes = (g) => stateBytes(g.mem(), LEN);
const rp = (g, k) => g.ex.t_rp(k);
const SEEKS = 7;   // t_rp(7): rp_seek calls so far
const FIT_DN = 23; // t_ui(23): labels shrunk to scale 1 by $fit in the last frame

test('A1: the viewer masks need_save (storage-full retry case) through seek and play; EXIT restores it', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.frame();
  g.tap(OVL.NEW);                               // NEW GAME; the loader has not acked the save yet
  assert.equal(g.ui(UI.SCR), SCR.FARM);
  assert.equal(g.ex.need_save(), 1);
  const live = bytes(g);
  assert.equal(g.load(CODES.BOT40), 0);
  assert.equal(g.ex.need_save(), 1, 'a pending replay changes nothing');
  // whenever the loader would save, the save image is the live game
  const check = (what) => {
    if (g.ex.need_save()) assert.deepEqual(Buffer.from(g.mem().slice(g.ex.save_ptr(), g.ex.save_ptr() + g.ex.save_len())), Buffer.from(live), what);
  };
  g.tap(RP.WATCH);
  assert.equal(g.ex.need_save(), 0, 'viewer open');
  g.ex.t_rp_seek(17); g.frame();
  assert.equal(g.ex.need_save(), 0, 'after a seek');
  g.tap(RP.PLAY);
  for (let i = 0; i < 60; i++) { g.frame(16); check('playing'); assert.equal(g.ex.need_save(), 0, 'while playing'); }
  assert.ok(rp(g, RPF.DAY) > 17, 'the viewer played days');
  g.tap(RP.EXIT);
  assert.equal(g.ex.need_save(), 1, 'want_save of the live game is back');
  assert.deepEqual(bytes(g), live);
  check('after EXIT');
});

test('A2: EXIT and the invalid-log paths restore the first and last state bytes exactly', async () => {
  const poke = (g) => {
    const m = g.mem();
    m[STATE.base] = 0xA5; m[STATE.base + 1] = 0x5A; m[STATE.base + LEN - 2] = 0xC3; m[STATE.base + LEN - 1] = 0x3C;
    return bytes(g);
  };
  for (const code of [CODES.BOT40, CODES.BAD_LOG]) {
    const g = await uiGame(360, 640, 200, { boot: 0 });
    g.frame();
    assert.equal(g.load(code), 0);
    const want = poke(g);
    g.tap(RP.WATCH);
    g.tap(RP.NEXT); g.tap(RP.NEXT); g.tap(RP.NEXT); g.tap(RP.NEXT);
    assert.notEqual(g.mem()[STATE.base + LEN - 1], 0x3C, 'the viewer replaced the state');
    g.tap(RP.EXIT);
    assert.deepEqual(bytes(g), want, code === CODES.BAD_LOG ? 'invalid log' : 'valid log');
  }
  // replay_restore that fails its replay check puts the loaded state back exactly
  const g = await uiGame(360, 640, 200, {});
  g.key(KEY.E);
  const own = g.code();                          // same seed: replayed in full, then found not to match
  const want = poke(g);
  const io = g.ex.io_buf();
  g.mem().set(Buffer.from(own, 'latin1'), io);
  assert.equal(g.ex.replay_restore(io, own.length), 8);
  assert.deepEqual(bytes(g), want, 'rejected replay_restore');
});

test('A3: scrubber moves coalesce into one seek per frame, to the last position', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.frame();
  assert.equal(g.load(CODES.BOT40), 0);
  g.tap(RP.WATCH);
  const s = g.hit(RP.SCRUB), y = s.y + (s.h >> 1);
  const at = (d) => g.toCss(Math.min(s.x + Math.round((s.w * d) / 40), s.x + s.w - 1), y);
  g.ex.pointer(...at(5), 0);
  const n0 = rp(g, SEEKS);
  for (const d of [30, 2, 37, 11, 25, 8, 33, 20]) g.ex.pointer(...at(d), 1);
  assert.equal(rp(g, SEEKS), n0, 'no seek before the frame');
  g.frame();
  assert.equal(rp(g, SEEKS), n0 + 1, 'one seek per frame');
  assert.ok(Math.abs(rp(g, RPF.DAY) - 20) <= 1, `last position wins: ${rp(g, RPF.DAY)}`);
  g.frame();
  assert.equal(rp(g, SEEKS), n0 + 1, 'nothing pending');
  g.ex.pointer(...at(39), 1);
  g.ex.pointer(...at(39), 2);
  g.frame();
  assert.ok(rp(g, RPF.DAY) >= 38, 'a move just before the release is applied');
});

test('A4: replay_restore while the viewer is open leaves the live share code intact', async () => {
  const g = await uiGame(360, 640, 200, { boot: 0 });
  g.frame();
  g.tap(OVL.NEW);
  g.key(KEY.E); g.key(KEY.E);
  const code = g.code();
  assert.ok(code.length > 10);
  assert.equal(g.load(CODES.BOT40), 0);
  g.tap(RP.WATCH);
  const io = g.ex.io_buf();
  g.mem().set(Buffer.from(code, 'latin1'), io);
  assert.equal(g.ex.replay_restore(io, code.length), 6);
  assert.equal(g.ex.t_log_st(), 0, 'still recording');
  g.tap(RP.EXIT);
  assert.equal(g.code(), code);
});

test('A6: a no-op action within 16 B of the log cap is not an overflow', async () => {
  const g = await uiGame(360, 640, 200, {});
  const ex = g.ex;
  while (ex.t_log_len() <= 4080) { assert.equal(ex.act(17, 1000, 0, 0), 0); assert.equal(ex.act(18, 1000, 0, 0), 0); }
  assert.equal(ex.t_log_st(), 0);
  assert.ok(ex.t_log_len() > 4080 && ex.t_log_len() <= 4096, `${ex.t_log_len()}`);
  const n = ex.t_log_len(), s = bytes(g);
  assert.equal(ex.act(3, 0, 0, 0), 0, 'HARVEST ALL with nothing ripe');
  assert.deepEqual(bytes(g), s, 'a no-op');
  assert.equal(ex.t_log_st(), 0, 'still recording: nothing needed room');
  assert.equal(ex.t_log_len(), n);
  assert.equal(ex.act(17, 1000, 0, 0), 0);
  assert.equal(ex.t_log_st(), 1, 'a real action that might not fit overflows');
});

test('A9: the Results share line says READY, the code length and the days, never an upper-cased fragment', async () => {
  for (const name of ['ui-results-share', 'ui-results-share-qr', 'ui-results-share-toolong']) {
    const g = await uiState(name);
    const code = g.code();
    const h = await uiGame(360, 640, 200, { boot: 0 });
    assert.equal(h.load(code), 0);
    const days = rp(h, RPF.N);                   // the End Days in the log (what the viewer plays)
    const line = g.labels().find((l) => l.startsWith('SHARE CODE'));
    assert.equal(line, `SHARE CODE READY: ${code.length} CHARS, ${days} ${days === 1 ? 'DAY' : 'DAYS'}`, name);
    assert.ok(!g.labels().some((l) => l.includes(code.slice(0, 8).toUpperCase())), 'no code fragment');
  }
});

test('A10: COPY CODE shows the two-square copy glyph (not the plus)', async () => {
  const names = ICONS.map(([n]) => n);
  assert.ok(names.includes('COPY'));
  const g = await uiState('ui-results-share');
  const r = g.hit(RP.COPY);
  const find = (name) => {
    const [, cols, rows] = ICONS.find(([n]) => n === name);
    const m = g.mem(), fb = g.ex.fb_ptr(), w = g.ex.fb_w();
    const px = (x, y) => new DataView(m.buffer).getUint32(fb + (y * w + x) * 4, true);
    const pal = (i) => new DataView(m.buffer).getUint32(0x100 + i * 4, true);
    for (let s = 1; s <= 2; s++) for (let y = r.y; y + 9 * s <= r.y + r.h; y++) for (let x = r.x; x + 9 * s <= r.x + r.w; x++) {
      let ok = true;
      for (let k = 0; k < 81 && ok; k++) {
        const v = rows[(k / 9) | 0][k % 9];
        if (v !== '.' && px(x + (k % 9) * s, y + ((k / 9) | 0) * s) !== pal(cols[Number(v) - 1])) ok = false;
      }
      if (ok) return true;
    }
    return false;
  };
  assert.ok(find('COPY'), 'copy glyph drawn in the COPY CODE button');
  assert.ok(!find('PLUS'), 'no plus glyph there');
});

test('A11: invalid replay at large 320x568 says why; viewer buttons keep the large scale', async () => {
  const g = await uiGame(320, 568, 200, { boot: 0, large: true });
  g.frame();
  assert.equal(g.load(CODES.BAD_LOG), 0);
  g.tap(RP.WATCH);
  g.frame();
  assert.equal(g.ui(FIT_DN), 0, 'day 0: nothing shrinks');
  g.tap(RP.NEXT); g.tap(RP.NEXT); g.tap(RP.NEXT);
  g.frame();
  assert.equal(rp(g, RPF.BAD), 4);
  assert.ok(g.labels().includes('REPLAY STOPPED AT DAY 4: INVALID MOVE'), JSON.stringify(g.labels()));
  assert.equal(g.ui(FIT_DN), 0, 'invalid: nothing shrinks');
  for (const c of [RP.RESTART, RP.PREV, RP.NEXT, RP.PLAY, RP.SPEED, RP.TAKE, RP.EXIT, RP.SCRUB]) assert.ok(g.hit(c), `0x${c.toString(16)} reachable`);
  // and on the normal phone / laptop sizes the card keeps its rows
  for (const [w, h, dpr] of [[360, 640, 200], [1280, 800, 100]]) {
    const v = await uiGame(w, h, dpr, { boot: 0 });
    v.frame(); v.load(CODES.BOT40); v.tap(RP.WATCH); v.frame();
    assert.equal(v.ui(FIT_DN), 0, `${w}x${h}`);
  }
});
