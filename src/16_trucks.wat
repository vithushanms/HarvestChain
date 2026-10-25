;; Trucks and distribution (spec §9, Decision 16). Truck record at $S_TRUCKS + t*48:
;;   +0 present, +1 dest market, +2 phase (0 home, 1 out, 2 back), +3 daysLeft,
;;   +4 upg (b0-1 capLvl, b2 fridge, b3 fast), +5 contract (0xFF none), +8 cashBack i32,
;;   +16 cargo 8 x {good u8, age u8, qty u16}; a slot with qty 0 is free.
;; Check order for every action: argument range, truck exists, home/away, stock/capacity, cash.
;; A non-zero return leaves state bytes unchanged.

(global $E_TRUCK_AWAY   i32 (i32.const 11))
(global $E_TRUCK_FULL   i32 (i32.const 12))
(global $E_NO_SLOT      i32 (i32.const 13))
(global $E_NEED_GARAGE  i32 (i32.const 15))
(global $E_CONTRACT     i32 (i32.const 16))

(global $K_TRUCK_PRICE      i32 (i32.const 3))
(global $K_TRUCK_UPG_COST   i32 (i32.const 5))
(global $K_TRUCK_UPG_AMT    i32 (i32.const 6))
(global $K_TRUCK_UPG_MAX    i32 (i32.const 7))
(global $K_FRIDGE_COST      i32 (i32.const 8))
(global $K_FAST_COST        i32 (i32.const 9))

(global $EV_ROAD_CLOSURE i32 (i32.const 3))
(global $EV_FUEL_SPIKE   i32 (i32.const 5))
(global $MKT_CITY        i32 (i32.const 2))
(global $CARGO_OFF       i32 (i32.const 16))
(global $CARGO_SLOTS     i32 (i32.const 8))
(global $UPG_FRIDGE      i32 (i32.const 4))
(global $UPG_FAST        i32 (i32.const 8))

;; Pointer to truck t, or 0 when t is not an owned, present truck.
(func $truck_ptr (param $t i32) (result i32)
  (local $p i32)
  (if (i32.ge_u (local.get $t) (i32.load8_u (global.get $S_TRUCK_COUNT))) (then (return (i32.const 0))))
  (local.set $p (i32.add (global.get $S_TRUCKS) (i32.mul (local.get $t) (global.get $TRUCK_STRIDE))))
  (if (i32.eqz (i32.load8_u (local.get $p))) (then (return (i32.const 0))))
  (local.get $p))

(func $truck_cap_of (param $p i32) (result i32)
  (i32.add (call $k (global.get $K_TRUCK_CAP))
    (i32.mul (call $k (global.get $K_TRUCK_UPG_AMT))
             (i32.and (i32.load8_u offset=4 (local.get $p)) (i32.const 3)))))

;; Capacity of truck t, 0 when there is no such truck.
(func $truck_cap (param $t i32) (result i32)
  (local $p i32)
  (local.set $p (call $truck_ptr (local.get $t)))
  (if (i32.eqz (local.get $p)) (then (return (i32.const 0))))
  (call $truck_cap_of (local.get $p)))

(func $slot_ptr (param $p i32) (param $i i32) (result i32)
  (i32.add (i32.add (local.get $p) (global.get $CARGO_OFF)) (i32.shl (local.get $i) (i32.const 2))))

(func $cargo_total (param $p i32) (result i32)
  (local $i i32) (local $n i32)
  (loop $l
    (local.set $n (i32.add (local.get $n)
      (i32.load16_u offset=2 (call $slot_ptr (local.get $p) (local.get $i)))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $CARGO_SLOTS))))
  (local.get $n))

(func $cargo_of (param $p i32) (param $g i32) (result i32)
  (local $i i32) (local $n i32) (local $s i32)
  (loop $l
    (local.set $s (call $slot_ptr (local.get $p) (local.get $i)))
    (if (i32.eq (i32.load8_u (local.get $s)) (local.get $g))
      (then (local.set $n (i32.add (local.get $n) (i32.load16_u offset=2 (local.get $s))))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $CARGO_SLOTS))))
  (local.get $n))

