// Generates the scene model table (crops, buildings, trucks, props) as a WAT data segment
// spliced into src/21c_scene.wat. Each model is a list of 8-byte primitive records that one
// interpreter loop ($mdraw) draws in order (author records back to front).
//
// Record: b0 type | flags, b1..b3 x y z (i8, world units, tile = 16), b4..b6 a b c (u8),
//         b7 hue (bits 0-3) | axis/dome (bit 4) | condition (bits 5-7).
// Types:  0 box(w,d,h)  1 prism(w,d,h, axis)  2 cyl(r,_,h)  3 sphere(r in 1/16 tile; dome =
//         clipped at its centre row)  4 rep(nx|ny<<4, sx|sy<<4, n): the next n records drawn on
//         an nx x ny grid (diagonal order)  5 shadow(w,d,sweep) (shadow pass only)
//         6 fx(kind, size): 0 windmill sails, 1 smoke, 2 snowflake decal  7 sub-model(id; 255 =
//         the greenhouse crop of the current tile)
// Flags:  8 no outline, 16 roof (snow-covered in winter), 32 specular pip, 64 glass (blend50),
//         128 sway (1px idle sway)
// Conds:  0 always, 1 A, 2 !A, 3 B, 4 !B, 5 C, 6 !C, 7 D.  Crops: A ripe, B winter, C spring.
//         Buildings: A upgraded, B recipe active. Trucks: A refrigerated, B fast.
// Index (at MODEL_ADDR): per model u16 record address, u8 record count, u8 top height.
import { esc, hex, isMain, extract as ex, splice as sp } from './gen-util.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCENE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', '21c_scene.wat');
export const MODEL_ADDR = 0x6800;
const H = { SOIL: 0, TILLED: 1, GRASS: 2, GRASS2: 3, WHEAT: 4, CORN: 5, TOMATO: 6, APPLE: 7, GRAPE: 8,
  BARN: 9, WOOD: 10, STONE: 11, SKY: 12, WATER: 13, PAPER: 14, INK: 15 };
const COND = { '': 0, A: 1, '!A': 2, B: 3, '!B': 4, C: 5, '!C': 6, D: 7 };
const FLAG = { noout: 8, roof: 16, spec: 32, glass: 64, sway: 128 };

const rec = (type, x, y, z, a, b, c, hue, o = {}) => {
  let f = type;
  for (const k of Object.keys(FLAG)) if (o[k]) f |= FLAG[k];
  return { type, x, y, z, a, b, c, top: o.top ?? 0,
    bytes: [f, x & 255, y & 255, z & 255, a, b, c, (H[hue] ?? 0) | (o.axis || o.dome ? 16 : 0) | (COND[o.if ?? ''] << 5)] };
};
const box = (x, y, z, w, d, h, hue, o = {}) => ({ ...rec(0, x, y, z, w, d, h, hue, o), top: z + h });
const prism = (x, y, z, w, d, h, hue, axis, o = {}) => ({ ...rec(1, x, y, z, w, d, h, hue, { ...o, axis }), top: z + h });
const cyl = (x, y, z, r, h, hue, o = {}) => ({ ...rec(2, x, y, z, r, 0, h, hue, o), top: z + h });
const sph = (x, y, z, r, hue, o = {}) => ({ ...rec(3, x, y, z, r, 0, 0, hue, o), top: z + r });
const shadow = (x, y, w, d, sl, o = {}) => rec(5, x, y, 0, w, d, sl, 'SOIL', o);
const fx = (kind, x, y, z, size, o = {}) => ({ ...rec(6, x, y, z, kind, size, 0, 'SOIL', o), top: z });
const sub = (id, x = 0, y = 0) => ({ ...rec(7, x, y, 0, id, 0, 0, 'SOIL'), top: 12 });
const rep = (nx, ny, sx, sy, list) => [{ ...rec(4, 0, 0, 0, nx | (ny << 4), sx | (sy << 4), list.length, 'SOIL'), top: 0 }, ...list];
const no = { noout: 1 };

