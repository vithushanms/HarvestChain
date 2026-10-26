;; QR code encoder (Task 7b): QR Model 2, byte mode only, ECC level L, versions 1..20, one
;; fixed data mask (mask 0, see tools/gen-qr.mjs; no penalty scoring, the spec allows any mask).
;; Pure: no sim state, no RNG, integer only. Verified with the jsQR decoder (tests/render/qr.test.mjs).
;;
;; API: $qr_encode(ptr, len) -> version 1..20 (smallest whose L byte capacity >= len), or 0 when
;;      len < 0 or len > 858: then nothing in the QR region is written and $qr_n = 0 ("no code":
;;      qr_size() = 0, qr_module() = 0, qr_draw draws nothing). The input must not lie in 0xC000..0xFFFF.
;;      $qr_size() = 17 + 4v; $qr_module(x, y) -> 0/1 (0 outside); $qr_draw(x, y, scale) paints
;;      the code plus a 4-module quiet zone (paper/ink palette colours, clipped by $rect);
;;      $qr_pixels(scale) = drawn side length. Scale is clamped to 0..64 (<= 0 draws nothing).
;;
;; Memory (inside the layout region, 00_memory.wat):
;;   0xC000..0xC013  version table (generated data, 20 B)
;;   0xC020..0xC03F  Reed-Solomon generator polynomial (ec <= 30 coefficients + a 0 sentinel)
;;   0xC040..0xC47C  codewords: data (D bytes) then each block's ECC (ec bytes per block); <= 1085 B
;;   0xC480..0xC8BC  final interleaved codeword stream (<= 1085 B)
;;   0xC900..0xEDC0  module matrix, n*n bytes (n <= 97): bit0 = dark, bit1 = function module
;;
;; GF(256) arithmetic uses a shift-and-xor multiply (poly 0x11D) instead of exp/log tables: smaller
;; code and no table init; v20 (861 data bytes x 28 ECC) costs well under a millisecond.

(global $QR_GEN i32 (i32.const 0xC020))
(global $QR_CW  i32 (i32.const 0xC040))
(global $QR_OUT i32 (i32.const 0xC480))
(global $QR_M   i32 (i32.const 0xC900))
(global $qr_n  (mut i32) (i32.const 0))
(global $qr_bp (mut i32) (i32.const 0))

;; >>> GENERATED qr: do not hand-edit (npm run gen)
(data (i32.const 0xc000) "\07\0a\0f\14\1a\32\34\38\3e\72\74\78\7a\7e\b6\b8\bc\be\dc\fc") ;; L: ((blocks-1)<<5)|ecc per block, v1..20
(global $QR_FMT i32 (i32.const 0x77c4)) ;; format bits: ECC L, mask 0
(func $qr_mask (param $x i32) (param $y i32) (result i32) ;; mask 0
  (i32.eqz (i32.and (i32.add (local.get $x) (local.get $y)) (i32.const 1))))
;; <<< END GENERATED qr

(func $gf_mul (param $x i32) (param $y i32) (result i32)
  (local $z i32) (local $i i32)
  (local.set $i (i32.const 7))
  (loop $l
    (local.set $z (i32.xor
      (i32.xor (i32.shl (local.get $z) (i32.const 1)) (i32.mul (i32.shr_u (local.get $z) (i32.const 7)) (i32.const 0x11D)))
      (i32.mul (i32.and (i32.shr_u (local.get $y) (local.get $i)) (i32.const 1)) (local.get $x))))
    (br_if $l (i32.ge_s (local.tee $i (i32.sub (local.get $i) (i32.const 1))) (i32.const 0))))
  (local.get $z))

;; Append the low $k bits of $v (MSB first) to the zeroed bit stream at $QR_CW.
(func $qr_put (param $v i32) (param $k i32)
  (local $a i32)
  (loop $l
    (local.set $k (i32.sub (local.get $k) (i32.const 1)))
    (if (i32.and (i32.shr_u (local.get $v) (local.get $k)) (i32.const 1))
      (then
        (local.set $a (i32.add (global.get $QR_CW) (i32.shr_u (global.get $qr_bp) (i32.const 3))))
        (i32.store8 (local.get $a) (i32.or (i32.load8_u (local.get $a))
          (i32.shr_u (i32.const 0x80) (i32.and (global.get $qr_bp) (i32.const 7)))))))
    (global.set $qr_bp (i32.add (global.get $qr_bp) (i32.const 1)))
    (br_if $l (local.get $k))))

