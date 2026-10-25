import { test } from 'node:test';
import assert from 'node:assert/strict';
import { palette, generate as genPal, HUES } from '../../tools/gen-palette.mjs';
import { generate as genFont, bodyBytes, badgeBytes, KEYS } from '../../tools/gen-font.mjs';
import { extract } from '../../tools/gen-util.mjs';
import { loadGame } from '../helpers.mjs';

const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const REQUIRED = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?-+/%$\'()*<>=', 'STAR', 'UP', 'DOWN'];

test('generators are deterministic', () => {
  assert.equal(genPal(), genPal());
  assert.equal(genFont(), genFont());
});

test('committed src/02_data.wat matches the generators (no drift)', () => {
  assert.equal(extract('palette'), genPal());
  assert.equal(extract('fonts'), genFont());
});

test('palette: 16 hues x 4 steps, every ramp strictly monotonic in luminance', () => {
  const pal = palette();
  assert.equal(HUES.length, 16);
  assert.equal(pal.length, 64);
  for (let h = 0; h < 16; h++) {
    const l = [0, 1, 2, 3].map((s) => luma(pal[h * 4 + s]));
    for (let s = 1; s < 4; s++) assert.ok(l[s] > l[s - 1] + 8, `${HUES[h][0]} step ${s}: ${l}`);
  }
});

test('palette in wasm memory matches generator, alpha always 255', async () => {
  const { mem } = await loadGame();
  const m = mem();
  const pal = palette();
  for (let i = 0; i < 64; i++) {
    assert.deepEqual([...m.slice(0x100 + i * 4, 0x100 + i * 4 + 4)], [...pal[i], 255], `entry ${i}`);
  }
});

test('shadows hue-shift toward blue and highlights toward yellow (warm hues)', () => {
  const pal = palette();
  const hue = ([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const dist = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  for (const name of ['SOIL', 'WHEAT', 'WOOD', 'PAPER', 'TOMATO']) {
    const h = HUES.findIndex((x) => x[0] === name);
    const hs = (s) => hue(pal[h * 4 + s]);
    assert.ok(dist(hs(0), 240) < dist(hs(2), 240), name + ' shadow cooler');
    assert.ok(dist(hs(3), 55) < dist(hs(2), 55), name + ' highlight warmer');
  }
});

test('ink on paper contrast >= 4.5:1', () => {
  const pal = palette();
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const ps of [2, 3]) assert.ok(ratio(pal[15 * 4], pal[14 * 4 + ps]) >= 4.5);
});

test('every required glyph in both fonts is non-empty; space is empty; stored in wasm memory', async () => {
  const { mem } = await loadGame();
  const m = mem();
  for (const [name, glyphs, base, n] of [['body', bodyBytes(), 0x210, 5], ['badge', badgeBytes(), 0x360, 2]]) {
    for (const k of REQUIRED) {
      const i = KEYS.indexOf(k);
      assert.ok(i >= 0, k);
      assert.ok(glyphs[i].some((b) => b), `${name} ${k} empty`);
      assert.deepEqual([...m.slice(base + i * n, base + i * n + n)], glyphs[i], `${name} ${k} in memory`);
    }
    assert.ok(glyphs[0].every((b) => b === 0), `${name} space empty`);
  }
});
