;; End Day pipeline (spec §4). end_day runs one function per step, in fixed order:
;;   1 weather  2 grow + age  3 process  4 age cellar  5 spoil  6 trucks (Task 6)
;;   7 contracts (Task 7)  8 drift + saturation  9 money (Task 8)  10 events, weather, day+1
;;   11 bankruptcy (Task 8)
;; RNG call order is part of the
;; spec: step 1 draws only on eligible tiles in index order, step 8 drift, step 10 events
;; then weather. $events_tick and $weather_advance run BEFORE day += 1 (they use day+1).
;; Aging of storage perishables happens in step 2 (controller ruling).

(global $W_RAIN     i32 (i32.const 1))
(global $W_DROUGHT  i32 (i32.const 2))
(global $W_STORM    i32 (i32.const 3))
(global $W_FROST    i32 (i32.const 4))
(global $W_HEAT     i32 (i32.const 5))
(global $BLD_WELL   i32 (i32.const 8))
(global $BLD_COLD   i32 (i32.const 6))
(global $BLD_CELLAR i32 (i32.const 4))
(global $CROP_TOMATO i32 (i32.const 2))
(global $CROP_GRAPE  i32 (i32.const 4))
(global $WINTER     i32 (i32.const 3))
(global $GOOD_GJ    i32 (i32.const 9))
(global $CELLAR_BUCKETS i32 (i32.const 5))

;; A crop lost to storm or drought: Apple trees survive with progress reset, others are cleared.
(func $lose_crop (param $idx i32)
  (local $p i32)
  (local.set $p (call $tile_ptr (local.get $idx)))
  (if (i32.eq (i32.load8_u offset=1 (local.get $p)) (global.get $CROP_APPLE))
    (then
      (i32.store16 offset=2 (local.get $p) (i32.const 0))
      (i32.store8 offset=4 (local.get $p) (i32.const 0)))
    (else (call $clear_tile (local.get $idx)))))

;; Step 1: today's weather hits the farm. Only plain (non-greenhouse) crop tiles are eligible.
(func $step_weather
  (local $w i32) (local $i i32) (local $p i32) (local $c i32) (local $strike i32) (local $s i32)
  (local.set $w (i32.load8_u (global.get $S_WEATHER)))
  (if (i32.and (i32.eq (local.get $w) (global.get $W_DROUGHT))
               (i32.eqz (call $count_bld (global.get $BLD_WELL))))
    (then
      (local.set $s (i32.add (i32.load8_u (global.get $S_DROUGHT)) (i32.const 1)))
      (if (i32.ge_u (local.get $s) (call $k (global.get $K_DROUGHT_STREAK)))
        (then (local.set $strike (i32.const 1)) (local.set $s (i32.const 0))))
      (i32.store8 (global.get $S_DROUGHT) (local.get $s)))
    (else (i32.store8 (global.get $S_DROUGHT) (i32.const 0))))
  (loop $tiles
    (if (call $in_grid (local.get $i))
      (then
        (local.set $p (call $tile_ptr (local.get $i)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 1))
          (then
            (local.set $c (i32.load8_u offset=1 (local.get $p)))
            (if (i32.eq (local.get $w) (global.get $W_STORM))
              (then (if (i32.eqz (call $rng_range (call $k (global.get $K_STORM_ODDS))))
                (then (call $lose_crop (local.get $i))))))
            (if (i32.eq (local.get $w) (global.get $W_FROST))
              (then (if (i32.or (i32.eq (local.get $c) (global.get $CROP_TOMATO))
                                (i32.eq (local.get $c) (global.get $CROP_GRAPE)))
                (then (call $clear_tile (local.get $i))))))
            (if (local.get $strike)
              (then (if (i32.eqz (call $rng_range (call $k (global.get $K_DROUGHT_ODDS))))
                (then (call $lose_crop (local.get $i))))))))))
    (br_if $tiles (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64)))))