;; Function module at (x, y) (column, row), dark when $d is non-zero; ignores out-of-range.
(func $qr_fn (param $x i32) (param $y i32) (param $d i32)
  (if (i32.and (i32.lt_u (local.get $x) (global.get $qr_n)) (i32.lt_u (local.get $y) (global.get $qr_n)))
    (then (i32.store8 (i32.add (global.get $QR_M) (i32.add (i32.mul (local.get $y) (global.get $qr_n)) (local.get $x)))
      (i32.or (i32.const 2) (i32.ne (local.get $d) (i32.const 0)))))))

;; Square pattern of radius $r centred on (cx, cy): ring at Chebyshev distance d is dark when bit d
;; of $dark is set (finder + separator: r 4, 0b01011; alignment: r 2, 0b101).
(func $qr_pat (param $cx i32) (param $cy i32) (param $r i32) (param $dark i32)
  (local $dx i32) (local $dy i32) (local $d i32)
  (local.set $dy (i32.sub (i32.const 0) (local.get $r)))
  (loop $ly
    (local.set $dx (i32.sub (i32.const 0) (local.get $r)))
    (loop $lx
      (local.set $d (select (local.get $dx) (i32.sub (i32.const 0) (local.get $dx)) (i32.ge_s (local.get $dx) (i32.const 0))))
      (local.set $d (select (local.get $d) (local.get $dy) (i32.ge_s (local.get $d) (local.get $dy))))
      (local.set $d (select (local.get $d) (i32.sub (i32.const 0) (local.get $dy)) (i32.ge_s (local.get $d) (i32.sub (i32.const 0) (local.get $dy)))))
      (call $qr_fn (i32.add (local.get $cx) (local.get $dx)) (i32.add (local.get $cy) (local.get $dy))
        (i32.and (i32.shr_u (local.get $dark) (local.get $d)) (i32.const 1)))
      (br_if $lx (i32.le_s (local.tee $dx (i32.add (local.get $dx) (i32.const 1))) (local.get $r))))
    (br_if $ly (i32.le_s (local.tee $dy (i32.add (local.get $dy) (i32.const 1))) (local.get $r)))))

;; Raw data modules of version v (all modules minus function patterns, format and version info).
(func $qr_raw (param $v i32) (result i32)
  (local $r i32) (local $na i32)
  (local.set $r (i32.add (i32.mul (i32.add (i32.shl (local.get $v) (i32.const 4)) (i32.const 128)) (local.get $v)) (i32.const 64)))
  (if (i32.ge_u (local.get $v) (i32.const 2))
    (then
      (local.set $na (i32.add (i32.div_u (local.get $v) (i32.const 7)) (i32.const 2)))
      (local.set $r (i32.sub (local.get $r)
        (i32.sub (i32.mul (i32.sub (i32.mul (local.get $na) (i32.const 25)) (i32.const 10)) (local.get $na)) (i32.const 55))))
      (if (i32.ge_u (local.get $v) (i32.const 7)) (then (local.set $r (i32.sub (local.get $r) (i32.const 36)))))))
  (local.get $r))

