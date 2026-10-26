// Build-time PWA icon: a flat 16x16 pixel-art barn scaled to 512x512, written as a palette PNG
// (pure node:zlib, no deps). Runs only inside tools/build.mjs; the PNG is inlined into the manifest.
import { deflateSync, crc32 } from 'node:zlib';

const PAL = { '.': '#7cc4e8', g: '#5a9e3c', G: '#3f7a2a', r: '#b83a2a', R: '#8c2a1e', y: '#e8c24a', w: '#f4ecd8', k: '#2a2430', s: '#d8d0c0' };
const ART = [
  '................',
  '................',
  '.....yy.........',
  '....yyyy...ss...',
  '................',
  '......RRRR......',
  '....RRrrrrRR....',
  '...RrrrrrrrrR...',
  '..RrrrrrrrrrrR..',
  '..rrrwwwwwwrrr..',
  '..rrrwkwwkwrrr..',
  '..rrrwwkkwwrrr..',
  '..rrrwkwwkwrrr..',
  'ggggwwwwwwgggggg',
  'GgGgGgGgGgGgGgGg',
  'GGGGGGGGGGGGGGGG',
];

export function makeIcon(size = 512) {
  const keys = Object.keys(PAL), k = size / 16;
  const raw = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = ART[(y / k) | 0];
    for (let x = 0; x < size; x++) raw[y * (size + 1) + 1 + x] = keys.indexOf(row[(x / k) | 0]);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 3; // 8-bit palette
  const plte = Buffer.from(keys.flatMap((c) => [1, 3, 5].map((i) => parseInt(PAL[c].slice(i, i + 2), 16))));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
