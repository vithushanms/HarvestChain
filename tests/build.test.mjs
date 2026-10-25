import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const build = (src) => {
  const out = mkdtempSync(join(tmpdir(), 'hc-'));
  const r = spawnSync('node', ['tools/build.mjs', '--src', src, '--out', out], { encoding: 'utf8' });
  return { ...r, out };
};

test('real source builds and reports sizes', () => {
  const r = build('src');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /game\.wasm\s+\d+ B raw\s+\d+ B gz/);
  assert.ok(existsSync(join(r.out, 'game.wasm')));
});

test('float token in source fails the build', () => {
  const r = build('tests/fixtures/float');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /f32|f64/);
});

test('sim RNG call in a presentation file (prefix >= 20) fails the build', () => {
  const r = build('tests/fixtures/rng');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /presentation code must not use the sim RNG.*21b_bad\.wat/);
});

test('sim RNG mentioned only in a comment is allowed in a presentation file', () => {
  const r = build('tests/fixtures/rng_comment');
  assert.equal(r.status, 0, r.stderr);
});

test('SIMD instruction fails the build', () => {
  const r = build('tests/fixtures/simd');
  assert.notEqual(r.status, 0);
});

test('memory is exported', async () => {
  const { loadGame } = await import('./helpers.mjs');
  const { ex } = await loadGame();
  assert.ok(ex.memory instanceof WebAssembly.Memory);
});