(func $qr_encode (param $ptr i32) (param $len i32) (result i32)
  (local $v i32) (local $R i32) (local $nb i32) (local $ec i32) (local $D i32) (local $cc i32)
  (local $i i32) (local $j i32) (local $k i32) (local $b i32) (local $n i32) (local $t i32)
  (local $sd i32) (local $ns i32) (local $src i32) (local $e i32) (local $f i32) (local $o i32)
  (local $na i32) (local $step i32) (local $x i32) (local $y i32) (local $right i32) (local $p i32)
  (global.set $qr_n (i32.const 0))
  (if (i32.lt_s (local.get $len) (i32.const 0)) (then (return (i32.const 0))))
  ;; smallest version whose data capacity holds 4 + cc + 8*len bits
  (block $found (loop $lv
    (local.set $v (i32.add (local.get $v) (i32.const 1)))
    (if (i32.gt_u (local.get $v) (i32.const 20)) (then (return (i32.const 0))))
    (local.set $R (i32.shr_u (call $qr_raw (local.get $v)) (i32.const 3)))
    (local.set $t (i32.load8_u offset=0xBFFF (local.get $v)))
    (local.set $nb (i32.add (i32.shr_u (local.get $t) (i32.const 5)) (i32.const 1)))
    (local.set $ec (i32.and (local.get $t) (i32.const 31)))
    (local.set $D (i32.sub (local.get $R) (i32.mul (local.get $nb) (local.get $ec))))
    (local.set $cc (select (i32.const 8) (i32.const 16) (i32.lt_u (local.get $v) (i32.const 10))))
    (br_if $found (i32.le_u (i32.add (i32.add (i32.shl (local.get $len) (i32.const 3)) (i32.const 4)) (local.get $cc))
                            (i32.shl (local.get $D) (i32.const 3))))
    (br $lv)))
  (local.set $n (i32.add (i32.shl (local.get $v) (i32.const 2)) (i32.const 17)))

  ;; ---- data bit stream: mode 0100, count, bytes, terminator (zeros), pad 0xEC/0x11 ----
  (memory.fill (global.get $QR_CW) (i32.const 0) (local.get $R))
  (global.set $qr_bp (i32.const 0))
  (call $qr_put (i32.const 4) (i32.const 4))
  (call $qr_put (local.get $len) (local.get $cc))
  (block $d (loop $l
    (br_if $d (i32.ge_u (local.get $i) (local.get $len)))
    (call $qr_put (i32.load8_u (i32.add (local.get $ptr) (local.get $i))) (i32.const 8))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br $l)))
  ;; bp = 4 mod 8 and bp <= 8D - 4, so the 4-bit terminator always fits and ends on a byte boundary
  (local.set $k (i32.shr_u (i32.add (global.get $qr_bp) (i32.const 4)) (i32.const 3)))
  (local.set $t (i32.const 0xEC))
  (block $d (loop $l
    (br_if $d (i32.ge_u (local.get $k) (local.get $D)))
    (i32.store8 (i32.add (global.get $QR_CW) (local.get $k)) (local.get $t))
    (local.set $t (i32.xor (local.get $t) (i32.const 0xFD)))
    (local.set $k (i32.add (local.get $k) (i32.const 1)))
    (br $l)))

  ;; ---- Reed-Solomon generator of degree ec (roots 2^0 .. 2^(ec-1)), coefficients high to low ----
  (memory.fill (global.get $QR_GEN) (i32.const 0) (i32.const 32))
  (i32.store8 (i32.add (global.get $QR_GEN) (i32.sub (local.get $ec) (i32.const 1))) (i32.const 1))
  (local.set $f (i32.const 1))
  (local.set $i (i32.const 0))
  (loop $li
    (local.set $j (i32.const 0))
    (loop $lj
      (local.set $p (i32.add (global.get $QR_GEN) (local.get $j)))
      (i32.store8 (local.get $p) (i32.xor (call $gf_mul (i32.load8_u (local.get $p)) (local.get $f))
                                          (i32.load8_u offset=1 (local.get $p))))
      (br_if $lj (i32.lt_u (local.tee $j (i32.add (local.get $j) (i32.const 1))) (local.get $ec))))
    (local.set $f (call $gf_mul (local.get $f) (i32.const 2)))
    (br_if $li (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $ec))))
  ;; the loop wrote g[ec-1] ^= g[ec] with g[ec] = 0 (sentinel from the fill)

  ;; ---- per-block ECC: ns short blocks of sd data bytes, then nb-ns blocks of sd+1 ----
  (local.set $sd (i32.sub (i32.div_u (local.get $R) (local.get $nb)) (local.get $ec)))
  (local.set $ns (i32.sub (local.get $nb) (i32.rem_u (local.get $R) (local.get $nb))))
  (local.set $src (global.get $QR_CW))
  (local.set $b (i32.const 0))
  (loop $lb
    (local.set $e (i32.add (i32.add (global.get $QR_CW) (local.get $D)) (i32.mul (local.get $b) (local.get $ec))))
    (local.set $k (i32.add (local.get $sd) (i32.ge_u (local.get $b) (local.get $ns))))
    (loop $ld
      (local.set $f (i32.xor (i32.load8_u (local.get $src)) (i32.load8_u (local.get $e))))
      (memory.copy (local.get $e) (i32.add (local.get $e) (i32.const 1)) (i32.sub (local.get $ec) (i32.const 1)))
      (i32.store8 (i32.add (local.get $e) (i32.sub (local.get $ec) (i32.const 1))) (i32.const 0))
      (local.set $j (i32.const 0))
      (loop $lj
        (local.set $p (i32.add (local.get $e) (local.get $j)))
        (i32.store8 (local.get $p) (i32.xor (i32.load8_u (local.get $p))
          (call $gf_mul (i32.load8_u (i32.add (global.get $QR_GEN) (local.get $j))) (local.get $f))))
        (br_if $lj (i32.lt_u (local.tee $j (i32.add (local.get $j) (i32.const 1))) (local.get $ec))))
      (local.set $src (i32.add (local.get $src) (i32.const 1)))
      (br_if $ld (local.tee $k (i32.sub (local.get $k) (i32.const 1)))))
    (br_if $lb (i32.lt_u (local.tee $b (i32.add (local.get $b) (i32.const 1))) (local.get $nb))))

  ;; ---- interleave: data column i of every block (short blocks have no column sd), then ECC ----
  (local.set $o (global.get $QR_OUT))
  (local.set $i (i32.const 0))
  (loop $li
    (local.set $b (i32.const 0))
    (loop $lb
      (if (i32.lt_u (local.get $i) (i32.add (local.get $sd) (i32.ge_u (local.get $b) (local.get $ns))))
        (then
          (i32.store8 (local.get $o) (i32.load8_u (i32.add (i32.add (global.get $QR_CW) (local.get $i))
            (i32.add (i32.mul (local.get $b) (local.get $sd))
                     (select (i32.sub (local.get $b) (local.get $ns)) (i32.const 0) (i32.gt_u (local.get $b) (local.get $ns)))))))
          (local.set $o (i32.add (local.get $o) (i32.const 1)))))
      (br_if $lb (i32.lt_u (local.tee $b (i32.add (local.get $b) (i32.const 1))) (local.get $nb))))
    (br_if $li (i32.le_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $sd))))
  (local.set $i (i32.const 0))
  (loop $li
    (local.set $b (i32.const 0))
    (loop $lb
      (i32.store8 (local.get $o) (i32.load8_u (i32.add (i32.add (global.get $QR_CW) (local.get $D))
        (i32.add (i32.mul (local.get $b) (local.get $ec)) (local.get $i)))))
      (local.set $o (i32.add (local.get $o) (i32.const 1)))
      (br_if $lb (i32.lt_u (local.tee $b (i32.add (local.get $b) (i32.const 1))) (local.get $nb))))
    (br_if $li (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $ec))))

  ;; ---- function patterns ----
  (global.set $qr_n (local.get $n))
  (memory.fill (global.get $QR_M) (i32.const 0) (i32.mul (local.get $n) (local.get $n)))
  (local.set $i (i32.const 0))
  (loop $l   ;; timing row and column
    (call $qr_fn (i32.const 6) (local.get $i) (i32.eqz (i32.and (local.get $i) (i32.const 1))))
    (call $qr_fn (local.get $i) (i32.const 6) (i32.eqz (i32.and (local.get $i) (i32.const 1))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $n))))
  (call $qr_pat (i32.const 3) (i32.const 3) (i32.const 4) (i32.const 0x0B))
  (call $qr_pat (i32.sub (local.get $n) (i32.const 4)) (i32.const 3) (i32.const 4) (i32.const 0x0B))
  (call $qr_pat (i32.const 3) (i32.sub (local.get $n) (i32.const 4)) (i32.const 4) (i32.const 0x0B))
  (if (i32.ge_u (local.get $v) (i32.const 2))
    (then
      ;; alignment centres: 6, then n-7 - k*step counting down (Annex E, closed form)
      (local.set $na (i32.add (i32.div_u (local.get $v) (i32.const 7)) (i32.const 2)))
      (local.set $step (i32.shl (i32.div_u (i32.add (i32.add (i32.shl (local.get $v) (i32.const 3))
        (i32.mul (local.get $na) (i32.const 3))) (i32.const 5)) (i32.sub (i32.shl (local.get $na) (i32.const 2)) (i32.const 4))) (i32.const 1)))
      (local.set $i (i32.const 0))
      (loop $li
        (local.set $j (i32.const 0))
        (loop $lj
          ;; skip the three corners that hold finders: (0,0), (0,last), (last,0)
          (if (i32.eqz (i32.or (i32.and (i32.eqz (local.get $i)) (i32.eqz (local.get $j)))
                (i32.and (i32.eqz (i32.mul (local.get $i) (local.get $j)))
                         (i32.eq (i32.add (local.get $i) (local.get $j)) (i32.sub (local.get $na) (i32.const 1))))))
            (then (call $qr_pat (call $qr_apos (local.get $i) (local.get $na) (local.get $step) (local.get $n))
                                (call $qr_apos (local.get $j) (local.get $na) (local.get $step) (local.get $n))
                                (i32.const 2) (i32.const 5))))
          (br_if $lj (i32.lt_u (local.tee $j (i32.add (local.get $j) (i32.const 1))) (local.get $na))))
        (br_if $li (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $na))))))
  ;; format information (constant: fixed mask), both copies, LSB first; then the dark module
  (local.set $i (i32.const 0))
  (loop $l
    (local.set $t (i32.and (i32.shr_u (global.get $QR_FMT) (local.get $i)) (i32.const 1)))
    (if (i32.lt_u (local.get $i) (i32.const 6)) (then (call $qr_fn (i32.const 8) (local.get $i) (local.get $t)))
      (else (if (i32.lt_u (local.get $i) (i32.const 8)) (then (call $qr_fn (i32.const 8) (i32.add (local.get $i) (i32.const 1)) (local.get $t)))
        (else (call $qr_fn (select (i32.const 7) (i32.sub (i32.const 14) (local.get $i)) (i32.eq (local.get $i) (i32.const 8)))
                           (i32.const 8) (local.get $t))))))
    (if (i32.lt_u (local.get $i) (i32.const 8))
      (then (call $qr_fn (i32.sub (i32.sub (local.get $n) (i32.const 1)) (local.get $i)) (i32.const 8) (local.get $t)))
      (else (call $qr_fn (i32.const 8) (i32.add (i32.sub (local.get $n) (i32.const 15)) (local.get $i)) (local.get $t))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 15))))
  (call $qr_fn (i32.const 8) (i32.sub (local.get $n) (i32.const 8)) (i32.const 1))
  ;; version information for v >= 7: v << 12 | BCH(18,6) remainder (generator 0x1F25)
  (if (i32.ge_u (local.get $v) (i32.const 7))
    (then
      (local.set $t (local.get $v))
      (local.set $i (i32.const 12))
      (loop $l
        (local.set $t (i32.xor (i32.shl (local.get $t) (i32.const 1)) (i32.mul (i32.shr_u (local.get $t) (i32.const 11)) (i32.const 0x1F25))))
        (br_if $l (local.tee $i (i32.sub (local.get $i) (i32.const 1)))))
      (local.set $t (i32.or (i32.shl (local.get $v) (i32.const 12)) (local.get $t)))
      (local.set $i (i32.const 0))
      (loop $l
        (local.set $f (i32.and (i32.shr_u (local.get $t) (local.get $i)) (i32.const 1)))
        (local.set $x (i32.add (i32.sub (local.get $n) (i32.const 11)) (i32.rem_u (local.get $i) (i32.const 3))))
        (local.set $y (i32.div_u (local.get $i) (i32.const 3)))
        (call $qr_fn (local.get $x) (local.get $y) (local.get $f))
        (call $qr_fn (local.get $y) (local.get $x) (local.get $f))
        (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 18))))))

  ;; ---- data placement: two-column zig-zag from the bottom right, skipping column 6; every
  ;; non-function module (incl. remainder bits) gets its bit XOR the mask ----
  (local.set $k (i32.shl (local.get $R) (i32.const 3)))
  (local.set $b (i32.const 0))
  (local.set $right (i32.sub (local.get $n) (i32.const 1)))
  (loop $lr
    (if (i32.eq (local.get $right) (i32.const 6)) (then (local.set $right (i32.const 5))))
    (local.set $i (i32.const 0))
    (loop $lv
      (local.set $j (i32.const 0))
      (loop $lj
        (local.set $x (i32.sub (local.get $right) (local.get $j)))
        (local.set $y (select (local.get $i) (i32.sub (i32.sub (local.get $n) (i32.const 1)) (local.get $i))
          (i32.and (i32.add (local.get $right) (i32.const 1)) (i32.const 2))))
        (local.set $p (i32.add (global.get $QR_M) (i32.add (i32.mul (local.get $y) (local.get $n)) (local.get $x))))
        (if (i32.eqz (i32.load8_u (local.get $p)))
          (then
            (local.set $t (i32.const 0))
            (if (i32.lt_u (local.get $b) (local.get $k))
              (then (local.set $t (i32.and (i32.shr_u
                (i32.load8_u (i32.add (global.get $QR_OUT) (i32.shr_u (local.get $b) (i32.const 3))))
                (i32.sub (i32.const 7) (i32.and (local.get $b) (i32.const 7)))) (i32.const 1)))))
            (i32.store8 (local.get $p) (i32.xor (local.get $t) (call $qr_mask (local.get $x) (local.get $y))))
            (local.set $b (i32.add (local.get $b) (i32.const 1)))))
        (br_if $lj (i32.lt_u (local.tee $j (i32.add (local.get $j) (i32.const 1))) (i32.const 2))))
      (br_if $lv (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $n))))
    (br_if $lr (i32.ge_s (local.tee $right (i32.sub (local.get $right) (i32.const 2))) (i32.const 1))))
  (local.get $v))