;; Occupied slot holding (good, age), or 0.
(func $find_slot (param $p i32) (param $g i32) (param $a i32) (result i32)
  (local $i i32) (local $s i32)
  (loop $l
    (local.set $s (call $slot_ptr (local.get $p) (local.get $i)))
    (if (i32.and (i32.ne (i32.load16_u offset=2 (local.get $s)) (i32.const 0))
                 (i32.and (i32.eq (i32.load8_u (local.get $s)) (local.get $g))
                          (i32.eq (i32.load8_u offset=1 (local.get $s)) (local.get $a))))
      (then (return (local.get $s))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $CARGO_SLOTS))))
  (i32.const 0))

(func $free_slots (param $p i32) (result i32)
  (local $i i32) (local $n i32)
  (loop $l
    (if (i32.eqz (i32.load16_u offset=2 (call $slot_ptr (local.get $p) (local.get $i))))
      (then (local.set $n (i32.add (local.get $n) (i32.const 1)))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $CARGO_SLOTS))))
  (local.get $n))

(func $free_slot (param $p i32) (result i32)
  (local $i i32) (local $s i32)
  (loop $l
    (local.set $s (call $slot_ptr (local.get $p) (local.get $i)))
    (if (i32.eqz (i32.load16_u offset=2 (local.get $s))) (then (return (local.get $s))))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $CARGO_SLOTS))))
  (i32.const 0))

(func $a_truck_load (param $t i32) (param $g i32) (param $q i32) (result i32)
  (local $p i32) (local $a i32) (local $left i32) (local $take i32) (local $need i32) (local $s i32) (local $bp i32)
  (if (i32.or (i32.gt_u (local.get $g) (i32.const 12)) (i32.eqz (local.get $q)))
    (then (return (global.get $E_BAD_ARG))))
  (local.set $p (call $truck_ptr (local.get $t)))
  (if (i32.eqz (local.get $p)) (then (return (global.get $E_BAD_ARG))))
  (if (i32.load8_u offset=2 (local.get $p)) (then (return (global.get $E_TRUCK_AWAY))))
  (if (i32.lt_u (call $inv_count (local.get $g)) (local.get $q)) (then (return (global.get $E_NO_STOCK))))
  (if (i32.gt_u (i32.add (call $cargo_total (local.get $p)) (local.get $q)) (call $truck_cap_of (local.get $p)))
    (then (return (global.get $E_TRUCK_FULL))))
  ;; dry run: how many new slots does an oldest-first move need?
  (local.set $left (local.get $q))
  (local.set $a (i32.const 7))
  (loop $dry
    (local.set $take (i32.load16_u (call $inv_ptr (local.get $g) (local.get $a))))
    (if (i32.gt_u (local.get $take) (local.get $left)) (then (local.set $take (local.get $left))))
    (if (local.get $take)
      (then
        (if (i32.eqz (call $find_slot (local.get $p) (local.get $g) (local.get $a)))
          (then (local.set $need (i32.add (local.get $need) (i32.const 1)))))
        (local.set $left (i32.sub (local.get $left) (local.get $take)))))
    (br_if $dry (i32.ge_s (local.tee $a (i32.sub (local.get $a) (i32.const 1))) (i32.const 0))))
  (if (i32.gt_u (local.get $need) (call $free_slots (local.get $p))) (then (return (global.get $E_TRUCK_FULL))))
  ;; move
  (local.set $left (local.get $q))
  (local.set $a (i32.const 7))
  (loop $mv
    (local.set $bp (call $inv_ptr (local.get $g) (local.get $a)))
    (local.set $take (i32.load16_u (local.get $bp)))
    (if (i32.gt_u (local.get $take) (local.get $left)) (then (local.set $take (local.get $left))))
    (if (local.get $take)
      (then
        (local.set $s (call $find_slot (local.get $p) (local.get $g) (local.get $a)))
        (if (i32.eqz (local.get $s))
          (then
            (local.set $s (call $free_slot (local.get $p)))
            (i32.store8 (local.get $s) (local.get $g))
            (i32.store8 offset=1 (local.get $s) (local.get $a))))
        (i32.store16 offset=2 (local.get $s) (i32.add (i32.load16_u offset=2 (local.get $s)) (local.get $take)))
        (i32.store16 (local.get $bp) (i32.sub (i32.load16_u (local.get $bp)) (local.get $take)))
        (local.set $left (i32.sub (local.get $left) (local.get $take)))))
    (br_if $mv (i32.ge_s (local.tee $a (i32.sub (local.get $a) (i32.const 1))) (i32.const 0))))
  (i32.const 0))