// ---- crops: 3 stages each (sprout, growing, grown); A ripe, B winter, C spring ----
// tuft: five thin stems (optionally with grain heads); seg: world-space line (thick unless noout)
const tuft = (x, y, h, hue, o = {}) => ({ ...rec(6, x, y, 0, 3, h, 0, hue, { ...o, axis: o.heads }), top: h + 1 });
const seg = (x, y, z, dx, dy, dz, hue, o = {}) =>
  ({ ...rec(6, x, y, z, 5, dz & 255, (dx & 15) | ((dy & 15) << 4), hue, o), top: Math.max(z, z + dz) });
const wheat = [
  rep(4, 4, 4, 4, [tuft(1, 1, 3, 'GRASS')]),
  rep(4, 4, 4, 4, [tuft(1, 1, 6, 'GRASS2', { heads: 1 })]),
  rep(4, 4, 4, 4, [tuft(1, 1, 9, 'WHEAT', { heads: 1, if: 'A' }), tuft(1, 1, 9, 'GRASS2', { heads: 1, if: '!A' })]),
];
const leaf = (z, dx, dy, dz, hue = 'GRASS') => seg(4, 4, z, dx, dy, dz, hue, no);
const corn = [
  rep(2, 2, 8, 8, [tuft(3, 3, 4, 'GRASS')]),
  rep(2, 2, 8, 8, [leaf(5, -3, 0, -2), leaf(7, 0, -3, -2), seg(4, 4, 0, 0, 0, 10, 'GRASS'), leaf(4, 3, 0, -2), leaf(6, 0, 3, -2)]),
  rep(2, 2, 8, 8, [leaf(6, -4, 0, -3), leaf(10, 0, -4, -2), leaf(13, -3, 0, -1, 'GRASS2'), seg(4, 4, 0, 0, 0, 15, 'GRASS'),
    box(5, 5, 6, 1, 1, 4, 'CORN', { if: 'A' }), box(5, 5, 6, 1, 1, 4, 'GRASS2', { if: '!A' }),
    leaf(8, 4, 0, -3), leaf(11, 0, 4, -2), leaf(14, 3, 0, -1, 'GRASS2'),
    seg(4, 4, 15, 1, 0, 2, 'WHEAT', { ...no, sway: 1 }), seg(4, 4, 15, -1, 0, 2, 'WHEAT', { ...no, sway: 1 })]),
];
const fruit = (x, y, z, hue, cond) => sph(x, y, z, 1, hue, { spec: 1, if: cond });
const tomato = [
  rep(2, 2, 8, 8, [sph(4, 4, 1, 2, 'GRASS')]),
  rep(2, 2, 8, 8, [seg(3, 3, 0, 0, 0, 9, 'WOOD', no), sph(4, 4, 4, 4, 'GRASS')]),
  rep(2, 2, 8, 8, [seg(3, 3, 0, 0, 0, 12, 'WOOD', no), sph(4, 4, 5, 5, 'GRASS'),
    fruit(7, 5, 6, 'TOMATO', 'A'), fruit(5, 7, 4, 'TOMATO', 'A'), fruit(6, 7, 8, 'TOMATO', 'A'), fruit(7, 7, 3, 'TOMATO', 'A'),
    fruit(7, 5, 6, 'GRASS2', '!A'), fruit(5, 7, 4, 'GRASS2', '!A')]),
];
const apple = [
  [seg(8, 8, 0, 0, 0, 6, 'WOOD'), sph(8, 8, 8, 4, 'GRASS', { if: '!B' })],
  [shadow(5, 5, 6, 6, 8, { if: '!B' }), shadow(7, 7, 2, 2, 9, { if: 'B' }), cyl(8, 8, 0, 1, 8, 'WOOD'), seg(8, 8, 7, 3, 0, 5, 'WOOD', { if: 'B' }), seg(8, 8, 7, 0, 3, 4, 'WOOD', { if: 'B' }),
    sph(8, 8, 12, 7, 'GRASS', { if: '!B', roof: 1 }), sph(10, 11, 14, 1, 'PAPER', { ...no, if: 'C' })],
  [shadow(3, 3, 10, 10, 14, { if: '!B' }), shadow(7, 7, 2, 2, 16, { if: 'B' }), shadow(5, 9, 4, 1, 9, { if: 'B' }),
    cyl(8, 8, 0, 2, 11, 'WOOD', { if: '!B' }), cyl(8, 8, 0, 1, 10, 'WOOD', { if: 'B' }),
    seg(8, 8, 7, -6, 0, 8, 'WOOD', { if: 'B' }), seg(8, 8, 8, 0, -6, 9, 'WOOD', { if: 'B' }), seg(8, 8, 9, 0, 0, 12, 'WOOD', { if: 'B' }),
    seg(2, 8, 15, -2, 1, 4, 'WOOD', { ...no, if: 'B' }), seg(8, 2, 17, 1, -2, 4, 'WOOD', { ...no, if: 'B' }), seg(8, 8, 21, -2, -1, 3, 'WOOD', { ...no, if: 'B' }),
    seg(8, 8, 8, 6, 0, 8, 'WOOD', { if: 'B' }), seg(8, 8, 8, 0, 6, 8, 'WOOD', { if: 'B' }),
    seg(14, 8, 16, 1, -1, 4, 'WOOD', { ...no, if: 'B' }), seg(8, 14, 16, -1, 1, 4, 'WOOD', { ...no, if: 'B' }),
    sph(8, 8, 17, 10, 'GRASS', { if: '!B', roof: 1 }),
    sph(9, 13, 18, 1, 'PAPER', { ...no, if: 'C' }), sph(13, 9, 20, 1, 'APPLE', { ...no, if: 'C' }),
    sph(12, 12, 16, 1, 'PAPER', { ...no, if: 'C' }), sph(6, 11, 22, 1, 'APPLE', { ...no, if: 'C' }), sph(11, 6, 23, 1, 'PAPER', { ...no, if: 'C' }),
    fruit(10, 13, 15, 'APPLE', 'A'), fruit(13, 10, 18, 'APPLE', 'A'), fruit(12, 13, 21, 'APPLE', 'A'),
    fruit(7, 12, 20, 'APPLE', 'A'), fruit(14, 13, 15, 'APPLE', 'A'), fruit(9, 9, 25, 'APPLE', 'A')],
];
const post = (x, y) => box(x, y, 0, 1, 1, 10, 'WOOD');
const wire = seg(2, 4, 9, 7, 0, 0, 'STONE', no);
const wire2 = seg(9, 4, 9, 4, 0, 0, 'STONE', no);
const bunch = (x, cond, hue) => [fruit(x, 5, 6, hue, cond), fruit(x + 1, 5, 6, hue, cond), fruit(x, 6, 4, hue, cond)];
const grape = [
  rep(1, 2, 0, 7, [post(2, 4), tuft(6, 3, 2, 'GRASS'), tuft(10, 3, 2, 'GRASS'), post(13, 4)]),
  rep(1, 2, 0, 7, [post(2, 4), wire, wire2, sph(5, 4, 7, 3, 'GRASS'), sph(10, 4, 7, 3, 'GRASS'), post(13, 4)]),
  rep(1, 2, 0, 7, [post(2, 4), wire, wire2,
    sph(4, 4, 8, 4, 'GRASS'), sph(8, 4, 9, 4, 'GRASS'), sph(12, 4, 8, 4, 'GRASS'),
    ...bunch(5, 'A', 'GRAPE'), ...bunch(10, 'A', 'GRAPE'), ...bunch(5, '!A', 'GRASS2'), ...bunch(10, '!A', 'GRASS2'), post(13, 4)]),
];