;; k-th alignment centre coordinate.
(func $qr_apos (param $k i32) (param $na i32) (param $step i32) (param $n i32) (result i32)
  (select (i32.const 6)
    (i32.sub (i32.sub (local.get $n) (i32.const 7)) (i32.mul (i32.sub (i32.sub (local.get $na) (i32.const 1)) (local.get $k)) (local.get $step)))
    (i32.eqz (local.get $k))))

(func $qr_size (result i32) (global.get $qr_n))

(func $qr_module (param $x i32) (param $y i32) (result i32)
  (if (result i32) (i32.and (i32.lt_u (local.get $x) (global.get $qr_n)) (i32.lt_u (local.get $y) (global.get $qr_n)))
    (then (i32.and (i32.load8_u (i32.add (global.get $QR_M) (i32.add (i32.mul (local.get $y) (global.get $qr_n)) (local.get $x)))) (i32.const 1)))
    (else (i32.const 0))))

;; Side length in pixels of the drawn code incl. quiet zone (0 when there is no code or scale <= 0).
(func $qr_pixels (param $s i32) (result i32)
  (i32.mul (select (i32.add (global.get $qr_n) (i32.const 8)) (i32.const 0) (global.get $qr_n))
           (call $clamp (local.get $s) (i32.const 0) (i32.const 64))))