;; Ripeness target in hundredths of a day for the crop c growing on tile p.
(func $grow_target (param $p i32) (param $c i32) (result i32)
  (local $col i32)
  (local.set $col (i32.const 1))
  (if (i32.and (i32.eq (local.get $c) (global.get $CROP_APPLE))
               (i32.and (i32.load8_u offset=5 (local.get $p)) (i32.const 1)))
    (then (local.set $col (i32.const 3))))
  (i32.mul (call $bal (global.get $T_CROP) (local.get $c) (local.get $col)) (i32.const 100)))

;; Growth in hundredths of a day for crop c today (Decision 3). Greenhouse tiles always 100.
(func $grow_rate (param $c i32) (param $gh i32) (param $w i32) (param $well i32) (result i32)
  (local $r i32)
  (if (local.get $gh) (then (return (i32.const 100))))
  (if (i32.eq (call $season) (global.get $WINTER)) (then (return (i32.const 0))))
  (if (i32.and (i32.eq (local.get $w) (global.get $W_DROUGHT)) (i32.eqz (local.get $well)))
    (then (return (i32.const 0))))
  (local.set $r (i32.const 100))
  (if (i32.eq (local.get $w) (global.get $W_RAIN))
    (then (local.set $r (i32.add (local.get $r) (call $k (global.get $K_RAIN_BONUS))))))
  (if (i32.eqz (i32.and (call $bal (global.get $T_CROP) (local.get $c) (i32.const 5))
                        (i32.shl (i32.const 1) (call $season))))
    (then (local.set $r (i32.div_u (i32.mul (local.get $r) (call $k (global.get $K_OFF_SEASON_PCT)))
                                   (i32.const 100)))))
  (local.get $r))

;; Age the stock of good g by one day (two in a heatwave), skipping up to $prot of its oldest
;; units (Cold Store). Ages stop at 7. Returns the protection left over for the next good.
;; Buckets are visited oldest first, so a moved unit always lands in a bucket already settled.
(func $age_good (param $g i32) (param $prot i32) (param $step i32) (result i32)
  (local $a i32) (local $p i32) (local $c i32) (local $keep i32) (local $to i32) (local $q i32)
  (local.set $a (call $k (global.get $K_MAX_AGE)))
  (loop $l
    (local.set $p (call $inv_ptr (local.get $g) (local.get $a)))
    (local.set $c (i32.load16_u (local.get $p)))
    (local.set $keep (local.get $c))
    (if (i32.gt_u (local.get $c) (local.get $prot)) (then (local.set $keep (local.get $prot))))
    (local.set $prot (i32.sub (local.get $prot) (local.get $keep)))
    (i32.store16 (local.get $p) (local.get $keep))
    (if (i32.gt_u (local.get $c) (local.get $keep))
      (then
        (local.set $to (i32.add (local.get $a) (local.get $step)))
        (if (i32.gt_u (local.get $to) (call $k (global.get $K_MAX_AGE))) (then (local.set $to (call $k (global.get $K_MAX_AGE)))))
        (local.set $q (call $inv_ptr (local.get $g) (local.get $to)))
        (i32.store16 (local.get $q)
          (i32.add (i32.load16_u (local.get $q)) (i32.sub (local.get $c) (local.get $keep))))))
    (br_if $l (i32.ge_s (local.tee $a (i32.sub (local.get $a) (i32.const 1))) (i32.const 0))))
  (local.get $prot))