// ---- buildings 0..9: A upgraded, B recipe active ----
const ao = (x, y, w, d, sl) => [shadow(x, y, w, d, sl), shadow(x - 1, y - 1, w + 2, d + 2, 0)];
const roof = { roof: 1 };
const mill = [...ao(2, 2, 12, 12, 18),
  cyl(8, 8, 0, 6, 9, 'STONE'), box(6, 13, 0, 3, 1, 6, 'WOOD'), cyl(8, 8, 9, 5, 12, 'WOOD'),
  cyl(8, 8, 12, 6, 1, 'BARN', { if: 'A' }), cyl(8, 8, 17, 5, 1, 'WHEAT', { ...no, if: 'A' }),
  sph(8, 8, 21, 7, 'BARN', { dome: 1, roof: 1 }), sph(8, 13, 17, 2, 'WOOD'), fx(0, 8, 13, 17, 13)];
const cannery = [...ao(2, 2, 12, 12, 14),
  cyl(5, 5, 0, 4, 15, 'STONE'), cyl(5, 5, 9, 4, 2, 'BARN', { if: 'A' }), sph(5, 5, 15, 4, 'STONE', { dome: 1 }),
  seg(7, 7, 12, 3, 0, 0, 'STONE'),
  box(8, 3, 0, 6, 11, 9, 'PAPER'), box(12, 6, 9, 1, 1, 6, 'STONE'),
  prism(7, 2, 9, 8, 13, 4, 'WATER', 0, roof), box(10, 14, 0, 3, 1, 5, 'WOOD'),
  cyl(3, 12, 0, 2, 4, 'TOMATO', { if: 'A' }), fx(1, 12, 6, 16, 0, { if: 'B' })];
