;; Contracts and reputation (spec §10, Decisions 17-18). Records are 8 B:
;;   {good u8, market u8, qty u8, active u8, deadline u16, payout u16}
;; The board ($S_BOARD) holds offers (active 0); accepted ($S_ACCEPTED) holds taken contracts
;; (active 1). An empty slot is all zero. Visible board slots: boardVisibleLow below rank
;; boardHighRank, boardVisibleHigh at or above it; slots past that stay empty.
;; Rank itself ($rank, T_REP thresholds) lives in 04_inv.wat.
;; RNG order inside $contract_roll (part of the spec): good, [market if tier > 0], qty, deadline.

(global $E_DEADLINE   i32 (i32.const 17))
(global $MKT_TOWN     i32 (i32.const 1))
(global $CONTRACT_SLOTS i32 (i32.const 3))

(func $board_ptr (param $slot i32) (result i32)
  (i32.add (global.get $S_BOARD) (i32.shl (local.get $slot) (i32.const 3))))

(func $acc_ptr (param $slot i32) (result i32)
  (i32.add (global.get $S_ACCEPTED) (i32.shl (local.get $slot) (i32.const 3))))

;; Number of board slots in play at the current rank.
(func $board_visible (result i32)
  (if (result i32) (i32.ge_u (call $rank) (call $k (global.get $K_BOARD_HIGH_RANK)))
    (then (call $k (global.get $K_BOARD_VIS_HIGH)))
    (else (call $k (global.get $K_BOARD_VIS_LOW)))))

;; Fill one board slot with a fresh offer (active 0). Consumes RNG.
(func $contract_roll (param $slot i32)
  (local $p i32) (local $rank i32) (local $maxTier i32) (local $n i32) (local $g i32)
  (local $pick i32) (local $good i32) (local $m i32) (local $qty i32) (local $dl i32)
  (local.set $p (call $board_ptr (local.get $slot)))
  (local.set $rank (call $rank))
  (if (i32.ge_u (local.get $rank) (call $k (global.get $K_BOARD_HIGH_RANK)))
    (then (local.set $maxTier (call $k (global.get $K_CONTRACT_TIER_HIGH))))
    (else (local.set $maxTier (call $k (global.get $K_CONTRACT_TIER_LOW)))))
  ;; eligible goods: ids ascending with tier <= maxTier
  (local.set $g (i32.const 0))
  (loop $count
    (if (i32.le_u (call $bal (global.get $T_GOOD) (local.get $g) (i32.const 2)) (local.get $maxTier))
      (then (local.set $n (i32.add (local.get $n) (i32.const 1)))))
    (br_if $count (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (global.get $GOODS))))
  (local.set $pick (call $rng_range (local.get $n)))
  (local.set $g (i32.const 0))
  (loop $find
    (if (i32.le_u (call $bal (global.get $T_GOOD) (local.get $g) (i32.const 2)) (local.get $maxTier))
      (then
        (if (i32.eqz (local.get $pick)) (then (local.set $good (local.get $g)) (local.set $pick (i32.const -1)))
          (else (if (i32.gt_s (local.get $pick) (i32.const 0))
            (then (local.set $pick (i32.sub (local.get $pick) (i32.const 1)))))))))
    (br_if $find (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (global.get $GOODS))))
  (local.set $m (global.get $MKT_TOWN))
  (if (call $bal (global.get $T_GOOD) (local.get $good) (i32.const 2))
    (then (local.set $m (i32.add (i32.const 1) (call $rng_range (i32.const 2))))))
  (local.set $qty (i32.add (call $k (global.get $K_CONTRACT_QTY_BASE))
    (call $rng_range (i32.add (call $k (global.get $K_CONTRACT_QTY_SPREAD))
                              (i32.mul (call $k (global.get $K_CONTRACT_QTY_RANK)) (local.get $rank))))))
  (local.set $dl (i32.add (i32.add (i32.load16_u (global.get $S_DAY)) (call $k (global.get $K_CONTRACT_DL_BASE)))
    (call $rng_range (call $k (global.get $K_CONTRACT_DL_SPREAD)))))
  (i32.store8 (local.get $p) (local.get $good))
  (i32.store8 offset=1 (local.get $p) (local.get $m))
  (i32.store8 offset=2 (local.get $p) (local.get $qty))
  (i32.store8 offset=3 (local.get $p) (i32.const 0))
  (i32.store16 offset=4 (local.get $p) (local.get $dl))
  (i32.store16 offset=6 (local.get $p)
    (i32.div_u (i32.mul (i32.mul (local.get $qty) (call $bal (global.get $T_GOOD) (local.get $good) (i32.const 0)))
                        (call $k (global.get $K_CONTRACT_MULT)))
               (global.get $BP_ONE))))

