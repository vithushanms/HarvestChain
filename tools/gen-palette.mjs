// Generates the 64-entry palette (16 hues x 4 ramp steps) as a WAT data segment.
// Entry index = hue*4 + step; step 0 darkest .. 3 lightest. Bytes r,g,b,255, so a
// little-endian i32 load is the 0xAABBGGRR canvas pixel word.
// Shadows are hue-shifted toward cool blue, highlights toward warm yellow.
import { esc, splice, isMain } from './gen-util.mjs';

export const PAL_ADDR = 0x100;
// [name, hue deg, saturation %, lightness % for steps 0..3]
export const HUES = [
  ['SOIL',   28, 36, [24, 34, 45, 57]],
  ['TILLED', 20, 32, [11, 17, 25, 34]],
  ['GRASS', 102, 42, [20, 30, 43, 57]],
  ['GRASS2', 78, 46, [22, 33, 45, 59]],
  ['WHEAT',  42, 76, [30, 44, 58, 72]],
  ['CORN',   52, 86, [34, 47, 60, 76]],
  ['TOMATO',  4, 76, [28, 40, 52, 66]],
  ['APPLE', 348, 58, [24, 35, 47, 60]],
  ['GRAPE', 280, 38, [20, 30, 42, 56]],
  ['BARN',    8, 58, [18, 27, 36, 48]],
  ['WOOD',   26, 50, [20, 30, 41, 54]],
  ['STONE', 215,  8, [24, 38, 54, 70]],
  ['SKY',   205, 68, [40, 56, 70, 84]],
  ['WATER', 188, 62, [26, 40, 54, 70]],
  ['PAPER',  42, 50, [64, 76, 87, 95]],
  ['INK',   225, 28, [8, 14, 22, 34]],
];
const SHIFT = [-16, -7, 0, 8];          // degrees toward blue (-) or yellow (+)
const SATK = [90, 100, 100, 90];        // saturation scale %

const arc = (from, to) => ((to - from + 540) % 360) - 180; // signed shortest arc
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

export function palette() {
  const out = [];
  for (const [, h, s, ls] of HUES) {
    for (let step = 0; step < 4; step++) {
      const target = step < 2 ? 240 : 55;
      const d = arc(h, target);
      const mag = Math.min(Math.abs(SHIFT[step]), Math.abs(d));
      const hh = h + Math.sign(d) * mag;
      out.push(hsl2rgb(hh, s * SATK[step] / 100, ls[step]));
    }
  }
  return out;
}

export function generate() {
  const pal = palette();
  let t = `(data (i32.const 0x${PAL_ADDR.toString(16)})\n`;
  HUES.forEach(([name], i) => {
    const bytes = pal.slice(i * 4, i * 4 + 4).flatMap(([r, g, b]) => [r, g, b, 255]);
    t += `  "${esc(bytes)}" ;; ${i} ${name}\n`;
  });
  t += ')\n';
  HUES.forEach(([name], i) => { t += `(global $H_${name} i32 (i32.const ${i}))\n`; });
  return t;
}

if (isMain(import.meta)) splice('palette', generate());