;; Step 2: crops grow, ripe perishables on tiles age, then storage perishables age.
(func $step_grow
  (local $w i32) (local $well i32) (local $i i32) (local $p i32) (local $c i32) (local $gh i32)
  (local $t i32) (local $g i32) (local $prot i32) (local $step i32) (local $v i32) (local $was i32)
  (local.set $w (i32.load8_u (global.get $S_WEATHER)))
  (local.set $well (i32.ne (call $count_bld (global.get $BLD_WELL)) (i32.const 0)))
  (local.set $step (i32.add (i32.const 1)
    (select (call $k (global.get $K_HEAT_AGE_EXTRA)) (i32.const 0) (i32.eq (local.get $w) (global.get $W_HEAT)))))
  (loop $tiles
    (if (call $in_grid (local.get $i))
      (then
        (local.set $p (call $tile_ptr (local.get $i)))
        (local.set $c (call $tile_crop (local.get $p)))
        (if (i32.ge_s (local.get $c) (i32.const 0))
          (then
            (local.set $gh (i32.eq (i32.load8_u (local.get $p)) (i32.const 2)))
            ;; only crops already ripe when the step starts age; the ripening day is age 0
            (local.set $was (call $tile_ripe (local.get $p)))
            (local.set $t (call $grow_target (local.get $p) (local.get $c)))
            (local.set $v (i32.add (i32.load16_u offset=2 (local.get $p))
              (call $grow_rate (local.get $c) (local.get $gh) (local.get $w) (local.get $well))))
            (if (i32.gt_u (local.get $v) (local.get $t)) (then (local.set $v (local.get $t))))
            ;; progress never moves backwards (a tile already past its target keeps its value)
            (if (i32.gt_u (local.get $v) (i32.load16_u offset=2 (local.get $p)))
              (then (i32.store16 offset=2 (local.get $p) (local.get $v))))
            (if (i32.and (local.get $was)
                         (i32.ne (call $bal (global.get $T_CROP) (local.get $c) (i32.const 4)) (i32.const 0)))
              (then (i32.store8 offset=4 (local.get $p)
                (i32.add (i32.load8_u offset=4 (local.get $p))
                  (select (i32.const 1) (local.get $step) (i32.or (local.get $gh) (i32.ne (local.get $w) (global.get $W_HEAT))))))))))))
    (br_if $tiles (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  ;; Storage: the first 20 x ColdStores perishable units (oldest-first, goods in id order) do not age.
  (local.set $prot (i32.mul (call $count_bld (global.get $BLD_COLD)) (call $k (global.get $K_COLD_PER_STORE))))
  (local.set $g (i32.const 0))
  (loop $goods
    (if (call $bal (global.get $T_GOOD) (local.get $g) (i32.const 1))
      (then (local.set $prot (call $age_good (local.get $g) (local.get $prot) (local.get $step)))))
    (br_if $goods (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (global.get $GOODS)))))

;; Output of one batch fits when (used - consumed) + produced <= cap. Written out so a
;; many-to-one recipe can run in a full store; wrap-safe because used >= consumed.
(func $batch_fits (param $in i32) (param $out i32) (result i32)
  (i32.le_u (i32.add (i32.sub (call $storage_used) (local.get $in)) (local.get $out))
            (call $storage_cap)))

;; Step 3 for one ordinary processor tile at p running recipe row.
(func $process_tile (param $p i32) (param $row i32)
  (local $in i32) (local $q i32) (local $out i32) (local $cap i32) (local $n i32)
  (local.set $in (call $bal (global.get $T_RECIPE) (local.get $row) (i32.const 1)))
  (local.set $q (call $bal (global.get $T_RECIPE) (local.get $row) (i32.const 2)))
  (local.set $out (call $bal (global.get $T_RECIPE) (local.get $row) (i32.const 3)))
  (local.set $cap (call $bal (global.get $T_BLD) (i32.load8_u offset=1 (local.get $p)) (i32.const 2)))
  (if (i32.and (i32.load8_u offset=5 (local.get $p)) (i32.const 2))
    (then (local.set $cap (i32.mul (local.get $cap) (call $k (global.get $K_BLD_UPG_CAP_MULT))))))
  ;; whole batches only, bounded by the input cap and by what is held
  (local.set $n (i32.div_u (local.get $cap) (local.get $q)))
  (if (i32.gt_u (local.get $n) (i32.div_u (call $inv_count (local.get $in)) (local.get $q)))
    (then (local.set $n (i32.div_u (call $inv_count (local.get $in)) (local.get $q)))))
  (loop $batch
    (if (local.get $n)
      (then
        (if (i32.eqz (call $batch_fits (local.get $q) (i32.const 1))) (then (return)))
        (drop (call $inv_take (local.get $in) (local.get $q)))
        (call $inv_add (local.get $out) (i32.const 1))
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (br $batch)))))

;; Step 3 for a Cellar: Grape Juice goes into the last aging bucket, up to cellarHold minus
;; the units already aging. Units leave storage, so no storage room is needed.
(func $cellar_load (param $idx i32) (param $row i32)
  (local $b i32) (local $room i32) (local $n i32) (local $q i32) (local $i i32)
  (local.set $b (i32.add (global.get $S_CELLAR) (i32.mul (local.get $idx) (global.get $CELLAR_BUCKETS))))
  (local.set $room (call $k (global.get $K_CELLAR_HOLD)))
  (loop $sum
    (local.set $room (i32.sub (local.get $room) (i32.load8_u (i32.add (local.get $b) (local.get $i)))))
    (br_if $sum (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $CELLAR_BUCKETS))))
  (if (i32.le_s (local.get $room) (i32.const 0)) (then (return)))
  (local.set $q (call $bal (global.get $T_RECIPE) (local.get $row) (i32.const 2)))
  (local.set $n (call $inv_count (call $bal (global.get $T_RECIPE) (local.get $row) (i32.const 1))))
  (if (i32.gt_u (local.get $n) (local.get $room)) (then (local.set $n (local.get $room))))
  (local.set $n (i32.sub (local.get $n) (i32.rem_u (local.get $n) (local.get $q))))
  (if (i32.eqz (local.get $n)) (then (return)))
  (drop (call $inv_take (call $bal (global.get $T_RECIPE) (local.get $row) (i32.const 1)) (local.get $n)))
  (local.set $b (i32.add (local.get $b)
    (i32.sub (call $bal (global.get $T_RECIPE) (local.get $row) (i32.const 4)) (i32.const 1))))
  (i32.store8 (local.get $b) (i32.add (i32.load8_u (local.get $b)) (local.get $n))))

;; Step 3: every building tile with a recipe, in index order.
(func $step_process
  (local $i i32) (local $p i32) (local $r i32) (local $row i32)
  (loop $tiles
    (if (call $in_grid (local.get $i))
      (then
        (local.set $p (call $tile_ptr (local.get $i)))
        (local.set $r (i32.load8_u offset=7 (local.get $p)))
        (if (i32.and (i32.eq (i32.load8_u (local.get $p)) (i32.const 2)) (i32.ne (local.get $r) (i32.const 0)))
          (then
            (local.set $row (i32.sub (local.get $r) (i32.const 1)))
            (if (i32.and (i32.lt_u (local.get $row) (i32.const 8))
                         (i32.eq (call $bal (global.get $T_RECIPE) (local.get $row) (i32.const 0))
                                 (i32.load8_u offset=1 (local.get $p))))
              (then
                (if (i32.eq (i32.load8_u offset=1 (local.get $p)) (global.get $BLD_CELLAR))
                  (then (call $cellar_load (local.get $i) (local.get $row)))
                  (else (call $process_tile (local.get $p) (local.get $row))))))))))
    (br_if $tiles (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64)))))

;; Step 4: shift every cellar down one bucket. Units leaving bucket 0 become Wine in storage
;; as far as it has room; the rest stay in bucket 0 and retry tomorrow.
(func $step_age_cellar
  (local $i i32) (local $b i32) (local $out i32) (local $room i32) (local $n i32)
  (loop $tiles
    (local.set $b (i32.add (global.get $S_CELLAR) (i32.mul (local.get $i) (global.get $CELLAR_BUCKETS))))
    (local.set $out (i32.load8_u (local.get $b)))
    (local.set $n (i32.const 0))
    (if (local.get $out)
      (then
        (local.set $room (i32.const 0))
        (if (i32.gt_u (call $storage_cap) (call $storage_used))
          (then (local.set $room (i32.sub (call $storage_cap) (call $storage_used)))))
        (local.set $n (local.get $out))
        (if (i32.gt_u (local.get $n) (local.get $room)) (then (local.set $n (local.get $room))))
        (if (i32.and (i32.ne (local.get $n) (i32.const 0)) (call $storage_fits (local.get $n)))
          (then (call $inv_add (global.get $GOOD_WINE) (local.get $n)))
          (else (local.set $n (i32.const 0))))))
    ;; shift 1..4 down, stuck units (out - n) join the new bucket 0
    (i32.store8 (local.get $b)
      (i32.add (i32.load8_u offset=1 (local.get $b)) (i32.sub (local.get $out) (local.get $n))))
    (i32.store8 offset=1 (local.get $b) (i32.load8_u offset=2 (local.get $b)))
    (i32.store8 offset=2 (local.get $b) (i32.load8_u offset=3 (local.get $b)))
    (i32.store8 offset=3 (local.get $b) (i32.load8_u offset=4 (local.get $b)))
    (i32.store8 offset=4 (local.get $b) (i32.const 0))
    (br_if $tiles (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64)))))

