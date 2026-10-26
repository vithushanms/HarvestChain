// Generates the QR encoder's constant block in src/25_qr.wat (between the GENERATED qr markers):
//   - a 20-byte table at $QR_TAB, one byte per version 1..20 at ECC level L:
//     ((blocks - 1) << 5) | ecc codewords per block   (ISO/IEC 18004 Table 9, typed below)
//     Everything else per version (total codewords, group split, alignment centres, remainder
//     bits) is computed at run time from the version number.
//   - $QR_FMT: the 15 format bits for (ECC L, fixed mask) = BCH(15,5) with generator 0x537, ^ 0x5412.
//   - $qr_mask(x, y): 1 where the fixed data mask inverts a module.
// Usage: node tools/gen-qr.mjs [mask 0..7]   (default QR_MASK; the committed block uses QR_MASK)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, extract as extractIn, splice, isMain } from './gen-util.mjs';

export const QR_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', '25_qr.wat');
export const QR_TAB = 0xC000;
// Mask 0 ((x + y) even, a checkerboard) is the fixed mask: no penalty scoring (the spec allows any of
// the 8 masks; decoders read it from the format bits). Checked with jsQR across the whole test battery.
export const QR_MASK = 0;

// Level L, versions 1..20: EC codewords per block and total block count (groups 1 + 2).
const L_EC = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28];
const L_BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8];

export const formatBits = (mask) => {
  const data = (1 << 3) | mask;   // ECC level L = 01
  let r = data;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((data << 10) | r) ^ 0x5412;
};

// Mask conditions (x = column, y = row); p = x*y.
const MASKS = [
  '(i32.eqz (i32.and (i32.add (local.get $x) (local.get $y)) (i32.const 1)))',
  '(i32.eqz (i32.and (local.get $y) (i32.const 1)))',
  '(i32.eqz (i32.rem_u (local.get $x) (i32.const 3)))',
  '(i32.eqz (i32.rem_u (i32.add (local.get $x) (local.get $y)) (i32.const 3)))',
  '(i32.eqz (i32.and (i32.add (i32.shr_u (local.get $y) (i32.const 1)) (i32.div_u (local.get $x) (i32.const 3))) (i32.const 1)))',
  '(i32.eqz (i32.add (i32.and (local.tee $p (i32.mul (local.get $x) (local.get $y))) (i32.const 1)) (i32.rem_u (local.get $p) (i32.const 3))))',
  '(i32.eqz (i32.and (i32.add (i32.and (local.tee $p (i32.mul (local.get $x) (local.get $y))) (i32.const 1)) (i32.rem_u (local.get $p) (i32.const 3))) (i32.const 1)))',
  '(i32.eqz (i32.and (i32.add (i32.and (i32.add (local.get $x) (local.get $y)) (i32.const 1)) (i32.rem_u (i32.mul (local.get $x) (local.get $y)) (i32.const 3))) (i32.const 1)))',
];

export function generate(mask = QR_MASK) {
  const tab = L_EC.map((ec, i) => ((L_BLOCKS[i] - 1) << 5) | ec);
  const p = mask === 5 || mask === 6 ? ' (local $p i32)' : '';
  return `(data (i32.const 0x${QR_TAB.toString(16)}) "${esc(tab)}") ;; L: ((blocks-1)<<5)|ecc per block, v1..20\n`
    + `(global $QR_FMT i32 (i32.const 0x${formatBits(mask).toString(16)})) ;; format bits: ECC L, mask ${mask}\n`
    + `(func $qr_mask (param $x i32) (param $y i32) (result i32)${p} ;; mask ${mask}\n  ${MASKS[mask]})\n`;
}

export const extract = (name = 'qr', file = QR_FILE) => extractIn(name, file);

if (isMain(import.meta)) splice('qr', generate(process.argv[2] === undefined ? QR_MASK : Number(process.argv[2])), QR_FILE);
