;; Process / Market / Trucks / Build tabs (plan Task 5b). Drawn into the PANEL rect by
;; $sheet_body while $tab != 0 (portrait / tablet: the bottom sheet, the farm stays visible above
;; it; laptop: the side panel). Every action goes through $act ($do): errors toast their mapped
;; string, successes are announced (sales, sends and loans also toast). Read-only helpers here
;; mirror the sim rules (process plan, tomorrow's rot, truck spoilage, contract checks).
;;
;; Dynamic hit codes (panel range 0x200..0x3FF; 0x200..0x22F are the farm sheet, 22a_farm.wat):
;;   0x208 SELL  0x209 FILL BEST  0x20A SEND  0x20B BUY TRUCK  0x20C NEXT  0x20D BACK
;;   0x20E LOAN TAKE  0x20F LOAN REPAY   0x220+b (Build tab) place building b
;;   0x230+i market sub-tab (PRICES SELL CONTRACTS)  0x233 cancel placement  0x238+m destination
;;   0x240 / 0x250 / 0x260 + a   stepper - / + / MAX of amount a (goods 0..12, 13 loan, 14 repay)
;;   0x270+s ACCEPT board slot s  0x274+s DECLINE  0x280+t DISPATCH truck t
;;   0x290 + 4t + k  truck t upgrade k (0 capacity, 1 fridge, 2 fast)  0x2A0+s tag contract s, 0x2A3 none
;;   0x2FF inert row card   0x300+i locate tile i   0x340+i / 0x380+i recipe prev / next of tile i
;; UI state: wasm globals + R_LAYOUT 0xA040 amounts QTY[16] i32, 0xA080 REM[13] i32 (process plan).

(global $tab (mut i32) (i32.const 0))          ;; 0 Farm 1 Process 2 Market 3 Trucks 4 Build
(global $msub (mut i32) (i32.const 0))         ;; market sub-tab (kept across tab switches)
(global $place (mut i32) (i32.const 0))        ;; placement mode: building + 1
(global $dsp (mut i32) (i32.const -1))         ;; dispatch flow: truck index, -1 none
(global $dstep (mut i32) (i32.const 0))        ;; 0 destination 1 cargo 2 contract 3 confirm
(global $dm (mut i32) (i32.const 1))           ;; destination market
(global $dc (mut i32) (i32.const 255))         ;; contract tag (255 none)
(global $qk (mut i32) (i32.const 0))           ;; last $qmax / $qv: the cargo-slot limit binds
(global $QTY i32 (i32.const 0xA040))
(global $REM i32 (i32.const 0xA080))
;; 0x937 truck upgrade cost columns (K), 0x948 good -> icon (crop model / the building that makes it)
(data (i32.const 0x937) "\05\08\09")
(data (i32.const 0x948) "\40\41\42\43\44\50\50\51\52\52\53\53\54")
(data (i32.const 0x93A) "\55\53\56")          ;; route stops: Warehouse, Bakery, Cold Store models

(func $gname (param $g i32) (result i32) (call $str (i32.add (global.get $STR_GOOD) (local.get $g))))
(func $sg (param $g i32) (call $ss (call $gname (local.get $g))))
(func $sp (call $sc (i32.const 32)))

;; ---------------------------------------------------------------- amounts and steppers

(func $qa (param $a i32) (result i32) (i32.add (global.get $QTY) (i32.shl (local.get $a) (i32.const 2))))
(func $q (param $a i32) (result i32) (i32.load (call $qa (local.get $a))))
(func $qreset
  (memory.fill (global.get $QTY) (i32.const 0) (i32.const 64))
  (i32.store offset=52 (global.get $QTY) (i32.const 300))
  (i32.store offset=56 (global.get $QTY) (i32.const 100)))
(func $qsum (result i32)
  (local $g i32) (local $n i32)
  (loop $l
    (local.set $n (i32.add (local.get $n) (call $q (local.get $g))))
    (br_if $l (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13))))
  (local.get $n))
;; Upper limit of amount a: the stock (dispatch: also the truck's free room and its free cargo
;; slots less those the other planned lines need), loanMax, min(owed, cash). $qk = the slots bind.
(func $qmax (param $a i32) (result i32)
  (local $v i32) (local $p i32) (local $g i32) (local $s i32)
  (global.set $qk (i32.const 0))
  (if (i32.eq (local.get $a) (i32.const 13)) (then (return (call $k (global.get $K_LOAN_MAX)))))
  (if (i32.eq (local.get $a) (i32.const 14)) (then (return (call $imax (i32.const 0) (call $imin (call $loan_owed) (i32.load (global.get $S_CASH)))))))
  (local.set $v (call $inv_count (local.get $a)))
  (local.set $p (call $truck_ptr (global.get $dsp)))
  (if (local.get $p) (then
    (local.set $v (call $imax (i32.const 0) (call $imin (local.get $v)
      (i32.add (i32.sub (i32.sub (call $truck_cap_of (local.get $p)) (call $cargo_total (local.get $p))) (call $qsum)) (call $q (local.get $a))))))
    ;; cargo slots ($load_slots is TRUCK_LOAD's own dry run): free ones less the other lines' needs
    (local.set $s (call $free_slots (local.get $p)))
    (loop $l
      (if (i32.ne (local.get $g) (local.get $a)) (then
        (local.set $s (i32.sub (local.get $s) (call $load_slots (local.get $p) (local.get $g) (call $q (local.get $g)))))))
      (br_if $l (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13))))
    (local.set $g (local.get $v))
    (block $f (loop $fit
      (br_if $f (i32.or (i32.le_s (local.get $v) (i32.const 0)) (i32.le_s (call $load_slots (local.get $p) (local.get $a) (local.get $v)) (local.get $s))))
      (local.set $v (i32.sub (local.get $v) (i32.const 1)))
      (br $fit)))
    (global.set $qk (i32.lt_s (local.get $v) (local.get $g)))))
  (call $imax (local.get $v) (i32.const 0)))
;; Amount a clamped to [0, max] (stored back); $qk = the slot limit stops a + here.
(func $qv (param $a i32) (result i32)
  (local $v i32) (local $m i32)
  (local.set $m (call $qmax (local.get $a)))
  (local.set $v (call $clamp (call $q (local.get $a)) (i32.const 0) (local.get $m)))
  (global.set $qk (i32.and (global.get $qk) (i32.eq (local.get $v) (local.get $m))))
  (i32.store (call $qa (local.get $a)) (local.get $v))
  (local.get $v))
;; Stepper k (0 -, 1 +, 2 MAX) on amount a; loans step $100.
(func $adj (param $a i32) (param $k i32)
  (i32.store (call $qa (local.get $a))
    (if (result i32) (i32.eq (local.get $k) (i32.const 2))
      (then (call $qmax (local.get $a)))
      (else (i32.add (call $q (local.get $a))
        (i32.mul (i32.sub (i32.shl (local.get $k) (i32.const 1)) (i32.const 1))
                 (select (i32.const 100) (i32.const 1) (i32.ge_u (local.get $a) (i32.const 13))))))))
  (drop (call $qv (local.get $a))))

;; The shared list row with a stepper: a card [icon label / sub   value] then [-] [+] [MAX].
;; value = "5/12" (amount / stock) for goods, "$300" for the loan amounts.
(func $srow (param $a i32) (param $icon i32) (param $label i32) (param $sub i32)
  (local $bs i32) (local $w i32) (local $x i32) (local $k i32) (local $h i32)
  (local.set $bs (call $btnh))
  (local.set $h (call $rowh))
  (local.set $w (i32.sub (global.get $uw) (i32.mul (i32.const 3) (i32.add (local.get $bs) (global.get $lgap)))))
  (call $sb (global.get $SB2))
  (call $sn (call $qv (local.get $a)) (i32.gt_u (local.get $a) (i32.const 12)))
  (if (i32.lt_u (local.get $a) (i32.const 13)) (then (call $si (global.get $STR_OF)) (call $sn0 (call $inv_count (local.get $a)))))
  (global.set $b_row (i32.const 1)) (global.set $b_sub (local.get $sub)) (global.set $b_right (global.get $SB2))
  (call $btn (i32.const 0x2FF) (global.get $ux) (global.get $uy) (local.get $w) (local.get $h) (local.get $label) (local.get $icon) (i32.const 0) (i32.const 1))
  (local.set $x (i32.add (i32.add (global.get $ux) (local.get $w)) (global.get $lgap)))
  (loop $l
    ;; + stops at the 8-cargo-slot limit (its reason is toasted on a tap)
    (global.set $b_why (call $str (global.get $STR_KINDS)))
    (call $btn (i32.add (i32.add (i32.const 0x240) (i32.shl (local.get $k) (i32.const 4))) (local.get $a))
      (local.get $x) (i32.add (global.get $uy) (i32.shr_u (i32.sub (local.get $h) (local.get $bs)) (i32.const 1)))
      (local.get $bs) (local.get $bs) (call $str (i32.add (global.get $STR_STP) (local.get $k))) (i32.const -1) (i32.const 0)
      (i32.eqz (i32.and (i32.eq (local.get $k) (i32.const 1)) (global.get $qk))))
    (local.set $x (i32.add (local.get $x) (i32.add (local.get $bs) (global.get $lgap))))
    (br_if $l (i32.lt_u (local.tee $k (i32.add (local.get $k) (i32.const 1))) (i32.const 3))))
  (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $h) (global.get $lgap)))))

;; Stepper rows for every good in storage, unit price / quote at market m (Sell panel, cargo).
(func $goods_rows (param $m i32)
  (local $g i32) (local $n i32) (local $v i32)
  (loop $l
    (if (call $inv_count (local.get $g)) (then
      (local.set $n (i32.const 1))
      (local.set $v (call $qv (local.get $g)))
      (call $sb (global.get $SB1))
      (if (local.get $v)
        (then (call $si (global.get $STR_FOR)) (call $sn (call $quote (local.get $m) (local.get $g) (local.get $v)) (i32.const 1)))
        (else (call $sn (call $price (local.get $m) (local.get $g)) (i32.const 1)) (call $si (global.get $STR_EA))))
      (call $srow (local.get $g) (i32.load8_u (i32.add (i32.const 0x948) (local.get $g))) (call $gname (local.get $g)) (global.get $SB1))))
    (br_if $l (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13))))
  (if (i32.eqz (local.get $n)) (then
    (call $sb (global.get $SB1)) (call $si (global.get $STR_NOTHING)) (call $si (global.get $STR_STOCK))
    (call $lab (global.get $I_CRATE) (i32.const 63)))))