const press = [...ao(2, 2, 12, 12, 10),
  box(2, 3, 0, 12, 10, 1, 'WOOD'), box(3, 4, 1, 2, 2, 12, 'WOOD'), box(11, 4, 1, 2, 2, 12, 'WOOD'),
  box(3, 4, 13, 10, 2, 2, 'WOOD'), cyl(8, 6, 1, 4, 4, 'WOOD'), cyl(8, 6, 2, 4, 1, 'STONE', no),
  sph(8, 6, 5, 3, 'GRAPE', { if: 'B' }), cyl(8, 5, 6, 1, 7, 'STONE'),
  cyl(12, 12, 1, 3, 6, 'WOOD', { if: 'A' }), cyl(12, 12, 3, 3, 1, 'STONE', { ...no, if: 'A' }),
  cyl(5, 12, 1, 3, 6, 'WOOD'), cyl(5, 12, 3, 3, 1, 'STONE', no)];
const bakery = [...ao(3, 3, 10, 10, 14),
  box(3, 3, 0, 10, 10, 10, 'BARN'), box(3, 3, 8, 10, 10, 1, 'PAPER', { ...no, if: 'A' }),
  box(6, 13, 0, 3, 1, 6, 'WOOD'), box(13, 6, 3, 1, 4, 3, 'WHEAT'),
  prism(5, 13, 6, 6, 2, 2, 'PAPER', 0, { ...roof, if: 'A' }),
  prism(2, 2, 10, 12, 12, 6, 'WOOD', 1, roof), box(5, 4, 11, 2, 2, 9, 'STONE'),
  box(9, 10, 12, 2, 2, 5, 'STONE', { if: 'A' }), fx(1, 6, 5, 20, 0, { if: 'B' })];
const cellar = [shadow(2, 2, 13, 13, 4),
  sph(8, 7, 0, 13, 'GRASS', { dome: 1 }), box(11, 3, 0, 3, 3, 6, 'GRASS', { if: 'A' }),
  box(4, 12, 0, 7, 3, 7, 'STONE'), prism(4, 12, 7, 7, 3, 3, 'STONE', 1),
  box(6, 15, 0, 3, 1, 5, 'WOOD'), seg(7, 16, 0, 0, 0, 5, 'INK', no), box(9, 15, 5, 1, 1, 2, 'WHEAT', { spec: 1, if: 'B' }),
  cyl(13, 14, 0, 2, 4, 'WOOD', { if: 'A' }), cyl(2, 15, 0, 2, 4, 'WOOD', { if: 'A' })];