(func $a_truck_unload (param $t i32) (param $g i32) (param $q i32) (result i32)
  (local $p i32) (local $a i32) (local $left i32) (local $take i32) (local $i i32) (local $s i32) (local $bp i32)
  (if (i32.or (i32.gt_u (local.get $g) (i32.const 12)) (i32.eqz (local.get $q)))
    (then (return (global.get $E_BAD_ARG))))
  (local.set $p (call $truck_ptr (local.get $t)))
  (if (i32.eqz (local.get $p)) (then (return (global.get $E_BAD_ARG))))
  (if (i32.load8_u offset=2 (local.get $p)) (then (return (global.get $E_TRUCK_AWAY))))
  (if (i32.lt_u (call $cargo_of (local.get $p) (local.get $g)) (local.get $q)) (then (return (global.get $E_NO_STOCK))))
  (if (i32.eqz (call $storage_fits (local.get $q))) (then (return (global.get $E_STORAGE_FULL))))
  (local.set $left (local.get $q))
  (local.set $a (i32.const 7))
  (loop $age
    (local.set $i (i32.const 0))
    (loop $slot
      (local.set $s (call $slot_ptr (local.get $p) (local.get $i)))
      (if (i32.and (i32.ne (i32.load16_u offset=2 (local.get $s)) (i32.const 0))
                   (i32.and (i32.eq (i32.load8_u (local.get $s)) (local.get $g))
                            (i32.eq (i32.load8_u offset=1 (local.get $s)) (local.get $a))))
        (then
          (local.set $take (i32.load16_u offset=2 (local.get $s)))
          (if (i32.gt_u (local.get $take) (local.get $left)) (then (local.set $take (local.get $left))))
          (i32.store16 offset=2 (local.get $s) (i32.sub (i32.load16_u offset=2 (local.get $s)) (local.get $take)))
          (if (i32.eqz (i32.load16_u offset=2 (local.get $s))) (then (i32.store (local.get $s) (i32.const 0))))
          (local.set $bp (call $inv_ptr (local.get $g) (local.get $a)))
          (i32.store16 (local.get $bp) (i32.add (i32.load16_u (local.get $bp)) (local.get $take)))
          (local.set $left (i32.sub (local.get $left) (local.get $take)))))
      (br_if $slot (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $CARGO_SLOTS))))
    (br_if $age (i32.ge_s (local.tee $a (i32.sub (local.get $a) (i32.const 1))) (i32.const 0))))
  (i32.const 0))

(func $a_truck_send (param $t i32) (param $m i32) (param $c i32) (result i32)
  (local $p i32) (local $fuel i32) (local $days i32)
  (if (i32.gt_u (i32.sub (local.get $m) (i32.const 1)) (i32.const 1)) (then (return (global.get $E_BAD_ARG))))
  (local.set $p (call $truck_ptr (local.get $t)))
  (if (i32.eqz (local.get $p)) (then (return (global.get $E_BAD_ARG))))
  (if (i32.load8_u offset=2 (local.get $p)) (then (return (global.get $E_TRUCK_AWAY))))
  (if (i32.eqz (call $cargo_total (local.get $p))) (then (return (global.get $E_NO_STOCK))))
  ;; Task 7 replaces this with contract-tag validation.
  (if (i32.ne (local.get $c) (global.get $NO_CONTRACT)) (then (return (global.get $E_CONTRACT))))
  (if (call $event_active (global.get $EV_FUEL_SPIKE)) (then (local.set $fuel (call $k (global.get $K_FUEL_COST)))))
  (if (i32.lt_s (i32.load (global.get $S_CASH)) (local.get $fuel)) (then (return (global.get $E_CASH))))
  (i32.store (global.get $S_CASH) (i32.sub (i32.load (global.get $S_CASH)) (local.get $fuel)))
  (local.set $days (call $bal (global.get $T_MKT) (local.get $m) (i32.const 2)))
  (if (i32.and (i32.eq (local.get $m) (global.get $MKT_CITY)) (call $event_active (global.get $EV_ROAD_CLOSURE)))
    (then (local.set $days (i32.add (local.get $days) (i32.const 1)))))
  (i32.store8 offset=1 (local.get $p) (local.get $m))
  (i32.store8 offset=2 (local.get $p) (i32.const 1))
  (i32.store8 offset=3 (local.get $p) (local.get $days))
  (i32.store8 offset=5 (local.get $p) (global.get $NO_CONTRACT))
  (i32.const 0))