;; Section header: a gap, dark text, a rule under it.
(func $hdr (param $s i32)
  (call $flush (call $rowh))
  (global.set $uy (i32.add (global.get $uy) (global.get $lgap)))
  (call $ui_label (i32.const -1) (call $str (local.get $s)) (i32.const 60))
  (call $hline (global.get $ux) (i32.sub (global.get $uy) (i32.const 2)) (global.get $uw) (call $pal (i32.const 57))))

;; ---------------------------------------------------------------- read-only sim mirrors

;; Storage units of good g that spoil tonight (End Day steps 2 + 5): units that age to perishDays,
;; minus the Cold Store's protected oldest units (shared in good id order).
(func $rot (param $g i32) (result i32)
  (local $j i32) (local $prot i32) (local $a i32) (local $d i32) (local $ex i32) (local $all i32) (local $v i32) (local $step i32)
  (local.set $step (call $age_step))
  (local.set $prot (i32.mul (call $count_bld (global.get $BLD_COLD)) (call $k (global.get $K_COLD_PER_STORE))))
  (loop $gl
    (local.set $d (call $bal (global.get $T_GOOD) (local.get $j) (i32.const 1)))
    (if (local.get $d) (then
      (local.set $ex (i32.const 0)) (local.set $all (i32.const 0)) (local.set $a (i32.const 0))
      (loop $al
        (local.set $v (i32.load16_u (call $inv_ptr (local.get $j) (local.get $a))))
        (local.set $all (i32.add (local.get $all) (local.get $v)))
        (if (i32.ge_s (i32.add (local.get $a) (local.get $step)) (local.get $d)) (then (local.set $ex (i32.add (local.get $ex) (local.get $v)))))
        (br_if $al (i32.lt_u (local.tee $a (i32.add (local.get $a) (i32.const 1))) (i32.const 8))))
      (if (i32.eq (local.get $j) (local.get $g)) (then (return (i32.sub (local.get $ex) (call $imin (local.get $ex) (local.get $prot))))))
      (local.set $prot (i32.sub (local.get $prot) (call $imin (local.get $prot) (local.get $all))))))
    (br_if $gl (i32.le_u (local.tee $j (i32.add (local.get $j) (i32.const 1))) (local.get $g))))
  (i32.const 0))

;; Ages a truck's cargo gains before it sells at the destination: travel days, +heatAgeExtra
;; when today is a Heatwave (later days are unknown: counted as 1 each).
(func $aging (result i32)
  (i32.add (call $travel_days (global.get $dm)) (i32.sub (call $age_step) (i32.const 1))))

;; Units of good g that spoil before arrival (step 5 on each travel day): truck p's cargo plus the
;; n oldest units in storage (loads take the oldest first); none in a refrigerated truck.
(func $spoil_n (param $p i32) (param $g i32) (param $n i32) (result i32)
  (local $d i32) (local $a i32) (local $s i32) (local $o i32) (local $t i32) (local $ag i32)
  (local.set $d (call $bal (global.get $T_GOOD) (local.get $g) (i32.const 1)))
  (if (i32.or (i32.eqz (local.get $d)) (i32.and (i32.load8_u offset=4 (local.get $p)) (global.get $UPG_FRIDGE))) (then (return (i32.const 0))))
  (local.set $ag (call $aging))
  (loop $sl
    (local.set $s (call $slot_ptr (local.get $p) (local.get $a)))
    (if (i32.and (i32.eq (i32.load8_u (local.get $s)) (local.get $g))
                 (i32.ge_u (i32.add (i32.load8_u offset=1 (local.get $s)) (local.get $ag)) (local.get $d)))
      (then (local.set $o (i32.add (local.get $o) (i32.load16_u offset=2 (local.get $s))))))
    (br_if $sl (i32.lt_u (local.tee $a (i32.add (local.get $a) (i32.const 1))) (i32.const 8))))
  (local.set $a (i32.const 7))
  (loop $l
    (local.set $t (call $imin (i32.load16_u (call $inv_ptr (local.get $g) (local.get $a))) (local.get $n)))
    (local.set $n (i32.sub (local.get $n) (local.get $t)))
    (if (i32.ge_u (i32.add (local.get $a) (local.get $ag)) (local.get $d)) (then (local.set $o (i32.add (local.get $o) (local.get $t)))))
    (br_if $l (i32.ge_s (local.tee $a (i32.sub (local.get $a) (i32.const 1))) (i32.const 0))))
  (local.get $o))

;; Why accepted contract s cannot ride truck p to $dm with the planned cargo (0 = it can):
;; $contract_check order (market, already carried, deadline, quantity).
(func $con_why (param $p i32) (param $s i32) (result i32)
  (local $a i32) (local $r i32)
  (local.set $a (call $acc_ptr (local.get $s)))
  (if (i32.ne (i32.load8_u offset=1 (local.get $a)) (global.get $dm)) (then (return (call $str (global.get $STR_WRONG_MKT)))))
  (if (i32.ge_s (call $carrier (local.get $s)) (i32.const 0)) (then (return (call $str (global.get $STR_TAKEN)))))
  (if (i32.gt_u (i32.add (i32.load16_u (global.get $S_DAY)) (call $travel_days (global.get $dm))) (i32.load16_u offset=4 (local.get $a)))
    (then (return (call $err_str (global.get $E_DEADLINE)))))
  (local.set $r (i32.sub (i32.load8_u offset=2 (local.get $a))
    (i32.add (call $cargo_of (local.get $p) (i32.load8_u (local.get $a))) (call $q (i32.load8_u (local.get $a))))))
  (if (i32.gt_s (local.get $r) (i32.const 0)) (then
    (call $sb (global.get $SB3)) (call $si (global.get $STR_NEED)) (call $sn0 (local.get $r)) (call $si (global.get $STR_MORE))
    (return (global.get $SB3))))
  (i32.const 0))

;; Why truck p cannot take upgrade k costing c ($a_upgrade_truck order), 0 = it can.
(func $upg_why (param $p i32) (param $k i32) (param $c i32) (result i32)
  (local $u i32)
  (if (i32.eqz (call $count_bld (global.get $BLD_GARAGE))) (then (return (call $err_str (global.get $E_NEED_GARAGE)))))
  (if (i32.load8_u offset=2 (local.get $p)) (then (return (call $err_str (global.get $E_TRUCK_AWAY)))))
  (local.set $u (i32.load8_u offset=4 (local.get $p)))
  (if (select (i32.ge_u (i32.and (local.get $u) (i32.const 3)) (call $k (global.get $K_TRUCK_UPG_MAX)))
              (i32.and (local.get $u) (i32.shl (i32.const 2) (local.get $k))) (i32.eqz (local.get $k)))
    (then (return (call $str (global.get $STR_MAX_LEVEL)))))
  (if (i32.lt_s (i32.load (global.get $S_CASH)) (local.get $c)) (then (return (call $err_str (global.get $E_CASH)))))
  (i32.const 0))

;; "12 SAUCE > TOWN BY DAY 34" for contract record p into the current builder.
(func $s_con (param $p i32)
  (call $sn0 (i32.load8_u offset=2 (local.get $p))) (call $sp) (call $sg (i32.load8_u (local.get $p)))
  (call $sp) (call $sc (i32.const 62)) (call $sp)
  (call $si (i32.add (global.get $STR_MKT) (i32.load8_u offset=1 (local.get $p))))
  (call $si (global.get $STR_BY_DAY)) (call $sn0 (i32.load16_u offset=4 (local.get $p))))

;; ---------------------------------------------------------------- tab bodies

;; Sheet subtitle while dispatching: "TRUCK 1, STEP 2/4: CARGO" into the current builder.
;; "TRUCK 1, STEP 2 OF 4: CARGO" (also announced on every step change, $step_to).
(func $s_step
  (call $si (global.get $STR_TRUCK)) (call $sn0 (i32.add (global.get $dsp) (i32.const 1))) (call $sep)
  (call $si (global.get $STR_STEP)) (call $sn0 (i32.add (global.get $dstep) (i32.const 1))) (call $si (global.get $STR_OF)) (call $sc (i32.const 52))
  (call $sc (i32.const 58)) (call $sp) (call $si (i32.add (global.get $STR_STEPN) (global.get $dstep))))
(func $step_to (param $s i32)
  (global.set $dstep (local.get $s))
  (call $sb (global.get $SB3)) (call $s_step) (call $announce (global.get $SB3)))
;; "TAP AN EMPTY PLOT FOR MILL" into the current builder.
(func $s_place
  (call $si (global.get $STR_PLACE)) (call $si (i32.add (global.get $STR_BLD) (i32.sub (global.get $place) (i32.const 1)))))

(func $tab_body
  (if (i32.eq (global.get $tab) (i32.const 1)) (then (call $process_body)))
  (if (i32.eq (global.get $tab) (i32.const 2)) (then (call $market_body)))
  (if (i32.eq (global.get $tab) (i32.const 3)) (then (call $trucks_body)))
  (if (i32.eq (global.get $tab) (i32.const 4)) (then (call $build_body))))

