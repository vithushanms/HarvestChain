;; Inventory, storage and calendar helpers (spec §5, §8). Pure functions of state.
;; Inventory is u16 counts at $S_INV[good*8 + age], age 0..7 (ages stop at 7).
;; Removal is always oldest-first (highest age bucket first); additions land at age 0.

(func $tile_ptr (param $idx i32) (result i32)
  (i32.add (global.get $S_TILES) (i32.mul (local.get $idx) (global.get $TILE_STRIDE))))

;; Tile index is inside the active grid x grid square of the 8x8 board (row-major, stride 8).
(func $in_grid (param $idx i32) (result i32)
  (local $g i32)
  (local.set $g (i32.load8_u (global.get $S_GRID)))
  (i32.and
    (i32.lt_u (local.get $idx) (i32.const 64))
    (i32.and
      (i32.lt_u (i32.and (local.get $idx) (i32.const 7)) (local.get $g))
      (i32.lt_u (i32.shr_u (local.get $idx) (i32.const 3)) (local.get $g)))))

(func $inv_ptr (param $good i32) (param $age i32) (result i32)
  (i32.add (global.get $S_INV)
           (i32.shl (i32.add (i32.shl (local.get $good) (i32.const 3)) (local.get $age)) (i32.const 1))))

(func $inv_count (param $good i32) (result i32)
  (local $a i32) (local $n i32)
  (loop $l
    (local.set $n (i32.add (local.get $n) (i32.load16_u (call $inv_ptr (local.get $good) (local.get $a)))))
    (br_if $l (i32.lt_u (local.tee $a (i32.add (local.get $a) (i32.const 1))) (i32.const 8))))
  (local.get $n))

;; Add qty at age 0. Capacity is the caller's job (actions check $storage_used first).
(func $inv_add (param $good i32) (param $qty i32)
  (local $p i32)
  (local.set $p (call $inv_ptr (local.get $good) (i32.const 0)))
  (i32.store16 (local.get $p) (i32.add (i32.load16_u (local.get $p)) (local.get $qty))))

;; Remove up to qty, oldest first. Returns the number actually taken.
(func $inv_take (param $good i32) (param $qty i32) (result i32)
  (local $a i32) (local $p i32) (local $have i32) (local $t i32) (local $left i32)
  (local.set $left (local.get $qty))
  (local.set $a (call $k (global.get $K_MAX_AGE)))
  (loop $l
    (if (local.get $left)
      (then
        (local.set $p (call $inv_ptr (local.get $good) (local.get $a)))
        (local.set $have (i32.load16_u (local.get $p)))
        (local.set $t (select (local.get $have) (local.get $left) (i32.lt_u (local.get $have) (local.get $left))))
        (i32.store16 (local.get $p) (i32.sub (local.get $have) (local.get $t)))
        (local.set $left (i32.sub (local.get $left) (local.get $t)))))
    (br_if $l (i32.ge_s (local.tee $a (i32.sub (local.get $a) (i32.const 1))) (i32.const 0))))
  (i32.sub (local.get $qty) (local.get $left)))

(func $storage_used (result i32)
  (local $i i32) (local $n i32)
  (loop $l
    (local.set $n (i32.add (local.get $n)
      (i32.load16_u (i32.add (global.get $S_INV) (i32.shl (local.get $i) (i32.const 1))))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 104))))
  (local.get $n))

;; Number of standing building tiles of type bld.
(func $count_bld (param $bld i32) (result i32)
  (local $i i32) (local $p i32) (local $n i32)
  (loop $l
    (local.set $p (call $tile_ptr (local.get $i)))
    (if (i32.and (i32.eq (i32.load8_u (local.get $p)) (i32.const 2))
                 (i32.eq (i32.load8_u offset=1 (local.get $p)) (local.get $bld)))
      (then (local.set $n (i32.add (local.get $n) (i32.const 1)))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  (local.get $n))

;; startStorage + sum over building rows of count * storageBonus (Warehouse 40, Cold Store 20).
(func $storage_cap (result i32)
  (local $b i32) (local $cap i32)
  (local.set $cap (call $k (global.get $K_START_STORAGE)))
  (loop $l
    (local.set $cap (i32.add (local.get $cap)
      (i32.mul (call $count_bld (local.get $b))
               (call $bal (global.get $T_BLD) (local.get $b) (i32.const 3)))))
    (br_if $l (i32.lt_u (local.tee $b (i32.add (local.get $b) (i32.const 1))) (i32.const 10))))
  (local.get $cap))

(func $season (result i32)
  (i32.rem_u
    (i32.div_u (i32.sub (i32.load16_u (global.get $S_DAY)) (i32.const 1))
               (call $k (global.get $K_DAYS_PER_SEASON)))
    (i32.const 4)))

(func $year (result i32)
  (i32.div_u (i32.sub (i32.load16_u (global.get $S_DAY)) (i32.const 1))
             (i32.mul (call $k (global.get $K_DAYS_PER_SEASON)) (i32.const 4))))

;; Reputation rank 1..5 from rep points (T_REP pointsForRank thresholds).
(func $rank (result i32)
  (local $r i32) (local $rep i32)
  (local.set $rep (i32.load8_u (global.get $S_REP)))
  (local.set $r (i32.const 4))
  (loop $l
    (if (i32.ge_u (local.get $rep) (call $bal (global.get $T_REP) (local.get $r) (i32.const 0)))
      (then (return (i32.add (local.get $r) (i32.const 1)))))
    (br_if $l (i32.ge_s (local.tee $r (i32.sub (local.get $r) (i32.const 1))) (i32.const 0))))
  (i32.const 1))

;; 1 when units more would still fit: used + units <= cap. Wrap-safe even if used > cap
;; (e.g. after demolishing a Warehouse). Callers gate every storage add on this.
(func $storage_fits (param $units i32) (result i32)
  (i32.le_u (i32.add (call $storage_used) (local.get $units)) (call $storage_cap)))
