;; Pricing, saturation and drift (spec §7, Decisions 12-14).
;; Layout: drift u16[13] at $S_DRIFT (bp), sat u16[39] at $S_SAT ([market*13+good], bp),
;; driftNext i16[13] at $S_DRIFT_NEXT. Inventory is never touched here: callers
;; (SELL_STAND, truck arrival) remove the stock themselves.

(global $GOODS i32 (i32.const 13))
(global $MKTS  i32 (i32.const 3))
(global $GOOD_WINE i32 (i32.const 12))
(global $MKT_STAND i32 (i32.const 0))

(func $bp_mul (param $v i32) (param $bp i32) (result i32)
  (i32.div_u (i32.mul (local.get $v) (local.get $bp)) (global.get $BP_ONE)))

(func $sat_ptr (param $m i32) (param $g i32) (result i32)
  (i32.add (global.get $S_SAT)
    (i32.shl (i32.add (i32.mul (local.get $m) (global.get $GOODS)) (local.get $g)) (i32.const 1))))

;; Unit price in whole dollars, Decision 12 order: market mult, drift, event, saturation.
(func $price (param $m i32) (param $g i32) (result i32)
  (local $v i32) (local $tier i32)
  (local.set $tier (call $bal (global.get $T_GOOD) (local.get $g) (i32.const 2)))
  (local.set $v (i32.mul (call $bal (global.get $T_GOOD) (local.get $g) (i32.const 0)) (i32.const 100)))
  ;; tier 0 -> multRawBp (col 0), else multProcBp (col 1)
  (local.set $v (call $bp_mul (local.get $v)
    (call $bal (global.get $T_MKT) (local.get $m) (i32.ne (local.get $tier) (i32.const 0)))))
  (local.set $v (call $bp_mul (local.get $v)
    (i32.load16_u (i32.add (global.get $S_DRIFT) (i32.shl (local.get $g) (i32.const 1))))))
  (local.set $v (call $bp_mul (local.get $v) (call $event_mod (local.get $m) (local.get $g))))
  (local.set $v (call $bp_mul (local.get $v) (i32.load16_u (call $sat_ptr (local.get $m) (local.get $g)))))
  (local.set $v (i32.div_u (local.get $v) (i32.const 100)))
  (select (local.get $v) (i32.const 1) (i32.gt_u (local.get $v) (i32.const 1))))

;; u16 counter += n, saturating at 65535.
(func $ctr_add (param $p i32) (param $n i32)
  (local $v i32)
  (local.set $v (i32.add (i32.load16_u (local.get $p)) (local.get $n)))
  (i32.store16 (local.get $p)
    (select (local.get $v) (i32.const 65535) (i32.lt_u (local.get $v) (i32.const 65535)))))

;; Sell qty units one at a time at the current price, lowering saturation after each.
;; Returns total dollars. Does not remove inventory.
(func $sell_units (param $m i32) (param $g i32) (param $qty i32) (result i32)
  (local $i i32) (local $total i32) (local $sp i32) (local $s i32) (local $step i32) (local $floor i32) (local $lower i32)
  (if (i32.eqz (local.get $qty)) (then (return (i32.const 0))))
  (local.set $sp (call $sat_ptr (local.get $m) (local.get $g)))
  (local.set $step (call $bal (global.get $T_MKT) (local.get $m) (i32.const 3)))
  (local.set $floor (call $k (global.get $K_SAT_FLOOR)))
  (local.set $lower (i32.const 1))
  (if (i32.eqz (local.get $m))
    (then (local.set $lower (i32.eqz (call $event_active (global.get $EV_FESTIVAL))))))
  (loop $unit
    (local.set $total (i32.add (local.get $total) (call $price (local.get $m) (local.get $g))))
    (if (local.get $lower)
      (then
        (local.set $s (i32.load16_u (local.get $sp)))
        (local.set $s (select (i32.sub (local.get $s) (local.get $step)) (local.get $floor)
                              (i32.gt_s (i32.sub (local.get $s) (local.get $step)) (local.get $floor))))
        ;; never raise sat above its current value (sat already below floor stays put)
        (if (i32.lt_u (local.get $s) (i32.load16_u (local.get $sp)))
          (then (i32.store16 (local.get $sp) (local.get $s))))))
    (br_if $unit (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $qty))))
  (if (call $bal (global.get $T_GOOD) (local.get $g) (i32.const 2))
    (then (call $ctr_add (global.get $S_PROC_SOLD) (local.get $qty))))
  (if (i32.eq (local.get $g) (global.get $GOOD_WINE))
    (then (call $ctr_add (global.get $S_WINE_SOLD) (local.get $qty))))
  (local.get $total))

;; Step 8 (drift): apply pending step with clamp, then re-roll. Goods in id order.
(func $drift_tick
  (local $g i32) (local $p i32) (local $v i32)
  (loop $good
    (local.set $p (i32.add (global.get $S_DRIFT) (i32.shl (local.get $g) (i32.const 1))))
    (local.set $v (i32.add (i32.load16_u (local.get $p))
      (i32.load16_s (i32.add (global.get $S_DRIFT_NEXT) (i32.shl (local.get $g) (i32.const 1))))))
    (if (i32.lt_s (local.get $v) (call $k (global.get $K_DRIFT_MIN)))
      (then (local.set $v (call $k (global.get $K_DRIFT_MIN)))))
    (if (i32.gt_s (local.get $v) (call $k (global.get $K_DRIFT_MAX)))
      (then (local.set $v (call $k (global.get $K_DRIFT_MAX)))))
    (i32.store16 (local.get $p) (local.get $v))
    (i32.store16 (i32.add (global.get $S_DRIFT_NEXT) (i32.shl (local.get $g) (i32.const 1)))
      (i32.mul (i32.sub (call $rng_range (i32.const 3)) (i32.const 1)) (call $k (global.get $K_DRIFT_STEP))))
    (br_if $good (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (global.get $GOODS))))
)

;; Step 8 (recovery): sat += (10000 - sat) * recoverBp / 10000 for all 39 entries.
(func $sat_recover
  (local $i i32) (local $p i32) (local $s i32) (local $rec i32)
  (loop $e
    (local.set $p (i32.add (global.get $S_SAT) (i32.shl (local.get $i) (i32.const 1))))
    (local.set $rec (call $bal (global.get $T_MKT) (i32.div_u (local.get $i) (global.get $GOODS)) (i32.const 4)))
    (local.set $s (i32.load16_u (local.get $p)))
    (i32.store16 (local.get $p) (i32.add (local.get $s)
      (call $bp_mul (i32.sub (global.get $BP_ONE) (local.get $s)) (local.get $rec))))
    (br_if $e (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1)))
                        (i32.mul (global.get $MKTS) (global.get $GOODS)))))
)

;; Test hooks.
(func $t_set_sat (param $m i32) (param $g i32) (param $v i32)
  (i32.store16 (call $sat_ptr (local.get $m) (local.get $g)) (local.get $v)))
(func $t_set_drift (param $g i32) (param $v i32)
  (i32.store16 (i32.add (global.get $S_DRIFT) (i32.shl (local.get $g) (i32.const 1))) (local.get $v)))