;; Process: storage + tomorrow's rot, then one card per processor in End Day (tile) order with
;; its recipe selector, stock vs daily cap and the next End Day's batch (REM = stock left after
;; the processors before it), Cellar aging buckets.
(func $process_body
  (local $g i32) (local $i i32) (local $p i32) (local $b i32) (local $r i32) (local $in i32) (local $q i32) (local $n i32)
  (local $v i32) (local $c i32) (local $any i32) (local $j i32) (local $more i32)
  (call $sb (global.get $SB1)) (call $si (global.get $STR_STORAGE))
  (call $sn0 (call $storage_used)) (call $sc (i32.const 47)) (call $sn0 (call $storage_cap))
  (call $lab (global.get $I_CRATE) (i32.const 61))
  (local.set $n (i32.add (i32.const 4) (i32.shl (call $ui_ts) (i32.const 1))))
  (call $ui_bar (global.get $ux) (global.get $uy) (global.get $uw) (local.get $n) (call $storage_used) (call $storage_cap) (i32.const 18))
  (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $n) (i32.add (global.get $lgap) (i32.const 2)))))
  (loop $gl
    (local.set $v (call $rot (local.get $g)))
    (if (local.get $v) (then
      (call $sb (global.get $SB1)) (call $sn0 (local.get $v)) (call $sp) (call $sg (local.get $g)) (call $si (global.get $STR_ROT))
      (call $lab (global.get $I_WARN) (i32.const 37))))
    (i32.store (i32.add (global.get $REM) (i32.shl (local.get $g) (i32.const 2))) (call $inv_count (local.get $g)))
    (br_if $gl (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13))))
  (loop $tl
    (local.set $p (call $tile_ptr (local.get $i)))
    (local.set $b (i32.load8_u offset=1 (local.get $p)))
    (if (i32.and (call $in_grid (local.get $i)) (i32.and (i32.eq (i32.load8_u (local.get $p)) (i32.const 2)) (i32.le_u (local.get $b) (i32.const 4)))) (then (block $card
      (local.set $any (i32.const 1))
      ;; a card takes 3 draw-list records: past the cap the rest are counted ("+12 MORE")
      (if (i32.gt_u (global.get $btn_n) (i32.const 60)) (then (local.set $more (i32.add (local.get $more) (i32.const 1))) (br $card)))
      (call $hline (global.get $ux) (global.get $uy) (global.get $uw) (call $pal (i32.const 57)))
      (global.set $uy (i32.add (global.get $uy) (global.get $lgap)))
      ;; header card: name (+ II when upgraded), plot; tap = find it on the farm
      (call $sb (global.get $SB1)) (call $s_plot (local.get $i))
      (call $sb (global.get $SB2)) (call $si (i32.add (global.get $STR_BLD) (local.get $b)))
      (if (i32.and (i32.load8_u offset=5 (local.get $p)) (i32.const 2)) (then (call $si (global.get $STR_II))))
      (global.set $b_row (i32.const 1)) (global.set $b_right (global.get $SB1))
      (call $put (i32.add (i32.const 0x300) (local.get $i)) (global.get $SB2) (i32.add (i32.const 80) (local.get $b)) (i32.const 0) (i32.const 1) (i32.const 1) (call $btnh))
      (call $recipe_sel (local.get $p) (i32.add (i32.const 0x340) (local.get $i)))
      (local.set $r (i32.load8_u offset=7 (local.get $p)))
      (if (i32.eqz (local.get $r))
        (then (call $ui_label (global.get $I_WARN) (call $str (global.get $STR_NO_RECIPE)) (i32.const 37)))
        (else
          (local.set $r (i32.sub (local.get $r) (i32.const 1)))
          (local.set $in (call $bal (global.get $T_RECIPE) (local.get $r) (i32.const 1)))
          (local.set $q (call $bal (global.get $T_RECIPE) (local.get $r) (i32.const 2)))
          (local.set $c (i32.add (global.get $REM) (i32.shl (local.get $in) (i32.const 2))))
          (local.set $v (i32.load (local.get $c)))
          (call $sb (global.get $SB1)) (call $sn0 (local.get $v)) (call $sp) (call $sg (local.get $in)) (call $si (global.get $STR_IN_STOCK)) (call $sc (i32.const 44))
          (if (i32.eq (local.get $b) (global.get $BLD_CELLAR))
            (then
              ;; $cellar_load: up to cellarHold minus the units already aging
              (local.set $n (call $k (global.get $K_CELLAR_HOLD))) (local.set $j (i32.const 0))
              (loop $cl
                (local.set $n (i32.sub (local.get $n) (i32.load8_u (i32.add (i32.add (global.get $S_CELLAR) (i32.mul (local.get $i) (i32.const 5))) (local.get $j)))))
                (br_if $cl (i32.lt_u (local.tee $j (i32.add (local.get $j) (i32.const 1))) (i32.const 5))))
              (local.set $n (call $imax (i32.const 0) (local.get $n)))
              (call $sp) (call $si (global.get $STR_ROOM)) (call $sn0 (local.get $n))
              (local.set $n (call $imin (local.get $n) (local.get $v)))
              (local.set $n (i32.sub (local.get $n) (i32.rem_u (local.get $n) (local.get $q)))))
            (else
              ;; $process_tile: whole batches, bounded by the input cap (x2 upgraded) and the stock
              (local.set $n (i32.mul (call $bal (global.get $T_BLD) (local.get $b) (i32.const 2))
                (select (call $k (global.get $K_BLD_UPG_CAP_MULT)) (i32.const 1) (i32.and (i32.load8_u offset=5 (local.get $p)) (i32.const 2)))))
              (call $si (global.get $STR_CAP)) (call $sn0 (local.get $n)) (call $si (global.get $STR_PER_DAY))
              (local.set $n (i32.mul (call $imin (i32.div_u (local.get $n) (local.get $q)) (i32.div_u (local.get $v) (local.get $q))) (local.get $q)))))
          (call $lab (global.get $I_CRATE) (i32.const 63))
          (i32.store (local.get $c) (i32.sub (local.get $v) (local.get $n)))
          (call $sb (global.get $SB1))
          (if (local.get $n)
            (then
              (call $si (global.get $STR_PLAN)) (call $sn0 (local.get $n)) (call $sp) (call $sg (local.get $in))
              (call $sp) (call $sc (i32.const 62)) (call $sp) (call $sn0 (i32.div_u (local.get $n) (local.get $q))) (call $sp)
              (call $sg (call $bal (global.get $T_RECIPE) (local.get $r) (i32.const 3)))
              (call $lab (global.get $I_GEAR) (i32.const 61)))
            (else
              (call $si (global.get $STR_NEED)) (call $sn0 (local.get $q)) (call $sp) (call $sg (local.get $in))
              (call $lab (global.get $I_WARN) (i32.const 37))))))
      (if (i32.eq (local.get $b) (global.get $BLD_CELLAR)) (then
        ;; aging queue: "WINE IN 1D:2 3D:4" (bucket j finishes in j + 1 End Days)
        (call $sb (global.get $SB1)) (call $si (global.get $STR_WINE_IN)) (local.set $j (i32.const 0)) (local.set $n (i32.const 0))
        (loop $al
          (local.set $v (i32.load8_u (i32.add (i32.add (global.get $S_CELLAR) (i32.mul (local.get $i) (i32.const 5))) (local.get $j))))
          (if (local.get $v) (then
            (local.set $n (i32.const 1))
            (call $sn0 (i32.add (local.get $j) (i32.const 1))) (call $sc (i32.const 68)) (call $sc (i32.const 58))
            (call $sn0 (local.get $v)) (call $sp)))
          (br_if $al (i32.lt_u (local.tee $j (i32.add (local.get $j) (i32.const 1))) (i32.const 5))))
        (if (i32.eqz (local.get $n)) (then (call $sb (global.get $SB1)) (call $si (global.get $STR_NOTHING)) (call $si (global.get $STR_AGING))))
        (call $lab (global.get $I_CLOCK) (i32.const 63)))))))
    (br_if $tl (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 64))))
  (if (local.get $more) (then
    (call $sb (global.get $SB1)) (call $sc (i32.const 43)) (call $sn0 (local.get $more)) (call $si (global.get $STR_MORE))
    (call $lab (i32.const -1) (i32.const 63))))
  (if (i32.eqz (local.get $any)) (then (call $ui_label (global.get $I_GEAR) (call $str (global.get $STR_NO_PROC)) (i32.const 63)))))

;; Market: segmented control, then the price board, the Farm Stand sell panel or the contracts.
(func $market_body
  (local $i i32)
  (loop $l
    (call $put (i32.add (i32.const 0x230) (local.get $i)) (call $str (i32.add (global.get $STR_MSUB) (local.get $i))) (i32.const -1)
      (select (i32.const 3) (i32.const 0) (i32.eq (local.get $i) (global.get $msub))) (i32.const 1) (i32.const 3) (call $btnh))
    (br_if $l (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 3))))
  (if (i32.eqz (global.get $msub)) (then (call $prices)))
  (if (i32.eq (global.get $msub) (i32.const 1)) (then (call $sell_body)))
  (if (i32.eq (global.get $msub) (i32.const 2)) (then (call $contracts_body))))

;; Price board: market news (every active event, days left), a legend, then 13 goods x Stand /
;; Town / City. Hint goods get tomorrow's drift arrow by the name; a Surge / Glut cell its arrow
;; before the "$" (numbers stay right-aligned); a small red "-24%" tag left of a price while that
;; market is saturated below 90%. Two-line rows when the columns do not fit.
;; Market news: every active event with its days left ("SURGE ^ BREAD CITY, 4 DAYS"); also the Gazette.
(func $news
  (local $k i32) (local $p i32) (local $s i32)
  (loop $e
    (local.set $p (call $event_ptr (local.get $k)))
    (local.set $s (i32.load8_u (local.get $p)))
    (if (local.get $s) (then
      (call $sb (global.get $SB1)) (call $si (i32.add (global.get $STR_EV) (local.get $s)))
      (if (i32.le_u (local.get $s) (i32.const 2)) (then
        (call $sp) (call $sg (i32.load8_u offset=2 (local.get $p)))
        (call $sp) (call $si (i32.add (global.get $STR_MKT) (i32.load8_u offset=1 (local.get $p))))))
      (call $sep) (call $s_days (i32.load8_u offset=3 (local.get $p)))
      (call $lab (global.get $I_WARN) (i32.const 61))))
    (br_if $e (i32.lt_u (local.tee $k (i32.add (local.get $k) (i32.const 1))) (i32.const 3)))))