(func $a_buy_truck (result i32)
  (local $n i32) (local $lim i32) (local $p i32) (local $price i32)
  (local.set $n (i32.load8_u (global.get $S_TRUCK_COUNT)))
  (local.set $lim (i32.add (i32.const 1) (call $count_bld (global.get $BLD_GARAGE))))
  (if (i32.gt_u (local.get $lim) (call $k (global.get $K_MAX_TRUCKS)))
    (then (local.set $lim (call $k (global.get $K_MAX_TRUCKS)))))
  (if (i32.ge_u (local.get $n) (local.get $lim)) (then (return (global.get $E_NO_SLOT))))
  (local.set $price (call $k (global.get $K_TRUCK_PRICE)))
  (if (i32.lt_s (i32.load (global.get $S_CASH)) (local.get $price)) (then (return (global.get $E_CASH))))
  (i32.store (global.get $S_CASH) (i32.sub (i32.load (global.get $S_CASH)) (local.get $price)))
  (local.set $p (i32.add (global.get $S_TRUCKS) (i32.mul (local.get $n) (global.get $TRUCK_STRIDE))))
  (memory.fill (local.get $p) (i32.const 0) (global.get $TRUCK_STRIDE))
  (i32.store8 (local.get $p) (i32.const 1))
  (i32.store8 offset=5 (local.get $p) (global.get $NO_CONTRACT))
  (i32.store8 (global.get $S_TRUCK_COUNT) (i32.add (local.get $n) (i32.const 1)))
  (i32.const 0))

(func $a_upgrade_truck (param $t i32) (param $kind i32) (result i32)
  (local $p i32) (local $u i32) (local $cost i32) (local $bit i32)
  (if (i32.gt_u (local.get $kind) (i32.const 2)) (then (return (global.get $E_BAD_ARG))))
  (local.set $p (call $truck_ptr (local.get $t)))
  (if (i32.eqz (local.get $p)) (then (return (global.get $E_BAD_ARG))))
  (if (i32.eqz (call $count_bld (global.get $BLD_GARAGE))) (then (return (global.get $E_NEED_GARAGE))))
  (if (i32.load8_u offset=2 (local.get $p)) (then (return (global.get $E_TRUCK_AWAY))))
  (local.set $u (i32.load8_u offset=4 (local.get $p)))
  (if (i32.eqz (local.get $kind))
    (then
      (if (i32.ge_u (i32.and (local.get $u) (i32.const 3)) (call $k (global.get $K_TRUCK_UPG_MAX)))
        (then (return (global.get $E_MAX))))
      (local.set $cost (call $k (global.get $K_TRUCK_UPG_COST)))
      (local.set $bit (i32.const 1))))
  (if (i32.eq (local.get $kind) (i32.const 1))
    (then
      (if (i32.and (local.get $u) (global.get $UPG_FRIDGE)) (then (return (global.get $E_MAX))))
      (local.set $cost (call $k (global.get $K_FRIDGE_COST)))
      (local.set $bit (global.get $UPG_FRIDGE))))
  (if (i32.eq (local.get $kind) (i32.const 2))
    (then
      (if (i32.and (local.get $u) (global.get $UPG_FAST)) (then (return (global.get $E_MAX))))
      (local.set $cost (call $k (global.get $K_FAST_COST)))
      (local.set $bit (global.get $UPG_FAST))))
  (if (i32.lt_s (i32.load (global.get $S_CASH)) (local.get $cost)) (then (return (global.get $E_CASH))))
  (i32.store (global.get $S_CASH) (i32.sub (i32.load (global.get $S_CASH)) (local.get $cost)))
  ;; capLvl is a 2-bit counter in b0-1, so +1 never carries while capLvl < truckCapUpgMax <= 3.
  (i32.store8 offset=4 (local.get $p) (i32.add (local.get $u) (local.get $bit)))
  (i32.const 0))

