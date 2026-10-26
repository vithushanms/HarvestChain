// The shipping binary (build/game.wasm) has no t_* test hooks; the test binary (build/game.test.wasm) has all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadGame, readState } from './helpers.mjs';

const PROD = 'build/game.wasm', TEST = 'build/game.test.wasm';
const names = (p) => WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(p))).map((e) => e.name);
const ACT_PLANT = 1;

test('shipping build exports no t_* names', () => {
  const bad = names(PROD).filter((n) => n.startsWith('t_'));
  assert.deepEqual(bad, []);
  assert.ok(names(TEST).some((n) => n.startsWith('t_')), 'test build keeps its hooks');
});

test('every shipping export also exists in the test build', () => {
  const t = new Set(names(TEST));
  for (const n of names(PROD)) assert.ok(t.has(n), `missing in test build: ${n}`);
});

const sha = (g) => {
  const { ex } = g;
  const n = ex.fb_w() * ex.fb_h() * 4;
  return createHash('sha256').update(g.mem().subarray(ex.fb_ptr(), ex.fb_ptr() + n)).digest('hex');
};

// Drive only exports present in the shipping build; returns what it observed.
async function scenario(path) {
  const g = await loadGame(path);
  const { ex } = g;
  ex.resize(360, 640, 200);
  ex.ui_new_game(7);
  let t = 1000;
  const frames = [];
  const f = (dt = 16) => { const r = ex.frame(t += dt); frames.push(r); return r; };
  f();
  ex.pointer(180, 300, 0); f(); ex.pointer(180, 300, 2); f();
  ex.pointer(30, 600, 0); f(); ex.pointer(30, 600, 2); f();
  for (const k of [9, 10, 11, 12, 13, 8, 3]) { ex.key(k); f(); }
  for (let i = 0; i < 30; i++) f();
  const r = ex.frame(t += 1000);
  return { g, ex, frames, r, hash: sha(g) };
}

test('smoke: playable through shipping exports only', async () => {
  const { g, ex, frames, r } = await scenario(PROD);
  for (const x of [...frames, r]) assert.ok(x === 0 || x === 1 || x === 2, `frame() returned ${x}`);
  const fb = g.mem().subarray(ex.fb_ptr(), ex.fb_ptr() + ex.fb_w() * ex.fb_h() * 4);
  const colours = new Set();
  for (let i = 0; i < fb.length; i += 4 * 97) colours.add((fb[i] << 16) | (fb[i + 1] << 8) | fb[i + 2]);
  assert.ok(colours.size > 4, `framebuffer looks blank (${colours.size} colours)`);

  const nw0 = ex.net_worth();
  let planted = -1;
  for (let tile = 0; tile < 64 && planted < 0; tile++) if (ex.act(ACT_PLANT, tile, 0, 0) === 0) planted = tile;
  assert.ok(planted >= 0, 'act(PLANT) succeeded on some tile');
  assert.equal(typeof ex.net_worth(), 'number');
  const day0 = readState(g.mem()).day;
  ex.end_day();
  assert.ok(readState(g.mem()).day >= day0, 'day advanced or run ended');
  assert.ok(Number.isInteger(ex.net_worth()) && Number.isInteger(nw0));

  assert.equal(ex.need_save(), 1, 'a change flags need_save');
  const len = ex.save_len();
  const saved = g.mem().slice(ex.save_ptr(), ex.save_ptr() + len);
  ex.ack_save();
  assert.equal(ex.need_save(), 0);
  const g2 = await loadGame(PROD);
  g2.mem().set(saved, g2.ex.io_buf());
  assert.equal(g2.ex.load(g2.ex.io_buf(), len), 0);
  assert.deepEqual(readState(g2.mem()), readState(g.mem()));
  assert.equal(g2.ex.net_worth(), ex.net_worth());
});

test('stripping hooks changed nothing visible: identical framebuffer hash', async () => {
  const a = await scenario(PROD), b = await scenario(TEST);
  assert.deepEqual(a.frames, b.frames);
  assert.equal(a.hash, b.hash);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
});