(func $prices
  (local $g i32) (local $m i32) (local $k i32) (local $nw i32) (local $cw i32) (local $two i32)
  (local $y i32) (local $s i32) (local $d i32) (local $ts i32) (local $rh i32) (local $lh i32)
  (call $news)
  (call $ui_label (i32.const -1) (call $str (global.get $STR_LEGEND)) (i32.const 37))
  (local.set $ts (call $ui_ts))
  (global.set $tscale (local.get $ts))
  (local.set $lh (call $lh))
  (local.set $nw (i32.mul (i32.const 78) (local.get $ts)))
  (local.set $two (i32.lt_s (i32.sub (global.get $uw) (local.get $nw)) (i32.mul (i32.const 126) (local.get $ts))))
  (if (local.get $two) (then (local.set $nw (i32.const 0))))
  (local.set $cw (i32.div_s (i32.sub (global.get $uw) (local.get $nw)) (i32.const 3)))
  (local.set $rh (i32.add (i32.add (local.get $lh) (i32.mul (local.get $two) (i32.add (local.get $lh) (i32.const 2)))) (i32.add (i32.mul (i32.const 3) (local.get $ts)) (i32.const 3))))
  (local.set $g (i32.const -1))
  (loop $r
    (local.set $y (global.get $uy))
    (if (i32.ge_s (local.get $g) (i32.const 0)) (then
      (if (i32.and (local.get $g) (i32.const 1)) (then
        (call $rect (global.get $ux) (i32.sub (local.get $y) (i32.const 2)) (global.get $uw) (local.get $rh) (call $pal (i32.const 57)))))
      (call $sb (global.get $SB1)) (call $sg (local.get $g))
      (local.set $d (i32.load16_s (i32.add (global.get $S_DRIFT_NEXT) (i32.shl (local.get $g) (i32.const 1)))))
      (if (i32.and (i32.or (i32.eq (i32.load8_u (global.get $S_HINT)) (local.get $g)) (i32.eq (i32.load8_u offset=1 (global.get $S_HINT)) (local.get $g)))
                   (i32.ne (local.get $d) (i32.const 0)))
        (then (call $sp) (call $sc (select (i32.const 2) (i32.const 3) (i32.gt_s (local.get $d) (i32.const 0))))))
      (drop (call $txt (global.get $ux) (local.get $y) (global.get $SB1) (call $pal (i32.const 61))))
      (if (local.get $two) (then (local.set $y (i32.add (local.get $y) (i32.add (local.get $lh) (i32.const 2))))))))
    (local.set $m (i32.const 0))
    (loop $c
      (call $sb (global.get $SB1))
      (local.set $s (i32.const 10000))
      (if (i32.lt_s (local.get $g) (i32.const 0))
        (then (call $si (i32.add (global.get $STR_MKT) (local.get $m))))
        (else
          (local.set $d (call $event_mod (local.get $m) (local.get $g)))
          (if (i32.ne (local.get $d) (i32.const 10000)) (then (call $sc (select (i32.const 2) (i32.const 3) (i32.gt_u (local.get $d) (i32.const 10000))))))
          (call $sn (call $price (local.get $m) (local.get $g)) (i32.const 1))
          (local.set $s (i32.load16_u (call $sat_ptr (local.get $m) (local.get $g))))))
      (local.set $k (i32.sub (i32.add (i32.add (global.get $ux) (local.get $nw)) (i32.mul (i32.add (local.get $m) (i32.const 1)) (local.get $cw)))
                             (i32.add (call $tw (global.get $SB1)) (i32.const 2))))
      (drop (call $txt (local.get $k) (local.get $y) (global.get $SB1) (call $pal (select (i32.const 63) (i32.const 61) (i32.lt_s (local.get $g) (i32.const 0))))))
      (if (i32.lt_u (local.get $s) (i32.const 9000)) (then
        (call $sb (global.get $SB2)) (call $sc (i32.const 45)) (call $sn0 (i32.div_u (i32.sub (i32.const 10050) (local.get $s)) (i32.const 100))) (call $sc (i32.const 37))
        (global.set $tscale (i32.const 1))
        (drop (call $txt (i32.sub (local.get $k) (i32.add (call $tw (global.get $SB2)) (i32.const 3))) (i32.sub (i32.add (local.get $y) (local.get $lh)) (i32.const 7))
          (global.get $SB2) (call $pal (i32.const 37))))
        (global.set $tscale (local.get $ts))))
      (br_if $c (i32.lt_u (local.tee $m (i32.add (local.get $m) (i32.const 1))) (i32.const 3))))
    (global.set $uy (i32.add (global.get $uy) (select (i32.add (local.get $lh) (i32.const 4)) (local.get $rh) (i32.lt_s (local.get $g) (i32.const 0)))))
    (br_if $r (i32.lt_s (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13)))))

;; Farm Stand: stepper rows, then SELL with the live quote (+ the saturation note).
(func $sell_body
  (local $g i32) (local $n i32) (local $t i32) (local $v i32) (local $dr i32) (local $u i32)
  (call $goods_rows (i32.const 0))
  (loop $l
    (local.set $v (call $q (local.get $g)))
    (local.set $u (call $quote (i32.const 0) (local.get $g) (local.get $v)))
    (local.set $n (i32.add (local.get $n) (local.get $v)))
    (local.set $t (i32.add (local.get $t) (local.get $u)))
    (if (i32.lt_u (local.get $u) (i32.mul (local.get $v) (call $price (i32.const 0) (local.get $g)))) (then (local.set $dr (i32.const 1))))
    (br_if $l (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13))))
  (call $sb (global.get $SB2)) (call $si (i32.add (global.get $STR_MSUB) (i32.const 1))) (call $sp) (call $sn (local.get $t) (i32.const 1))
  (global.set $b_sub (select (call $str (global.get $STR_DROP)) (i32.const 0) (local.get $dr)))
  (global.set $b_why (call $str (global.get $STR_SET_QTY)))
  (call $put (i32.const 0x208) (global.get $SB2) (global.get $I_COIN) (i32.const 2) (i32.ne (local.get $n) (i32.const 0)) (i32.const 1)
    (select (call $rowh) (call $btnh) (i32.or (local.get $dr) (i32.eqz (local.get $n))))))

;; Contracts: the board's offers (ACCEPT / DECLINE), then the accepted ones with their status.
(func $contracts_body
  (local $s i32) (local $p i32) (local $n i32) (local $r i32) (local $ic i32) (local $c i32) (local $en i32) (local $h i32)
  (loop $cnt
    (local.set $n (i32.add (local.get $n) (i32.load8_u offset=3 (call $acc_ptr (local.get $s)))))
    (br_if $cnt (i32.lt_u (local.tee $s (i32.add (local.get $s) (i32.const 1))) (i32.const 3))))
  (call $hdr (global.get $STR_OFFERS))
  (local.set $s (i32.const 0))
  (loop $b
    (local.set $p (call $board_ptr (local.get $s)))
    (if (i32.eqz (call $board_check (local.get $s))) (then
      (call $sb (global.get $SB1)) (call $s_con (local.get $p))
      (call $lab (global.get $I_CRATE) (i32.const 61))
      (call $sb (global.get $SB2)) (call $si (global.get $STR_ACCEPT)) (call $sn (i32.load16_u offset=6 (local.get $p)) (i32.const 1))
      (local.set $en (i32.lt_u (local.get $n) (call $k (global.get $K_ACCEPTED_MAX))))
      (local.set $h (select (call $btnh) (call $rowh) (local.get $en)))
      (global.set $b_why (call $err_str (global.get $E_MAX)))
      (call $put (i32.add (i32.const 0x270) (local.get $s)) (global.get $SB2) (i32.const -1) (i32.const 2) (local.get $en) (i32.const 2) (local.get $h))
      (call $put (i32.add (i32.const 0x274) (local.get $s)) (call $str (global.get $STR_DECLINE)) (i32.const -1) (i32.const 0) (i32.const 1) (i32.const 2) (local.get $h))))
    (br_if $b (i32.lt_u (local.tee $s (i32.add (local.get $s) (i32.const 1))) (i32.const 3))))
  (call $hdr (global.get $STR_ACCEPTED))
  (local.set $s (i32.const 0))
  (loop $a
    (local.set $p (call $acc_ptr (local.get $s)))
    (if (i32.load8_u offset=3 (local.get $p)) (then
      (call $sb (global.get $SB1)) (call $s_con (local.get $p)) (call $sp) (call $sn (i32.load16_u offset=6 (local.get $p)) (i32.const 1))
      (call $lab (global.get $I_CRATE) (i32.const 61))
      ;; "DUE IN 5 DAYS, ON TRUCK 1" / ", READY" / ", NEED 6 MORE" (+ ", SEND TODAY" / ", TOO LATE")
      (call $sb (global.get $SB1)) (call $si (global.get $STR_DUE))
      (call $s_days (i32.sub (i32.load16_u offset=4 (local.get $p)) (i32.load16_u (global.get $S_DAY)))) (call $sep)
      (local.set $ic (global.get $I_CLOCK)) (local.set $c (i32.const 63))
      ;; (a tag only rides an outbound truck: it is set by TRUCK_SEND and dropped on arrival)
      (local.set $h (call $carrier (local.get $s)))
      (if (i32.ge_s (local.get $h) (i32.const 0))
        (then (call $si (global.get $STR_ON_TRUCK)) (call $sn0 (i32.add (local.get $h) (i32.const 1))) (local.set $ic (global.get $I_TRUCK)))
        (else
          (local.set $r (i32.sub (i32.load8_u offset=2 (local.get $p)) (call $inv_count (i32.load8_u (local.get $p)))))
          (if (i32.gt_s (local.get $r) (i32.const 0))
            (then (call $si (global.get $STR_NEED)) (call $sn0 (local.get $r)) (call $si (global.get $STR_MORE)))
            (else (call $si (global.get $STR_READY))))
          ;; late risk: a truck sent today arrives on (SEND TODAY) or after (TOO LATE) the deadline
          (local.set $r (i32.sub (i32.add (i32.load16_u (global.get $S_DAY)) (call $travel_days (i32.load8_u offset=1 (local.get $p))))
                                 (i32.load16_u offset=4 (local.get $p))))
          (if (i32.ge_s (local.get $r) (i32.const 0)) (then
            (call $sep) (call $si (select (global.get $STR_TOO_LATE) (global.get $STR_SEND_TODAY) (local.get $r)))
            (local.set $ic (global.get $I_WARN)) (local.set $c (i32.const 37))))))
      (call $lab (local.get $ic) (local.get $c))))
    (br_if $a (i32.lt_u (local.tee $s (i32.add (local.get $s) (i32.const 1))) (i32.const 3))))
  (if (i32.eqz (local.get $n)) (then (call $ui_label (i32.const -1) (call $str (global.get $STR_NONE)) (i32.const 63)))))