;; Step 5: expired perishables leave storage; ripe Tomato/Grape rot on their tiles.
(func $step_spoil
  (local $g i32) (local $a i32) (local $d i32) (local $i i32) (local $p i32) (local $c i32) (local $sd i32)
  (loop $goods
    (local.set $d (call $bal (global.get $T_GOOD) (local.get $g) (i32.const 1)))
    (if (local.get $d)
      (then
        (local.set $a (local.get $d))
        (loop $ages
          (if (i32.le_u (local.get $a) (call $k (global.get $K_MAX_AGE)))
            (then
              (i32.store16 (call $inv_ptr (local.get $g) (local.get $a)) (i32.const 0))
              (local.set $a (i32.add (local.get $a) (i32.const 1)))
              (br $ages))))))
    (br_if $goods (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (global.get $GOODS))))
  (loop $tiles
    (if (call $in_grid (local.get $i))
      (then
        (local.set $p (call $tile_ptr (local.get $i)))
        (local.set $c (call $tile_crop (local.get $p)))
        (if (i32.ge_s (local.get $c) (i32.const 0))
          (then
            (local.set $sd (call $bal (global.get $T_CROP) (local.get $c) (i32.const 4)))
            (if (i32.and (i32.ne (local.get $sd) (i32.const 0))
                         (i32.ge_u (i32.load8_u offset=4 (local.get $p)) (local.get $sd)))
              (then
                (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 1))
                  (then (call $clear_tile (local.get $i)))
                  (else
                    ;; Greenhouse: the crop rots, the building stays.
                    (i32.store8 offset=6 (local.get $p) (i32.const 0))
                    (i32.store16 offset=2 (local.get $p) (i32.const 0))
                    (i32.store8 offset=4 (local.get $p) (i32.const 0))))))))))
    (br_if $tiles (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64)))))