const warehouse = [...ao(1, 2, 14, 12, 12),
  box(1, 3, 0, 14, 10, 9, 'BARN'), box(1, 3, 8, 14, 10, 1, 'PAPER', no),
  box(5, 13, 0, 5, 1, 7, 'WOOD'), seg(5, 14, 0, 5, 0, 7, 'PAPER', no), seg(5, 14, 7, 5, 0, -7, 'PAPER', no),
  prism(0, 2, 9, 16, 12, 7, 'STONE', 0, roof),
  box(7, 7, 14, 3, 3, 3, 'PAPER', { if: 'A' }), prism(6, 6, 17, 5, 5, 3, 'BARN', 0, { ...roof, if: 'A' })];
const coldstore = [...ao(2, 2, 12, 12, 10),
  box(2, 2, 0, 12, 12, 10, 'PAPER'), box(2, 2, 7, 12, 12, 1, 'WATER', no), box(2, 2, 2, 12, 12, 1, 'WATER', { ...no, if: 'A' }),
  box(1, 1, 10, 14, 14, 1, 'STONE'), box(10, 14, 0, 3, 1, 6, 'STONE'),
  box(4, 4, 11, 5, 5, 3, 'STONE', { if: 'A' }), fx(2, 6, 14, 4, 3)];
const greenhouse = [shadow(1, 1, 14, 14, 6),
  box(1, 1, 0, 14, 14, 1, 'STONE'), sub(255),
  box(1, 1, 1, 14, 14, 9, 'WATER', { glass: 1, noout: 1 }),
  prism(1, 1, 10, 14, 14, 5, 'WATER', 0, { glass: 1, noout: 1, roof: 1 }),
  box(14, 14, 1, 1, 1, 9, 'PAPER', no), box(1, 14, 1, 1, 1, 9, 'PAPER', no), box(14, 1, 1, 1, 1, 9, 'PAPER', no),
  box(1, 15, 10, 14, 0, 1, 'PAPER', no), box(15, 1, 10, 0, 14, 1, 'PAPER', no),
  box(11, 3, 13, 2, 2, 3, 'STONE', { if: 'A' })];
const well = [...ao(3, 3, 10, 10, 8),
  cyl(8, 8, 0, 5, 5, 'STONE'), cyl(8, 8, 5, 4, 0, 'WATER', no),
  box(3, 8, 0, 1, 1, 14, 'WOOD'), box(3, 8, 11, 10, 1, 1, 'WOOD', no), box(12, 8, 0, 1, 1, 14, 'WOOD'),
  prism(2, 6, 14, 12, 5, 4, 'BARN', 0, roof),
  cyl(12, 13, 0, 2, 3, 'WOOD', { if: 'A' }), box(2, 12, 0, 4, 3, 2, 'WATER', { if: 'A' })];
const garage = [...ao(1, 1, 14, 14, 12),
  box(1, 1, 0, 14, 14, 1, 'STONE', no), box(1, 1, 1, 14, 1, 10, 'PAPER'), box(1, 2, 1, 1, 13, 10, 'PAPER'),
  sub(25, 1, 7), box(14, 2, 1, 1, 13, 10, 'PAPER'),
  prism(0, 0, 11, 16, 14, 5, 'BARN', 0, roof), box(4, 15, 9, 8, 1, 2, 'WHEAT', { if: 'A' })];