;; Re-roll every visible board slot in slot order; slots past the visible count are emptied.
(func $board_refresh
  (local $s i32) (local $vis i32)
  (local.set $vis (call $board_visible))
  (loop $slots
    (if (i32.lt_u (local.get $s) (local.get $vis))
      (then (call $contract_roll (local.get $s)))
      (else (memory.fill (call $board_ptr (local.get $s)) (i32.const 0) (i32.const 8))))
    (br_if $slots (i32.lt_u (local.tee $s (i32.add (local.get $s) (i32.const 1))) (global.get $CONTRACT_SLOTS)))))

;; 0 when the slot is a visible, non-empty board offer, else E_BAD_ARG.
(func $board_check (param $slot i32) (result i32)
  (if (i32.ge_u (local.get $slot) (call $board_visible)) (then (return (global.get $E_BAD_ARG))))
  (if (i32.eqz (i32.load8_u offset=2 (call $board_ptr (local.get $slot)))) (then (return (global.get $E_BAD_ARG))))
  (i32.const 0))

(func $a_accept (param $slot i32) (result i32)
  (local $err i32) (local $i i32) (local $a i32)
  (local.set $err (call $board_check (local.get $slot)))
  (if (local.get $err) (then (return (local.get $err))))
  (loop $free
    (local.set $a (call $acc_ptr (local.get $i)))
    (if (i32.eqz (i32.load8_u offset=3 (local.get $a)))
      (then
        (memory.copy (local.get $a) (call $board_ptr (local.get $slot)) (i32.const 8))
        (i32.store8 offset=3 (local.get $a) (i32.const 1))
        (call $contract_roll (local.get $slot))
        (return (i32.const 0))))
    (br_if $free (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (call $k (global.get $K_ACCEPTED_MAX)))))
  (global.get $E_MAX))

(func $a_decline (param $slot i32) (result i32)
  (local $err i32)
  (local.set $err (call $board_check (local.get $slot)))
  (if (local.get $err) (then (return (local.get $err))))
  (call $contract_roll (local.get $slot))
  (i32.const 0))

;; Validate a TRUCK_SEND tag c (not 255) for truck p going to market m.
;; Order: tag names an active slot, market, not already carried, deadline, cargo quantity.
(func $contract_check (param $p i32) (param $m i32) (param $c i32) (result i32)
  (local $a i32) (local $t i32) (local $q i32)
  (if (i32.ge_u (local.get $c) (global.get $CONTRACT_SLOTS)) (then (return (global.get $E_CONTRACT))))
  (local.set $a (call $acc_ptr (local.get $c)))
  (if (i32.eqz (i32.load8_u offset=3 (local.get $a))) (then (return (global.get $E_CONTRACT))))
  (if (i32.ne (local.get $m) (i32.load8_u offset=1 (local.get $a))) (then (return (global.get $E_CONTRACT))))
  (loop $trucks
    (local.set $q (call $truck_ptr (local.get $t)))
    (if (local.get $q)
      (then (if (i32.eq (i32.load8_u offset=5 (local.get $q)) (local.get $c))
        (then (return (global.get $E_CONTRACT))))))
    (br_if $trucks (i32.lt_u (local.tee $t (i32.add (local.get $t) (i32.const 1))) (i32.const 3))))
  (if (i32.gt_u (i32.add (i32.load16_u (global.get $S_DAY)) (call $travel_days (local.get $m)))
                (i32.load16_u offset=4 (local.get $a)))
    (then (return (global.get $E_DEADLINE))))
  (if (i32.lt_u (call $cargo_of (local.get $p) (i32.load8_u (local.get $a))) (i32.load8_u offset=2 (local.get $a)))
    (then (return (global.get $E_NO_STOCK))))
  (i32.const 0))