;; Total owed on the loan (principal + interest).
(func $loan_owed (result i32)
  (i32.add (i32.load (global.get $S_LOAN_P)) (i32.load (global.get $S_LOAN_I))))

;; Step 9: upkeep of every standing building (upgraded ones cost the same), then, if a loan is
;; outstanding, interest = floor((principal + interest) * loanRateBp / 10000) added to the
;; interest. The product runs in i64 and the owed total saturates at 2^30 so a loan that is
;; never repaid cannot wrap i32.
(func $step_money
  (local $i i32) (local $p i32) (local $sum i32) (local $add i64)
  (loop $tiles
    (local.set $p (call $tile_ptr (local.get $i)))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 2))
      (then (local.set $sum (i32.add (local.get $sum)
        (call $bal (global.get $T_BLD) (i32.load8_u offset=1 (local.get $p)) (i32.const 1))))))
    (br_if $tiles (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  (i32.store (global.get $S_CASH) (i32.sub (i32.load (global.get $S_CASH)) (local.get $sum)))
  (if (i32.gt_s (call $loan_owed) (i32.const 0))
    (then
      (local.set $add (i64.div_u (i64.mul (i64.extend_i32_u (call $loan_owed))
                                          (i64.extend_i32_u (call $k (global.get $K_LOAN_RATE))))
                                 (i64.const 10000)))
      (if (i64.gt_u (i64.add (i64.extend_i32_u (call $loan_owed)) (local.get $add)) (i64.const 0x40000000))
        (then (local.set $add (i64.sub (i64.const 0x40000000) (i64.extend_i32_u (call $loan_owed))))))
      (if (i64.lt_s (local.get $add) (i64.const 0)) (then (local.set $add (i64.const 0))))
      (i32.store (global.get $S_LOAN_I)
        (i32.add (i32.load (global.get $S_LOAN_I)) (i32.wrap_i64 (local.get $add)))))))

;; Step 11 (only while Playing/Endless): negative cash with a loan outstanding burns grace, and
;; grace beyond graceDays is Game Over. Cash >= 0 resets grace. No loan: negative cash is ignored.
(func $step_bankrupt
  (local $st i32)
  (local.set $st (i32.load8_u (global.get $S_STATUS)))
  (if (i32.and (i32.ne (local.get $st) (i32.const 0)) (i32.ne (local.get $st) (global.get $ST_ENDLESS)))
    (then (return)))
  (if (i32.ge_s (i32.load (global.get $S_CASH)) (i32.const 0))
    (then (i32.store8 (global.get $S_GRACE) (i32.const 0)) (return)))
  (if (i32.gt_s (call $loan_owed) (i32.const 0))
    (then
      (i32.store8 (global.get $S_GRACE) (i32.add (i32.load8_u (global.get $S_GRACE)) (i32.const 1)))
      (if (i32.gt_u (i32.load8_u (global.get $S_GRACE)) (call $k (global.get $K_GRACE_DAYS)))
        (then (i32.store8 (global.get $S_STATUS) (global.get $ST_GAMEOVER)))))))

;; Net worth (spec §12, Decision 21): cash + netWorthBldBp of the build cost of standing buildings
;; (+ bldUpgPctBp of the cost for upgraded ones) + netWorthLandBp of the land rings bought
;; + cashBack held by present trucks - everything owed on the loan. Inventory and cargo are excluded.
(func $net_worth (result i32)
  (local $i i32) (local $p i32) (local $c i32) (local $b i32) (local $l i32) (local $cb i32)
  (loop $tiles
    (local.set $p (call $tile_ptr (local.get $i)))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 2))
      (then
        (local.set $c (call $bal (global.get $T_BLD) (i32.load8_u offset=1 (local.get $p)) (i32.const 0)))
        (local.set $b (i32.add (local.get $b) (local.get $c)))
        (if (i32.and (i32.load8_u offset=5 (local.get $p)) (i32.const 2))
          (then (local.set $b (i32.add (local.get $b)
            (i32.div_u (i32.mul (local.get $c) (call $k (global.get $K_BLD_UPG_PCT))) (i32.const 10000))))))))
    (br_if $tiles (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  ;; cash held by trucks on the way back is already earned; cargo is inventory and stays out
  (local.set $i (i32.const 0))
  (loop $trucks
    (local.set $p (call $truck_ptr (local.get $i)))
    (if (local.get $p)
      (then (local.set $cb (i32.add (local.get $cb) (i32.load offset=8 (local.get $p))))))
    (br_if $trucks (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 3))))
  (local.set $i (i32.load8_u (global.get $S_RINGS)))
  (loop $rings
    (if (local.get $i)
      (then
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (local.set $l (i32.add (local.get $l) (call $bal (global.get $T_LAND) (local.get $i) (i32.const 0))))
        (br $rings))))
  (i32.sub
    (i32.add
      (i32.add (i32.add (i32.load (global.get $S_CASH)) (local.get $cb))
               (i32.div_u (i32.mul (local.get $b) (call $k (global.get $K_NW_BLD_BP))) (i32.const 10000)))
      (i32.div_u (i32.mul (local.get $l) (call $k (global.get $K_NW_LAND_BP))) (i32.const 10000)))
    (call $loan_owed)))