// ---- trucks (A refrigerated, B fast) facing -x (out) and +x (back); props ----
const truck = (back) => {
  const cab = box(back ? 9 : 1, 1, 3, 4, 6, 5, 'BARN', { if: '!B' });
  const cabF = box(back ? 9 : 1, 1, 3, 4, 6, 5, 'TOMATO', { if: 'B' });
  const win = box(back ? 10 : 2, 7, 5, 2, 1, 2, 'WATER', no);
  const cx = back ? 1 : 5;
  const cargo = [box(cx, 1, 3, 8, 6, 6, 'WOOD', { if: '!A' }), box(cx, 1, 3, 8, 6, 6, 'PAPER', { if: 'A' }),
    box(cx, 1, 6, 8, 6, 1, 'WATER', { ...no, if: 'A' }), box(cx, 1, 4, 8, 6, 1, 'CORN', { ...no, if: 'B' })];
  return [shadow(1, 1, 12, 6, 4), box(1, 1, 1, 12, 6, 2, 'INK'),
    ...(back ? [...cargo, cab, cabF, win] : [cab, cabF, win, ...cargo]),
    sph(3, 7, 1, 2, 'INK'), sph(10, 7, 1, 2, 'INK')];
};
const pond = [cyl(8, 8, 0, 13, 0, 'WATER', { if: '!B' }), cyl(6, 7, 0, 6, 0, 'SKY', { ...no, if: '!B' }),
  cyl(8, 8, 0, 13, 0, 'SKY', { if: 'B' }), cyl(6, 7, 0, 7, 0, 'PAPER', { ...no, if: 'B' }),
  seg(3, 6, 0, 5, 2, 0, 'STONE', { ...no, if: 'B' }), seg(8, 8, 0, 4, 5, 0, 'STONE', { ...no, if: 'B' }), seg(8, 8, 0, 2, -5, 0, 'STONE', { ...no, if: 'B' }),
  tuft(14, 3, 5, 'GRASS2', { if: '!B' }), tuft(2, 14, 4, 'GRASS2', { if: '!B' }), tuft(15, 9, 4, 'GRASS', { if: '!B' }),
  tuft(14, 3, 4, 'WOOD', { if: 'B' }), tuft(2, 14, 3, 'WOOD', { if: 'B' }), tuft(15, 9, 3, 'WHEAT', { if: 'B' })];
const rock = [shadow(5, 5, 6, 6, 3), sph(8, 8, 0, 5, 'STONE', { dome: 1 }), sph(11, 10, 0, 3, 'STONE', { dome: 1 })];
const sign = [shadow(7, 8, 2, 2, 6), box(8, 8, 0, 1, 1, 8, 'WOOD'), box(5, 9, 5, 7, 1, 4, 'WHEAT')];
const bush = [shadow(5, 5, 6, 6, 4), sph(8, 8, 3, 5, 'GRASS2', { roof: 1 })];
// rotting crop: limp vines arching off a stake and flopping to the ground (brown, olive dying
// leaves), squashed dark fruit
const droop = (dx, dy, hue = 'WOOD') => [seg(3, 3, 9, dx >> 1, dy >> 1, 1, hue, no), seg(3 + (dx >> 1), 3 + (dy >> 1), 10, dx, dy, -8, hue)];
const mush = (x, y) => sph(x, y, 0, 1, 'BARN', { dome: 1 });
const wilt = [rep(2, 2, 8, 8, [mush(6, 6), ...droop(-4, 2), ...droop(2, -4), seg(3, 3, 0, 0, 0, 9, 'WOOD', no),
  ...droop(4, 1, 'GRASS2'), ...droop(1, 4, 'GRASS2'), mush(1, 7), mush(7, 2)])];

export const MODELS = [
  ...wheat, ...corn, ...tomato, ...apple, ...grape,                    // 0..14 crop*3 + stage
  mill, cannery, press, bakery, cellar, warehouse, coldstore, greenhouse, well, garage, // 15..24
  truck(false), truck(true), sign, bush, pond, rock, wilt,             // 25..31
].map((m) => m.flat());

export function generate() {
  const idx = [], body = [];
  let addr = MODEL_ADDR + MODELS.length * 4;
  MODELS.forEach((m, i) => {
    const top = Math.max(...m.map((r) => r.top));
    idx.push(esc([addr & 255, addr >> 8, m.length, top]) + ` ;; ${i}`);
    for (const r of m) body.push(esc(r.bytes));
    addr += m.length * 8;
  });
  const lines = [];
  for (let i = 0; i < body.length; i += 6) lines.push('  "' + body.slice(i, i + 6).join('') + '"');
  return `(data (i32.const 0x${hex(MODEL_ADDR)})\n` + idx.map((s) => '  "' + s.replace(' ;;', '" ;;')).join('\n') + '\n' +
    lines.join('\n') + `)\n;; ${MODELS.length} models, ${body.length} records, ${addr - MODEL_ADDR} bytes (ends 0x${addr.toString(16)})\n`;
}
export const extract = () => ex('models', SCENE_FILE);
if (isMain(import.meta)) { sp('models', generate(), SCENE_FILE); console.log('models written'); }