;; Route strip: a dashed dirt road Farm - Town - City with a tiny 3D barn / house / tower over
;; each stop and the destination as a red diamond. The truck drives on the road at
;; 2k / (2T + 1) of its leg (k = days done + 1 out, days left back; T = travel days), so it never
;; sits on a stop while away and is just short of its stop on the last day; it faces the way it
;; goes and bobs while away (static under reduced motion).
(func $route (param $p i32)
  (local $x0 i32) (local $w i32) (local $y i32) (local $m i32) (local $k i32) (local $x i32) (local $ts i32) (local $ph i32) (local $t i32) (local $s i32)
  (local.set $ts (call $ui_ts))
  (local.set $x0 (i32.add (global.get $ux) (i32.mul (i32.const 12) (local.get $ts))))
  (local.set $w (i32.sub (global.get $uw) (i32.mul (i32.const 24) (local.get $ts))))
  (local.set $y (i32.add (global.get $uy) (i32.mul (i32.const 15) (local.get $ts))))
  (local.set $ph (i32.load8_u offset=2 (local.get $p)))
  (local.set $m (i32.load8_u offset=1 (local.get $p)))
  (call $rect (local.get $x0) (i32.sub (local.get $y) (i32.const 2)) (local.get $w) (i32.const 5) (call $pal (i32.const 2)))
  (local.set $x (local.get $x0))
  (loop $d
    (call $rect (local.get $x) (local.get $y) (i32.const 3) (i32.const 1) (call $pal (i32.const 59)))
    (br_if $d (i32.lt_s (local.tee $x (i32.add (local.get $x) (i32.const 7))) (i32.add (local.get $x0) (local.get $w)))))
  (loop $n
    (local.set $x (i32.add (local.get $x0) (i32.shr_s (i32.mul (local.get $k) (local.get $w)) (i32.const 1))))
    ;; 0x93A: barn (Warehouse), house (Bakery), tower (Cold Store) models
    (call $ui_icon (i32.load8_u (i32.add (i32.const 0x93A) (local.get $k))) (i32.sub (local.get $x) (i32.mul (i32.const 12) (local.get $ts)))
      (i32.sub (local.get $y) (i32.mul (i32.const 22) (local.get $ts))) (i32.mul (i32.const 24) (local.get $ts)))
    ;; stop marker: the destination a big red diamond, the others small cream ones (ink rims)
    (local.set $t (i32.and (i32.ne (local.get $ph) (i32.const 0)) (i32.eq (local.get $k) (local.get $m))))
    (call $diamond (local.get $x) (local.get $y) (select (i32.const 6) (i32.const 3) (local.get $t)) (call $pal (i32.const 61)))
    (call $diamond (local.get $x) (local.get $y) (select (i32.const 5) (i32.const 2) (local.get $t)) (call $pal (select (i32.const 38) (i32.const 59) (local.get $t))))
    (local.set $s (call $str (select (i32.add (global.get $STR_MKT) (local.get $k)) (global.get $STR_TAB) (local.get $k))))
    (drop (call $txt (i32.sub (local.get $x) (i32.shr_s (call $tw (local.get $s)) (i32.const 1))) (i32.add (local.get $y) (i32.const 8)) (local.get $s) (call $pal (i32.const 63))))
    (br_if $n (i32.lt_u (local.tee $k (i32.add (local.get $k) (i32.const 1))) (i32.const 3))))
  (local.set $t (call $travel_days (local.get $m)))
  (local.set $k (i32.load8_u offset=3 (local.get $p)))
  (if (i32.eq (local.get $ph) (i32.const 1)) (then (local.set $k (i32.add (i32.sub (local.get $t) (local.get $k)) (i32.const 1)))))
  (local.set $x (i32.add (local.get $x0) (i32.div_s (i32.mul (i32.mul (local.get $w) (local.get $m)) (call $clamp (local.get $k) (i32.const 0) (local.get $t)))
    (i32.add (i32.shl (local.get $t) (i32.const 1)) (i32.const 1)))))
  (global.set $flip (i32.eq (local.get $ph) (i32.const 2)))
  (call $ui_icon (global.get $I_TRUCK) (i32.sub (local.get $x) (i32.shr_s (i32.mul (i32.const 9) (local.get $ts)) (i32.const 1)))
    (i32.sub (i32.sub (local.get $y) (i32.mul (i32.const 7) (local.get $ts)))
      (i32.and (i32.and (i32.ne (local.get $ph) (i32.const 0)) (i32.eqz (global.get $flag_reduced))) (i32.and (i32.shr_u (global.get $now) (i32.const 8)) (i32.const 1))))
    (local.get $ts))
  (global.set $flip (i32.const 0))
  (global.set $uy (i32.add (local.get $y) (i32.add (i32.add (call $lh) (i32.const 8)) (global.get $lgap)))))

;; Filled diamond of radius r centred on (x, y).
(func $diamond (param $x i32) (param $y i32) (param $r i32) (param $c i32)
  (local $i i32) (local $h i32)
  (local.set $i (i32.sub (i32.const 0) (local.get $r)))
  (loop $l
    (local.set $h (i32.sub (local.get $r) (select (local.get $i) (i32.sub (i32.const 0) (local.get $i)) (i32.ge_s (local.get $i) (i32.const 0)))))
    (call $rect (i32.sub (local.get $x) (local.get $h)) (i32.add (local.get $y) (local.get $i)) (i32.add (i32.shl (local.get $h) (i32.const 1)) (i32.const 1)) (i32.const 1) (local.get $c))
    (br_if $l (i32.le_s (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $r)))))

;; Trucks: a card per truck (title + upgrades, status, route strip, DISPATCH, upgrade buttons),
;; then BUY TRUCK; the dispatch flow replaces it while running.
(func $trucks_body
  (local $t i32) (local $p i32) (local $u i32) (local $ph i32) (local $k i32) (local $why i32) (local $c i32) (local $n i32) (local $cols i32)
  (if (i32.ge_s (global.get $dsp) (i32.const 0)) (then (if (call $dispatch_body) (then (return)))))
  (local.set $cols (select (i32.const 3) (i32.const 1)
    (i32.ge_s (global.get $uw) (i32.mul (i32.const 3) (i32.add (i32.mul (i32.const 72) (call $ui_ts)) (i32.const 10))))))
  (loop $tl
    (local.set $p (call $truck_ptr (local.get $t)))
    (if (local.get $p) (then
      (local.set $u (i32.load8_u offset=4 (local.get $p)))
      (local.set $ph (i32.load8_u offset=2 (local.get $p)))
      (if (local.get $t) (then (call $hline (global.get $ux) (global.get $uy) (global.get $uw) (call $pal (i32.const 57)))
        (global.set $uy (i32.add (global.get $uy) (global.get $lgap)))))
      (call $sb (global.get $SB1)) (call $si (global.get $STR_TRUCK)) (call $sn0 (i32.add (local.get $t) (i32.const 1)))
      (call $sc (i32.const 44)) (call $si (global.get $STR_CAP)) (call $sn0 (call $truck_cap_of (local.get $p)))
      (if (i32.and (local.get $u) (i32.const 4)) (then (call $sep) (call $si (i32.add (global.get $STR_UPG) (i32.const 1)))))
      (if (i32.and (local.get $u) (i32.const 8)) (then (call $sep) (call $si (i32.add (global.get $STR_UPG) (i32.const 2)))))
      (call $lab (global.get $I_TRUCK) (i32.const 61))
      (call $sb (global.get $SB1)) (call $si (i32.add (global.get $STR_TST) (local.get $ph)))
      (if (i32.eq (local.get $ph) (i32.const 1)) (then (call $si (i32.add (global.get $STR_MKT) (i32.load8_u offset=1 (local.get $p))))))
      (if (local.get $ph) (then (call $sep) (call $s_days (i32.load8_u offset=3 (local.get $p)))))
      (if (i32.eq (local.get $ph) (i32.const 2)) (then (call $sep) (call $sc (i32.const 43)) (call $sn (i32.load offset=8 (local.get $p)) (i32.const 1))))
      (call $lab (global.get $I_CLOCK) (i32.const 63))
      (call $route (local.get $p))
      ;; a truck on the road has nothing to tap (its status line says where it is)
      (if (i32.eqz (local.get $ph)) (then
      (call $put (i32.add (i32.const 0x280) (local.get $t)) (call $str (global.get $STR_DISPATCH)) (global.get $I_TRUCK) (i32.const 2)
        (i32.const 1) (i32.const 1) (call $btnh))
      (local.set $k (i32.const 0))
      (loop $ul
        (local.set $c (call $k (i32.load8_u (i32.add (i32.const 0x937) (local.get $k)))))
        (local.set $why (call $upg_why (local.get $p) (local.get $k) (local.get $c)))
        (call $sb (global.get $SB2)) (call $si (i32.add (global.get $STR_UPG) (local.get $k))) (call $sn (local.get $c) (i32.const 1))
        (global.set $b_why (local.get $why))
        (call $put (i32.add (i32.add (i32.const 0x290) (i32.shl (local.get $t) (i32.const 2))) (local.get $k)) (global.get $SB2) (i32.const -1) (i32.const 0)
          (i32.eqz (local.get $why)) (local.get $cols) (call $rowh))
        (br_if $ul (i32.lt_u (local.tee $k (i32.add (local.get $k) (i32.const 1))) (i32.const 3))))))))
    (br_if $tl (i32.lt_u (local.tee $t (i32.add (local.get $t) (i32.const 1))) (i32.const 3))))
  ;; BUY TRUCK ($a_buy_truck order: slot = 1 + Garages up to maxTrucks, then cash)
  (local.set $n (i32.load8_u (global.get $S_TRUCK_COUNT)))
  (local.set $why (i32.const 0))
  (if (i32.lt_s (i32.load (global.get $S_CASH)) (call $k (global.get $K_TRUCK_PRICE))) (then (local.set $why (call $err_str (global.get $E_CASH)))))
  (local.set $c (call $count_bld (global.get $BLD_GARAGE)))
  (if (i32.gt_u (local.get $n) (local.get $c)) (then
    (local.set $why (select (call $str (global.get $STR_ANOTHER)) (call $err_str (global.get $E_NEED_GARAGE)) (local.get $c)))))
  (if (i32.ge_u (local.get $n) (call $k (global.get $K_MAX_TRUCKS))) (then (local.set $why (call $err_str (global.get $E_MAX)))))
  (call $sb (global.get $SB2)) (call $si (global.get $STR_BUY_TRUCK)) (call $sn (call $k (global.get $K_TRUCK_PRICE)) (i32.const 1))
  (global.set $b_why (local.get $why))
  (call $put (i32.const 0x20B) (global.get $SB2) (global.get $I_PLUS) (i32.const 0) (i32.eqz (local.get $why)) (i32.const 1) (call $rowh)))

