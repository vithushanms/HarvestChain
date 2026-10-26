// Task 7 integration: the share link's QR code on the Results / Game Over share panel
// ($share_qr_slot in src/24_replay.wat, encoder src/25_qr.wat). The framebuffer region the module
// reports (t_qr) is cropped out of the real frame and decoded with jsQR: the text must be the share
// URL (origin + '#' + code). Long runs (link > 858 bytes) show no QR and a one-line explanation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { uiGame, uiState, HIT, KEY, UI, SCR, OVL, RP, ORIGIN, setOrigin } from './uistates.mjs';
import { STATE } from '../helpers.mjs';

const TOO_LONG = 'TOO LONG FOR QR - COPY CODE';
const QR = { X: 0, Y: 1, SIDE: 2, SCALE: 3 };
const url = (g) => Buffer.from(g.mem().slice(g.ex.share_url_ptr(), g.ex.share_url_ptr() + g.ex.share_url_len())).toString('latin1');
const qr = (g) => [0, 1, 2, 3].map((k) => g.ex.t_qr(k));
const bytes = (g) => g.mem().slice(STATE.base, STATE.base + STATE.length);

// Crop the drawn QR (incl. quiet zone) out of the framebuffer and decode it.
function decodeFb(g) {
  const [x, y, side] = qr(g);
  const W = g.ex.fb_w(), fb = new Uint32Array(g.ex.memory.buffer, g.ex.fb_ptr(), W * g.ex.fb_h());
  const crop = new Uint8ClampedArray(side * side * 4), out = new Uint32Array(crop.buffer);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) out[j * side + i] = fb[(y + j) * W + x + i];
  return { r: jsQR(crop, side, side, { inversionAttempts: 'dontInvert' }), fb, W };
}
// Scroll the card (drag on the panel) until the whole QR is inside the visible body.
function reveal(g) {
  for (let i = 0; i < 60; i++) {
    g.frame();
    const [, y, side, s] = qr(g);
    if (!s) return;
    const p = g.hit(HIT.PANEL);
    const top = g.ex.t_qr(4), bottom = g.ex.t_qr(5);   // card body clip
    if (y >= top && y + side <= bottom) return;
    const [cx, cy] = g.toCss(p.x + 3, p.y + (p.h >> 1));
    const dy = y < top ? 30 : -30;
    g.down(cx, cy); g.ex.pointer(cx, cy + dy, 1); g.up(cx, cy + dy);
  }
}

const SIZES = [[360, 640, 200, false], [1280, 800, 100, false], [320, 568, 200, true]];

test('a short run: Results shows a QR of the share URL; the framebuffer decodes to it (phone, laptop, large text)', async () => {
  for (const [w, h, d, large] of SIZES) {
    const g = await uiState('ui-results-share-qr', w, h, d);
    if (large) { g.ex.set_flags(1, 1); g.frame(); }
    assert.equal(g.ui(UI.SCR), SCR.RESULTS, `${w}x${h}`);
    const link = url(g);
    assert.ok(link.startsWith(ORIGIN + '#') && link.length <= 858, link);
    reveal(g);
    const [x, y, side, s] = qr(g);
    assert.ok(s >= 2, `${w}x${h} large=${large}: scale ${s} >= 2 px per module`);
    const n = g.ex.qr_size();
    assert.equal(side, (n + 8) * s, 'side includes the 4-module quiet zone');
    assert.ok(x >= 0 && y >= 0 && x + side <= g.ex.fb_w() && y + side <= g.ex.fb_h(), 'inside the framebuffer');
    const { r, fb, W } = decodeFb(g);
    assert.ok(r, `${w}x${h} large=${large}: framebuffer QR decodes`);
    assert.equal(r.data, link);
    // quiet zone: the 4-module border is paper all round
    const paper = fb[y * W + x];
    for (let i = 0; i < side; i += s) {
      for (const [px, py] of [[x + i, y], [x + i, y + side - 1], [x, y + i], [x + side - 1, y + i]]) {
        assert.equal(fb[py * W + px], paper, `quiet zone at ${px},${py}`);
      }
    }
    // the share buttons are still there and touchable
    for (const c of [RP.COPY, RP.OWN]) {
      const b = g.hit(c) || (g.reach(c), g.hit(c));
      assert.ok(b && b.w >= g.ex.t_min_touch() && b.h >= g.ex.t_min_touch(), `${w}x${h} 0x${c.toString(16)}`);
    }
    assert.ok(!g.labels().includes(TOO_LONG));
    assert.equal(g.ex.t_canary_ok(), 1);
  }
});

test('a long run (240-day bot, link > 858 B): no QR, the explanation line, COPY CODE and WATCH REPLAY stay', async () => {
  for (const [w, h, d, large] of SIZES) {
    const g = await uiState('ui-results-share-toolong', w, h, d);
    if (large) { g.ex.set_flags(1, 1); g.frame(); }
    assert.ok([SCR.RESULTS, SCR.GAMEOVER].includes(g.ui(UI.SCR)));
    assert.equal(g.ex.t_log_st(), 0, 'the run is shareable');
    assert.ok(g.ex.t_log_len() > 3000, `log ${g.ex.t_log_len()} B`);
    assert.ok(url(g).length > 858);
    assert.equal(g.ex.t_qr(3), 0, 'no QR drawn');
    assert.ok(g.labels().includes(TOO_LONG), JSON.stringify(g.labels()));
    assert.ok(g.reach(RP.COPY) && g.reach(RP.OWN));
  }
});

test('the QR is re-encoded from the current link on every draw (the matrix is shared scratch)', async () => {
  const g = await uiState('ui-results-share-qr');
  reveal(g);
  assert.equal(decodeFb(g).r.data, url(g));
  // clobber the shared matrix with another payload, then redraw: the Results QR is the link again
  const io = g.ex.io_buf();
  g.mem().set(Buffer.from('SOMETHING ELSE'), io);
  assert.ok(g.ex.qr_encode(io, 14));
  g.ex.resize(360, 640, 200); g.frame();
  reveal(g);
  assert.equal(decodeFb(g).r.data, url(g));
  // a new origin (the link changes) shows up in the next frame
  setOrigin(g.ex, 'https://other.example/hc/');
  g.ex.resize(360, 640, 200); g.frame();
  reveal(g);
  assert.ok(url(g).startsWith('https://other.example/hc/#'));
  assert.equal(decodeFb(g).r.data, url(g));
  // drawing the QR never changes the sim state
  const before = bytes(g);
  for (let i = 0; i < 5; i++) { g.ex.resize(360, 640, 200); g.frame(); }
  assert.deepEqual(bytes(g), before);
});

test('a resumed save without its log shows no code and no QR (and no QR explanation)', async () => {
  const src = await uiState('ui-results-share-qr');
  const save = bytes(src);
  const g = await uiGame(360, 640, 200, {});
  setOrigin(g.ex);
  g.mem().set(save, g.ex.io_buf());
  assert.equal(g.ex.load(g.ex.io_buf(), save.length), 0);
  g.ex.ui_boot(1); g.frame();
  g.tap(OVL.CONTINUE);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS);
  assert.equal(g.hit(RP.COPY), undefined);
  assert.equal(g.ex.t_qr(3), 0);
  assert.ok(g.labels().includes('SHARE ONLY FOR RUNS STARTED THIS SESSION'));
  assert.ok(!g.labels().includes(TOO_LONG));
  g.key(KEY.R);
  assert.equal(g.ui(UI.SCR), SCR.RESULTS);
});