;; Step 5 (trucks): cargo ages with the day (Heatwave +2) unless refrigerated; perishables
;; at or past perishDays are removed. Trucks in index order, home or away.
(func $step_truck_spoil
  (local $t i32) (local $p i32) (local $i i32) (local $s i32) (local $g i32) (local $d i32) (local $age i32) (local $step i32)
  (local.set $step (select (i32.const 2) (i32.const 1) (i32.eq (i32.load8_u (global.get $S_WEATHER)) (global.get $W_HEAT))))
  (loop $trucks
    (local.set $p (call $truck_ptr (local.get $t)))
    (if (local.get $p)
      (then
        (local.set $i (i32.const 0))
        (loop $slots
          (local.set $s (call $slot_ptr (local.get $p) (local.get $i)))
          (if (i32.load16_u offset=2 (local.get $s))
            (then
              (local.set $d (call $bal (global.get $T_GOOD) (i32.load8_u (local.get $s)) (i32.const 1)))
              (if (local.get $d)
                (then
                  (local.set $age (i32.load8_u offset=1 (local.get $s)))
                  (if (i32.eqz (i32.and (i32.load8_u offset=4 (local.get $p)) (global.get $UPG_FRIDGE)))
                    (then
                      (local.set $age (i32.add (local.get $age) (local.get $step)))
                      (if (i32.gt_u (local.get $age) (global.get $MAX_AGE)) (then (local.set $age (global.get $MAX_AGE))))
                      (i32.store8 offset=1 (local.get $s) (local.get $age))))
                  (if (i32.ge_u (local.get $age) (local.get $d))
                    (then (i32.store (local.get $s) (i32.const 0))))))))
          (br_if $slots (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $CARGO_SLOTS))))))
    (br_if $trucks (i32.lt_u (local.tee $t (i32.add (local.get $t) (i32.const 1))) (i32.const 3)))))

;; Outbound arrival: sell every cargo slot at the destination, proceeds to cashBack.
(func $truck_arrive (param $p i32)
  (local $i i32) (local $s i32) (local $m i32) (local $earn i32)
  (local.set $m (i32.load8_u offset=1 (local.get $p)))
  ;; HOOK (Task 7): fulfil the tagged contract here, before the remaining cargo is sold.
  (loop $slots
    (local.set $s (call $slot_ptr (local.get $p) (local.get $i)))
    (if (i32.load16_u offset=2 (local.get $s))
      (then (local.set $earn (i32.add (local.get $earn)
        (call $sell_units (local.get $m) (i32.load8_u (local.get $s)) (i32.load16_u offset=2 (local.get $s)))))))
    (br_if $slots (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (global.get $CARGO_SLOTS))))
  (i32.store offset=8 (local.get $p) (i32.add (i32.load offset=8 (local.get $p)) (local.get $earn)))
  (memory.fill (i32.add (local.get $p) (global.get $CARGO_OFF)) (i32.const 0) (i32.const 32))
  (i32.store8 offset=2 (local.get $p) (i32.const 2))
  (if (i32.and (i32.eq (local.get $m) (global.get $MKT_CITY))
               (i32.ne (i32.and (i32.load8_u offset=4 (local.get $p)) (global.get $UPG_FAST)) (i32.const 0)))
    (then (i32.store8 offset=3 (local.get $p) (call $k (global.get $K_FAST_DAYS))))
    (else (i32.store8 offset=3 (local.get $p) (call $bal (global.get $T_MKT) (local.get $m) (i32.const 2))))))

;; Step 6: away trucks tick down; outbound at 0 sells, returning at 0 pays out and goes home.
(func $step_trucks
  (local $t i32) (local $p i32) (local $ph i32)
  (loop $trucks
    (local.set $p (call $truck_ptr (local.get $t)))
    (if (local.get $p)
      (then
        (local.set $ph (i32.load8_u offset=2 (local.get $p)))
        (if (local.get $ph)
          (then
            (if (i32.load8_u offset=3 (local.get $p))
              (then (i32.store8 offset=3 (local.get $p) (i32.sub (i32.load8_u offset=3 (local.get $p)) (i32.const 1)))))
            (if (i32.eqz (i32.load8_u offset=3 (local.get $p)))
              (then
                (if (i32.eq (local.get $ph) (i32.const 1))
                  (then (call $truck_arrive (local.get $p)))
                  (else
                    (i32.store (global.get $S_CASH)
                      (i32.add (i32.load (global.get $S_CASH)) (i32.load offset=8 (local.get $p))))
                    (i32.store offset=8 (local.get $p) (i32.const 0))
                    (i32.store8 offset=2 (local.get $p) (i32.const 0))))))))))
    (br_if $trucks (i32.lt_u (local.tee $t (i32.add (local.get $t) (i32.const 1))) (i32.const 3)))))