;; Dispatch step panel for truck $dsp: 1 destination (travel days, arrival day), 2 cargo (load
;; bar, FILL BEST, stepper rows priced at the destination), 3 optional contract tag (valid ones
;; only, others with the reason), 4 confirm (arrival, spoilage warnings, expected sales,
;; contract payout, fuel); BACK / NEXT or SEND. Returns 0 (and leaves the flow) when the truck
;; is gone or no longer home.
(func $dispatch_body (result i32)
  (local $p i32) (local $k i32) (local $w i32) (local $g i32) (local $v i32) (local $sp i32) (local $rev i32) (local $a i32)
  (local $cg i32) (local $cq i32) (local $ok i32) (local $why i32) (local $m i32) (local $h i32)
  (local.set $p (call $truck_ptr (global.get $dsp)))
  (if (i32.or (i32.eqz (local.get $p)) (i32.ne (i32.load8_u offset=2 (local.get $p)) (i32.const 0))) (then
    (global.set $dsp (i32.const -1)) (return (i32.const 0))))
  (local.set $m (global.get $dm))
  ;; a tag that stopped being valid (End Day passed its deadline or expired it, cargo changed) is dropped
  (if (i32.lt_u (global.get $dc) (i32.const 3)) (then (if (call $con_why (local.get $p) (global.get $dc)) (then (global.set $dc (i32.const 255))))))
  ;; step bar: four segments, done and current filled
  (local.set $w (i32.div_s (i32.sub (global.get $uw) (i32.mul (i32.const 3) (global.get $lgap))) (i32.const 4)))
  (loop $s
    (call $rrect (i32.add (global.get $ux) (i32.mul (local.get $k) (i32.add (local.get $w) (global.get $lgap)))) (global.get $uy)
      (local.get $w) (i32.const 4) (i32.const 1) (call $pal (select (i32.const 38) (i32.const 57) (i32.le_u (local.get $k) (global.get $dstep)))))
    (br_if $s (i32.lt_u (local.tee $k (i32.add (local.get $k) (i32.const 1))) (i32.const 4))))
  (global.set $uy (i32.add (global.get $uy) (i32.add (global.get $lgap) (i32.const 6))))
  (if (i32.eqz (global.get $dstep)) (then
    (local.set $k (i32.const 1))
    (loop $dl
      (call $sb (global.get $SB1)) (call $s_days (call $travel_days (local.get $k))) (call $sep) (call $si (global.get $STR_ARRIVES))
      (call $sn0 (i32.add (i32.load16_u (global.get $S_DAY)) (call $travel_days (local.get $k))))
      (if (i32.and (i32.eq (local.get $k) (i32.const 2)) (call $event_active (global.get $EV_ROAD_CLOSURE)))
        (then (call $sep) (call $si (i32.add (global.get $STR_EV) (i32.const 3)))))
      (global.set $b_row (i32.const 1)) (global.set $b_sub (global.get $SB1))
      (call $put (i32.add (i32.const 0x238) (local.get $k)) (call $str (i32.add (global.get $STR_MKT) (local.get $k))) (global.get $I_TRUCK)
        (select (i32.const 3) (i32.const 0) (i32.eq (local.get $k) (local.get $m))) (i32.const 1) (i32.const 1) (call $rowh))
      (br_if $dl (i32.le_u (local.tee $k (i32.add (local.get $k) (i32.const 1))) (i32.const 2))))))
  (local.set $v (i32.add (call $cargo_total (local.get $p)) (call $qsum)))
  (if (i32.eq (global.get $dstep) (i32.const 1)) (then
    (call $sb (global.get $SB1)) (call $si (global.get $STR_LOAD)) (call $sn0 (local.get $v)) (call $sc (i32.const 47)) (call $sn0 (call $truck_cap_of (local.get $p)))
    (call $lab (global.get $I_CRATE) (i32.const 61))
    (local.set $h (i32.add (i32.const 4) (i32.shl (call $ui_ts) (i32.const 1))))
    (call $ui_bar (global.get $ux) (global.get $uy) (global.get $uw) (local.get $h) (local.get $v) (call $truck_cap_of (local.get $p)) (i32.const 18))
    (global.set $uy (i32.add (global.get $uy) (i32.add (local.get $h) (i32.add (global.get $lgap) (i32.const 2)))))
    (call $put (i32.const 0x209) (call $str (global.get $STR_FILL)) (global.get $I_STAR) (i32.const 0) (i32.const 1) (i32.const 1) (call $btnh))
    (call $goods_rows (local.get $m))))
  (if (i32.eq (global.get $dstep) (i32.const 2)) (then
    (call $put (i32.const 0x2A3) (call $str (global.get $STR_NO_CON)) (i32.const -1) (select (i32.const 3) (i32.const 0) (i32.eq (global.get $dc) (i32.const 255)))
      (i32.const 1) (i32.const 1) (call $btnh))
    (local.set $k (i32.const 0))
    (loop $cl
      (local.set $a (call $acc_ptr (local.get $k)))
      (if (i32.load8_u offset=3 (local.get $a)) (then
        (local.set $why (call $con_why (local.get $p) (local.get $k)))
        (call $sb (global.get $SB1)) (call $s_con (local.get $a))
        (call $sb (global.get $SB2)) (call $sn (i32.load16_u offset=6 (local.get $a)) (i32.const 1))
        (global.set $b_row (i32.const 1)) (global.set $b_sub (global.get $SB2)) (global.set $b_why (local.get $why))
        (call $put (i32.add (i32.const 0x2A0) (local.get $k)) (global.get $SB1) (i32.load8_u (i32.add (i32.const 0x948) (i32.load8_u (local.get $a))))
          (select (i32.const 3) (i32.const 0) (i32.eq (global.get $dc) (local.get $k))) (i32.eqz (local.get $why)) (i32.const 1) (call $rowh))))
      (br_if $cl (i32.lt_u (local.tee $k (i32.add (local.get $k) (i32.const 1))) (i32.const 3))))))
  (if (i32.eq (global.get $dstep) (i32.const 3)) (then
    (call $sb (global.get $SB1)) (call $si (i32.add (global.get $STR_MKT) (local.get $m))) (call $sep) (call $si (global.get $STR_ARRIVES))
    (call $sn0 (i32.add (i32.load16_u (global.get $S_DAY)) (call $travel_days (local.get $m))))
    (call $lab (global.get $I_TRUCK) (i32.const 61))
    (local.set $cg (i32.const -1))
    (if (i32.lt_u (global.get $dc) (i32.const 3)) (then
      (local.set $a (call $acc_ptr (global.get $dc)))
      (local.set $cg (i32.load8_u (local.get $a))) (local.set $cq (i32.load8_u offset=2 (local.get $a)))))
    ;; the cargo list, a card per good: [icon] "9 SAUCE" / "CONTRACT"  "$88" (units that spoil
    ;; on the way first, then the contract quantity is delivered, the rest sells), then the totals
    (loop $gl
      (local.set $v (i32.add (call $cargo_of (local.get $p) (local.get $g)) (call $q (local.get $g))))
      (if (local.get $v) (then
        (local.set $sp (call $spoil_n (local.get $p) (local.get $g) (call $q (local.get $g))))
        (call $sb (global.get $SB1)) (call $sn0 (local.get $v)) (call $sp) (call $sg (local.get $g))
        (local.set $v (i32.sub (local.get $v) (local.get $sp)))
        (global.set $b_sub (i32.const 0))
        (if (i32.and (i32.eq (local.get $g) (local.get $cg)) (i32.ge_s (local.get $v) (local.get $cq))) (then
          (local.set $v (i32.sub (local.get $v) (local.get $cq))) (local.set $ok (i32.const 1))
          (global.set $b_sub (call $str (i32.add (global.get $STR_STEPN) (i32.const 2))))))
        (call $sb (global.get $SB2))
        ;; the market part ($0 when it all spoils; none when the contract takes it all)
        (if (i32.or (local.get $v) (i32.eqz (global.get $b_sub))) (then
          (local.set $k (call $quote (local.get $m) (local.get $g) (local.get $v)))
          (local.set $rev (i32.add (local.get $rev) (local.get $k)))
          (call $sn (local.get $k) (i32.const 1))))
        (global.set $b_row (i32.const 1)) (global.set $b_right (global.get $SB2))
        (call $put (i32.const 0x2FF) (global.get $SB1) (i32.load8_u (i32.add (i32.const 0x948) (local.get $g))) (i32.const 0) (i32.const 1) (i32.const 1) (call $rowh))
        (if (local.get $sp) (then
          (call $sb (global.get $SB1)) (call $sn0 (local.get $sp)) (call $sp) (call $sg (local.get $g)) (call $si (global.get $STR_SPOIL))
          (call $lab (global.get $I_WARN) (i32.const 37))))))
      (br_if $gl (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13))))
    (call $sb (global.get $SB1)) (call $si (global.get $STR_EST)) (call $sn (local.get $rev) (i32.const 1))
    (call $lab (global.get $I_COIN) (i32.const 61))
    (if (local.get $ok) (then
      (call $sb (global.get $SB1)) (call $si (i32.add (global.get $STR_STEPN) (i32.const 2))) (call $si (global.get $STR_PAYS))
      (call $sn (i32.load16_u offset=6 (local.get $a)) (i32.const 1)) (call $si (global.get $STR_INSTEAD))
      (call $lab (global.get $I_CHECK) (i32.const 61))))
    (if (call $event_active (global.get $EV_FUEL_SPIKE)) (then
      (call $sb (global.get $SB1)) (call $si (global.get $STR_FUEL)) (call $sn (call $k (global.get $K_FUEL_COST)) (i32.const 1))
      (call $lab (global.get $I_WARN) (i32.const 61))))))
  ;; BACK + NEXT (SEND on the last step); NEXT after the cargo step needs something loaded
  (local.set $why (select (call $str (global.get $STR_EMPTY_T)) (i32.const 0) (i32.and (i32.eq (global.get $dstep) (i32.const 1)) (i32.eqz (local.get $v)))))
  (local.set $h (select (call $rowh) (call $btnh) (local.get $why)))
  (call $flush (local.get $h))
  (call $put (i32.const 0x20D) (call $str (global.get $STR_BACK)) (global.get $I_ARROW_L) (i32.const 0) (i32.const 1) (i32.const 2) (local.get $h))
  (global.set $b_why (local.get $why))
  (if (i32.eq (global.get $dstep) (i32.const 3))
    (then (call $put (i32.const 0x20A) (call $str (global.get $STR_SEND)) (global.get $I_TRUCK) (i32.const 2) (i32.const 1) (i32.const 2) (local.get $h)))
    (else (call $put (i32.const 0x20C) (call $str (global.get $STR_NEXT)) (global.get $I_ARROW_R) (i32.const 2) (i32.eqz (local.get $why)) (i32.const 2) (local.get $h))))
  (i32.const 1))