(func $score (result i32)
  (i32.add (call $net_worth)
    (i32.add (i32.mul (i32.load8_u (global.get $S_REP)) (call $k (global.get $K_REP_SCORE)))
             (i32.mul (i32.load16_u (global.get $S_CONTRACTS_DONE)) (call $k (global.get $K_CONTRACT_SCORE))))))

;; Milestone i (T_MILE[i], thresholds from T_K) given the net worth snapshot.
(func $mile_ok (param $i i32) (param $nw i32) (result i32)
  (if (i32.eqz (local.get $i)) (then (return (i32.ne (i32.load16_u (global.get $S_PROC_SOLD)) (i32.const 0)))))
  (if (i32.eq (local.get $i) (i32.const 1)) (then (return (i32.ge_s (local.get $nw) (call $k (global.get $K_MILE_WORTH1))))))
  (if (i32.eq (local.get $i) (i32.const 2))
    (then (return (i32.ge_u (i32.load16_u (global.get $S_CONTRACTS_DONE)) (call $k (global.get $K_MILE_CONTRACTS))))))
  ;; 3: the rollover into Year 2 (day 4 seasons + 1) with enough net worth
  (if (i32.eq (local.get $i) (i32.const 3))
    (then (return (i32.and
      (i32.eq (i32.load16_u (global.get $S_DAY))
              (i32.add (i32.mul (call $k (global.get $K_DAYS_PER_SEASON)) (i32.const 4)) (i32.const 1)))
      (i32.ge_s (local.get $nw) (call $k (global.get $K_MILE_WORTH_Y1)))))))
  (if (i32.eq (local.get $i) (i32.const 4)) (then (return (i32.ge_u (call $rank) (call $k (global.get $K_MILE_RANK))))))
  (if (i32.eq (local.get $i) (i32.const 5))
    (then (return (i32.ge_u (i32.load16_u (global.get $S_WINE_SOLD)) (call $k (global.get $K_MILE_WINE))))))
  (i32.ge_s (local.get $nw) (call $k (global.get $K_MILE_WORTH_RUN))))

