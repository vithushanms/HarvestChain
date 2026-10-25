// Dev tool: render a canned scene headlessly and write a PNG (node:zlib only).
// Usage: node tools/dump-ppm.mjs <scene> <w_css> <h_css> [dpr_x100=100] [--zoom N]
//   scenes: demo (palette swatches, fonts, shapes), iso (isometric 3D showcase),
//           iso-small (the iso showcase at 180x320 logical; size args ignored)
// Output: build/<scene>-<w>x<h>.png (nearest-neighbour zoomed, default 2x).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
// rgba: Uint8Array of w*h*4
export function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function renderScene(scene, w, h, dpr = 100) {
  const { instance } = await WebAssembly.instantiate(readFileSync(join(root, 'build', 'game.wasm')), {});
  const ex = instance.exports;
  ex.init(1);
  if (scene === 'iso-small') ex.resize(180, 320, 100);
  else ex.resize(w, h, dpr);
  if (scene === 'demo') ex.t_demo(0);
  else if (scene === 'iso' || scene === 'iso-small') ex.t_iso_demo(0);
  else throw new Error(`unknown scene "${scene}" (available: demo, iso, iso-small)`);
  const fw = ex.fb_w(), fh = ex.fb_h();
  return { w: fw, h: fh, rgba: new Uint8Array(ex.memory.buffer.slice(ex.fb_ptr(), ex.fb_ptr() + fw * fh * 4)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const zi = args.indexOf('--zoom');
  const zoom = zi >= 0 ? Number(args.splice(zi, 2)[1]) : 2;
  const [scene = 'demo', w = '360', h = '640', dpr = '100'] = args;
  const img = await renderScene(scene, Number(w), Number(h), Number(dpr));
  const zw = img.w * zoom, zh = img.h * zoom;
  const out = new Uint32Array(zw * zh);
  const src = new Uint32Array(img.rgba.buffer);
  for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) out[y * zw + x] = src[((y / zoom) | 0) * img.w + ((x / zoom) | 0)];
  mkdirSync(join(root, 'build'), { recursive: true });
  const file = join(root, 'build', `${scene}-${img.w}x${img.h}.png`);
  writeFileSync(file, encodePng(zw, zh, new Uint8Array(out.buffer)));
  console.log(`${file}  logical ${img.w}x${img.h}  png ${zw}x${zh}`);
}
