// Build-time PWA icon: a flat 16x16 pixel-art barn scaled to 192x192, written as a 2-bit palette PNG with
// filter 'Up' (pure node:zlib, no deps; ~200 B so it fits the index.html budget). Inlined into the manifest.
import { deflateSync, crc32 } from 'node:zlib';

const PAL = { '.': '#7cc4e8', g: '#4f8f34', r: '#b83a2a', w: '#f4ecd8' };
const ART = [
  '................',
  '................',
  '................',
  '................',
  '......rrrr......',
  '....rrrrrrrr....',
  '...rrrrrrrrrr...',
  '..rrrrrrrrrrrr..',
  '..rrrrwwwwrrrr..',
  '..rrrrwrrwrrrr..',
  '..rrrrwwwwrrrr..',
  '..rrrrwrrwrrrr..',
  'ggggggwrrwgggggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
];

export function makeIcon(size = 192) {
  const keys = Object.keys(PAL), k = size / 16, rb = size / 4;   // 2-bit palette: four pixels per byte
  const raw = Buffer.alloc((rb + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = ART[(y / k) | 0];
    for (let x = 0; x < size; x++) raw[y * (rb + 1) + 1 + (x >> 2)] |= keys.indexOf(row[(x / k) | 0]) << (6 - 2 * (x & 3));
  }
  // PNG filter 2 'Up': each row minus the one above (rows repeat k times, so most become zero runs)
  for (let y = size - 1; y > 0; y--) {
    raw[y * (rb + 1)] = 2;
    for (let x = 1; x <= rb; x++) raw[y * (rb + 1) + x] = (raw[y * (rb + 1) + x] - raw[(y - 1) * (rb + 1) + x]) & 255;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 2; ihdr[9] = 3; // 2-bit palette
  const plte = Buffer.from(keys.flatMap((c) => [1, 3, 5].map((i) => parseInt(PAL[c].slice(i, i + 2), 16))));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