;; Step 10 tail while Playing: milestones 0..6 in order against ONE net worth snapshot taken
;; before any payout, each paid once; milestone 6 or day > runDays ends the run (Results).
(func $check_run
  (local $i i32) (local $nw i32) (local $m i32)
  (if (i32.ne (i32.load8_u (global.get $S_STATUS)) (i32.const 0)) (then (return)))
  (local.set $nw (call $net_worth))
  (local.set $m (i32.load8_u (global.get $S_MILESTONES)))
  (loop $ms
    (if (i32.and (i32.eqz (i32.and (local.get $m) (i32.shl (i32.const 1) (local.get $i))))
                 (call $mile_ok (local.get $i) (local.get $nw)))
      (then
        (local.set $m (i32.or (local.get $m) (i32.shl (i32.const 1) (local.get $i))))
        (i32.store (global.get $S_CASH)
          (i32.add (i32.load (global.get $S_CASH)) (call $bal (global.get $T_MILE) (local.get $i) (i32.const 0))))
        (if (i32.eq (local.get $i) (i32.const 6))
          (then (i32.store8 (global.get $S_STATUS) (global.get $ST_RESULTS))))))
    (br_if $ms (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 7))))
  (i32.store8 (global.get $S_MILESTONES) (local.get $m))
  (if (i32.gt_u (i32.load16_u (global.get $S_DAY)) (call $k (global.get $K_RUN_DAYS)))
    (then (i32.store8 (global.get $S_STATUS) (global.get $ST_RESULTS)))))

;; Step 10 canonical RNG order: events_tick, weather_advance, hint goods (two rng_range(13),
;; in index order), day += 1, board refresh when the new day is a multiple of
;; contractRefreshDays, then milestones and run end.
(func $step_roll_day
  (call $events_tick)
  (call $weather_advance)
  (i32.store8 (global.get $S_HINT) (call $rng_range (i32.const 13)))
  (i32.store8 offset=1 (global.get $S_HINT) (call $rng_range (i32.const 13)))
  (call $ctr_add (global.get $S_DAY) (i32.const 1))
  (if (i32.eqz (i32.rem_u (i32.load16_u (global.get $S_DAY)) (call $k (global.get $K_CONTRACT_REFRESH))))
    (then (call $board_refresh)))
  (call $check_run))

(func $end_day (result i32)
  (local $st i32)
  (local.set $st (i32.load8_u (global.get $S_STATUS)))
  (if (i32.and (i32.ne (local.get $st) (i32.const 0)) (i32.ne (local.get $st) (global.get $ST_ENDLESS)))
    (then (return (global.get $E_STATUS))))
  (call $step_weather)
  (call $step_grow)
  (call $step_process)
  (call $step_age_cellar)
  (call $step_spoil)
  (call $step_truck_spoil)
  (call $step_trucks)
  (call $step_contracts)
  (call $drift_tick)
  (call $sat_recover)
  (call $step_money)
  (call $step_roll_day)
  (call $step_bankrupt)
  (i32.const 0))
