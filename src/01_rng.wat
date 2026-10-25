;; Seeded xorshift32. Every random number in the game comes from $rng_next.
;; The RNG word lives in game state (offset 0x008) so it is saved and replayed.

(global $S_RNG i32 (i32.const 0x1008))

;; Seed 0 is the xorshift fixed point; substitute a fixed non-zero word.
(func $rng_seed (param $seed i32)
  (i32.store (global.get $S_RNG)
    (select (local.get $seed) (i32.const 0x6D2B79F5) (local.get $seed))))

(func $rng_next (result i32)
  (local $x i32)
  (local.set $x (i32.load (global.get $S_RNG)))
  (local.set $x (i32.xor (local.get $x) (i32.shl (local.get $x) (i32.const 13))))
  (local.set $x (i32.xor (local.get $x) (i32.shr_u (local.get $x) (i32.const 17))))
  (local.set $x (i32.xor (local.get $x) (i32.shl (local.get $x) (i32.const 5))))
  (i32.store (global.get $S_RNG) (local.get $x))
  (local.get $x))

;; Uniform-ish value in [0, n). n must be > 0. Modulo bias is accepted.
(func $rng_range (param $n i32) (result i32)
  (i32.rem_u (call $rng_next) (local.get $n)))