(func $qr_draw (param $x i32) (param $y i32) (param $s i32)
  (local $w i32) (local $mx i32) (local $my i32) (local $ink i32)
  (local.set $w (call $qr_pixels (local.get $s)))
  (if (i32.eqz (local.get $w)) (then (return)))
  (local.set $s (call $clamp (local.get $s) (i32.const 1) (i32.const 64)))
  (local.set $x (call $clamp (local.get $x) (i32.const -16384) (i32.const 16384)))
  (local.set $y (call $clamp (local.get $y) (i32.const -16384) (i32.const 16384)))
  (call $rect (local.get $x) (local.get $y) (local.get $w) (local.get $w) (call $hc (global.get $H_PAPER) (i32.const 3)))
  (local.set $ink (call $hc (global.get $H_INK) (i32.const 0)))
  (loop $ly
    (local.set $mx (i32.const 0))
    (loop $lx
      (if (call $qr_module (local.get $mx) (local.get $my))
        (then (call $rect (i32.add (local.get $x) (i32.mul (i32.add (local.get $mx) (i32.const 4)) (local.get $s)))
                          (i32.add (local.get $y) (i32.mul (i32.add (local.get $my) (i32.const 4)) (local.get $s)))
                          (local.get $s) (local.get $s) (local.get $ink))))
      (br_if $lx (i32.lt_u (local.tee $mx (i32.add (local.get $mx) (i32.const 1))) (global.get $qr_n))))
    (br_if $ly (i32.lt_u (local.tee $my (i32.add (local.get $my) (i32.const 1))) (global.get $qr_n)))))