;; Outbound arrival, before the rest of the cargo is sold: deliver the tagged contract.
;; The tag is dropped either way. If the cargo no longer holds the full quantity (it spoiled
;; en route) there is no partial delivery: the slot stays active and expires normally.
(func $contract_fulfil (param $p i32)
  (local $c i32) (local $a i32) (local $r i32)
  (local.set $c (i32.load8_u offset=5 (local.get $p)))
  (if (i32.eq (local.get $c) (global.get $NO_CONTRACT)) (then (return)))
  (i32.store8 offset=5 (local.get $p) (global.get $NO_CONTRACT))
  (if (i32.ge_u (local.get $c) (global.get $CONTRACT_SLOTS)) (then (return)))
  (local.set $a (call $acc_ptr (local.get $c)))
  (if (i32.eqz (i32.load8_u offset=3 (local.get $a))) (then (return)))
  (if (i32.lt_u (call $cargo_of (local.get $p) (i32.load8_u (local.get $a))) (i32.load8_u offset=2 (local.get $a)))
    (then (return)))
  (drop (call $cargo_take (local.get $p) (i32.load8_u (local.get $a)) (i32.load8_u offset=2 (local.get $a))))
  (i32.store (global.get $S_CASH)
    (i32.add (i32.load (global.get $S_CASH)) (i32.load16_u offset=6 (local.get $a))))
  (local.set $r (i32.add (i32.load8_u (global.get $S_REP)) (call $k (global.get $K_REP_GAIN))))
  (if (i32.gt_u (local.get $r) (i32.const 255)) (then (local.set $r (i32.const 255))))
  (i32.store8 (global.get $S_REP) (local.get $r))
  (call $ctr_add (global.get $S_CONTRACTS_DONE) (i32.const 1))
  (memory.fill (local.get $a) (i32.const 0) (i32.const 8)))

;; 1 when an outbound truck (phase 1) carries accepted slot s.
(func $slot_carried (param $s i32) (result i32)
  (local $t i32) (local $q i32)
  (loop $trucks
    (local.set $q (call $truck_ptr (local.get $t)))
    (if (local.get $q)
      (then (if (i32.and (i32.eq (i32.load8_u offset=2 (local.get $q)) (i32.const 1))
                         (i32.eq (i32.load8_u offset=5 (local.get $q)) (local.get $s)))
        (then (return (i32.const 1))))))
    (br_if $trucks (i32.lt_u (local.tee $t (i32.add (local.get $t) (i32.const 1))) (i32.const 3))))
  (i32.const 0))

;; Step 7: an active accepted contract with deadline <= day that no outbound truck carries
;; expires: rep -repLoss (floor 0), cash -latePenaltyBp of the payout (floor), slot cleared,
;; and any truck still tagged with it is untagged. Slots in order 0..2. Cash may go negative.
(func $step_contracts
  (local $s i32) (local $a i32) (local $t i32) (local $q i32) (local $rep i32) (local $loss i32)
  (loop $slots
    (local.set $a (call $acc_ptr (local.get $s)))
    (if (i32.and (i32.ne (i32.load8_u offset=3 (local.get $a)) (i32.const 0))
                 (i32.le_u (i32.load16_u offset=4 (local.get $a)) (i32.load16_u (global.get $S_DAY))))
      (then
        (if (i32.eqz (call $slot_carried (local.get $s)))
          (then
            (local.set $rep (i32.load8_u (global.get $S_REP)))
            (local.set $loss (call $k (global.get $K_REP_LOSS)))
            (if (i32.gt_u (local.get $rep) (local.get $loss))
              (then (i32.store8 (global.get $S_REP) (i32.sub (local.get $rep) (local.get $loss))))
              (else (i32.store8 (global.get $S_REP) (i32.const 0))))
            (i32.store (global.get $S_CASH)
              (i32.sub (i32.load (global.get $S_CASH))
                (i32.div_u (i32.mul (i32.load16_u offset=6 (local.get $a)) (call $k (global.get $K_LATE_PENALTY)))
                           (global.get $BP_ONE))))
            (memory.fill (local.get $a) (i32.const 0) (i32.const 8))
            (local.set $t (i32.const 0))
            (loop $trucks
              (local.set $q (call $truck_ptr (local.get $t)))
              (if (local.get $q)
                (then (if (i32.eq (i32.load8_u offset=5 (local.get $q)) (local.get $s))
                  (then (i32.store8 offset=5 (local.get $q) (global.get $NO_CONTRACT))))))
              (br_if $trucks (i32.lt_u (local.tee $t (i32.add (local.get $t) (i32.const 1))) (i32.const 3))))))))
    (br_if $slots (i32.lt_u (local.tee $s (i32.add (local.get $s) (i32.const 1))) (global.get $CONTRACT_SLOTS)))))