;; Build: the building list (tap = placement), land, loan.
(func $build_body
  (local $o i32) (local $v i32)
  (call $pick_rows (i32.const 2))
  (call $hdr (global.get $STR_LAND))
  (local.set $v (i32.load8_u (global.get $S_GRID)))
  (if (i32.lt_u (local.get $v) (call $k (global.get $K_MAX_GRID)))
    (then (call $land_ui (local.get $v)))
    (else (call $ui_label (global.get $I_CHECK) (call $str (global.get $STR_FULL_FARM)) (i32.const 63))))
  (call $hdr (global.get $STR_LOAN))
  (local.set $o (call $loan_owed))
  (call $sb (global.get $SB1))
  (if (local.get $o)
    (then (call $s_owed (local.get $o)))
    (else (call $si (global.get $STR_NOTHING_OWED)) (call $sep)
      (call $sn0 (i32.div_u (call $k (global.get $K_LOAN_RATE)) (i32.const 100))) (call $sc (i32.const 37))))
  (call $si (global.get $STR_PER_DAY))
  (call $lab (global.get $I_COIN) (i32.const 61))
  (call $sb (global.get $SB1))
  (if (local.get $o)
    (then (call $si (global.get $STR_FIRST)) (call $srow (i32.const 14) (global.get $I_COIN) (call $str (global.get $STR_REPAY)) (global.get $SB1)))
    (else (call $si (global.get $STR_UP_TO)) (call $sn (call $k (global.get $K_LOAN_MAX)) (i32.const 1))
      (call $srow (i32.const 13) (global.get $I_COIN) (call $str (global.get $STR_TAKE)) (global.get $SB1))))
  (call $sb (global.get $SB2))
  (if (local.get $o) (then
    (call $si (global.get $STR_REPAY)) (call $sn (call $q (i32.const 14)) (i32.const 1))
    (global.set $b_why (call $err_str (global.get $E_CASH)))
    (call $put (i32.const 0x20F) (global.get $SB2) (global.get $I_COIN) (i32.const 2) (i32.ne (call $q (i32.const 14)) (i32.const 0)) (i32.const 1) (call $rowh))
    (call $sb (global.get $SB2))))
  (call $si (global.get $STR_TAKE)) (if (i32.eqz (local.get $o)) (then (call $sn (call $q (i32.const 13)) (i32.const 1))))
  (global.set $b_why (call $str (global.get $STR_ONE_LOAN)))
  (call $put (i32.const 0x20E) (global.get $SB2) (global.get $I_PLUS) (i32.const 2) (i32.eqz (local.get $o)) (i32.const 1) (select (call $btnh) (call $rowh) (i32.eqz (local.get $o))))
  ;; the Journal (milestones, score preview)
  (call $put (i32.const 0x3C6) (call $str (i32.add (global.get $STR_SCR) (i32.const 2))) (global.get $I_BOOK) (i32.const 0) (i32.const 1) (i32.const 1) (call $btnh)))

;; "OWED $303, $3" (the day's interest; callers add "/DAY").
(func $s_owed (param $o i32)
  (call $si (global.get $STR_OWED)) (call $sn (local.get $o) (i32.const 1)) (call $sep)
  (call $sn (i32.div_u (i32.mul (local.get $o) (call $k (global.get $K_LOAN_RATE))) (i32.const 10000)) (i32.const 1)))

;; ---------------------------------------------------------------- navigation and actions

;; Act; on error toast it (and shake), on success request a save. SB3 is then empty, ready for
;; the success message. Returns the error code.
(func $do (param $id i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
  (local $e i32)
  (local.set $e (call $act (local.get $id) (local.get $a) (local.get $b) (local.get $c)))
  (if (local.get $e) (then (call $fail (local.get $e))) (else (global.set $want_save (i32.const 1))))
  (call $sb (global.get $SB3))
  (local.get $e))

;; Open the sheet (sliding in unless reduced motion / laptop): a tall one for the tabs.
(func $open_sheet
  (if (i32.eqz (global.get $sheet)) (then
    (global.set $sheet (i32.const 1))
    (global.set $slide_t (select (i32.const -2) (i32.const -1)
      (i32.or (global.get $flag_reduced) (i32.eq (call $lget (global.get $L_MODE)) (i32.const 2)))))))
  (call $layout_panel (i32.add (i32.const 1) (i32.ne (global.get $tab) (i32.const 0)))))

;; Switch to tab t (keys 1-5, the tab bar): transient state (selection, placement, dispatch,
;; amounts, scroll) is cleared; the market sub-tab is kept. Announces the tab name.
(func $set_tab (param $t i32)
  (global.set $sel_tile (i32.const -1)) (global.set $scroll (i32.const 0)) (global.set $arm (i32.const 0))
  (global.set $place (i32.const 0)) (global.set $dsp (i32.const -1))
  (call $qreset)
  (if (local.get $t) (then (global.set $tab (local.get $t)) (call $open_sheet)) (else (call $close)))
  (call $announce (call $str (i32.add (global.get $STR_TAB) (local.get $t)))))

;; Esc / back: an open screen returns where it came from ($pop) (Gazette, Journal, How to play; the others
;; stay); else leave placement, then step the dispatch flow back (leaving it at step 1), then close.
(func $back
  (global.set $dirty (i32.const 1))
  (if (global.get $scr) (then
    (if (i32.and (i32.const 0x4C) (i32.shl (i32.const 1) (global.get $scr))) (then (call $pop)))
    (return)))
  (if (global.get $place) (then (global.set $place (i32.const 0)) (call $open_sheet) (return)))
  (if (i32.ge_s (global.get $dsp) (i32.const 0)) (then
    (if (global.get $dstep) (then (call $step_to (i32.sub (global.get $dstep) (i32.const 1))))
      (else (global.set $dsp (i32.const -1))))
    (return)))
  (call $close))

;; Placement mode: build the chosen building on plot t (a tap or Enter); one placement, then the
;; mode ends. Errors keep the mode (and toast why); a tap off the farm cancels it.
(func $place_at (param $t i32)
  (if (i32.lt_s (local.get $t) (i32.const 0)) (then (call $back) (return)))
  (if (i32.eqz (call $do (i32.const 4) (local.get $t) (i32.sub (global.get $place) (i32.const 1)) (i32.const 0))) (then
    (call $si (global.get $STR_BUILT)) (call $si (i32.add (global.get $STR_BLD) (i32.sub (global.get $place) (i32.const 1))))
    (call $announce (global.get $SB3))
    (call $back))))

;; Instruction bar over the bottom of the farm while placing: "TAP AN EMPTY PLOT: MILL" + CANCEL.
(func $draw_place
  (local $x i32) (local $y i32) (local $w i32) (local $h i32) (local $bw i32) (local $g i32) (local $bh i32)
  (if (i32.eqz (global.get $place)) (then (return)))
  (local.set $g (global.get $lgap))
  (local.set $bh (call $btnh))
  (local.set $h (i32.add (local.get $bh) (i32.shl (local.get $g) (i32.const 1))))
  (local.set $x (i32.add (call $lay_x (global.get $LR_GRID)) (local.get $g)))
  (local.set $w (i32.sub (call $lay_w (global.get $LR_GRID)) (i32.shl (local.get $g) (i32.const 1))))
  (local.set $y (i32.sub (i32.add (call $lay_y (global.get $LR_GRID)) (call $lay_h (global.get $LR_GRID))) (i32.add (local.get $h) (local.get $g))))
  (local.set $bw (call $imax (call $min_touch) (i32.div_s (local.get $w) (i32.const 3))))
  (drop (call $hit_add (local.get $x) (local.get $y) (local.get $w) (local.get $h) (global.get $HIT_PANEL)))
  (call $rrect (local.get $x) (local.get $y) (local.get $w) (local.get $h) (i32.const 3) (call $pal (i32.const 60)))
  (call $sb (global.get $SB1)) (call $s_place)
  (call $fit (global.get $SB1) (i32.sub (local.get $w) (i32.add (local.get $bw) (i32.shl (local.get $g) (i32.const 2)))))
  (drop (call $txt (i32.add (local.get $x) (i32.shl (local.get $g) (i32.const 1))) (i32.add (local.get $y) (i32.shr_s (i32.sub (local.get $h) (call $lh)) (i32.const 1)))
    (global.get $SB1) (call $pal (i32.const 59))))
  (call $btn (i32.const 0x233) (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.add (local.get $bw) (local.get $g))) (i32.add (local.get $y) (local.get $g))
    (local.get $bw) (local.get $bh) (call $str (global.get $STR_CANCEL)) (global.get $I_CLOSE) (i32.const 0) (i32.const 1)))

;; FILL BEST: goods by estimated revenue per unit at the destination (quote of one unit), best
;; first, each up to its stock / the room / the cargo slots left; goods that would all spoil on the
;; way are skipped.
(func $fill_best
  (local $n i32) (local $g i32) (local $b i32) (local $bv i32) (local $v i32) (local $p i32)
  (local.set $p (call $truck_ptr (global.get $dsp)))
  (call $qreset)
  (loop $pick
    (local.set $b (i32.const -1)) (local.set $bv (i32.const 0)) (local.set $g (i32.const 0))
    (loop $l
      ;; what a MAX would load (stock, room, cargo slots); skipped when all of it would spoil
      ;; (spoilage of cargo already on the truck does not count)
      (local.set $v (call $qmax (local.get $g)))
      (if (i32.and (i32.eqz (call $q (local.get $g)))
            (i32.lt_s (i32.sub (call $spoil_n (local.get $p) (local.get $g) (local.get $v)) (call $spoil_n (local.get $p) (local.get $g) (i32.const 0))) (local.get $v))) (then
        (local.set $v (call $quote (global.get $dm) (local.get $g) (i32.const 1)))
        (if (i32.gt_s (local.get $v) (local.get $bv)) (then (local.set $bv (local.get $v)) (local.set $b (local.get $g))))))
      (br_if $l (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13))))
    (if (i32.ge_s (local.get $b) (i32.const 0)) (then (call $adj (local.get $b) (i32.const 2))))
    (br_if $pick (i32.lt_u (local.tee $n (i32.add (local.get $n) (i32.const 1))) (i32.const 13)))))

;; SEND: TRUCK_LOAD each cargo line, then TRUCK_SEND. If a call fails after earlier loads
;; succeeded, every line loaded so far is unloaded again (state bytes as before) and the error toasted.
(func $do_send
  (local $g i32) (local $e i32) (local $lim i32)
  (local.set $lim (i32.const 13))
  (block $x (loop $l
    (if (call $q (local.get $g)) (then
      (local.set $e (call $act (i32.const 10) (global.get $dsp) (local.get $g) (call $q (local.get $g))))
      (if (local.get $e) (then (local.set $lim (local.get $g)) (br $x)))))
    (br_if $l (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13)))))
  (if (i32.eqz (local.get $e)) (then (local.set $e (call $act (i32.const 12) (global.get $dsp) (global.get $dm) (global.get $dc)))))
  (if (local.get $e) (then
    (local.set $g (i32.const 0))
    (loop $u
      (if (i32.and (i32.lt_u (local.get $g) (local.get $lim)) (i32.ne (call $q (local.get $g)) (i32.const 0)))
        (then (drop (call $act (i32.const 11) (global.get $dsp) (local.get $g) (call $q (local.get $g))))))
      (br_if $u (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13))))
    (call $fail (local.get $e))
    (return)))
  (global.set $want_save (i32.const 1))
  (call $sb (global.get $SB3)) (call $si (global.get $STR_TRUCK)) (call $sn0 (i32.add (global.get $dsp) (i32.const 1)))
  (call $si (global.get $STR_SENT)) (call $si (i32.add (global.get $STR_MKT) (global.get $dm))) (call $sep) (call $si (global.get $STR_ARRIVES))
  (call $sn0 (i32.add (i32.load16_u (global.get $S_DAY)) (call $travel_days (global.get $dm))))
  (call $toast (i32.const 3) (global.get $SB3))
  (global.set $dsp (i32.const -1))
  (call $qreset))

;; Tab buttons (codes in the header); returns 1 when c was one of them.
(func $tab_btn (param $c i32) (result i32)
  (local $a i32) (local $o i32) (local $n i32) (local $g i32) (local $c0 i32)
  (global.set $dirty (i32.const 1))
  (local.set $a (i32.and (local.get $c) (i32.const 15)))
  (local.set $o (i32.shr_u (local.get $c) (i32.const 4)))
  (if (i32.and (i32.eq (global.get $tab) (i32.const 4)) (i32.eq (local.get $o) (i32.const 0x22))) (then
    ;; Build tab: a building row starts placement (the portrait sheet gets out of the way)
    (global.set $place (i32.add (local.get $a) (i32.const 1)))
    (global.set $sheet (i32.const 0)) (call $layout_panel (i32.const 0))
    (call $sb (global.get $SB3)) (call $s_place) (call $announce (global.get $SB3))
    (return (i32.const 1))))
  (if (i32.eq (local.get $o) (i32.const 0x23)) (then
    (if (i32.lt_u (local.get $a) (i32.const 3)) (then (global.set $msub (local.get $a)) (global.set $scroll (i32.const 0))
      (call $sb (global.get $SB3)) (call $si (i32.add (global.get $STR_TAB) (i32.const 2))) (call $sp) (call $si (i32.add (global.get $STR_MSUB) (local.get $a)))
      (call $announce (global.get $SB3))))
    (if (i32.eq (local.get $a) (i32.const 3)) (then (call $back)))
    (if (i32.ge_u (local.get $a) (i32.const 9)) (then (global.set $dm (i32.sub (local.get $a) (i32.const 8))) (call $step_to (i32.const 1))))
    (return (i32.const 1))))
  (if (i32.lt_u (i32.sub (local.get $o) (i32.const 0x24)) (i32.const 3)) (then (call $adj (local.get $a) (i32.sub (local.get $o) (i32.const 0x24))) (return (i32.const 1))))
  (if (i32.eq (local.get $o) (i32.const 0x27)) (then
    (if (i32.eqz (call $do (select (i32.const 15) (i32.const 16) (i32.lt_u (local.get $a) (i32.const 4))) (i32.and (local.get $a) (i32.const 3)) (i32.const 0) (i32.const 0)))
      (then (call $announce (call $str (select (global.get $STR_ACCEPTED) (global.get $STR_DECLINED) (i32.lt_u (local.get $a) (i32.const 4)))))))
    (return (i32.const 1))))
  (if (i32.eq (local.get $o) (i32.const 0x28)) (then
    (global.set $dsp (local.get $a)) (global.set $dm (i32.const 1)) (global.set $dc (i32.const 255))
    (global.set $scroll (i32.const 0)) (call $qreset) (call $step_to (i32.const 0))
    (return (i32.const 1))))
  (if (i32.eq (local.get $o) (i32.const 0x29)) (then
    (if (i32.eqz (call $do (i32.const 14) (i32.shr_u (local.get $a) (i32.const 2)) (i32.and (local.get $a) (i32.const 3)) (i32.const 0))) (then
      (call $si (global.get $STR_UPGRADED)) (call $si (global.get $STR_TRUCK)) (call $sn0 (i32.add (i32.shr_u (local.get $a) (i32.const 2)) (i32.const 1)))
      (call $announce (global.get $SB3))))
    (return (i32.const 1))))
  (if (i32.eq (local.get $o) (i32.const 0x2A)) (then (global.set $dc (select (i32.const 255) (local.get $a) (i32.eq (local.get $a) (i32.const 3)))) (return (i32.const 1))))
  (if (i32.lt_u (i32.sub (local.get $c) (i32.const 0x300)) (i32.const 0x40)) (then (call $set_tab (i32.const 0)) (call $select (i32.and (local.get $c) (i32.const 63)) (i32.const 1)) (return (i32.const 1))))
  (if (i32.eq (local.get $c) (i32.const 0x208)) (then
    ;; one SELL_STAND per line; a line is zeroed once sold, so after a failure (toasted by $do)
    ;; the lines already sold cannot be sold twice; the sale so far is toasted too
    (local.set $c0 (i32.load (global.get $S_CASH)))
    (block $x (loop $l
      (if (local.tee $a (call $q (local.get $g))) (then
        (br_if $x (call $do (i32.const 9) (local.get $g) (local.get $a) (i32.const 0)))
        (i32.store (call $qa (local.get $g)) (i32.const 0))
        (local.set $n (i32.add (local.get $n) (local.get $a)))))
      (br_if $l (i32.lt_u (local.tee $g (i32.add (local.get $g) (i32.const 1))) (i32.const 13)))))
    (if (local.get $n) (then
      (call $sb (global.get $SB3)) (call $si (global.get $STR_MP)) (call $sn0 (local.get $n)) (call $si (global.get $STR_UNITS)) (call $sp)
      (call $sc (i32.const 43)) (call $sn (i32.sub (i32.load (global.get $S_CASH)) (local.get $c0)) (i32.const 1))
      (call $toast (i32.const 3) (global.get $SB3))))))
  (if (i32.eq (local.get $c) (i32.const 0x209)) (then (call $fill_best)))
  (if (i32.eq (local.get $c) (i32.const 0x20A)) (then (call $do_send)))
  (if (i32.eq (local.get $c) (i32.const 0x20B)) (then
    (if (i32.eqz (call $do (i32.const 13) (i32.const 0) (i32.const 0) (i32.const 0))) (then
      (call $si (global.get $STR_BOUGHT)) (call $si (global.get $STR_TRUCK)) (call $sn0 (i32.load8_u (global.get $S_TRUCK_COUNT)))
      (call $announce (global.get $SB3))))))
  (if (i32.eq (local.get $c) (i32.const 0x20C)) (then (call $step_to (i32.add (global.get $dstep) (i32.const 1)))))
  (if (i32.eq (local.get $c) (i32.const 0x20D)) (then (call $back)))
  (if (i32.eq (i32.shr_u (local.get $c) (i32.const 1)) (i32.const 0x107)) (then
    ;; 0x20E TAKE / 0x20F REPAY the stepper amount
    (local.set $n (call $q (i32.sub (local.get $c) (i32.const 0x201))))
    (if (i32.eqz (call $do (i32.sub (local.get $c) (i32.const 0x1FD)) (local.get $n) (i32.const 0) (i32.const 0))) (then
      (call $si (select (global.get $STR_BORROWED) (global.get $STR_REPAID) (i32.eq (local.get $c) (i32.const 0x20E)))) (call $sn (local.get $n) (i32.const 1))
      (call $toast (i32.const 3) (global.get $SB3))))))
  ;; (0x2FF, the inert row card, is swallowed too)
  (i32.or (i32.lt_u (i32.sub (local.get $c) (i32.const 0x208)) (i32.const 8)) (i32.eq (local.get $c) (i32.const 0x2FF))))
